import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ACCENT_COLORS,
  DEFAULT_LAYERS,
  DEFAULT_PREFS,
  DEFAULT_SHAPE_STYLE,
  IMAGE_SELECTION,
  SELECT_ALL,
  WorkspaceContext,
  isPixelSpacingMm,
  randomId,
  shapeBBox,
  shapeLayerId,
  type AiDiagnosis,
  type AiCommandResolver,
  type AiFocus,
  type AiHistoryItem,
  type AiCustomCommand,
  type AiResults,
  type AppNotification,
  type LayerDef,
  type LayerId,
  type ImageStateSnapshot,
  type NotificationKind,
  type PatientInfo,
  type PixelSpacingMm,
  type Prefs,
  type SectionId,
  type Shape,
  type ShapeStyle,
  type Viewport,
  type WorkspaceState,
  type WlValue,
} from "./workspace";
import type { ExamImage, Examination, ExamImageMetadata, GradCamResult, ThreeDResult } from "../lib/examinations";
import type { LinearImageBuffer } from "../lib/dicom";
import { linearToDataUrl } from "../lib/dicomRenderer";
import { imageToPngDataUrl } from "../lib/exportImage";
import type { AiActionPlan } from "../lib/workspaceProtocol";
import type { ReportClinicalContext } from "../lib/reports/clinicalContext";
import { buildWorkspaceManifest, captureAnnotatedImage } from "../lib/workspaceProtocol";
import type { AnatomyRegionPayload, OpenCxrImageResult, PathologyResult, WorkspaceAnatomyResult, WorkspaceLandmarksResult, WorkspaceThreeDProgress } from "../lib/workspaceApi";
import { createWorkspaceExam, generateWorkspaceAnatomy, generateWorkspaceAnatomyAnalysis, generateWorkspaceAnatomyRegions, generateWorkspaceLandmarks, generateWorkspacePathology, pathologyColorFor, toAnatomyContext } from "../lib/workspaceApi";
import { ANATOMY_REGIONS } from "../lib/anatomyMap";
import {
  computeLandmarkMeasurements,
  contoursEdited,
  type LandmarkContours,
  type LandmarkOrganKey,
} from "../lib/landmarkMeasure";
import { isSupabaseConfigured } from "../lib/db/supabaseClient";
import {
  mergeRemoteShapes,
  restoreEditorObjects,
  scheduleLandmarkPersist,
  scheduleShapesPersist,
  type EditorShape,
  type LandmarkMeasureInput,
} from "../lib/db/editorPersistence";
import { persistAnatomyRun } from "../lib/db/analysisRunService";
import {
  loadLatestRadioReport,
  persistGeneratedRadioReport,
  persistReportEdit,
  validateReportById,
} from "../lib/db/reportService";

const DEFAULT_COLLAPSED: Record<SectionId, boolean> = {
  document: false,
  image: false,
  gradcam: false,
  anatomy: false,
  landmarks: false,
  anatomymap: false,
  pathology: false,
  diagnostics: false,
  report: false,
};

/** Ordre par défaut des cartes du panneau droit (Application cohérente après
    une réinitialisation ou un premier lancement). */
const DEFAULT_CARD_ORDER: SectionId[] = [
  "document",
  "image",
  "gradcam",
  "anatomy",
  "landmarks",
  "anatomymap",
  "pathology",
  "diagnostics",
  "report",
];



/** Préfixe d'actionId des formes de mesure landmarks posées sur le canvas. */
const LANDMARK_SHAPE_PREFIX = "landmarks:";

/** Préfixe d'actionId des boxes de détection pathologies (formes rectangles). */
const PATHOLOGY_SHAPE_PREFIX = "pathology:";

const cloneShape = (s: Shape): Shape => ({
  ...s,
  points: s.points.map((p) => ({ ...p })),
});

/** Copie profonde des contours HybridGNet (édition sans muter la sortie modèle). */
const cloneContours = (source: WorkspaceLandmarksResult["contours"]): LandmarkContours => {
  const out = {} as LandmarkContours;
  for (const key of Object.keys(source) as LandmarkOrganKey[]) {
    const c = source[key];
    out[key] = { x: [...c.x], y: [...c.y], std: [...c.std] };
  }
  return out;
};

/** Full history snapshot: drawings + shape transforms + image adjustments */
interface Snapshot {
  shapes: Shape[];
  wl: WlValue;
  brightness: number;
  contrast: number;
  inverted: boolean;
  rotation: number;
  flipH: boolean;
  flipV: boolean;
}

const cloneWithOffset = (s: Shape, dx: number, dy: number): Shape => ({
  ...cloneShape(s),
  id: randomId(),
  x: s.x + dx,
  y: s.y + dy,
  points: s.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
});

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem("aimaging.prefs");
    return raw ? { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Prefs>) } : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

function loadShapeStyle(): ShapeStyle {
  try {
    const raw = localStorage.getItem("aimaging.shapeStyle");
    return raw
      ? { ...DEFAULT_SHAPE_STYLE, ...(JSON.parse(raw) as Partial<ShapeStyle>) }
      : DEFAULT_SHAPE_STYLE;
  } catch {
    return DEFAULT_SHAPE_STYLE;
  }
}

/* Observations anatomiques éditées manuellement : persistées par image
   (clé locale `aimaging.anatomyObs.<imageId>`), prioritaires sur l'IA. */
function anatomyOverridesStorageKey(imageId: string): string {
  return `aimaging.anatomyObs.${imageId}`;
}

function loadAnatomyOverrides(imageId: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(anatomyOverridesStorageKey(imageId));
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function persistAnatomyOverrides(imageId: string, overrides: Record<string, string>): void {
  try {
    localStorage.setItem(anatomyOverridesStorageKey(imageId), JSON.stringify(overrides));
  } catch {
    /* localStorage indisponible — l'édition reste en mémoire pour la session */
  }
}

export function WorkspaceProvider({
  children,
  autoRestore = true,
  /** Phase Database 6 : legacy id de l'examen ouvert — requis pour rattacher
   *  les analysis_runs ; null en éditeur autonome (pas de run persisté). */
  persistenceExamId = null,
}: {
  children: ReactNode;
  /** When true, the standalone editor restores the auto-saved document on mount.
   *  Disable when opening the editor with an examination image. */
  autoRestore?: boolean;
  persistenceExamId?: string | null;
}) {
  const [tool, setTool] = useState<WorkspaceState["tool"]>("move");
  const [selection, setSelection] = useState<string | null>("image");

  /* ------------------------------ Shapes + history ------------------------------ */
  const [shapes, setShapesState] = useState<Shape[]>([]);
  const shapesRef = useRef<Shape[]>([]);
  const pastRef = useRef<Snapshot[]>([]);
  const futureRef = useRef<Snapshot[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const commit = useCallback((next: Shape[]) => {
    shapesRef.current = next;
    setShapesState(next);
  }, []);

  /* Adjustment state + refs (history snapshots read the refs, so gesture-driven
     changes are captured even before React re-renders). */
  const [wlState, setWlState] = useState<WlValue>({ window: 255, level: 127.5 });
  const wlRef = useRef<WlValue>({ window: 255, level: 127.5 });
  const [brightnessState, setBrightnessState] = useState(50);
  const brightnessRef = useRef(50);
  const [contrastState, setContrastState] = useState(50);
  const contrastRef = useRef(50);
  const [invertedState, setInvertedState] = useState(false);
  const invertedRef = useRef(false);
  const [rotationState, setRotationState] = useState(0);
  const rotationRef = useRef(0);
  const [flipHState, setFlipHState] = useState(false);
  const flipHRef = useRef(false);
  const [flipVState, setFlipVState] = useState(false);
  const flipVRef = useRef(false);

  const setWl = useCallback((v: WlValue) => {
    wlRef.current = v;
    setWlState(v);
  }, []);
  const setBrightness = useCallback((v: number) => {
    brightnessRef.current = v;
    setBrightnessState(v);
  }, []);
  const setContrast = useCallback((v: number) => {
    contrastRef.current = v;
    setContrastState(v);
  }, []);
  const setInverted = useCallback((v: boolean) => {
    invertedRef.current = v;
    setInvertedState(v);
  }, []);
  const setRotation = useCallback((v: number) => {
    rotationRef.current = v;
    setRotationState(v);
  }, []);
  const setFlipH = useCallback((v: boolean) => {
    flipHRef.current = v;
    setFlipHState(v);
  }, []);
  const setFlipV = useCallback((v: boolean) => {
    flipVRef.current = v;
    setFlipVState(v);
  }, []);

  /* Current values (aliases over the state halves, kept for the context value) */
  const wl = wlState;
  const brightness = brightnessState;
  const contrast = contrastState;
  const inverted = invertedState;
  const rotation = rotationState;
  const flipH = flipHState;
  const flipV = flipVState;

  const [prefs, setPrefsState] = useState<Prefs>(loadPrefs);
  const setPrefs = useCallback((p: Partial<Prefs>) => {
    setPrefsState((prev) => {
      const next = { ...prev, ...p };
      try {
        localStorage.setItem("aimaging.prefs", JSON.stringify(next));
      } catch {
        /* storage unavailable */
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--color-accent", prefs.accent);
    root.style.setProperty("--color-accent-2", prefs.accent);
  }, [prefs.accent]);

  const currentSnapshot = useCallback((): Snapshot => ({
    shapes: shapesRef.current.map(cloneShape),
    wl: { ...wlRef.current },
    brightness: brightnessRef.current,
    contrast: contrastRef.current,
    inverted: invertedRef.current,
    rotation: rotationRef.current,
    flipH: flipHRef.current,
    flipV: flipVRef.current,
  }), []);

  const restoreSnapshot = useCallback((s: Snapshot) => {
    commit(s.shapes);
    setWl(s.wl);
    setBrightness(s.brightness);
    setContrast(s.contrast);
    setInverted(s.inverted);
    setRotation(s.rotation);
    setFlipH(s.flipH);
    setFlipV(s.flipV);
  }, [commit, setWl, setBrightness, setContrast, setInverted, setRotation, setFlipH, setFlipV]);

  const pushHistory = useCallback(() => {
    pastRef.current.push(currentSnapshot());
    if (pastRef.current.length > prefs.undoCap) pastRef.current.shift();
    futureRef.current = [];
    setCanUndo(true);
    setCanRedo(false);
  }, [currentSnapshot, prefs.undoCap]);

  const undo = useCallback(() => {
    const past = pastRef.current;
    if (past.length === 0) return;
    futureRef.current.push(currentSnapshot());
    restoreSnapshot(past.pop() as Snapshot);
    setCanUndo(past.length > 0);
    setCanRedo(true);
  }, [currentSnapshot, restoreSnapshot]);

  const redo = useCallback(() => {
    const future = futureRef.current;
    if (future.length === 0) return;
    pastRef.current.push(currentSnapshot());
    restoreSnapshot(future.pop() as Snapshot);
    setCanRedo(future.length > 0);
    setCanUndo(true);
  }, [currentSnapshot, restoreSnapshot]);

  const addShape = useCallback((s: Shape) => {
    commit([...shapesRef.current, s]);
  }, [commit]);

  const updateShape = useCallback((id: string, patch: Partial<Shape>) => {
    commit(shapesRef.current.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }, [commit]);

  const removeShape = useCallback((id: string) => {
    commit(shapesRef.current.filter((s) => s.id !== id));
  }, [commit]);

  const removeShapes = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    const set = new Set(ids);
    commit(shapesRef.current.filter((s) => !set.has(s.id)));
  }, [commit]);

  const resetDocument = useCallback(() => {
    pastRef.current = [];
    futureRef.current = [];
    commit([]);
    setCanUndo(false);
    setCanRedo(false);
  }, [commit]);

  /* ------------------------------ Real crop ------------------------------ */

  const translateShape = (s: Shape, dx: number, dy: number): Shape => ({
    ...s,
    x: s.x + dx,
    y: s.y + dy,
    points: s.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
  });

  const [view, setViewState] = useState<Viewport>({ s: 0.6, x: 0, y: 0 });
  const viewRef = useRef<Viewport>({ s: 0.6, x: 0, y: 0 });
  const setView = useCallback((v: Viewport) => {
    const cur = viewRef.current;
    if (cur.s === v.s && cur.x === v.x && cur.y === v.y) return;
    viewRef.current = v;
    setViewState(v);
  }, []);
  const [viewB, setViewBState] = useState<Viewport>({ s: 0.6, x: 0, y: 0 });
  const viewBRef = useRef<Viewport>({ s: 0.6, x: 0, y: 0 });
  const setViewB = useCallback((v: Viewport) => {
    const cur = viewBRef.current;
    if (cur.s === v.s && cur.x === v.x && cur.y === v.y) return;
    viewBRef.current = v;
    setViewBState(v);
  }, []);
  const [splitOn, setSplitOn] = useState(false);
  const [activePane, setActivePaneState] = useState<"A" | "B">("A");
  const activePaneRef = useRef<"A" | "B">("A");
  const setActivePane = useCallback((p: "A" | "B") => {
    activePaneRef.current = p;
    setActivePaneState(p);
  }, []);
  const activeView = activePane === "B" ? viewB : view;
  const setActiveView = useCallback((v: Viewport) => {
    if (activePaneRef.current === "B") setViewB(v);
    else setView(v);
  }, [setViewB, setView]);
  const [zoomPreset, setZoomPreset] = useState<"fit" | "actual">("fit");
  const [toolbarOpen, setToolbarOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [rightWidth, setRightWidth] = useState(352);
  const [probe, setProbe] = useState<{ x: number; y: number; ts: number } | null>(null);
  const [gridOn, setGridOn] = useState(false);
  const [rulersOn, setRulersOn] = useState(false);
  const [statusBarOpen, setStatusBarOpen] = useState(true);

  const setPixelGrid = useCallback((on: boolean) => {
    setGridOn(on);
    if (on) setPrefs({ gridStyle: "lines", gridSize: 1 });
  }, [setPrefs, setGridOn]);

  const toggleGrid = useCallback(() => {
    setGridOn((on) => {
      const next = !on;
      if (next && prefs.gridStyle === "lines" && prefs.gridSize === 1) {
        setPrefs({ gridStyle: "dots", gridSize: 28 });
      }
      return next;
    });
  }, [prefs, setPrefs, setGridOn]);
  /* -------------------------------- Layers -------------------------------- */

  const [layers, setLayers] = useState<LayerDef[]>(DEFAULT_LAYERS);
  const gradcamResultRef = useRef<GradCamResult | null>(null);
  const [gradcamResult, setGradcamResultState] = useState<GradCamResult | null>(null);
  const setGradcamResult = useCallback((result: GradCamResult | null) => {
    gradcamResultRef.current = result;
    setGradcamResultState(result);
  }, []);
  const [pixelSpacingMm, setPixelSpacingMmState] = useState<PixelSpacingMm | null>(null);
  const setPixelSpacingMm = useCallback((spacing: PixelSpacingMm | null) => {
    setPixelSpacingMmState(spacing);
  }, []);
  const [gradcamOn, setGradcamOnState] = useState(false);
  const setGradcamOn = useCallback((v: boolean) => {
    setGradcamOnState(v);
    setLayers((prev) =>
      prev.map((l) => (l.id === "gradcam" ? { ...l, visible: v } : l)),
    );
  }, []);
  const [gradcamIntensity, setGradcamIntensity] = useState(62);
  const [gradcamMode, setGradcamMode] = useState<"blue" | "heatmap">("blue");

  /* --------------------------- Segmentation anatomique --------------------------- */
  const [anatomyResult, setAnatomyResultState] = useState<WorkspaceAnatomyResult | null>(null);
  const anatomyResultRef = useRef<WorkspaceAnatomyResult | null>(null);
  const [anatomyLoading, setAnatomyLoading] = useState(false);
  const anatomyLoadingRef = useRef(false);
  const [anatomyError, setAnatomyError] = useState<string | null>(null);
  const [anatomyCardOpen, setAnatomyCardOpenState] = useState(false);
  const anatomyCardOpenRef = useRef(false);
  const [anatomySelected, setAnatomySelectedState] = useState<string | null>(null);
  const [anatomyRegionTexts, setAnatomyRegionTextsState] = useState<Record<string, string>>({});
  const anatomyRegionTextsRef = useRef<Record<string, string>>({});
  const [anatomyRegionTextsLoading, setAnatomyRegionTextsLoading] = useState(false);
  const anatomyRegionTextsLoadingRef = useRef(false);
  const [anatomyRegionTextsError, setAnatomyRegionTextsError] = useState<string | null>(null);
  /* Régions signalées avec anomalie par l'IA (id de région -> true). */
  const [anatomyRegionAnomalies, setAnatomyRegionAnomaliesState] = useState<Record<string, boolean>>({});
  const anatomyRegionAnomaliesRef = useRef<Record<string, boolean>>({});
  /* Observations éditées manuellement par région (prioritaires sur le texte IA). */
  const [anatomyRegionOverrides, setAnatomyRegionOverridesState] = useState<Record<string, string>>({});

  /* --------------------- Pathologies (backend « Neuro ») --------------------- */
  const [pathologyResult, setPathologyResultState] = useState<PathologyResult | null>(null);
  const pathologyResultRef = useRef<PathologyResult | null>(null);
  const [pathologyLoading, setPathologyLoading] = useState(false);
  const pathologyLoadingRef = useRef(false);
  const [pathologyError, setPathologyError] = useState<string | null>(null);
  const [pathologyCardOpen, setPathologyCardOpenState] = useState(false);
  const pathologyCardOpenRef = useRef(false);
  /** Affichages canvas de la détection : boxes YOLO (formes posées) et
      heatmap Grad-CAM — deux toggles indépendants, comme gradcamOn. */
  const [pathologyBoxesOn, setPathologyBoxesOn] = useState(true);
  const [pathologyHeatmapOn, setPathologyHeatmapOn] = useState(false);
  /** Heatmap choisie : null = composite globale, sinon individual_heatmaps[key]. */
  const [pathologyHeatmapKey, setPathologyHeatmapKey] = useState<string | null>(null);

  /* --------------------------- Landmarks (HybridGNet) --------------------------- */
  const [landmarkResult, setLandmarkResultState] = useState<WorkspaceLandmarksResult | null>(null);
  const landmarkResultRef = useRef<WorkspaceLandmarksResult | null>(null);
  const [landmarkLoading, setLandmarkLoading] = useState(false);
  const landmarkLoadingRef = useRef(false);
  const [landmarkError, setLandmarkError] = useState<string | null>(null);
  const [landmarkCardOpen, setLandmarkCardOpenState] = useState(false);
  const landmarkCardOpenRef = useRef(false);
  const [landmarksSelected, setLandmarksSelectedState] = useState<string | null>(null);
  /* --- Édition des contours (modelage des mesures) --- */
  const [landmarkContours, setLandmarkContoursState] = useState<LandmarkContours | null>(null);
  const landmarkContoursRef = useRef<LandmarkContours | null>(null);
  /* Mesures recalculées depuis les contours (base) — réplique du calcul
     serveur, voir lib/landmarkMeasure.ts. Les droites posées sur le canvas
     priment ensuite (voir landmarkLive plus bas). */
  const landmarkBase = useMemo(
    () => (landmarkContours ? computeLandmarkMeasurements(landmarkContours, pixelSpacingMm) : null),
    [landmarkContours, pixelSpacingMm],
  );
  const landmarkEdited = useMemo(
    () => contoursEdited(landmarkContours, landmarkResult?.contours),
    [landmarkContours, landmarkResult],
  );

  /* ------------------------------ OpenCXR (tri + normalisation) ------------------------------ */
  const [cxrResult, setCxrResultState] = useState<OpenCxrImageResult | null>(null);
  const cxrResultRef = useRef<OpenCxrImageResult | null>(null);
  const setCxrResult = useCallback((result: OpenCxrImageResult | null) => {
    cxrResultRef.current = result;
    setCxrResultState(result);
  }, []);

  const threeDResultRef = useRef<ThreeDResult | null>(null);
  const [threeDResult, setThreeDResultState] = useState<ThreeDResult | null>(null);
  const setThreeDResult = useCallback((result: ThreeDResult | null) => {
    threeDResultRef.current = result;
    setThreeDResultState(result);
  }, []);
  const [threeDOn, setThreeDOnState] = useState(false);
  const setThreeDOn = useCallback((v: boolean) => setThreeDOnState(v), []);
  const [threeDRunning, setThreeDRunningState] = useState(false);
  const setThreeDRunning = useCallback((v: boolean) => setThreeDRunningState(v), []);
  const [threeDProgress, setThreeDProgressState] = useState<WorkspaceThreeDProgress | null>(null);
  const setThreeDProgress = useCallback((p: WorkspaceThreeDProgress | null) => setThreeDProgressState(p), []);

  const setLayerVisible = useCallback(
    (id: LayerId, visible: boolean) => {
      setLayers((prev) => prev.map((l) => (l.id === id ? { ...l, visible } : l)));
      if (id === "gradcam") setGradcamOn(visible);
    },
    [setGradcamOn],
  );

  const setLayerLocked = useCallback((id: LayerId, locked: boolean) => {
    setLayers((prev) => prev.map((l) => (l.id === id ? { ...l, locked } : l)));
    if (locked) {
      setSelection((sel) => {
        if (sel === null || sel === IMAGE_SELECTION || sel === SELECT_ALL) return sel;
        const shape = shapesRef.current.find((s) => s.id === sel);
        return shape && shapeLayerId(shape) === id ? null : sel;
      });
    }
  }, []);

  const setLayerName = useCallback((id: LayerId, name: string) => {
    setLayers((prev) => prev.map((l) => (l.id === id ? { ...l, name } : l)));
  }, []);

  const setLayerOpacity = useCallback((id: LayerId, opacity: number) => {
    setLayers((prev) => prev.map((l) => (l.id === id ? { ...l, opacity } : l)));
  }, []);

  const moveLayer = useCallback((id: LayerId, toIndex: number) => {
    if (id === "image") return;
    setLayers((prev) => {
      const from = prev.findIndex((l) => l.id === id);
      if (from < 0) return prev;
      const target = Math.max(1, Math.min(prev.length - 1, toIndex));
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(target, 0, item);
      return next;
    });
  }, []);

  const deleteLayerContent = useCallback(
    (id: LayerId) => {
      if (id === "annotations" || id === "measurements") {
        const ids = shapesRef.current
          .filter((s) => shapeLayerId(s) === id)
          .map((s) => s.id);
        if (ids.length > 0) {
          pushHistory();
          removeShapes(ids);
        }
      }
      if (id === "gradcam") setGradcamOn(false);
    },
    [pushHistory, removeShapes, setGradcamOn],
  );

  const [collapsed, setCollapsed] = useState(DEFAULT_COLLAPSED);
  const [analysis, setAnalysis] = useState<WorkspaceState["analysis"]>("idle");
  const [cursorPos, setCursorPosState] = useState<{ x: number; y: number } | null>(null);
  const setCursorPos = useCallback((p: { x: number; y: number } | null) => {
    setCursorPosState((prev) =>
      prev?.x === p?.x && prev?.y === p?.y ? prev : p,
    );
  }, []);
  const [imageSrc, setImageSrc] = useState("");
  const [imageId, setImageId] = useState<string | null>(null);
  const imageIdRef = useRef<string | null>(null);
  const imageSrcRef = useRef("");
  const [imageName, setImageName] = useState("Chest X-Ray ÔÇö PA");
  const [imageMetadata, setImageMetadataState] = useState<ExamImageMetadata | null>(null);
  const setImageMetadata = useCallback((metadata: ExamImageMetadata | null) => {
    setImageMetadataState(metadata);
  }, []);
  const imageMetadataRef = useRef<ExamImageMetadata | null>(null);
  const [fitSignal, setFitSignal] = useState<{ a: number; b: number }>({ a: 0, b: 0 });
  const [dims, setDims] = useState({ w: 1200, h: 1063 });
  const imageNameRef = useRef("Chest X-Ray ÔÇö PA");
  const dimsRef = useRef({ w: 1200, h: 1063 });

  /* ------------------------- Infos patient éditables -----------------------
     Carte « Document » du panneau droit. Pré-remplissage depuis les
     métadonnées DICOM de l'image active (jamais d'écrasement des champs
     déjà saisis) ; injectées ensuite dans les rapports exportés. */
  const [patientInfo, setPatientInfoState] = useState<PatientInfo>({
    name: "",
    patientId: "",
    age: "",
    sex: "",
    studyDate: new Date().toISOString().slice(0, 10),
    modality: "CR",
    study: "CHEST PA",
  });
  const setPatientInfo = useCallback((patch: Partial<PatientInfo>) => {
    setPatientInfoState((p) => ({ ...p, ...patch }));
  }, []);
  useEffect(() => {
    if (!imageMetadata) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPatientInfoState((p) => ({
      ...p,
      name: p.name || imageMetadata.patientPseudonym || "",
      studyDate: p.studyDate || imageMetadata.studyDate || p.studyDate,
      modality: imageMetadata.modality || p.modality,
      study:
        p.study && p.study !== "CHEST PA"
          ? p.study
          : imageMetadata.studyDescription || imageMetadata.bodyPartExamined
            ? `${imageMetadata.bodyPartExamined ?? ""}${imageMetadata.viewPosition ? ` ${imageMetadata.viewPosition}` : ""}`.trim() || imageMetadata.studyDescription || p.study
            : p.study,
    }));
  }, [imageMetadata]);


  useEffect(() => {
    imageIdRef.current = imageId;
    imageSrcRef.current = imageSrc;
    imageNameRef.current = imageName;
    imageMetadataRef.current = imageMetadata;
    dimsRef.current = dims;
  }, [imageId, imageSrc, imageName, imageMetadata, dims]);

  /* Changement d'image : le résultat de segmentation et la sélection du
     canvas précédent ne s'appliquent plus à la nouvelle image.
     (Réinitialisation volontaire dans un effet de synchronisation —
     l'appel direct des setters dans l'effet est requis ici, sans effet
     d'indirection possible sur des setters bruts de useState.) */
  useEffect(() => {
    if (!imageId) return;
    anatomyResultRef.current = null;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAnatomyResultState(null);
    setAnatomySelectedState(null);
    setAnatomyError(null);
    anatomyRegionTextsRef.current = {};
    setAnatomyRegionTextsState({});
    setAnatomyRegionTextsError(null);
    anatomyRegionAnomaliesRef.current = {};
    setAnatomyRegionAnomaliesState({});
    setAnatomyRegionOverridesState(loadAnatomyOverrides(imageId));
    pathologyResultRef.current = null;
    setPathologyResultState(null);
    setPathologyError(null);
    landmarkResultRef.current = null;
    setLandmarkResultState(null);
    setLandmarksSelectedState(null);
    setLandmarkError(null);
    landmarkContoursRef.current = null;
    setLandmarkContoursState(null);
    cxrResultRef.current = null;
    setCxrResultState(null);
  }, [imageId]);

  /* --- Droites de mesure posées sur le canvas : source de vérité temps réel ---
     Dès que « Poser les mesures » a posé les droites (formes landmarks:*),
     les déplacer / les étirer recalcule diamètres et CTR en direct :
     la géométrie des formes (espace image) est reconvertie en unités de la
     grille 1024 du modèle, puis convertie mm comme côté serveur. */
  const landmarkLineGeometry = useMemo(() => {
    const heart = shapes.find((s) => s.actionId === `${LANDMARK_SHAPE_PREFIX}heart_transverse`);
    const thorax = shapes.find((s) => s.actionId === `${LANDMARK_SHAPE_PREFIX}thorax_transverse`);
    if (!heart || !thorax || dims.w <= 0 || dims.h <= 0) return null;
    const gridLen = (shape: Shape) =>
      Math.hypot((shape.w / dims.w) * 1024, (shape.h / dims.h) * 1024);
    return { heartW: gridLen(heart), thoraxW: gridLen(thorax) };
  }, [shapes, dims]);

  /* Mesures exposées à l'UI : base contours, avec priorité aux droites posées
     pour CTR + diamètres transverses. Les incertitudes du modèle sont
     conservées proportionnellement aux nouvelles valeurs. */
  const landmarkLive = useMemo(() => {
    if (!landmarkBase) return null;
    if (!landmarkLineGeometry) return landmarkBase;
    const { heartW, thoraxW } = landmarkLineGeometry;
    const model = landmarkResult?.status === "ok" ? landmarkResult.measurements : null;
    const pxOnly = !pixelSpacingMm;
    const scale = pxOnly ? 1 : (pixelSpacingMm[0] + pixelSpacingMm[1]) / 2;
    const unitLen: "px" | "mm" = pxOnly ? "px" : "mm";
    const relStd = (key: "heart_transverse_diameter" | "thorax_transverse_diameter") => {
      const m = model?.[key];
      return m && m.value > 0 ? m.std / m.value : 0;
    };
    const hStd = relStd("heart_transverse_diameter");
    const tStd = relStd("thorax_transverse_diameter");
    const ctr = thoraxW > 0 ? heartW / thoraxW : 0;
    const r3 = (v: number) => Math.round(v * 1000) / 1000;
    return {
      ...landmarkBase,
      measurements: {
        ...landmarkBase.measurements,
        ctr: { value: r3(ctr), std: r3(ctr * Math.hypot(hStd, tStd)), unit: "ratio" as const },
        heart_transverse_diameter: {
          value: r3(heartW * scale),
          std: r3(heartW * scale * hStd),
          unit: unitLen,
        },
        thorax_transverse_diameter: {
          value: r3(thoraxW * scale),
          std: r3(thoraxW * scale * tStd),
          unit: unitLen,
        },
      },
    };
  }, [landmarkBase, landmarkLineGeometry, landmarkResult, pixelSpacingMm]);

  /* ---------------- Phase Database 5 : persistance annotations/mesures ----------------
     Workflow imposé (SUITE.md §4/§9/§10) : state local → UI instantanée →
     snapshot undo → flush débounced vers Supabase. Undo/redo reste 100 % local. */
  const editorRestoringRef = useRef(false);
  /* Phase Database 6 : contexte examen pour l'analyse_runs + id du dernier run
     HybridGNet réussi, rattaché aux mesures persistées (reliquat Phase 5 corrigé). */
  const persistenceExamIdRef = useRef<string | null>(persistenceExamId);
  useEffect(() => {
    persistenceExamIdRef.current = persistenceExamId;
  }, [persistenceExamId]);
  const [landmarkRunId, setLandmarkRunId] = useState<string | null>(null);

  useEffect(() => {
    if (!imageId || !isSupabaseConfigured) return;
    let cancelled = false;
    editorRestoringRef.current = true;
    restoreEditorObjects(imageId)
      .then((restored) => {
        if (cancelled || restored === null || restored.shapes.length === 0) return;
        /* LWW §21 : le distant remplace les ids communs ; les shapes
           locale-only sont conservées (aucune perte automatique). */
        commit(mergeRemoteShapes(shapesRef.current, restored.shapes as EditorShape[]) as unknown as Shape[]);
      })
      .catch((exc: unknown) => {
        console.error("[db] Restauration des annotations impossible (cache local utilisé).", exc);
      })
      .finally(() => {
        if (!cancelled) editorRestoringRef.current = false;
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageId]);

  useEffect(() => {
    if (editorRestoringRef.current || !imageId) return;
    scheduleShapesPersist(imageId, shapes as EditorShape[]);
  }, [shapes, imageId]);

  useEffect(() => {
    if (!imageId || !landmarkLive) return;
    const inputs: LandmarkMeasureInput[] = Object.entries(landmarkLive.measurements).map(
      ([key, raw]) => {
        const entry = raw as { value: number; std?: number; unit: string; label?: string };
        return {
          key,
          label: entry.label ?? key,
          value: entry.value,
          std: entry.std,
          unit: entry.unit,
        };
      },
    );
    if (inputs.length > 0) scheduleLandmarkPersist(imageId, inputs, { analysisRunId: landmarkRunId });
  }, [landmarkLive, imageId, landmarkRunId]);

  /* L'étiquette CTR posée sur le canvas suit les droites en temps réel.
     Mise à jour directe via commit() : pas d'entrée dans l'historique
     d'annulation pendant le drag. */
  const landmarkCtrLabel = useMemo(() => {
    const ctr = landmarkLive?.measurements.ctr;
    return ctr ? `CTR = ${ctr.value.toFixed(3)} ± ${ctr.std.toFixed(3)}` : null;
  }, [landmarkLive]);

  useEffect(() => {
    if (!landmarkCtrLabel) return;
    const target = shapesRef.current.find((s) => s.actionId === `${LANDMARK_SHAPE_PREFIX}ctr`);
    if (!target || target.label === landmarkCtrLabel) return;
    commit(shapesRef.current.map((s) => (s.id === target.id ? { ...s, label: landmarkCtrLabel } : s)));
  }, [landmarkCtrLabel, commit]);

  const [dicomLinear, setDicomLinearState] = useState<LinearImageBuffer | null>(null);
  const setDicomLinear = useCallback((buffer: LinearImageBuffer | null) => {
    setDicomLinearState((prev) => (prev === buffer ? prev : buffer));
    if (buffer) setDims({ w: buffer.width, h: buffer.height });
  }, []);
  const [crop, setCrop] = useState<WorkspaceState["crop"]>(null);

  /* Rendu pr├¬t ├á afficher : fen├¬trage natif pour les DICOM lin├®aires, sinon
     l'image source (le filtre CSS prend le relais). */
  const renderSrc = useMemo(() => {
    if (!dicomLinear || !imageSrc) return imageSrc;
    return linearToDataUrl(dicomLinear, { wl, brightness, contrast, inverted });
  }, [dicomLinear, imageSrc, wl, brightness, contrast, inverted]);

  const resetImageAdjustments = useCallback(() => {
    setRotation(0);
    setFlipH(false);
    setFlipV(false);
    setWl({ window: 255, level: 127.5 });
    setBrightness(50);
    setContrast(50);
    setInverted(false);
    setCrop(null);
    setGradcamOn(false);
    setGradcamResult(null);
    setThreeDOn(false);
    setThreeDResult(null);
    setThreeDRunning(false);
    setThreeDProgress(null);
    setPixelSpacingMm(null);
    setSelection(null);
    anatomyResultRef.current = null;
    setAnatomyResultState(null);
    setAnatomySelectedState(null);
    setAnatomyError(null);
    anatomyRegionTextsRef.current = {};
    setAnatomyRegionTextsState({});
    setAnatomyRegionTextsError(null);
    anatomyRegionAnomaliesRef.current = {};
    setAnatomyRegionAnomaliesState({});
    pathologyResultRef.current = null;
    setPathologyResultState(null);
    setPathologyError(null);
    landmarkResultRef.current = null;
    setLandmarkResultState(null);
    setLandmarksSelectedState(null);
    setLandmarkError(null);
    landmarkContoursRef.current = null;
    setLandmarkContoursState(null);
    cxrResultRef.current = null;
    setCxrResultState(null);
  }, [setRotation, setFlipH, setFlipV, setWl, setBrightness, setContrast, setInverted, setGradcamOn, setGradcamResult, setThreeDOn, setThreeDResult, setThreeDRunning, setThreeDProgress, setPixelSpacingMm]);
  const [shapeStyle, setShapeStyle] = useState<ShapeStyle>(loadShapeStyle);

  /* ------------------------------ Clipboard ------------------------------ */

  const [clipboard, setClipboard] = useState<Shape[]>([]);

  const getSelectedIds = useCallback((): string[] => {
    if (!selection || selection === IMAGE_SELECTION) return [];
    if (selection === SELECT_ALL) return shapesRef.current.map((s) => s.id);
    return [selection];
  }, [selection]);

  const copySelection = useCallback(() => {
    const ids = getSelectedIds();
    if (ids.length === 0) return;
    const items = ids
      .map((id) => shapesRef.current.find((s) => s.id === id))
      .filter((s): s is Shape => Boolean(s));
    if (items.length === 0) return;
    setClipboard(items.map(cloneShape));
  }, [getSelectedIds]);

  const cutSelection = useCallback(() => {
    const ids = getSelectedIds();
    if (ids.length === 0) return;
    copySelection();
    pushHistory();
    removeShapes(ids);
    setSelection(null);
  }, [getSelectedIds, copySelection, pushHistory, removeShapes]);

  const pasteClipboard = useCallback(() => {
    if (clipboard.length === 0 || !imageSrc) return;
    pushHistory();
    const clones = clipboard.map((s) => cloneWithOffset(s, 24, 24));
    commit([...shapesRef.current, ...clones]);
    setSelection(clones[0].id);
  }, [clipboard, imageSrc, pushHistory, commit]);

  const duplicateSelection = useCallback(() => {
    const ids = getSelectedIds();
    if (ids.length === 0) return;
    pushHistory();
    const items = ids
      .map((id) => shapesRef.current.find((s) => s.id === id))
      .filter((s): s is Shape => Boolean(s));
    const clones = items.map((s) => cloneWithOffset(s, 24, 24));
    commit([...shapesRef.current, ...clones]);
    setSelection(clones[0].id);
  }, [getSelectedIds, pushHistory, commit]);

  const selectAll = useCallback(() => {
    setSelection(shapesRef.current.length > 0 ? SELECT_ALL : null);
  }, []);

  const nudgeSelection = useCallback(
    (dx: number, dy: number) => {
      if (selection === null || selection === IMAGE_SELECTION) return;
      const ids =
        selection === SELECT_ALL ? shapesRef.current.map((s) => s.id) : [selection];
      if (ids.length === 0) return;
      pushHistory();
      commit(
        shapesRef.current.map((s) => {
          if (!ids.includes(s.id)) return s;
          const t = translateShape(s, dx, dy);
          return { ...t, id: s.id };
        }),
      );
    },
    [selection, pushHistory, commit],
  );

  useEffect(() => {
    try {
      localStorage.setItem("aimaging.shapeStyle", JSON.stringify(shapeStyle));
    } catch {
      /* storage unavailable */
    }
  }, [shapeStyle]);

  const applyCrop = useCallback(() => {
    const c = crop;
    if (!c || c.w < 1 || c.h < 1) return;
    const oldDims = dims;
    /* Un DICOM lin├®aire est rogn├® sur le rendu fen├¬tr├® courant, puis l'image
       devient une image ordinaire (le buffer lin├®aire est d├®tach├®). */
    const src = dicomLinear ? renderSrc : imageSrc;
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(c.w));
      canvas.height = Math.max(1, Math.round(c.h));
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(img, c.x, c.y, c.w, c.h, 0, 0, canvas.width, canvas.height);
      }
      /* Image keeps its doc-space top-left (0, 0); the view refits afterwards.
         Shapes anchored on the old content follow: they shift by
         -(crop) plus the image origin delta (oldDims - newDims) / 2. */
      const dx = -c.x - (oldDims.w - c.w) / 2;
      const dy = -c.y - (oldDims.h - c.h) / 2;
      const cropDoc = { l: c.x, t: c.y, r: c.x + c.w, b: c.y + c.h };
      const next = shapesRef.current
        .filter((s) => {
          const bb = shapeBBox(s);
          const iw = Math.min(bb.x + bb.w, cropDoc.r) - Math.max(bb.x, cropDoc.l);
          const ih = Math.min(bb.y + bb.h, cropDoc.b) - Math.max(bb.y, cropDoc.t);
          return iw > 0 && ih > 0;
        })
        .map((s) => translateShape(s, dx, dy));
      pushHistory();
      commit(next);
      setCrop(null);
      setImageSrc(canvas.toDataURL("image/png"));
      setImageName((n) => `${n} (cropped)`);
      if (dicomLinear) {
        setDicomLinear(null);
        resetImageAdjustments();
      }
      setZoomPreset("fit");
      setFitSignal((s) => ({ a: s.a + 1, b: s.b + 1 }));
    };
    img.src = src;
  }, [crop, dims, dicomLinear, renderSrc, imageSrc, pushHistory, commit, resetImageAdjustments, setDicomLinear]);

  const toggleSection = useCallback((id: SectionId) => {
    setCollapsed((c) => ({ ...c, [id]: !c[id] }));
  }, []);

  const runAnalysis = useCallback(() => {
    setAnalysis("running");
    window.setTimeout(() => setAnalysis("done"), 1800);
  }, []);

  /* ------------------------------ AI workspace ------------------------------ */

  const [imageLocked, setImageLocked] = useState(false);
  const [imageCardOpen, setImageCardOpen] = useState(false);
  const [gradcamCardOpen, setGradcamCardOpen] = useState(false);
  const [cardOrder, setCardOrderState] = useState<SectionId[]>(() => {
    try {
      const raw = localStorage.getItem("aimaging.cardOrder");
      const arr = raw ? JSON.parse(raw) : null;
      if (Array.isArray(arr) && arr.every((id) => DEFAULT_CARD_ORDER.includes(id as SectionId))) {
        /* Fusionne les nouvelles cartes ajoutées au fil des versions : une
           commande sauvegardée antérieurement ne doit jamais masquer une
           section qui n'existait pas encore (ex. « pathology »). */
        const saved = arr as SectionId[];
        const missing = DEFAULT_CARD_ORDER.filter((id) => !saved.includes(id));
        return [...saved, ...missing];
      }
    } catch {
      /* localStorage indisponible */
    }
    return DEFAULT_CARD_ORDER;
  });
  const setCardOrder = useCallback((order: SectionId[]) => {
    setCardOrderState(order);
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("aimaging.cardOrder", JSON.stringify(cardOrder));
    } catch {
      /* localStorage indisponible */
    }
  }, [cardOrder]);
  const [aiDisclaimerAck, setAiDisclaimerAck] = useState(false);
  const [aiDisclaimerDismissed, setAiDisclaimerDismissed] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiHistory, setAiHistory] = useState<AiHistoryItem[]>([]);
  const [aiCustomCommands, setAiCustomCommands] = useState<AiCustomCommand[]>(() => {
    try {
      const raw = localStorage.getItem("aimaging.aiCommands");
      const arr = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(arr)) return [];
      return arr
        .map((x: unknown): AiCustomCommand | null => {
          if (x && typeof x === "object" && typeof (x as AiCustomCommand).name === "string") {
            return {
              id: typeof (x as AiCustomCommand).id === "string" ? (x as AiCustomCommand).id : randomId(),
              name: ((x as AiCustomCommand).name as string).trim().replace(/^@/, "").toLowerCase(),
              command: String((x as AiCustomCommand).command ?? "").trim(),
              at: Number((x as AiCustomCommand).at) || Date.now(),
            };
          }
          return null;
        })
        .filter(
          (c: AiCustomCommand | null): c is AiCustomCommand =>
            c !== null && c.name.length > 0 && c.command.length > 0,
        )
        .slice(0, 24);
    } catch {
      return [];
    }
  });

  /* ------------------------------ Notifications (toasts) ------------------------------ */
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const notify = useCallback((title: string, kind: NotificationKind = "info", message?: string) => {
    const t = title.trim();
    if (!t) return;
    const id = randomId();
    setNotifications((list) => [
      ...list.filter((n) => !(n.kind === kind && n.title === t)),
      { id, kind, title: t, message, at: Date.now() },
    ].slice(-5));
    window.setTimeout(() => {
      setNotifications((list) => list.filter((n) => n.id !== id));
    }, kind === "error" || kind === "warning" ? 10000 : 6000);
  }, []);
  const dismissNotification = useCallback((id: string) => {
    setNotifications((list) => list.filter((n) => n.id !== id));
  }, []);
  const [aiResults, setAiResults] = useState<AiResults>({
    diagnostics: [],
    report: null,
    lastSummary: null,
    lastResponse: null,
    lastWarnings: [],
    lastLimitations: [],
    modelName: null,
    modelCount: null,
    reportFields: null,
    reportCoherencePassed: null,
    reportCoherenceIssues: [],
  });
  const setAiDiagnostics = useCallback((diagnostics: AiDiagnosis[], metadata?: { modelName?: string; modelCount?: number }) => {
    setAiResults((results) => ({
      ...results,
      diagnostics,
      modelName: metadata?.modelName ?? results.modelName,
      modelCount: metadata?.modelCount ?? results.modelCount,
    }));
    setAnalysis("done");
  }, []);
  /* Capture le résultat brut de /radiography/report (défaut §1/§3) : sans ce
     setter, seul le texte plat survivait à la génération et `fields` /
     `coherenceIssues` retombaient sur `{}` / `[]` à la persistance et à
     l'export, quelle que soit la réponse réelle du backend. Le contexte
     clinique (Neuro + anatomie) est mémorisé pour enrichir le structured_data
     persisté. */
  const lastReportClinicalCtxRef = useRef<ReportClinicalContext | null>(null);
  const setRadioReportGeneration = useCallback((result: {
    fields: Record<string, string>;
    coherencePassed: boolean;
    coherenceIssues: string[];
    context?: ReportClinicalContext;
  }) => {
    lastReportClinicalCtxRef.current = result.context ?? null;
    setAiResults((results) => ({
      ...results,
      reportFields: result.fields,
      reportCoherencePassed: result.coherencePassed,
      reportCoherenceIssues: result.coherenceIssues,
    }));
  }, []);
  const [aiFocus, setAiFocus] = useState<AiFocus | null>(null);
  const [aiThought, setAiThought] = useState<{ id: string; text: string } | null>(null);
  /* ---------------- Phase Database 7 : reports persistés ----------------
     Génération IA ⇒ NOUVEAU report needs_review (§10) ; édition ⇒ update
     débounced du report courant ; validation = action explicite (§18). */
  const [radioReport, setRadioReport] = useState<{ id: string; status: "draft" | "generated" | "needs_review" | "validated" } | null>(null);
  const lastPersistedReportTextRef = useRef<string>("");
  const reportSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!persistenceExamId || !isSupabaseConfigured) return;
    let cancelled = false;
    loadLatestRadioReport(persistenceExamId)
      .then((row) => {
        if (cancelled || row === null || row.type !== "radiography_ai") return;
        setRadioReport({ id: row.id, status: row.status as "draft" | "generated" | "needs_review" | "validated" });
        setAiResults((r) => (r.report === null ? { ...r, report: row.content ?? "" } : r));
        lastPersistedReportTextRef.current = row.content ?? "";
      })
      .catch((exc: unknown) => console.error("[db] Chargement du dernier rapport impossible.", exc));
    return () => {
      cancelled = true;
    };
  }, [persistenceExamId]);

  /* Nouvelle génération IA (texte différent) ⇒ nouveau report needs_review (§10). */
  useEffect(() => {
    const examId = persistenceExamIdRef.current;
    const text = aiResults.report;
    if (!examId || !text || text === lastPersistedReportTextRef.current) return;
    lastPersistedReportTextRef.current = text;
    /* Contexte clinique de la dernière génération réussie (Neuro + anatomie) :
       mémorisé par setRadioReportGeneration, injecté dans structured_data. */
    const clinicalCtx = lastReportClinicalCtxRef.current;
    void persistGeneratedRadioReport(
      examId,
      imageIdRef.current ? [imageIdRef.current] : [],
      {
        /* Champs/cohérence réels de la génération LLM (§1/§3) ; `{}`/`true`
           seulement en dernier recours si le texte a été édité manuellement
           avant toute génération réussie (jamais None inventé côté backend). */
        fields: aiResults.reportFields ?? {},
        coherencePassed: aiResults.reportCoherencePassed ?? true,
        coherenceIssues: aiResults.reportCoherenceIssues,
        renderedText: text,
        ensemblePrediction: aiResults.diagnostics[0]?.label ?? null,
        numModels: aiResults.modelCount,
        neuroFindings: clinicalCtx?.neuro_findings,
        neuroRiskLevel: clinicalCtx?.neuro_risk_level ?? null,
        anatomyObservations: clinicalCtx?.anatomy_observations,
      },
    )
      .then((row) => {
        if (row !== null) setRadioReport({ id: row.id, status: "needs_review" });
      })
      .catch((exc: unknown) => console.error("[db] Rapport non persisté.", exc));
  }, [aiResults.report]);

  const validateRadioReport = useCallback(() => {
    if (!radioReport) return;
    setRadioReport({ ...radioReport, status: "validated" });
    void validateReportById(radioReport.id).catch((exc: unknown) => {
      console.error("[db] Validation du rapport non persistée.", exc);
      if (radioReport) setRadioReport({ ...radioReport, status: "needs_review" });
    });
  }, [radioReport]);

  const [reportEditOpen, setReportEditOpen] = useState(false);
  const [reportDraft, setReportDraft] = useState("");
  const aiTimer = useRef<number | null>(null);
  const aiThoughtTimers = useRef<number[]>([]);
  const commandResolverRef = useRef<AiCommandResolver | null>(null);
  const executePlanRef = useRef<(plan: AiActionPlan) => { appliedActionIds: string[]; warnings: string[] }>(() => ({ appliedActionIds: [], warnings: [] }));
  /* Annulation globale des transactions IA multi-images (r├®gistr├®e par le Shell). */
  const [aiTransactionUndoable, setAiTransactionUndoable] = useState(false);
  const aiTransactionUndoRef = useRef<() => boolean>(() => false);
  const setAiTransactionUndo = useCallback((fn: (() => boolean) | null) => {
    aiTransactionUndoRef.current = fn ?? (() => false);
  }, []);
  const undoAiTransaction = useCallback(() => aiTransactionUndoRef.current(), []);


  const setAiCommandResolver = useCallback((resolver: AiCommandResolver | null) => {
    commandResolverRef.current = resolver;
  }, []);

  const openReportEditor = useCallback(() => {
    setReportDraft(aiResults.report ?? "");
    setReportEditOpen(true);
  }, [aiResults.report]);

  const saveReportDraft = useCallback(() => {
    setAiResults((r) => ({ ...r, report: reportDraft }));
    setReportEditOpen(false);
    /* Phase Database 7 : édition ⇒ update débounced du report courant (§9/§10).
       Une édition d'un rapport validé le repasse en needs_review (§5). */
    if (!radioReport || !isSupabaseConfigured) return;
    const wasValidated = radioReport.status === "validated";
    if (wasValidated) setRadioReport({ ...radioReport, status: "needs_review" });
    if (reportSaveTimerRef.current !== null) clearTimeout(reportSaveTimerRef.current);
    const content = reportDraft;
    const statusAtSave: "draft" | "generated" | "needs_review" | "validated" =
      wasValidated ? "needs_review" : radioReport.status;
    reportSaveTimerRef.current = setTimeout(() => {
      reportSaveTimerRef.current = null;
      void persistReportEdit(radioReport.id, content, statusAtSave).catch(
        (exc: unknown) => console.error("[db] Édition du rapport non persistée.", exc),
      );
    }, 800);
  }, [reportDraft, radioReport]);

  const focusAiRegion = useCallback((r: { x: number; y: number; w: number; h: number }) => {
    setAiFocus({ ...r, ts: Date.now() });
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("aimaging.aiCommands", JSON.stringify(aiCustomCommands));
    } catch {
      /* localStorage unavailable ÔÇö prompts stay in memory */
    }
  }, [aiCustomCommands]);

  const addAiCustomCommand = useCallback((name: string, command: string) => {
    const n = name.trim().replace(/^@/, "").toLowerCase();
    const c = command.trim();
    if (!n || !c) return;
    setAiCustomCommands((commands) => [
      { id: randomId(), name: n, command: c, at: Date.now() },
      ...commands.filter((cmd) => cmd.name !== n),
    ].slice(0, 24));
  }, []);

  const updateAiCustomCommand = useCallback((id: string, name: string, command: string) => {
    const n = name.trim().replace(/^@/, "").toLowerCase();
    const c = command.trim();
    if (!n || !c) return;
    setAiCustomCommands((commands) =>
      commands.map((cmd) => (cmd.id === id ? { ...cmd, name: n, command: c } : cmd)),
    );
  }, []);

  const removeAiCustomCommand = useCallback((id: string) => {
    setAiCustomCommands((commands) => commands.filter((cmd) => cmd.id !== id));
  }, []);


  /* --------------------------- Segmentation anatomique --------------------------- */
  const setAnatomyCardOpen = useCallback((open: boolean) => {
    anatomyCardOpenRef.current = open;
    setAnatomyCardOpenState(open);
  }, []);

  const setAnatomySelected = useCallback((label: string | null) => {
    setAnatomySelectedState(label);
  }, []);

  const loadAnatomyRegionTexts = useCallback(async (): Promise<void> => {
    const imageIdValue = imageIdRef.current;
    const imageSrcValue = imageSrcRef.current;
    const anatomyRes = anatomyResultRef.current;
    if (!imageIdValue || !imageSrcValue || !anatomyRes || anatomyRes.status !== "ok") {
      return;
    }
    if (anatomyRegionTextsLoadingRef.current) return;
    anatomyRegionTextsLoadingRef.current = true;
    setAnatomyRegionTextsLoading(true);
    setAnatomyRegionTextsError(null);
    try {
      const metadata = imageMetadataRef.current;
      const image: ExamImage = {
        id: imageIdValue,
        name: imageNameRef.current || "Image",
        src: imageSrcValue,
        dims: dimsRef.current,
        sourceKind: metadata?.modality ? "dicom" : "browser-image",
        metadata: metadata ?? undefined,
        state: {
          src: imageSrcValue,
          shapes: shapesRef.current,
          wl: wlRef.current,
          brightness: brightnessRef.current,
          contrast: contrastRef.current,
          inverted: invertedRef.current,
          rotation: rotationRef.current,
          flipH: flipHRef.current,
          flipV: flipVRef.current,
        },
      };
      const exam: Examination = {
        id: `anatomy-regions-${imageIdValue}`,
        name: "Analyse anatomique régions",
        modality: metadata?.modality ?? "image",
        images: [image],
        createdAt: new Date().toISOString(),
        lastOpenedAt: new Date().toISOString(),
        archived: false,
      };
      const manifest = buildWorkspaceManifest(exam, image.id, {});
      const session = await createWorkspaceExam(manifest);
      const canvasDataUrl = await captureAnnotatedImage(image).catch(() => null);
      const anatomyCtx = toAnatomyContext(anatomyRes);
      const regionsPayload: AnatomyRegionPayload[] = ANATOMY_REGIONS.map((r) => ({
        id: r.id,
        label: r.label,
        structures: r.structures,
        reference: r.reference,
      }));
      const response = await generateWorkspaceAnatomyRegions(
        session.workspace_id,
        imageIdValue,
        canvasDataUrl,
        anatomyCtx,
        regionsPayload,
      );
      if (imageIdRef.current !== imageIdValue) return;
      anatomyRegionTextsRef.current = response.region_texts;
      setAnatomyRegionTextsState(response.region_texts);
      const anomalies = response.region_anomalies ?? {};
      anatomyRegionAnomaliesRef.current = anomalies;
      setAnatomyRegionAnomaliesState(anomalies);
      /* Les éditions manuelles survivent à une regénération IA. */
      setAnatomyRegionOverridesState(loadAnatomyOverrides(imageIdValue));
    } catch (exc) {
      if (imageIdRef.current !== imageIdValue) return;
      const message = exc instanceof Error ? exc.message : "Interprétation IA des régions indisponible.";
      setAnatomyRegionTextsError(message);
    } finally {
      anatomyRegionTextsLoadingRef.current = false;
      setAnatomyRegionTextsLoading(false);
    }
  }, []);

  /** Édition manuelle de l'observation d'une région : "" réinitialise vers l'IA. */
  const saveAnatomyRegionObservation = useCallback((regionId: string, text: string): void => {
    const imageIdValue = imageIdRef.current;
    if (!imageIdValue || !regionId) return;
    setAnatomyRegionOverridesState((cur) => {
      const next = { ...cur };
      const trimmed = text.trim();
      if (trimmed) next[regionId] = trimmed;
      else delete next[regionId];
      persistAnatomyOverrides(imageIdValue, next);
      return next;
    });
  }, []);

  const runAnatomyAnalysis = useCallback(async (waitForImage = false): Promise<boolean> => {
    /* Ouverture d'un espace de travail : l'image peut ne pas être encore
       prête (elle est chargée juste après). On patiente un peu avant
       d'abandonner, pour lancer la segmentation en même temps que la
       classification automatique. */
    if (waitForImage) {
      let waited = 0;
      while (!imageIdRef.current || !imageSrcRef.current) {
        if (waited >= 8000) break;
        await new Promise((resolve) => setTimeout(resolve, 250));
        waited += 250;
      }
    }
    const imageIdValue = imageIdRef.current;
    const imageSrcValue = imageSrcRef.current;
    if (!imageIdValue || !imageSrcValue) {
      const message = "Chargez une radiographie avant de lancer la segmentation.";
      setAnatomyError(message);
      return false;
    }
    if (anatomyLoadingRef.current) return false;
    anatomyLoadingRef.current = true;
    setAnatomyLoading(true);
    setAnatomyError(null);
    try {
      const metadata = imageMetadataRef.current;
      const image: ExamImage = {
        id: imageIdValue,
        name: imageNameRef.current || "Image",
        src: imageSrcValue,
        dims: dimsRef.current,
        sourceKind: metadata?.modality ? "dicom" : "browser-image",
        metadata: metadata ?? undefined,
      };
      const exam: Examination = {
        id: `anatomy-${imageIdValue}`,
        name: "Analyse anatomique",
        modality: metadata?.modality ?? "image",
        images: [image],
        createdAt: new Date().toISOString(),
        lastOpenedAt: new Date().toISOString(),
        archived: false,
      };
      const manifest = buildWorkspaceManifest(exam, image.id, {});
      const session = await createWorkspaceExam(manifest);
      const response = await generateWorkspaceAnatomy(session.workspace_id, image);
      if (imageIdRef.current !== imageIdValue) return false;
      anatomyResultRef.current = response.result;
      setAnatomyResultState(response.result);
      if (response.result.status === "ok") {
        void loadAnatomyRegionTexts();
      }
      return true;
    } catch (exc) {
      const message = exc instanceof Error ? exc.message : "Segmentation anatomique impossible.";
      setAnatomyError(message);
      return false;
    } finally {
      anatomyLoadingRef.current = false;
      setAnatomyLoading(false);
    }
  }, [loadAnatomyRegionTexts]);

  const toggleAnatomyCard = useCallback(() => {
    const next = !anatomyCardOpenRef.current;
    setAnatomyCardOpen(next);
    if (next && !anatomyResultRef.current && !anatomyLoadingRef.current && imageIdRef.current && imageSrcRef.current) {
      void runAnatomyAnalysis();
    }
  }, [runAnatomyAnalysis, setAnatomyCardOpen]);

  /** Pose les boxes YOLO comme formes rectangles éditables sur le canvas :
      déplacement, redimensionnement et suppression passent par les outils
      existants ; le libellé se renomme au double-clic. Remplace les boxes
      d'une analyse précédente (même mécanique que les mesures landmarks). */
  const placePathologyShapes = useCallback((result: PathologyResult): void => {
    if (!result.yolo_boxes.length) return;
    const idsToRemove = shapesRef.current
      .filter((s) => s.actionId?.startsWith(PATHOLOGY_SHAPE_PREFIX))
      .map((s) => s.id);
    const newShapes: Shape[] = result.yolo_boxes.map((box, index) => {
      const [x1, y1, x2, y2] = box.xyxy;
      return {
        id: randomId(),
        type: "rectangle",
        x: x1,
        y: y1,
        w: Math.max(2, x2 - x1),
        h: Math.max(2, y2 - y1),
        points: [],
        strokeWidth: 2.5,
        strokeColor: pathologyColorFor(box.class),
        label: `${box.class.replace(/_/g, " ")} · ${(box.conf * 100).toFixed(0)} %`,
        createdBy: "ai",
        actionId: `${PATHOLOGY_SHAPE_PREFIX}${box.class}-${index}`,
      };
    });
    if (idsToRemove.length > 0) removeShapes(idsToRemove);
    commit([...shapesRef.current, ...newShapes]);
  }, [commit, removeShapes]);

  /** Pose les boxes YOLO quand le toggle « Détections » est actif, les retire
      sinon. Le résultat reste en mémoire : réactiver le toggle repose les
      boxes du dernier résultat (une nouvelle analyse les remplace). */
  const pathologyPlacedForResultRef = useRef<PathologyResult | null>(null);
  useEffect(() => {
    const ids = shapesRef.current
      .filter((s) => s.actionId?.startsWith(PATHOLOGY_SHAPE_PREFIX))
      .map((s) => s.id);
    if (!pathologyBoxesOn) {
      pathologyPlacedForResultRef.current = null;
      removeShapes(ids);
      return;
    }
    const result = pathologyResultRef.current;
    if (!result?.yolo_boxes.length) return;
    /* Repose les boxes uniquement si aucune n'est posée ou si le résultat a
       changé (nouvelle analyse) ; sinon préserve les boxes éditées par
       l'utilisateur (déplacement, redimensionnement, renommage). */
    if (ids.length > 0 && pathologyPlacedForResultRef.current === result) return;
    placePathologyShapes(result);
    pathologyPlacedForResultRef.current = result;
  }, [pathologyBoxesOn, pathologyResult, placePathologyShapes, removeShapes]);

  /* --------------------- Pathologies (backend « Neuro ») --------------------- */
  const runPathologyAnalysis = useCallback(async (): Promise<boolean> => {
    const imageIdValue = imageIdRef.current;
    const imageSrcValue = imageSrcRef.current;
    if (!imageIdValue || !imageSrcValue) {
      setPathologyError("Chargez une radiographie avant de lancer la détection.");
      return false;
    }
    if (pathologyLoadingRef.current) return false;
    pathologyLoadingRef.current = true;
    setPathologyLoading(true);
    setPathologyError(null);
    try {
      const metadata = imageMetadataRef.current;
      const image: ExamImage = {
        id: imageIdValue,
        name: imageNameRef.current || "Image",
        src: imageSrcValue,
        dims: dimsRef.current,
        sourceKind: metadata?.modality ? "dicom" : "browser-image",
        metadata: metadata ?? undefined,
        state: {
          src: imageSrcValue,
          shapes: shapesRef.current,
          wl: wlRef.current,
          brightness: brightnessRef.current,
          contrast: contrastRef.current,
          inverted: invertedRef.current,
          rotation: rotationRef.current,
          flipH: flipHRef.current,
          flipV: flipVRef.current,
        },
      };
      const exam: Examination = {
        id: `pathology-${imageIdValue}`,
        name: "Détection pathologies",
        modality: metadata?.modality ?? "image",
        images: [image],
        createdAt: new Date().toISOString(),
        lastOpenedAt: new Date().toISOString(),
        archived: false,
      };
      const manifest = buildWorkspaceManifest(exam, image.id, {});
      const session = await createWorkspaceExam(manifest);
      const response = await generateWorkspacePathology(session.workspace_id, imageIdValue, image);
      if (imageIdRef.current !== imageIdValue) return false;
      pathologyResultRef.current = response.result;
      setPathologyResultState(response.result);
      /* La pose des boxes passe par l'effet de synchronisation ci-dessus :
         il les pose si le toggle « Détections » est actif, sinon les garde
         masquées jusqu'à réactivation. */
      return true;
    } catch (exc) {
      if (imageIdRef.current !== imageIdValue) return false;
      const message = exc instanceof Error ? exc.message : "Détection des pathologies indisponible.";
      setPathologyError(message);
      return false;
    } finally {
      pathologyLoadingRef.current = false;
      setPathologyLoading(false);
    }
  }, [placePathologyShapes]);

  const setPathologyCardOpen = useCallback((open: boolean) => {
    pathologyCardOpenRef.current = open;
    setPathologyCardOpenState(open);
  }, []);

  const togglePathologyCard = useCallback(() => {
    const next = !pathologyCardOpenRef.current;
    setPathologyCardOpen(next);
    if (next && !pathologyResultRef.current && !pathologyLoadingRef.current && imageIdRef.current && imageSrcRef.current) {
      void runPathologyAnalysis();
    }
  }, [runPathologyAnalysis, setPathologyCardOpen]);

  const setLandmarksSelected = useCallback((organ: string | null) => {
    setLandmarksSelectedState(organ);
  }, []);

  const setLandmarkCardOpen = useCallback((open: boolean) => {
    landmarkCardOpenRef.current = open;
    setLandmarkCardOpenState(open);
  }, []);

  /** Formes de mesure posées automatiquement (diamètres + étiquette CTR). */
  const removeLandmarkMeasurements = useCallback(() => {
    const ids = shapesRef.current.filter((s) => s.actionId?.startsWith(LANDMARK_SHAPE_PREFIX)).map((s) => s.id);
    if (ids.length > 0) removeShapes(ids);
  }, [removeShapes]);

  const placeLandmarkMeasurements = useCallback(() => {
    const result = landmarkResultRef.current;
    if (!result || result.status !== "ok") return;
    const dims = dimsRef.current;
    if (!dims || dims.w <= 0 || dims.h <= 0) return;
    const toGrid = (v: number) => (v / 1024) * dims.w;
    const toGridY = (v: number) => (v / 1024) * dims.h;

    const newShapes: Shape[] = [];
    const idsToRemove = shapesRef.current.filter((s) => s.actionId?.startsWith(LANDMARK_SHAPE_PREFIX)).map((s) => s.id);
    for (const line of result.lines) {
      const x1 = toGrid(line.x1);
      const y1 = toGridY(line.y1);
      const x2 = toGrid(line.x2);
      const y2 = toGridY(line.y2);
      newShapes.push({
        id: randomId(),
        type: "measure",
        x: x1,
        y: y1,
        w: x2 - x1,
        h: y2 - y1,
        points: [],
        strokeWidth: 2,
        strokeColor: line.key === "heart_transverse" ? "#3b82f6" : "#f97316",
        fontSize: 14,
        fontFamily: "sans",
        fontWeight: "normal",
        color: "#ffffff",
        createdBy: "ai",
        actionId: `${LANDMARK_SHAPE_PREFIX}${line.key}`,
      });
    }
    const heartLine = result.lines.find((line) => line.key === "heart_transverse");
    if (heartLine) {
      const ax = toGrid((heartLine.x1 + heartLine.x2) / 2);
      const ay = toGridY((heartLine.y1 + heartLine.y2) / 2);
      const ctr = result.measurements.ctr;
      const label = `CTR = ${ctr.value.toFixed(3)} ± ${ctr.std.toFixed(3)}`;
      newShapes.push({
        id: randomId(),
        type: "annotation",
        x: ax + 24,
        y: ay - 46,
        w: 0,
        h: 0,
        points: [{ x: ax, y: ay }],
        strokeWidth: 2,
        fontSize: 14,
        fontFamily: "sans",
        fontWeight: "bold",
        color: ACCENT_COLORS[0],
        createdBy: "ai",
        actionId: `${LANDMARK_SHAPE_PREFIX}ctr`,
        label,
      });
    }
    if (idsToRemove.length > 0) removeShapes(idsToRemove);
    if (newShapes.length > 0) commit([...shapesRef.current, ...newShapes]);
  }, [commit, removeShapes]);

  /* --- Édition des contours (modelage des mesures) --- */

  const applyLandmarkContours = useCallback((next: LandmarkContours | null) => {
    landmarkContoursRef.current = next;
    setLandmarkContoursState(next);
  }, []);

  /* Repart des contours du modèle (nouvelle analyse ou reset utilisateur). */
  const adoptModelContours = useCallback(
    (result: WorkspaceLandmarksResult | null) => {
      const source = result && result.status === "ok" ? result.contours : null;
      applyLandmarkContours(source ? cloneContours(source) : null);
    },
    [applyLandmarkContours],
  );

  const setLandmarkContourNode = useCallback(
    (organ: LandmarkOrganKey, index: number, x: number, y: number) => {
      const current = landmarkContoursRef.current;
      const contour = current?.[organ];
      if (!contour || index < 0 || index >= contour.x.length) return;
      const next: LandmarkContours = {
        ...current,
        [organ]: {
          x: contour.x.map((v, i) => (i === index ? x : v)),
          y: contour.y.map((v, i) => (i === index ? y : v)),
          std: contour.std,
        },
      };
      applyLandmarkContours(next);
    },
    [applyLandmarkContours],
  );

  const resetLandmarkContours = useCallback(() => {
    adoptModelContours(landmarkResultRef.current);
  }, [adoptModelContours]);

  /** Analyse anatomique unifiée : segmentation CXAS + landmarks HybridGNet en une
   *  seule requête, résultats tracés par source (CXAS / HybridGNet). Remplit à la
   *  fois le panneau "Segmentation" (source CXAS) et le panneau "Mesures" (source
   *  HybridGNet), sans jamais fusionner mathématiquement les deux moteurs. */
  const runUnifiedAnatomyAnalysis = useCallback(async (waitForImage = false): Promise<boolean> => {
    if (waitForImage) {
      let waited = 0;
      while (!imageIdRef.current || !imageSrcRef.current) {
        if (waited >= 8000) break;
        await new Promise((resolve) => setTimeout(resolve, 250));
        waited += 250;
      }
    }
    const imageIdValue = imageIdRef.current;
    const imageSrcValue = imageSrcRef.current;
    if (!imageIdValue || !imageSrcValue) {
      const message = "Chargez une radiographie avant l'analyse anatomique.";
      setAnatomyError(message);
      setLandmarkError(message);
      return false;
    }
    if (anatomyLoadingRef.current || landmarkLoadingRef.current) return false;
    anatomyLoadingRef.current = true;
    landmarkLoadingRef.current = true;
    setAnatomyLoading(true);
    setLandmarkLoading(true);
    setAnatomyError(null);
    setLandmarkError(null);
    try {
      const metadata = imageMetadataRef.current;
      const image: ExamImage = {
        id: imageIdValue,
        name: imageNameRef.current || "Image",
        src: imageSrcValue,
        dims: dimsRef.current,
        sourceKind: metadata?.modality ? "dicom" : "browser-image",
        metadata: metadata ?? undefined,
      };
      const exam: Examination = {
        id: `anatomy-${imageIdValue}`,
        name: "Analyse anatomique",
        modality: metadata?.modality ?? "image",
        images: [image],
        createdAt: new Date().toISOString(),
        lastOpenedAt: new Date().toISOString(),
        archived: false,
      };
      const manifest = buildWorkspaceManifest(exam, image.id, {});
      const session = await createWorkspaceExam(manifest);
      const response = await generateWorkspaceAnatomyAnalysis(session.workspace_id, image);
      if (imageIdRef.current !== imageIdValue) return false;

      const cx = response.cxas;
      const anatomy: WorkspaceAnatomyResult = {
        status: cx?.status === "ok" ? "ok" : "error",
        error: cx?.error ?? null,
        measurements: (cx?.payload.measurements ?? {}) as Record<string, WorkspaceAnatomyResult["measurements"][string]>,
        segmentation: (cx?.payload.segmentation ?? {
          labels: {}, label_ids_available: [], file_size: [0, 0], mask_shape: [0, 0],
          areas_px: {}, mask_downscaled: false, masks_b64_png: {},
        }) as WorkspaceAnatomyResult["segmentation"],
        warnings: cx?.payload.warnings ?? [],
        inference_time_ms: cx?.inference_time_ms ?? null,
        generated_at: response.generated_at,
      };

      const lmPayload = response.hybridgnet?.payload ?? {};
      const landmarks: WorkspaceLandmarksResult = {
        status: response.hybridgnet?.status === "ok" ? "ok" : "error",
        error: response.hybridgnet?.error ?? null,
        contours: (lmPayload.contours ?? {}) as WorkspaceLandmarksResult["contours"],
        measurements: (lmPayload.measurements ?? {}) as WorkspaceLandmarksResult["measurements"],
        custom: lmPayload.custom ?? [],
        warnings: lmPayload.warnings ?? [],
        uncertainty: lmPayload.uncertainty ?? { max_node_std_px: 0, mean_node_std_px: 0 },
        scale_used: lmPayload.scale_used ?? "pixels",
        ctr_method: lmPayload.ctr_method ?? "",
        lines: lmPayload.lines ?? [],
        inference_time_ms: response.hybridgnet?.inference_time_ms ?? null,
        generated_at: response.generated_at,
      };

      anatomyResultRef.current = anatomy;
      setAnatomyResultState(anatomy);
      landmarkResultRef.current = landmarks;
      setLandmarkResultState(landmarks);
      adoptModelContours(landmarks);
      placeLandmarkMeasurements();

      /* Phase Database 6 : runs RÉELS cxas + hybridgnet tracés par source
         (§11/§12). Aucun run quality/plane/FetalCLIP/anomaly : mockés ou absents. */
      const examIdForRuns = persistenceExamIdRef.current;
      if (examIdForRuns !== null) {
        if (cx?.status === "ok") {
          void persistAnatomyRun("cxas", examIdForRuns, imageIdValue, {
            generated_at: response.generated_at,
            inference_time_ms: cx.inference_time_ms ?? null,
            warnings: cx.payload.warnings ?? [],
            segmentation_labels: Object.keys(cx.payload.segmentation?.areas_px ?? {}),
          }).catch((exc: unknown) => console.error("[db] Run CXAS non persisté.", exc));
        }
        if (landmarks.status === "ok") {
          void persistAnatomyRun("hybridgnet", examIdForRuns, imageIdValue, {
            generated_at: landmarks.generated_at,
            inference_time_ms: landmarks.inference_time_ms ?? null,
            ctr_method: landmarks.ctr_method,
            warnings: landmarks.warnings,
          })
            .then((runId) => {
              if (runId !== null) setLandmarkRunId(runId);
            })
            .catch((exc: unknown) => console.error("[db] Run HybridGNet non persisté.", exc));
        }
      }

      return true;
    } catch (exc) {
      const message = exc instanceof Error ? exc.message : "Analyse anatomique impossible.";
      setAnatomyError(message);
      setLandmarkError(message);
      return false;
    } finally {
      anatomyLoadingRef.current = false;
      landmarkLoadingRef.current = false;
      setAnatomyLoading(false);
      setLandmarkLoading(false);
    }
  }, [adoptModelContours, placeLandmarkMeasurements]);

  const runLandmarksAnalysis = useCallback(
    async (waitForImage = false, options?: { autoPlace?: boolean }): Promise<boolean> => {
      if (waitForImage) {
      let waited = 0;
      while (!imageIdRef.current || !imageSrcRef.current) {
        if (waited >= 8000) break;
        await new Promise((resolve) => setTimeout(resolve, 250));
        waited += 250;
      }
    }
    const imageIdValue = imageIdRef.current;
    const imageSrcValue = imageSrcRef.current;
    if (!imageIdValue || !imageSrcValue) {
      const message = "Chargez une radiographie avant de lancer les mesures.";
      setLandmarkError(message);
      return false;
    }
    if (landmarkLoadingRef.current) return false;
    landmarkLoadingRef.current = true;
    setLandmarkLoading(true);
    setLandmarkError(null);
    try {
      const metadata = imageMetadataRef.current;
      const image: ExamImage = {
        id: imageIdValue,
        name: imageNameRef.current || "Image",
        src: imageSrcValue,
        dims: dimsRef.current,
        sourceKind: metadata?.modality ? "dicom" : "browser-image",
        metadata: metadata ?? undefined,
      };
      const exam: Examination = {
        id: `landmarks-${imageIdValue}`,
        name: "Mesures landmarks",
        modality: metadata?.modality ?? "image",
        images: [image],
        createdAt: new Date().toISOString(),
        lastOpenedAt: new Date().toISOString(),
        archived: false,
      };
      const manifest = buildWorkspaceManifest(exam, image.id, {});
      const session = await createWorkspaceExam(manifest);
      const response = await generateWorkspaceLandmarks(session.workspace_id, image);
      if (imageIdRef.current !== imageIdValue) return false;
      landmarkResultRef.current = response.result;
      setLandmarkResultState(response.result);
      adoptModelContours(response.result);

      /* Phase Database 6 : run hybridgnet réel + rattachement aux mesures. */
      const examIdForRuns = persistenceExamIdRef.current;
      if (examIdForRuns !== null && response.result.status === "ok") {
        void persistAnatomyRun("hybridgnet", examIdForRuns, imageIdValue, {
          generated_at: response.result.generated_at,
          inference_time_ms: response.result.inference_time_ms ?? null,
          ctr_method: response.result.ctr_method,
          warnings: response.result.warnings,
        })
          .then((runId) => {
            if (runId !== null) setLandmarkRunId(runId);
          })
          .catch((exc: unknown) => console.error("[db] Run HybridGNet non persisté.", exc));
      }

      if (options?.autoPlace !== false) {
        /* Placement automatique des mesures sur l'image uniquement en usage
           manuel ; la chaîne automatique au chargement garde le canvas propre
           (le bouton « Poser les mesures » reste disponible). */
        placeLandmarkMeasurements();
      }
      return true;
    } catch (exc) {
      const message = exc instanceof Error ? exc.message : "Analyse landmarks impossible.";
      setLandmarkError(message);
      return false;
    } finally {
      landmarkLoadingRef.current = false;
      setLandmarkLoading(false);
    }
    },
    [adoptModelContours, placeLandmarkMeasurements],
  );

  const toggleLandmarksCard = useCallback(() => {
    const next = !landmarkCardOpenRef.current;
    setLandmarkCardOpen(next);
    if (next && !landmarkResultRef.current && !landmarkLoadingRef.current && imageIdRef.current && imageSrcRef.current) {
      void runLandmarksAnalysis();
    }
  }, [runLandmarksAnalysis, setLandmarkCardOpen]);

  const removeAiHistory = useCallback((id: string) => {
    setAiHistory((history) => history.filter((h) => h.id !== id));
  }, []);

  const clearAiHistory = useCallback(() => {
    setAiHistory([]);
  }, []);

  useEffect(
    () => () => {
      if (aiTimer.current) window.clearTimeout(aiTimer.current);
      aiThoughtTimers.current.forEach((t) => window.clearTimeout(t));
    },
    [],
  );

  const runAiCommand = useCallback(
    (raw: string) => {
      const text = raw.trim();
      if (!text) return;
      if (commandResolverRef.current) {
        const item: AiHistoryItem = { id: randomId(), text, summary: "Commande en coursÔÇª", at: Date.now() };
        setAiHistory((history) => [{ ...item }, ...history].slice(0, 20));
        setAiBusy(true);
        setAiThought({ id: item.id, text: "Validation de la commande structur├®eÔÇª" });
        void commandResolverRef.current(text)
.then((resolution) => {
            const result = executePlanRef.current(resolution.plan);
            const warnings = [...(resolution.warnings ?? []), ...result.warnings];
            const actionSummary =
              resolution.actionSummary ??
              (result.appliedActionIds.length
                ? `${result.appliedActionIds.length} action(s) appliqu├®e(s).`
                : "Aucune action canvas appliqu├®e.");
            const summary = `${actionSummary}${warnings.length ? ` ${warnings[0]}` : ""}`;
            setAiHistory((history) => history.map((entry) => entry.id === item.id ? {
              ...entry,
              summary,
              answer: resolution.assistantMessage,
              warnings,
              limitations: resolution.limitations ?? [],
            } : entry));
            setAiResults((results) => ({
              ...results,
              lastSummary: summary,
              lastResponse: resolution.assistantMessage,
              lastWarnings: warnings,
              lastLimitations: resolution.limitations ?? [],
            }));
          })
          .catch((error: unknown) => {
            const message = error instanceof Error ? error.message : "Commande impossible ├á traiter.";
            setAiHistory((history) => history.map((entry) => entry.id === item.id ? { ...entry, summary: message } : entry));
            setAiResults((results) => ({
              ...results,
              lastSummary: message,
              lastResponse: message,
              lastWarnings: [],
              lastLimitations: [],
            }));
          })
          .finally(() => {
            setAiBusy(false);
            setAiThought(null);
          });
        return;
      }
      const message = "Aucun espace de travail actif : ouvrez un examen pour utiliser l'assistant IA.";
      const item: AiHistoryItem = { id: randomId(), text, summary: message, at: Date.now() };
      setAiHistory((history) => [{ ...item }, ...history].slice(0, 20));
      setAiResults((results) => ({
        ...results,
        lastSummary: message,
        lastResponse: message,
        lastWarnings: [],
        lastLimitations: [],
      }));
    },
    [],
  );

  /** Executes only actions that target the image currently loaded in this provider.
   *  The shell will route multi-image plans to the appropriate image in the next
   *  integration step. Keeping the transaction here guarantees one Ctrl+Z.
   */
  const executeAiActionPlan = useCallback((plan: AiActionPlan) => {
    const appliedActionIds: string[] = [];
    const warnings: string[] = [];
    const actionList = [...plan.actions].sort((a, b) => a.order - b.order);

pushHistory();
    for (const action of actionList) {
      const payload = action as typeof action & Record<string, unknown>;
      if (action.target_image_id && action.target_image_id !== imageIdRef.current) {
        warnings.push(`Action ${action.id} ignor├®e : elle cible une autre image.`);
        continue;
      }
      const analysisLikeActions = new Set([
        "analyze_image", "analyze_exam", "predict", "generate_gradcam",
        "analyze_anatomy", "generate_report",
      ]);
      const cxrStatus = cxrResultRef.current?.rejected?.status ?? cxrResultRef.current?.sort.status;
      if (action.type && analysisLikeActions.has(action.type) && cxrStatus
        && (cxrStatus === "REJECTED_NON_CXR" || cxrStatus === "REJECTED_INVALID_IMAGE")) {
        /* Fail-closed (Phase 3) : une image rejetée par le tri CXR ne reçoit
           aucune analyse médicale (ensemble, Grad-CAM, CXAS/HybridGNet, rapport). */
        warnings.push(
          cxrStatus === "REJECTED_INVALID_IMAGE"
            ? "Cette image ne peut pas être lue ou est endommagée : aucune analyse n'est lancée."
            : "Cette image ne semble pas être une radiographie thoracique : aucune analyse médicale n'est lancée.",
        );
        continue;
      }
      switch (action.type) {
        case "set_window_level":
          setWl({ window: Number(payload.window), level: Number(payload.level) });
          break;
        case "set_brightness":
          setBrightness(Number(payload.value));
          break;
        case "set_contrast":
          setContrast(Number(payload.value));
          break;
        case "invert":
          setInverted(Boolean(payload.value));
          break;
        case "show_gradcam":
          if (!gradcamResultRef.current) {
            warnings.push("Aucune Grad-CAM r├®elle n'est disponible pour cette image.");
            continue;
          }
          setGradcamOn(Boolean(payload.visible));
          setGradcamIntensity(Math.min(100, Math.max(0, Math.round(Number(payload.opacity) * 100))));
          break;
        case "show_3d":
          if (!threeDResultRef.current) {
            warnings.push("Aucune reconstruction 3D n'est disponible pour cette image. Lancez d'abord @3d.");
            continue;
          }
          setThreeDOn(payload.visible !== false);
          break;
        case "zoom_to_region": {
          const region = payload.region as { x: number; y: number; w: number; h: number };
          setAiFocus({ ...region, ts: Date.now() });
          break;
        }
        case "create_shape": {
          const source = payload.shape as {
            id: string; type: Shape["type"]; x: number; y: number; w: number; h: number;
            points?: Array<{ x: number; y: number }>; label?: string; visible?: boolean;
            style?: { color?: string; stroke_color?: string; fill_color?: string; stroke_width?: number;
              font_size?: number; font_family?: Shape["fontFamily"]; font_weight?: Shape["fontWeight"] };
          };
          const style = source.style ?? {};
          const shape: Shape = {
            id: source.id,
            type: source.type,
            x: source.x,
            y: source.y,
            w: source.w,
            h: source.h,
            points: source.points ?? [],
            label: source.label,
            visible: source.visible,
            strokeWidth: style.stroke_width ?? 2,
            strokeColor: style.stroke_color,
            fillColor: style.fill_color,
            color: style.color,
            fontSize: style.font_size,
            fontFamily: style.font_family,
            fontWeight: style.font_weight,
            createdBy: "ai",
            actionId: action.id,
          };
          commit([...shapesRef.current, shape]);
          setSelection(shape.id);
          break;
        }
        case "delete_shape": {
          const shapeId = String(payload.shape_id);
          commit(shapesRef.current.filter((shape) => shape.id !== shapeId));
          break;
        }
        case "update_shape": {
          const shapeId = String(payload.shape_id);
          const patch = payload.patch as Record<string, unknown>;
          const style = patch.style as Record<string, unknown> | undefined;
          commit(shapesRef.current.map((shape) => shape.id !== shapeId ? shape : {
            ...shape,
            x: typeof patch.x === "number" ? patch.x : shape.x,
            y: typeof patch.y === "number" ? patch.y : shape.y,
            w: typeof patch.w === "number" ? patch.w : shape.w,
            h: typeof patch.h === "number" ? patch.h : shape.h,
            points: Array.isArray(patch.points) ? patch.points as Shape["points"] : shape.points,
            label: typeof patch.label === "string" ? patch.label : shape.label,
            visible: typeof patch.visible === "boolean" ? patch.visible : shape.visible,
            color: typeof style?.color === "string" ? style.color : shape.color,
            strokeColor: typeof style?.stroke_color === "string" ? style.stroke_color : shape.strokeColor,
            fillColor: typeof style?.fill_color === "string" ? style.fill_color : shape.fillColor,
            strokeWidth: typeof style?.stroke_width === "number" ? style.stroke_width : shape.strokeWidth,
            fontSize: typeof style?.font_size === "number" ? style.font_size : shape.fontSize,
            actionId: action.id,
          }));
          break;
        }
        case "set_layer_visibility":
          setLayerVisible(String(payload.layer) as LayerId, Boolean(payload.visible));
          break;
        case "set_layer_opacity":
          setLayerOpacity(String(payload.layer) as LayerId, Number(payload.opacity));
          break;
        case "replace_report":
          if (typeof payload.text === "string") {
            const text = payload.text;
            setAiResults((results) => ({ ...results, report: text }));
          }
          break;
        case "notify":
          if (typeof payload.message === "string") {
            warnings.push(payload.message);
            notify(payload.message, "info");
          }
          break;
        case "analyze_image":
        case "analyze_exam":
        case "predict":
          setAnalysis("done");
          break;
        case "analyze_anatomy":
          /* Analyse anatomique unifiée (CXAS + HybridGNet) : lancée en fond,
             les résultats remplissent les panneaux Segmentation et Mesures. */
          void runUnifiedAnatomyAnalysis().catch((error: unknown) => {
            const message = error instanceof Error ? error.message : "Analyse anatomique impossible.";
            warnings.push(message);
          });
          break;
        case "generate_gradcam":
          if (!gradcamResultRef.current) {
            warnings.push("La g├®n├®ration Grad-CAM n'a pas fourni de carte exploitable.");
            continue;
          }
          break;
        case "generate_report":
          /* Le moteur serveur convertit generate_report → replace_report
             (rapport réel) ; cette branche n'est atteinte que si un plan
             forfaitaire l'a contourné. Message non contradictoire. */
          warnings.push("Rapport demandé mais non converti par le moteur d'actions serveur. Relancez la commande @report.");
          continue;
      }
      appliedActionIds.push(action.id);
    }
    if (appliedActionIds.length === 0) {
      /* Aucun changement : retire l'instantan├® inutile cr├®├® pour cette transaction. */
      pastRef.current.pop();
      setCanUndo(pastRef.current.length > 0);
    }
    return { appliedActionIds, warnings };
  }, [commit, pushHistory, setBrightness, setContrast, setGradcamIntensity, setGradcamOn, setInverted, setLayerOpacity, setLayerVisible, setThreeDOn, setWl, notify, runUnifiedAnatomyAnalysis]);

  useEffect(() => {
    executePlanRef.current = executeAiActionPlan;
  }, [executeAiActionPlan]);


  const requestFit = useCallback((pane?: "A" | "B") => {
    const p = pane ?? activePaneRef.current;
    setZoomPreset("fit");
    setFitSignal((s) => (p === "B" ? { a: s.a, b: s.b + 1 } : { a: s.a + 1, b: s.b }));
  }, []);

  /* ------------------------------ Document ops ------------------------------ */

const openImageData = useCallback(
    (dataUrl: string, name: string, nextImageId?: string) => {
      resetDocument();
      resetImageAdjustments();
      setDicomLinear(null);
      setImageSrc(dataUrl);
      setImageId(nextImageId ?? null);
      setImageName(name);
      setImageMetadata(null);
      setDims({ w: 0, h: 0 });
      setZoomPreset("fit");
      setFitSignal((s) => ({ a: s.a + 1, b: s.b + 1 }));
    },
    [resetDocument, resetImageAdjustments, setImageMetadata, setDicomLinear],
  );

const closeDocument = useCallback(() => {
    resetDocument();
    resetImageAdjustments();
    setDicomLinear(null);
    setImageSrc("");
    setImageId(null);
    setImageName("Untitled");
    setImageMetadata(null);
    setDims({ w: 0, h: 0 });
    setZoomPreset("fit");
    setFitSignal((s) => ({ a: s.a + 1, b: s.b + 1 }));
  }, [resetDocument, resetImageAdjustments, setImageMetadata, setDicomLinear]);

  const captureImageState = useCallback((): ImageStateSnapshot & { name: string; dims: { w: number; h: number } } | null => {
    if (!imageSrcRef.current) return null;
    return {
      name: imageNameRef.current,
      src: imageSrcRef.current,
      dims: dimsRef.current,
      shapes: shapesRef.current,
      wl: wlRef.current,
      brightness: brightnessRef.current,
      contrast: contrastRef.current,
      inverted: invertedRef.current,
      rotation: rotationRef.current,
      flipH: flipHRef.current,
      flipV: flipVRef.current,
    };
  }, []);

  const applyImageState = useCallback(
    (s: ImageStateSnapshot) => {
      setImageSrc(s.src);
      setImageName(s.name || "Untitled");
      setImageMetadata(null);
      setDims(s.dims ?? { w: 0, h: 0 });
      commit(s.shapes);
      setWl(s.wl);
      setBrightness(s.brightness);
      setContrast(s.contrast);
      setInverted(s.inverted);
      setRotation(s.rotation);
      setFlipH(s.flipH);
      setFlipV(s.flipV);
      setSelection(null);
      setZoomPreset("fit");
      setFitSignal((sig) => ({ a: sig.a + 1, b: sig.b + 1 }));
    },
    [commit, setWl, setBrightness, setContrast, setInverted, setRotation, setFlipH, setFlipV, setImageMetadata],
  );

  const saveDocument = useCallback(
    async (name?: string): Promise<{ name: string; savedAt: string; doc: Record<string, unknown> } | null> => {
      if (!imageSrc) return null;
      const n = (name ?? imageName).trim() || "Untitled";
      const persistedImage = await imageToPngDataUrl(imageSrc);
      if (!persistedImage) return null;
      const doc = {
        name: n,
        imageSrc: persistedImage,
        dims,
        shapes: shapesRef.current,
        wl,
        brightness,
        contrast,
        inverted,
        rotation,
        imageMetadata,
        pixelSpacingMm,
        savedAt: new Date().toISOString(),
      };
      try {
        localStorage.setItem("aimaging.document", JSON.stringify(doc));
      } catch {
        return null;
      }
      if (name) setImageName(n);
      return { name: n, savedAt: doc.savedAt, doc };
    },
    [imageSrc, imageName, dims, shapesRef, wl, brightness, contrast, inverted, rotation, imageMetadata, pixelSpacingMm],
  );

  /* ------------------------- Auto-save + restore (44) ------------------------ */
  /* Debounced auto-save: the document is persisted to localStorage on every
     change, so closing/reloading the app loses nothing. */

  useEffect(() => {
    if (!imageSrc) return;
    const t = window.setTimeout(() => {
      void saveDocument();
    }, 800);
    return () => window.clearTimeout(t);
  }, [imageSrc, saveDocument, shapes]);

  /* Restore the auto-saved document on startup (disabled via ?noautoload=1 or
     when the editor was opened from an examination).
     Deferred via microtask so the initial mount render is untouched. */
  useEffect(() => {
    if (!autoRestore) return;
    if (new URLSearchParams(window.location.search).get("noautoload") === "1") return;
    const raw = localStorage.getItem("aimaging.document");
    if (!raw) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      try {
        const d = JSON.parse(raw) as {
          name?: unknown;
          imageSrc?: unknown;
          dims?: { w?: unknown; h?: unknown };
          shapes?: unknown[];
          wl?: WlValue;
          brightness?: unknown;
          contrast?: unknown;
          inverted?: unknown;
          rotation?: unknown;
          imageMetadata?: unknown;
          pixelSpacingMm?: unknown;
        };
        if (typeof d.imageSrc !== "string" || !d.imageSrc) return;
        const restored = (Array.isArray(d.shapes) ? d.shapes : []).filter(
          (s): s is Shape => typeof s === "object" && s !== null,
        );
        shapesRef.current = restored;
        setShapesState(restored);
        setImageSrc(d.imageSrc);
        setImageName(typeof d.name === "string" && d.name ? d.name : "Untitled");
        setDims({
          w: Number(d.dims?.w ?? 0) || 0,
          h: Number(d.dims?.h ?? 0) || 0,
        });
        if (d.wl) setWl(d.wl);
        if (typeof d.brightness === "number") setBrightness(d.brightness);
        if (typeof d.contrast === "number") setContrast(d.contrast);
        if (typeof d.inverted === "boolean") setInverted(d.inverted);
        if (typeof d.rotation === "number") setRotation(d.rotation);
        if (typeof d.imageMetadata === "object" && d.imageMetadata !== null) {
          setImageMetadata(d.imageMetadata as ExamImageMetadata);
        }
        if (isPixelSpacingMm(d.pixelSpacingMm)) setPixelSpacingMm(d.pixelSpacingMm);
        setSelection(null);
      } catch {
        /* corrupt snapshot ÔÇö ignore */
      }
    });
    return () => {
      cancelled = true;
    };
  }, [setShapesState, setImageSrc, setImageName, setDims, setWl, setBrightness, setContrast, setInverted, setRotation, setImageMetadata, setPixelSpacingMm, setSelection, autoRestore]);

  const value = useMemo<WorkspaceState>(
    () => ({
      tool,
      setTool,
      selection,
      setSelection,
      shapes,
      pushHistory,
      addShape,
      updateShape,
      removeShape,
      removeShapes,
      resetDocument,
      undo,
      redo,
      canUndo,
      canRedo,
      clipboard,
      copySelection,
      cutSelection,
      pasteClipboard,
      duplicateSelection,
      selectAll,
      nudgeSelection,
      canPaste: clipboard.length > 0 && Boolean(imageSrc),
      prefs,
      setPrefs,
      dims,
      setDims,
      crop,
      setCrop,
      applyCrop,
      shapeStyle,
      setShapeStyle,
      view,
      viewRef,
      setView,
      rotation,
      setRotation,
      flipH,
      setFlipH,
      flipV,
      setFlipV,
      zoomPreset,
      setZoomPreset,
      splitOn,
      setSplitOn,
      activePane,
      setActivePane,
      viewB,
      viewBRef,
      setViewB,
      activeView,
      setActiveView,
      toolbarOpen,
      setToolbarOpen,
      rightPanelOpen,
      setRightPanelOpen,
      rightWidth,
      setRightWidth,
      probe,
      setProbe,
      gridOn,
      setGridOn,
      setPixelGrid,
      toggleGrid,
      rulersOn,
      setRulersOn,
      statusBarOpen,
      setStatusBarOpen,
      gradcamOn,
      setGradcamOn,
      gradcamIntensity,
      setGradcamIntensity,
      gradcamMode,
      setGradcamMode,
      gradcamResult,
      setGradcamResult,
      threeDResult,
      setThreeDResult,
      threeDOn,
      setThreeDOn,
      threeDRunning,
      setThreeDRunning,
      threeDProgress,
      setThreeDProgress,
      pixelSpacingMm,
      setPixelSpacingMm,
      wl,
      setWl,
      anatomyResult,
      anatomyLoading,
      anatomyError,
      anatomyCardOpen,
      setAnatomyCardOpen,
      toggleAnatomyCard,
      anatomySelected,
      setAnatomySelected,
      runAnatomyAnalysis,
      anatomyRegionTexts,
      anatomyRegionTextsLoading,
      anatomyRegionTextsError,
      loadAnatomyRegionTexts,
      anatomyRegionAnomalies,
      anatomyRegionOverrides,
      saveAnatomyRegionObservation,
      pathologyResult,
      pathologyLoading,
      pathologyError,
      pathologyCardOpen,
      togglePathologyCard,
      runPathologyAnalysis,
      pathologyBoxesOn,
      setPathologyBoxesOn,
      pathologyHeatmapOn,
      setPathologyHeatmapOn,
      pathologyHeatmapKey,
      setPathologyHeatmapKey,
      landmarkResult,
      landmarkLoading,
      landmarkError,
      landmarkCardOpen,
      setLandmarkCardOpen,
      toggleLandmarksCard,
      landmarksSelected,
      setLandmarksSelected,
      runLandmarksAnalysis,
      placeLandmarkMeasurements,
      removeLandmarkMeasurements,
      landmarkContours,
      landmarkLive,
      landmarkEdited,
      setLandmarkContourNode,
      resetLandmarkContours,
      cxrResult,
      setCxrResult,
      brightness,
      setBrightness,
      contrast,
      setContrast,
      inverted,
      setInverted,
      collapsed,
      toggleSection,
      analysis,
      runAnalysis,
      runUnifiedAnatomyAnalysis,
      imageLocked,
      setImageLocked,
      imageCardOpen,
      setImageCardOpen,
      gradcamCardOpen,
      setGradcamCardOpen,
      cardOrder,
      setCardOrder,
      aiDisclaimerAck,
      setAiDisclaimerAck,
      aiDisclaimerDismissed,
      setAiDisclaimerDismissed,
      aiBusy,
      aiHistory,
      aiCustomCommands,
      addAiCustomCommand,
      updateAiCustomCommand,
      removeAiCustomCommand,
      removeAiHistory,
      clearAiHistory,
      aiResults,
      setAiDiagnostics,
      aiFocus,
      focusAiRegion,
      runAiCommand,
      setAiCommandResolver,
      executeAiActionPlan,
      setAiTransactionUndo,
      undoAiTransaction,
      aiTransactionUndoable,
      setAiTransactionUndoable,
      aiThought,
      reportEditOpen, setReportEditOpen,
      reportDraft, setReportDraft,
      openReportEditor,
      saveReportDraft,
      radioReportValidated: radioReport?.status === "validated",
      validateRadioReport,
      setRadioReportGeneration,
      cursorPos,
      setCursorPos,
imageSrc,
      setImageSrc,
      renderSrc,
      dicomLinear,
      setDicomLinear,
      imageId,
      setImageId,
      imageIdRef,
      imageName,
      setImageName,
      patientInfo,
      setPatientInfo,
      imageMetadata,
      setImageMetadata,
      openImageData,
      closeDocument,
      saveDocument,
      captureImageState,
      applyImageState,
      fitSignal,
      requestFit,
      layers,
      setLayerVisible,
      setLayerLocked,
      setLayerName,
      setLayerOpacity,
      moveLayer,
      deleteLayerContent,
      notifications,
      notify,
      dismissNotification,
    }),
    [
      tool, selection, shapes, pushHistory, addShape, updateShape, removeShape,
      removeShapes, resetDocument, undo, redo, canUndo, canRedo,
      clipboard, copySelection, cutSelection, pasteClipboard, duplicateSelection,
      selectAll, prefs, setPrefs, dims, setDims, crop, setCrop,
      nudgeSelection,
      applyCrop,
      shapeStyle, setShapeStyle,
      view, viewRef, setView,
      rotation, setRotation, flipH, setFlipH, flipV, setFlipV,
      zoomPreset, setZoomPreset, splitOn, setSplitOn,
      activePane, setActivePane, viewB, viewBRef, setViewB, activeView, setActiveView,
      toolbarOpen,
      rightPanelOpen, rightWidth, gridOn, setGridOn, setPixelGrid, toggleGrid,
      rulersOn, setRulersOn, statusBarOpen, setStatusBarOpen,
      gradcamOn, setGradcamOn, gradcamIntensity, setGradcamIntensity, gradcamMode, setGradcamMode, gradcamResult, setGradcamResult, threeDResult, setThreeDResult, threeDOn, setThreeDOn, threeDRunning, setThreeDRunning, threeDProgress, setThreeDProgress, pixelSpacingMm, setPixelSpacingMm, wl, setWl,
      anatomyResult, anatomyLoading, anatomyError, anatomyCardOpen, setAnatomyCardOpen, toggleAnatomyCard, anatomySelected, setAnatomySelected, runAnatomyAnalysis, cxrResult, setCxrResult,
      anatomyRegionTexts, anatomyRegionTextsLoading, anatomyRegionTextsError, loadAnatomyRegionTexts,
      anatomyRegionAnomalies, anatomyRegionOverrides, saveAnatomyRegionObservation,
      pathologyResult, pathologyLoading, pathologyError, pathologyCardOpen, togglePathologyCard, runPathologyAnalysis,
      pathologyBoxesOn, setPathologyBoxesOn, pathologyHeatmapOn, setPathologyHeatmapOn, pathologyHeatmapKey, setPathologyHeatmapKey,
      landmarkResult, landmarkLoading, landmarkError, landmarkCardOpen, setLandmarkCardOpen, toggleLandmarksCard, landmarksSelected, setLandmarksSelected, runLandmarksAnalysis,
      placeLandmarkMeasurements, removeLandmarkMeasurements,
      landmarkContours, landmarkLive, landmarkEdited, setLandmarkContourNode, resetLandmarkContours,
      brightness, setBrightness, contrast, setContrast, inverted, setInverted,
      probe, setProbe,
      collapsed, toggleSection, analysis,
      runAnalysis,
      runUnifiedAnatomyAnalysis,
      imageLocked, setImageLocked, imageCardOpen, setImageCardOpen, gradcamCardOpen, setGradcamCardOpen, cardOrder, setCardOrder,
      aiDisclaimerAck, setAiDisclaimerAck,
      aiDisclaimerDismissed, setAiDisclaimerDismissed, aiBusy, aiHistory,
      aiCustomCommands, addAiCustomCommand, updateAiCustomCommand, removeAiCustomCommand,
      removeAiHistory, clearAiHistory, notifications, notify, dismissNotification,
      aiResults, setAiDiagnostics, aiFocus, focusAiRegion, runAiCommand, setAiCommandResolver, executeAiActionPlan,
      setAiTransactionUndo, undoAiTransaction, aiTransactionUndoable, setAiTransactionUndoable, aiThought,
      reportEditOpen, setReportEditOpen, reportDraft, setReportDraft,
      openReportEditor, saveReportDraft,
      radioReport, validateRadioReport, setRadioReportGeneration,
      cursorPos, setCursorPos, imageSrc, renderSrc, dicomLinear, setDicomLinear, imageId, setImageId, imageIdRef, imageName, setImageName, patientInfo, setPatientInfo, imageMetadata, setImageMetadata, openImageData,
      closeDocument, saveDocument, captureImageState, applyImageState, fitSignal, requestFit,
      layers, setLayerVisible, setLayerLocked, setLayerName, setLayerOpacity,
      moveLayer, deleteLayerContent,
    ],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}