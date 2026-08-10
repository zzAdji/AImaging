import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  DEFAULT_LAYERS,
  DEFAULT_PREFS,
  DEFAULT_SHAPE_STYLE,
  IMAGE_SELECTION,
  SELECT_ALL,
  WorkspaceContext,
  randomId,
  shapeBBox,
  shapeLayerId,
  type AiDiagnosis,
  type AiFocus,
  type AiHistoryItem,
  type AiResults,
  type LayerDef,
  type LayerId,
  type ImageStateSnapshot,
  type Prefs,
  type SectionId,
  type Shape,
  type ShapeStyle,
  type Viewport,
  type WorkspaceState,
  type WlValue,
} from "./workspace";
import { imageToPngDataUrl } from "../lib/exportImage";
import { amendReportText, mockDiagnostics, mockReport, parseAiCommand, type AiCommandAction, type RegionFrac } from "../lib/aiCommands";

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
  const [rightWidth, setRightWidth] = useState(312);
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
  const [gradcamOn, setGradcamOnState] = useState(false);
  const setGradcamOn = useCallback((v: boolean) => {
    setGradcamOnState(v);
    setLayers((prev) =>
      prev.map((l) => (l.id === "gradcam" ? { ...l, visible: v } : l)),
    );
  }, []);
  const [gradcamIntensity, setGradcamIntensity] = useState(62);

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
  const [imageName, setImageName] = useState("Chest X-Ray — PA");
  const [fitSignal, setFitSignal] = useState<{ a: number; b: number }>({ a: 0, b: 0 });
  const [dims, setDims] = useState({ w: 1200, h: 1063 });
  const [crop, setCrop] = useState<WorkspaceState["crop"]>(null);
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
    const src = imageSrc;
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
      setZoomPreset("fit");
      setFitSignal((s) => ({ a: s.a + 1, b: s.b + 1 }));
    };
    img.src = src;
  }, [crop, dims, imageSrc, pushHistory, commit]);

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
  const [aiCustomPrompts, setAiCustomPrompts] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem("aimaging.aiPrompts");
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.filter((x) => typeof x === "string").slice(0, 12) : [];
    } catch {
      return [];
    }
  });
  const [aiActionLog, setAiActionLog] = useState<string[]>([]);
  const [aiResults, setAiResults] = useState<AiResults>({
    diagnostics: [],
    report: null,
    lastSummary: null,
  });
  const [aiFocus, setAiFocus] = useState<AiFocus | null>(null);
  const [aiThought, setAiThought] = useState<{ id: string; text: string } | null>(null);
  const [reportEditOpen, setReportEditOpen] = useState(false);
  const [reportDraft, setReportDraft] = useState("");
  const aiTimer = useRef<number | null>(null);
  const aiThoughtTimers = useRef<number[]>([]);

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

  const addAiCustomPrompt = useCallback((text: string) => {
    const t = text.trim();
    if (!t) return;
    setAiCustomPrompts((p) => (p.includes(t) ? p : [t, ...p].slice(0, 12)));
  }, []);

  const removeAiCustomPrompt = useCallback((text: string) => {
    setAiCustomPrompts((p) => p.filter((t) => t !== text));
  }, []);

  const recordAiAction = useCallback((text: string) => {
    const t = text.trim();
    if (!t) return;
    setAiActionLog((l) => (l[0] === t ? l : [t, ...l.filter((x) => x !== t)].slice(0, 30)));
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
            };
            pushHistory();
            commit([...shapesRef.current, ann]);
            setSelection(ann.id);
            setAiFocus({ ...r, ts: Date.now() });
            setAnalysis("done");
            break;
          }
          case "gradcam":
            setGradcamOn(true);
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
      setGradcamOn,
      setInverted,
      setWl,
    ],
  );

  const requestFit = useCallback((pane?: "A" | "B") => {
    const p = pane ?? activePaneRef.current;
    setZoomPreset("fit");
    setFitSignal((s) => (p === "B" ? { a: s.a, b: s.b + 1 } : { a: s.a + 1, b: s.b }));
  }, []);

  /* ------------------------------ Document ops ------------------------------ */

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
    setSelection(null);
  }, [setRotation, setFlipH, setFlipV, setWl, setBrightness, setContrast, setInverted]);

  const openImageData = useCallback(
    (dataUrl: string, name: string) => {
      resetDocument();
      resetImageAdjustments();
      setImageSrc(dataUrl);
      setImageName(name);
      setDims({ w: 0, h: 0 });
      setZoomPreset("fit");
      setFitSignal((s) => ({ a: s.a + 1, b: s.b + 1 }));
    },
    [resetDocument, resetImageAdjustments],
  );

  const closeDocument = useCallback(() => {
    resetDocument();
    resetImageAdjustments();
    setImageSrc("");
    setImageName("Untitled");
    setDims({ w: 0, h: 0 });
    setZoomPreset("fit");
    setFitSignal((s) => ({ a: s.a + 1, b: s.b + 1 }));
  }, [resetDocument, resetImageAdjustments]);

  const captureImageState = useCallback((): ImageStateSnapshot & { name: string; dims: { w: number; h: number } } | null => {
    if (!imageSrc) return null;
    return {
      name: imageName,
      src: imageSrc,
      dims,
      shapes: shapesRef.current,
      wl,
      brightness,
      contrast,
      inverted,
      rotation,
      flipH,
      flipV,
    };
  }, [imageSrc, imageName, dims, shapesRef, wl, brightness, contrast, inverted, rotation, flipH, flipV]);

  const applyImageState = useCallback(
    (s: ImageStateSnapshot) => {
      setImageSrc(s.src);
      setImageName(s.name || "Untitled");
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
    [commit, setWl, setBrightness, setContrast, setInverted, setRotation, setFlipH, setFlipV],
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
    [imageSrc, imageName, dims, shapesRef, wl, brightness, contrast, inverted, rotation],
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
        setSelection(null);
      } catch {
        /* corrupt snapshot — ignore */
      }
    });
    return () => {
      cancelled = true;
    };
  }, [setShapesState, setImageSrc, setImageName, setDims, setWl, setBrightness, setContrast, setInverted, setRotation, setSelection, autoRestore]);

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
      aiResults,
      aiFocus,
      focusAiRegion,
      runAiCommand,
      aiThought,
      reportEditOpen, setReportEditOpen,
      reportDraft, setReportDraft,
      openReportEditor,
      saveReportDraft,      cursorPos,
      setCursorPos,
      imageSrc,
      setImageSrc,
      imageName,
      setImageName,
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
      gradcamOn, gradcamIntensity, wl, setWl,
      brightness, setBrightness, contrast, setContrast, inverted, setInverted,
      collapsed, toggleSection, analysis,
      runAnalysis,
      aiMode, setAiMode, aiDisclaimerAck, setAiDisclaimerAck,
      aiDisclaimerDismissed, setAiDisclaimerDismissed, aiBusy, aiHistory,
      aiCustomPrompts, addAiCustomPrompt, removeAiCustomPrompt,
      aiActionLog, recordAiAction,
      aiResults, aiFocus, focusAiRegion, runAiCommand, aiThought,
      reportEditOpen, setReportEditOpen, reportDraft, setReportDraft,
      openReportEditor, saveReportDraft,
      cursorPos, setCursorPos, imageSrc, imageName, openImageData,
      closeDocument, saveDocument, captureImageState, applyImageState, fitSignal, requestFit,
      layers, setLayerVisible, setLayerLocked, setLayerName, setLayerOpacity,
      moveLayer, deleteLayerContent,
      openReportEditor, saveReportDraft, reportEditOpen, reportDraft,
    ],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
