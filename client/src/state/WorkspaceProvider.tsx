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
  type AiPrompt,
  type AiRecordedAction,
  type AiResults,
  type AppNotification,
  type LayerDef,
  type LayerId,
  type ImageStateSnapshot,
  type NotificationKind,
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
import { buildWorkspaceManifest, captureAnnotatedImage } from "../lib/workspaceProtocol";
import type { AnatomyRegionPayload, OpenCxrImageResult, WorkspaceAnatomyResult, WorkspaceLandmarksResult, WorkspaceThreeDProgress } from "../lib/workspaceApi";
import { createWorkspaceExam, generateWorkspaceAnatomy, generateWorkspaceAnatomyAnalysis, generateWorkspaceAnatomyRegions, generateWorkspaceLandmarks, toAnatomyContext } from "../lib/workspaceApi";
import { ANATOMY_REGIONS } from "../lib/anatomyMap";
import {
  computeLandmarkMeasurements,
  contoursEdited,
  type LandmarkContours,
  type LandmarkOrganKey,
} from "../lib/landmarkMeasure";

const DEFAULT_COLLAPSED: Record<SectionId, boolean> = {
  document: false,
  image: false,
  aianalysis: false,
  opencxr: false,
  gradcam: false,
  measurements: false,
  annotations: true,
  layers: false,
  metadata: true,
};



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

export function WorkspaceProvider({
  children,
  autoRestore = true,
}: {
  children: ReactNode;
  /** When true, the standalone editor restores the auto-saved document on mount.
   *  Disable when opening the editor with an examination image. */
  autoRestore?: boolean;
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
  /* Mesures recalculées en temps réel pendant le drag d'un nœud (réplique du
     calcul serveur, voir lib/landmarkMeasure.ts). */
  const landmarkLive = useMemo(
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
    landmarkResultRef.current = null;
    setLandmarkResultState(null);
    setLandmarksSelectedState(null);
    setLandmarkError(null);
    landmarkContoursRef.current = null;
    setLandmarkContoursState(null);
    cxrResultRef.current = null;
    setCxrResultState(null);
  }, [imageId]);

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

  const [aiMode, setAiMode] = useState(false);
  const [aiDisclaimerAck, setAiDisclaimerAck] = useState(false);
  const [aiDisclaimerDismissed, setAiDisclaimerDismissed] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiHistory, setAiHistory] = useState<AiHistoryItem[]>([]);
  const [aiCustomPrompts, setAiCustomPrompts] = useState<AiPrompt[]>(() => {
    try {
      const raw = localStorage.getItem("aimaging.aiPrompts");
      const arr = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(arr)) return [];
      return arr
        .map((x: unknown): AiPrompt | null => {
          if (typeof x === "string") return { id: randomId(), text: x, actions: [], at: Date.now() };
          if (x && typeof x === "object" && typeof (x as AiPrompt).text === "string") {
            return {
              id: (x as AiPrompt).id ?? randomId(),
              text: (x as AiPrompt).text,
              actions: Array.isArray((x as AiPrompt).actions) ? (x as AiPrompt).actions : [],
              at: Number((x as AiPrompt).at) || Date.now(),
            };
          }
          return null;
        })
        .filter((p: AiPrompt | null): p is AiPrompt => p !== null)
        .slice(0, 24);
    } catch {
      return [];
    }
  });
  const [aiActionLog, setAiActionLog] = useState<AiRecordedAction[]>([]);

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
  const [aiFocus, setAiFocus] = useState<AiFocus | null>(null);
  const [aiThought, setAiThought] = useState<{ id: string; text: string } | null>(null);
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
  }, [reportDraft]);

  const focusAiRegion = useCallback((r: { x: number; y: number; w: number; h: number }) => {
    setAiFocus({ ...r, ts: Date.now() });
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("aimaging.aiPrompts", JSON.stringify(aiCustomPrompts));
    } catch {
      /* localStorage unavailable ÔÇö prompts stay in memory */
    }
  }, [aiCustomPrompts]);

  const addAiCustomPrompt = useCallback((text: string, actions: AiRecordedAction[] = []) => {
    const t = text.trim();
    if (!t) return;
    setAiCustomPrompts((prompts) => [
      { id: randomId(), text: t, actions: actions.slice(0, 10), at: Date.now() },
      ...prompts.filter((p) => p.text !== t),
    ].slice(0, 24));
  }, []);

  const removeAiCustomPrompt = useCallback((id: string) => {
    setAiCustomPrompts((prompts) => prompts.filter((p) => p.id !== id));
  }, []);

  const recordAiAction = useCallback((text: string, action?: { type: string; payload: Record<string, unknown> }) => {
    const t = text.trim();
    if (!t) return;
    const rec: AiRecordedAction = {
      id: randomId(),
      label: t,
      type: action?.type ?? "",
      payload: action?.payload ?? {},
      at: Date.now(),
    };
    setAiActionLog((log) => [rec, ...log.filter((x) => !(x.label === t && x.type === rec.type))].slice(0, 30));
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
    } catch (exc) {
      if (imageIdRef.current !== imageIdValue) return;
      const message = exc instanceof Error ? exc.message : "Interprétation IA des régions indisponible.";
      setAnatomyRegionTextsError(message);
    } finally {
      anatomyRegionTextsLoadingRef.current = false;
      setAnatomyRegionTextsLoading(false);
    }
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
      recordAiAction(`Segmentation anatomique : ${message}`);
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
      recordAiAction(
        `Segmentation anatomique : ${response.result.segmentation.label_ids_available.length} structures détectées, ` +
          `CTR=${response.result.measurements["Cardio-Thoracic Ratio"]?.available ? "oui" : "n.d."}, ` +
          `SCD=${response.result.measurements["Spine-Center Distance"]?.available ? "oui" : "n.d."}.`,
      );
      return true;
    } catch (exc) {
      const message = exc instanceof Error ? exc.message : "Segmentation anatomique impossible.";
      setAnatomyError(message);
      recordAiAction(`Segmentation anatomique : ${message}`);
      return false;
    } finally {
      anatomyLoadingRef.current = false;
      setAnatomyLoading(false);
    }
  }, [loadAnatomyRegionTexts, recordAiAction]);

  const toggleAnatomyCard = useCallback(() => {
    const next = !anatomyCardOpenRef.current;
    setAnatomyCardOpen(next);
    if (next && !anatomyResultRef.current && !anatomyLoadingRef.current && imageIdRef.current && imageSrcRef.current) {
      void runAnatomyAnalysis();
    }
  }, [runAnatomyAnalysis, setAnatomyCardOpen]);

  const setLandmarksSelected = useCallback((organ: string | null) => {
    setLandmarksSelectedState(organ);
  }, []);

  const setLandmarkCardOpen = useCallback((open: boolean) => {
    landmarkCardOpenRef.current = open;
    setLandmarkCardOpenState(open);
  }, []);

  /** Formes de mesure posées automatiquement (diamètres + étiquette CTR). */
  const LANDMARK_SHAPE_PREFIX = "landmarks:";

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
      recordAiAction(`Analyse anatomique : ${message}`);
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

      recordAiAction(
        `Analyse anatomique : CXAS ${cx?.status === "ok" ? "ok" : "erreur"}, ` +
          `HybridGNet ${response.hybridgnet?.status === "ok" ? "ok" : "erreur"}.`,
      );
      return true;
    } catch (exc) {
      const message = exc instanceof Error ? exc.message : "Analyse anatomique impossible.";
      setAnatomyError(message);
      setLandmarkError(message);
      recordAiAction(`Analyse anatomique : ${message}`);
      return false;
    } finally {
      anatomyLoadingRef.current = false;
      landmarkLoadingRef.current = false;
      setAnatomyLoading(false);
      setLandmarkLoading(false);
    }
  }, [adoptModelContours, placeLandmarkMeasurements, recordAiAction]);

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
      recordAiAction(`Mesures landmarks : ${message}`);
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
      const ctr = response.result.measurements.ctr;
      recordAiAction(
        `Mesures landmarks : CTR=${ctr.value.toFixed(3)} ± ${ctr.std.toFixed(3)}, ` +
          `σ max=${response.result.uncertainty.max_node_std_px.toFixed(1)} px.`,
      );
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
      recordAiAction(`Mesures landmarks : ${message}`);
      return false;
    } finally {
      landmarkLoadingRef.current = false;
      setLandmarkLoading(false);
    }
    },
    [adoptModelContours, recordAiAction, placeLandmarkMeasurements],
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
    const actionShapeIds = new Set<string>();

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
          actionShapeIds.add(shape.id);
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
            recordAiAction(`Analyse anatomique : ${message}`);
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
    if (actionShapeIds.size > 0) recordAiAction(`${actionShapeIds.size} objet(s) ajout├®(s) par l'IA.`);
    return { appliedActionIds, warnings };
  }, [commit, pushHistory, recordAiAction, setBrightness, setContrast, setGradcamIntensity, setGradcamOn, setInverted, setLayerOpacity, setLayerVisible, setThreeDOn, setWl, notify, runUnifiedAnatomyAnalysis]);

  useEffect(() => {
    executePlanRef.current = executeAiActionPlan;
  }, [executeAiActionPlan]);

  /** Rejoue les actions enregistr├®es d'un prompt (d├®terministe, une seule
   *  transaction Ctrl+Z). Sans action rejouable, retombe sur la commande IA. */
  const runAiPrompt = useCallback((prompt: AiPrompt) => {
    const replayable = prompt.actions.filter((a) => a.type);
    if (replayable.length === 0) {
      runAiCommand(prompt.text);
      return;
    }
    pushHistory();
    const warnings: string[] = [];
    let applied = 0;
    for (const a of replayable) {
      const p = a.payload;
      switch (a.type) {
        case "invert":
          setInverted(Boolean(p.value));
          applied++;
          break;
        case "set_window_level":
          setWl({ window: Number(p.window), level: Number(p.level) });
          applied++;
          break;
        case "set_brightness":
          setBrightness(Number(p.value));
          applied++;
          break;
        case "set_contrast":
          setContrast(Number(p.value));
          applied++;
          break;
        case "brightness_contrast":
          setBrightness(Number(p.brightness));
          setContrast(Number(p.contrast));
          applied++;
          break;
        case "show_gradcam":
          if (gradcamResultRef.current) {
            setGradcamOn(Boolean(p.visible));
            if (typeof p.opacity === "number") {
              setGradcamIntensity(Math.min(100, Math.max(0, Math.round(p.opacity * 100))));
            }
            applied++;
          } else {
            warnings.push("Aucune Grad-CAM n'est disponible pour cette image : action ignor├®e.");
          }
          break;
        case "probe": {
          const x = Math.min(1, Math.max(0, Number(p.x)));
          const y = Math.min(1, Math.max(0, Number(p.y)));
          setProbe({ x, y, ts: Date.now() });
          applied++;
          break;
        }
        case "create_shape": {
          const source = p.shape as { type: Shape["type"]; x: number; y: number; w: number; h: number; points?: Array<{ x: number; y: number }>; label?: string; visible?: boolean; style?: { color?: string; stroke_color?: string; fill_color?: string; stroke_width?: number; font_size?: number; font_family?: Shape["fontFamily"]; font_weight?: Shape["fontWeight"] } };
          const style = source.style ?? {};
          const shape: Shape = {
            id: randomId(),
            type: source.type,
            x: Number(source.x),
            y: Number(source.y),
            w: Number(source.w),
            h: Number(source.h),
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
            actionId: `replay-${a.id}`,
          };
          commit([...shapesRef.current, shape]);
          setSelection(shape.id);
          applied++;
          break;
        }
      }
    }
    if (applied === 0) {
      pastRef.current.pop();
      setCanUndo(pastRef.current.length > 0);
      runAiCommand(prompt.text);
      return;
    }
    const summary = `${applied} action(s) rejou├®e(s) depuis le prompt.${warnings.length ? ` ${warnings[0]}` : ""}`;
    const item: AiHistoryItem = { id: randomId(), text: prompt.text, summary, at: Date.now() };
    setAiHistory((history) => [{ ...item }, ...history].slice(0, 20));
    setAiResults((results) => ({ ...results, lastSummary: summary }));
  }, [commit, gradcamResultRef, pastRef, pushHistory, runAiCommand, setBrightness, setContrast, setGradcamIntensity, setGradcamOn, setInverted, setProbe, setSelection, setWl, shapesRef]);

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
      aiMode,
      setAiMode: (v: boolean) => {
        setAiMode(v);
        if (v) setAiDisclaimerDismissed(false);
      },
      aiDisclaimerAck,
      setAiDisclaimerAck,
      aiDisclaimerDismissed,
      setAiDisclaimerDismissed,
      aiBusy,
      aiHistory,
      aiCustomPrompts,
      addAiCustomPrompt,
      removeAiCustomPrompt,
      aiActionLog,
      recordAiAction,
      runAiPrompt,
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
      saveReportDraft,      cursorPos,
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
      landmarkResult, landmarkLoading, landmarkError, landmarkCardOpen, setLandmarkCardOpen, toggleLandmarksCard, landmarksSelected, setLandmarksSelected, runLandmarksAnalysis,
      placeLandmarkMeasurements, removeLandmarkMeasurements,
      landmarkContours, landmarkLive, landmarkEdited, setLandmarkContourNode, resetLandmarkContours,
      brightness, setBrightness, contrast, setContrast, inverted, setInverted,
      probe, setProbe,
      collapsed, toggleSection, analysis,
      runAnalysis,
      runUnifiedAnatomyAnalysis,
      aiMode, setAiMode, aiDisclaimerAck, setAiDisclaimerAck,
      aiDisclaimerDismissed, setAiDisclaimerDismissed, aiBusy, aiHistory,
      aiCustomPrompts, addAiCustomPrompt, removeAiCustomPrompt,
      aiActionLog, recordAiAction, runAiPrompt, removeAiHistory, clearAiHistory, notifications, notify, dismissNotification,
      aiResults, setAiDiagnostics, aiFocus, focusAiRegion, runAiCommand, setAiCommandResolver, executeAiActionPlan,
      setAiTransactionUndo, undoAiTransaction, aiTransactionUndoable, setAiTransactionUndoable, aiThought,
      reportEditOpen, setReportEditOpen, reportDraft, setReportDraft,
      openReportEditor, saveReportDraft,
      cursorPos, setCursorPos, imageSrc, renderSrc, dicomLinear, setDicomLinear, imageId, setImageId, imageIdRef, imageName, imageMetadata, setImageMetadata, openImageData,
      closeDocument, saveDocument, captureImageState, applyImageState, fitSignal, requestFit,
      layers, setLayerVisible, setLayerLocked, setLayerName, setLayerOpacity,
      moveLayer, deleteLayerContent,
    ],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
