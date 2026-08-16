import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
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
  type LayerDef,
  type LayerId,
  type ImageStateSnapshot,
  type PixelSpacingMm,
  type Prefs,
  type SectionId,
  type Shape,
  type ShapeStyle,
  type Viewport,
  type WorkspaceState,
  type WlValue,
} from "./workspace";
import type { ExamImageMetadata, GradCamResult, ThreeDResult } from "../lib/examinations";
import type { LinearImageBuffer } from "../lib/dicom";
import { linearToDataUrl } from "../lib/dicomRenderer";
import { imageToPngDataUrl } from "../lib/exportImage";
import { amendReportText, mockDiagnostics, mockReport, parseAiCommand, type AiCommandAction, type RegionFrac } from "../lib/aiCommands";
import type { AiActionPlan } from "../lib/workspaceProtocol";
import type { WorkspaceThreeDProgress } from "../lib/workspaceApi";

const DEFAULT_COLLAPSED: Record<SectionId, boolean> = {
  document: false,
  image: false,
  aianalysis: false,
  gradcam: false,
  measurements: false,
  annotations: true,
  layers: false,
  metadata: true,
};

/** Converts a fraction-based region into image px */
const fracToPx = (r: RegionFrac, dims: { w: number; h: number }) => ({
  x: r.x * dims.w,
  y: r.y * dims.h,
  w: r.w * dims.w,
  h: r.h * dims.h,
});

const pxDiag = (d: AiDiagnosis, dims: { w: number; h: number }): AiDiagnosis =>
  d.region ? { ...d, region: fracToPx(d.region, dims) } : d;

const cloneShape = (s: Shape): Shape => ({
  ...s,
  points: s.points.map((p) => ({ ...p })),
});

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
  const [imageName, setImageName] = useState("Chest X-Ray — PA");
  const [imageMetadata, setImageMetadataState] = useState<ExamImageMetadata | null>(null);
  const setImageMetadata = useCallback((metadata: ExamImageMetadata | null) => {
    setImageMetadataState(metadata);
  }, []);
  const [fitSignal, setFitSignal] = useState<{ a: number; b: number }>({ a: 0, b: 0 });
  const [dims, setDims] = useState({ w: 1200, h: 1063 });
  const imageNameRef = useRef("Chest X-Ray — PA");
  const dimsRef = useRef({ w: 1200, h: 1063 });

  useEffect(() => {
    imageIdRef.current = imageId;
    imageSrcRef.current = imageSrc;
    imageNameRef.current = imageName;
    dimsRef.current = dims;
  }, [imageId, imageSrc, imageName, dims]);

  const [dicomLinear, setDicomLinearState] = useState<LinearImageBuffer | null>(null);
  const setDicomLinear = useCallback((buffer: LinearImageBuffer | null) => {
    setDicomLinearState((prev) => (prev === buffer ? prev : buffer));
    if (buffer) setDims({ w: buffer.width, h: buffer.height });
  }, []);
  const [crop, setCrop] = useState<WorkspaceState["crop"]>(null);

  /* Rendu prêt à afficher : fenêtrage natif pour les DICOM linéaires, sinon
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
    /* Un DICOM linéaire est rogné sur le rendu fenêtré courant, puis l'image
       devient une image ordinaire (le buffer linéaire est détaché). */
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
  /* Annulation globale des transactions IA multi-images (régistrée par le Shell). */
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
      /* localStorage unavailable — prompts stay in memory */
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

  /** Reflection steps shown above the command bar while an action runs. */
  const thoughtSteps = (kind: AiCommandAction["kind"]): string[] => {
    switch (kind) {
      case "analysis":
        return [
          "Interprétation de la requête…",
          "Analyse des pixels de l'image…",
          "Détection des anomalies, annotation des zones…",
        ];
      case "report":
        return [
          "Interprétation de la requête…",
          "Collecte des mesures et constats…",
          "Rédaction du rapport…",
        ];
      case "amendReport":
        return [
          "Interprétation de la requête…",
          "Révision du rapport en cours…",
          "Application des modifications…",
        ];
      case "gradcam":
        return [
          "Interprétation de la requête…",
          "Calcul de la carte d'activation…",
          "Superposition de la heatmap sur l'image…",
        ];
      case "explain":
      case "focus":
      case "focusDiagnosis":
        return [
          "Interprétation de la requête…",
          "Localisation de la région suspecte…",
          "Recentrage et zoom sur la zone…",
        ];
      case "annotation":
        return ["Interprétation de la requête…", "Placement de l'annotation…"];
      case "measure":
        return ["Interprétation de la requête…", "Mesure de la longueur…"];
      case "wl":
        return ["Interprétation de la requête…", "Application du fenêtrage…"];
      case "invert":
        return ["Interprétation de la requête…", "Inversion des niveaux de gris…"];
      case "compare":
        return ["Interprétation de la requête…", "Préparation de la comparaison…"];
      default:
        return ["Interprétation de la requête…", "Exécution de la commande…"];
    }
  };

  const runAiCommand = useCallback(
    (raw: string) => {
      const text = raw.trim();
      if (!text) return;
      if (commandResolverRef.current) {
        const item: AiHistoryItem = { id: randomId(), text, summary: "Commande en cours…", at: Date.now() };
        setAiHistory((history) => [{ ...item }, ...history].slice(0, 20));
        setAiBusy(true);
        setAiThought({ id: item.id, text: "Validation de la commande structurée…" });
        void commandResolverRef.current(text)
.then((resolution) => {
            const result = executePlanRef.current(resolution.plan);
            const warnings = [...(resolution.warnings ?? []), ...result.warnings];
            const actionSummary =
              resolution.actionSummary ??
              (result.appliedActionIds.length
                ? `${result.appliedActionIds.length} action(s) appliquée(s).`
                : "Aucune action canvas appliquée.");
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
            const message = error instanceof Error ? error.message : "Commande impossible à traiter.";
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
      const action = parseAiCommand(text);
      const item: AiHistoryItem = { id: randomId(), text, summary: "En cours…", at: Date.now() };
      setAiHistory((h) => [{ ...item }, ...h].slice(0, 20));
      setAiBusy(true);
      if (aiTimer.current) window.clearTimeout(aiTimer.current);
      aiThoughtTimers.current.forEach((t) => window.clearTimeout(t));
      aiThoughtTimers.current = [];
      const steps = thoughtSteps(action.kind);
      steps.forEach((s, i) => {
        aiThoughtTimers.current.push(
          window.setTimeout(() => setAiThought({ id: item.id + "-" + i, text: s }), i * 300),
        );
      });
      aiTimer.current = window.setTimeout(() => {
        setAiBusy(false);
        setAiThought(null);
        const done: AiHistoryItem = { ...item, summary: action.summary };
        setAiHistory((h) => h.map((i) => (i.id === item.id ? done : i)));
        setAiResults((r) => ({ ...r, lastSummary: action.summary }));

        switch (action.kind) {
          case "analysis":
            setAnalysis("running");
            window.setTimeout(() => setAnalysis("done"), 1400);
            setAiResults((r) => ({ ...r, diagnostics: mockDiagnostics().map((d) => pxDiag(d, dims)) }));
            break;
          case "explain":
            setAiFocus({ ...fracToPx(action.region, dims), ts: Date.now() });
            break;
          case "focus":
            setAiFocus({ ...fracToPx(action.region, dims), ts: Date.now() });
            break;
          case "focusDiagnosis": {
            setAiResults((r) => ({
              ...r,
              diagnostics: mockDiagnostics().map((d) => pxDiag(d, dims)),
            }));
            const r = fracToPx(action.region, dims);
            const ann: Shape = {
              id: randomId(),
              type: "annotation",
              x: r.x + r.w / 2,
              y: r.y,
              w: 0,
              h: 0,
              points: [{ x: r.x + r.w / 2, y: r.y }],
              strokeWidth: 2,
              label: action.label,
              fontSize: 14,
              fontFamily: "sans",
              fontWeight: "normal",
              color: "#ffffff",
              createdBy: "ai",
            };
            pushHistory();
            commit([...shapesRef.current, ann]);
            setSelection(ann.id);
            setAiFocus({ ...r, ts: Date.now() });
            setAnalysis("done");
            break;
          }
          case "gradcam":
            setAiResults((r) => ({
              ...r,
              lastWarnings: ["Ouvrez un examen pour calculer une Grad-CAM rÃ©elle sur le serveur."],
            }));
            break;
          case "report": {
            const fresh = mockReport(imageName);
            setAiResults((r) => ({ ...r, report: fresh }));
            if (reportEditOpen) setReportDraft(fresh);
            break;
          }
          case "amendReport": {
            if (reportEditOpen) {
              setReportDraft(action.text);
            } else {
              setAiResults((r) => ({ ...r, report: amendReportText(item.text, r.report ?? "") }));
            }
            break;
          }
          case "annotation": {
            const r = fracToPx(action.region, dims);
            const ann: Shape = {
              id: randomId(),
              type: "annotation",
              x: r.x + r.w / 2,
              y: r.y,
              w: 0,
              h: 0,
              points: [{ x: r.x + r.w / 2, y: r.y }],
              strokeWidth: 2,
              label: "Note IA",
              fontSize: 14,
              fontFamily: "sans",
              fontWeight: "normal",
              color: "#ffffff",
              createdBy: "ai",
            };
            pushHistory();
            commit([...shapesRef.current, ann]);
            setSelection(ann.id);
            break;
          }
          case "measure": {
            const r = fracToPx(action.region, dims);
            const m: Shape = {
              id: randomId(),
              type: "measure",
              x: r.x,
              y: r.y + r.h / 2,
              w: r.w,
              h: 0,
              points: [],
              strokeWidth: 2,
              createdBy: "ai",
            };
            pushHistory();
            commit([...shapesRef.current, m]);
            setSelection(m.id);
            break;
          }
          case "wl":
            setWl(action.wl);
            break;
          case "invert":
            setInverted(!inverted);
            break;
          case "compare":
            break;
          case "unknown":
            /* While the report editor is open, any unrecognised instruction is
               treated as a free-form amendment of the draft. */
            if (reportEditOpen) {
              setReportDraft((d) => `${d}\n\nNote IA : « ${item.text} » — complément ajouté.\n${amendReportText(item.text, "")}`);
            }
            break;
        }
      }, 1250);
    },
    [
      dims,
      imageName,
      inverted,
      reportEditOpen,
      pushHistory,
      commit,
      setInverted,
      setWl,
    ],
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
        warnings.push(`Action ${action.id} ignorée : elle cible une autre image.`);
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
            warnings.push("Aucune Grad-CAM réelle n'est disponible pour cette image.");
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
          if (typeof payload.message === "string") warnings.push(payload.message);
          break;
        case "analyze_image":
        case "analyze_exam":
        case "predict":
          setAnalysis("done");
          break;
        case "generate_gradcam":
          if (!gradcamResultRef.current) {
            warnings.push("La génération Grad-CAM n'a pas fourni de carte exploitable.");
            continue;
          }
          break;
        case "generate_report":
          warnings.push(`Action ${action.type} planifiée mais son service backend n'est pas encore relié.`);
          continue;
      }
      appliedActionIds.push(action.id);
    }
    if (appliedActionIds.length === 0) {
      /* Aucun changement : retire l'instantané inutile créé pour cette transaction. */
      pastRef.current.pop();
      setCanUndo(pastRef.current.length > 0);
    }
    if (actionShapeIds.size > 0) recordAiAction(`${actionShapeIds.size} objet(s) ajouté(s) par l'IA.`);
    return { appliedActionIds, warnings };
  }, [commit, pushHistory, recordAiAction, setBrightness, setContrast, setGradcamIntensity, setGradcamOn, setInverted, setLayerOpacity, setLayerVisible, setThreeDOn, setWl]);

  useEffect(() => {
    executePlanRef.current = executeAiActionPlan;
  }, [executeAiActionPlan]);

  /** Rejoue les actions enregistrées d'un prompt (déterministe, une seule
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
            warnings.push("Aucune Grad-CAM n'est disponible pour cette image : action ignorée.");
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
    const summary = `${applied} action(s) rejouée(s) depuis le prompt.${warnings.length ? ` ${warnings[0]}` : ""}`;
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
        /* corrupt snapshot — ignore */
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
      brightness, setBrightness, contrast, setContrast, inverted, setInverted,
      probe, setProbe,
      collapsed, toggleSection, analysis,
      runAnalysis,
      aiMode, setAiMode, aiDisclaimerAck, setAiDisclaimerAck,
      aiDisclaimerDismissed, setAiDisclaimerDismissed, aiBusy, aiHistory,
      aiCustomPrompts, addAiCustomPrompt, removeAiCustomPrompt,
      aiActionLog, recordAiAction, runAiPrompt, removeAiHistory, clearAiHistory,
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
