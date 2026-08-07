import { createContext, useContext, type RefObject } from "react";

export type ToolId =
  | "move"
  | "hand"
  | "zoom"
  | "rectangle"
  | "ellipse"
  | "arrow"
  | "line"
  | "freedraw"
  | "measure"
  | "angle"
  | "distance"
  | "annotation"
  | "text"
  | "crop"
  | "windowlevel"
  | "brightness"
  | "contrast"
  | "magicwand"
  | "aiselection"
  | "gradcam";

export type SectionId =
  | "document"
  | "image"
  | "aianalysis"
  | "gradcam"
  | "measurements"
  | "annotations"
  | "layers"
  | "metadata";

export type AnalysisState = "idle" | "running" | "done";

export interface Viewport {
  s: number;
  x: number;
  y: number;
}

export interface WlValue {
  window: number;
  level: number;
}

/** Maps a DICOM-style window/level (0-255 HU) onto a CSS contrast()+brightness()
 *  pair: y = C·B·x + 128·B·(1−C)  (8-bit) is the exact linear remap
 *  y = (x − (level − window/2)) · 255/window, clamped. */
export function wlToCssFilter({ window, level }: WlValue): string {
  const w = Math.min(512, Math.max(1, window));
  const l = Math.min(255, Math.max(0, level));
  const slope = 255 / w;
  const offset = (127.5 - l) / w;
  const c = 1 / (1 + (255 * offset) / (128 * slope));
  const C = Math.min(8, Math.max(0.1, c));
  const B = Math.min(8, Math.max(0.05, slope / C));
  return `contrast(${C.toFixed(3)}) brightness(${B.toFixed(3)})`;
}

/** Brightness / Contrast presets (0-100 scale, 50 = neutral) */
export const BC_PRESETS: { label: string; brightness: number; contrast: number }[] = [
  { label: "Default", brightness: 50, contrast: 50 },
  { label: "Low Light", brightness: 35, contrast: 50 },
  { label: "Bright", brightness: 65, contrast: 50 },
  { label: "High Contrast", brightness: 50, contrast: 70 },
  { label: "Soft", brightness: 50, contrast: 32 },
  { label: "Vivid", brightness: 60, contrast: 62 },
];

/** Window / Level presets (DICOM HU style, clamped to 20-512 / 0-255) */
export const WL_PRESETS: { label: string; wl: WlValue }[] = [
  { label: "Default", wl: { window: 255, level: 127.5 } },
  { label: "Lung", wl: { window: 170, level: 60 } },
  { label: "Bone", wl: { window: 350, level: 110 } },
  { label: "Soft Tissue", wl: { window: 60, level: 40 } },
  { label: "Abdomen", wl: { window: 100, level: 50 } },
  { label: "Brain", wl: { window: 80, level: 40 } },
];

/* ------------------------------ Shape model ------------------------------ */

export type ShapeType =
  | "rectangle"
  | "ellipse"
  | "arrow"
  | "line"
  | "freedraw"
  | "measure"
  | "distance"
  | "angle"
  | "annotation"
  | "text";

export type FontFamily = "sans" | "serif" | "mono";
export type FontWeight = "normal" | "bold";

export interface ShapeStyle {
  fontSize: number;
  fontFamily: FontFamily;
  fontWeight: FontWeight;
  color: string;
}

export const FONT_FAMILY_LABEL: Record<FontFamily, string> = {
  sans: "Sans",
  serif: "Serif",
  mono: "Mono",
};

export const TEXT_COLORS = ["#ffffff", "#3B82F6", "#F87171", "#4ADE80", "#FACC15", "#111111"];

export const ACCENT_COLORS = ["#3b82f6", "#8b5cf6", "#ec4899", "#f97316", "#22c55e", "#eab308"];

/** User preferences (persisted to localStorage under `aimaging.prefs`) */
export interface Prefs {
  /** UI accent color */
  accent: string;
  /** Max undo history depth */
  undoCap: number;
  /** Grid rendering style */
  gridStyle: "dots" | "lines";
  /** Grid cell size in doc px */
  gridSize: number;
}

export const DEFAULT_PREFS: Prefs = {
  accent: "#3b82f6",
  undoCap: 60,
  gridStyle: "dots",
  gridSize: 28,
};

export const DEFAULT_SHAPE_STYLE: ShapeStyle = {
  fontSize: 16,
  fontFamily: "sans",
  fontWeight: "normal",
  color: "#ffffff",
};

/** Pixels of image per millimeter (calibrated so ~320 px ≈ 84 mm) */
export const MM_PER_PX = 0.26;

export interface ShapePoint {
  x: number;
  y: number;
}

export interface Shape {
  id: string;
  type: ShapeType;
  /** rect/ellipse: top-left + size. line/arrow/measure/distance: start point + signed deltas to end. angle: vertex + delta of first arm. annotation/text: box top-left. freedraw: unused (see points) */
  x: number;
  y: number;
  w: number;
  h: number;
  /** freedraw: path points. angle: [second arm end]. annotation: [anchor point]. others: [] */
  points: ShapePoint[];
  strokeWidth: number;
  /** annotation / text */
  label?: string;
  fontSize?: number;
  fontFamily?: FontFamily;
  fontWeight?: FontWeight;
  color?: string;
  /** Per-shape visibility (hidden shapes are not rendered nor hit-tested) */
  visible?: boolean;
}

/* ------------------------------ Layer model ------------------------------ */

export type LayerId = "image" | "annotations" | "measurements" | "gradcam";

export interface LayerDef {
  id: LayerId;
  name: string;
  visible: boolean;
  locked: boolean;
  /** 0-100 */
  opacity: number;
}

export const DEFAULT_LAYERS: LayerDef[] = [
  { id: "image", name: "Image", visible: true, locked: false, opacity: 100 },
  { id: "annotations", name: "Annotations", visible: true, locked: false, opacity: 100 },
  { id: "measurements", name: "Measurements", visible: true, locked: false, opacity: 100 },
  { id: "gradcam", name: "Grad-CAM overlay", visible: false, locked: false, opacity: 100 },
];

export function shapeLayerId(s: Shape): LayerId {
  if (s.type === "measure" || s.type === "distance" || s.type === "angle") return "measurements";
  return "annotations";
}

export function layerVisible(id: LayerId, layers: LayerDef[]): boolean {
  return layers.find((l) => l.id === id)?.visible ?? true;
}

export function layerOpacity(id: LayerId, layers: LayerDef[]): number {
  return layers.find((l) => l.id === id)?.opacity ?? 100;
}

/** A shape renders (and is hit-testable) only when it is individually visible
 *  AND its layer is visible. */
export function isShapeVisible(s: Shape, layers: LayerDef[]): boolean {
  if (s.visible === false) return false;
  return layerVisible(shapeLayerId(s), layers);
}

/** Shapes on a locked layer cannot be selected / dragged / resized on the canvas. */
export function isShapeLocked(s: Shape, layers: LayerDef[]): boolean {
  return layers.find((l) => l.id === shapeLayerId(s))?.locked ?? false;
}

/** Reserved selection id for the document image */
export const IMAGE_SELECTION = "image";

/** Reserved selection id meaning "all shapes are selected" (Select All) */
export const SELECT_ALL = "__all__";

export const randomId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/** Text label bounding box (annotation box / text extent) in doc units */
export function shapeTextBox(s: Shape): { x: number; y: number; w: number; h: number } {
  const fs = s.fontSize ?? 16;
  const lines = (s.label ?? "").split("\n");
  const len = Math.max(1, ...lines.map((l) => l.length));
  return { x: s.x, y: s.y, w: len * fs * 0.62 + 20, h: lines.length * fs * 1.35 + 14 };
}

export function shapeBBox(s: Shape): { x: number; y: number; w: number; h: number } {
  if (s.type === "freedraw") {
    if (s.points.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const p of s.points) {
      x1 = Math.min(x1, p.x); y1 = Math.min(y1, p.y);
      x2 = Math.max(x2, p.x); y2 = Math.max(y2, p.y);
    }
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }
  if (s.type === "line" || s.type === "arrow" || s.type === "measure" || s.type === "distance") {
    const x1 = s.x, y1 = s.y, x2 = s.x + s.w, y2 = s.y + s.h;
    return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(s.w), h: Math.abs(s.h) };
  }
  if (s.type === "angle") {
    const p2 = s.points[0] ?? { x: s.x, y: s.y };
    const pts = [{ x: s.x, y: s.y }, { x: s.x + s.w, y: s.y + s.h }, p2];
    const x1 = Math.min(...pts.map((p) => p.x));
    const y1 = Math.min(...pts.map((p) => p.y));
    const x2 = Math.max(...pts.map((p) => p.x));
    const y2 = Math.max(...pts.map((p) => p.y));
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }
  if (s.type === "annotation" || s.type === "text") return shapeTextBox(s);
  return { x: s.x, y: s.y, w: s.w, h: s.h };
}

/** Full image CSS filter used both by the viewport and the canvas exporter:
 *  invert → brightness → contrast → window/level. */
export function buildImageFilter(
  wl: WlValue,
  brightness: number,
  contrast: number,
  inverted: boolean,
): string {
  return (
    (inverted ? "invert(1) " : "") +
    `brightness(${brightness / 50}) contrast(${1 + (contrast - 50) / 40}) ${wlToCssFilter(wl)}`
  );
}

/** Snapshot of the whole editor state (image, adjustments, shapes) so it can be
 *  persisted against an examination image. name/dims are present when captured
 *  from the editor but optional when restoring (examination images carry them). */
export interface ImageStateSnapshot {
  name?: string;
  src: string;
  dims?: { w: number; h: number };
  shapes: Shape[];
  wl: WlValue;
  brightness: number;
  contrast: number;
  inverted: boolean;
  rotation: number;
  flipH: boolean;
  flipV: boolean;
}

export interface WorkspaceState {
  tool: ToolId;
  setTool: (t: ToolId) => void;

  /* selection: a shape id, IMAGE_SELECTION for the document, SELECT_ALL for everything, or null */
  selection: string | null;
  setSelection: (s: string | null) => void;

  shapes: Shape[];
  pushHistory: () => void;
  addShape: (s: Shape) => void;
  updateShape: (id: string, patch: Partial<Shape>) => void;
  removeShape: (id: string) => void;
  removeShapes: (ids: string[]) => void;
  resetDocument: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;

  /* Internal object clipboard (cut / copy / paste) */
  clipboard: Shape[];
  copySelection: () => void;
  cutSelection: () => void;
  pasteClipboard: () => void;
  duplicateSelection: () => void;
  selectAll: () => void;
  /** Moves the selected shape (or all shapes) by (dx, dy) doc units (arrow-key nudge). */
  nudgeSelection: (dx: number, dy: number) => void;
  canPaste: boolean;

  /** User preferences, persisted to localStorage */
  prefs: Prefs;
  setPrefs: (p: Partial<Prefs>) => void;

  /** Natural image size in px */
  dims: { w: number; h: number };
  setDims: (d: { w: number; h: number }) => void;

  /** Active crop rect in image px (null when no crop) */
  crop: { x: number; y: number; w: number; h: number } | null;
  setCrop: (c: { x: number; y: number; w: number; h: number } | null) => void;
  /** Real crop: cuts the image to the crop rect, moves matching shapes */
  applyCrop: () => void;

  /** Default style for newly created text / annotations */
  shapeStyle: ShapeStyle;
  setShapeStyle: (s: ShapeStyle) => void;

  view: Viewport;
  viewRef: RefObject<Viewport>;
  setView: (v: Viewport) => void;

  rotation: number;
  setRotation: (r: number) => void;

  flipH: boolean;
  setFlipH: (v: boolean) => void;
  flipV: boolean;
  setFlipV: (v: boolean) => void;

  zoomPreset: "fit" | "actual";
  setZoomPreset: (p: "fit" | "actual") => void;

  /** Split view: renders a second canvas pane ("2 Windows") for side-by-side comparison */
  splitOn: boolean;
  setSplitOn: (o: boolean) => void;
  /** Which pane receives zoom / fit commands */
  activePane: "A" | "B";
  setActivePane: (p: "A" | "B") => void;
  /** View of the second pane (independent pan / zoom) */
  viewB: Viewport;
  viewBRef: RefObject<Viewport>;
  setViewB: (v: Viewport) => void;
  /** View of the active pane (alias over view / viewB) */
  activeView: Viewport;
  setActiveView: (v: Viewport) => void;

  toolbarOpen: boolean;
  setToolbarOpen: (o: boolean) => void;
  rightPanelOpen: boolean;
  setRightPanelOpen: (o: boolean) => void;
  rightWidth: number;
  setRightWidth: (w: number) => void;

  gridOn: boolean;
  setGridOn: (o: boolean) => void;
  /** Toggles the classic (dots) grid; resets the style if it was in pixel mode */
  toggleGrid: () => void;
  /** Enables the 1px "pixel grid" (line style, 1px cells) */
  setPixelGrid: (on: boolean) => void;

  rulersOn: boolean;
  setRulersOn: (o: boolean) => void;
  statusBarOpen: boolean;
  setStatusBarOpen: (o: boolean) => void;

  gradcamOn: boolean;
  setGradcamOn: (o: boolean) => void;
  gradcamIntensity: number;
  setGradcamIntensity: (v: number) => void;

  wl: WlValue;
  setWl: (v: WlValue) => void;
  brightness: number;
  setBrightness: (v: number) => void;
  contrast: number;
  setContrast: (v: number) => void;
  inverted: boolean;
  setInverted: (o: boolean) => void;

  collapsed: Record<SectionId, boolean>;
  toggleSection: (id: SectionId) => void;

  analysis: AnalysisState;
  runAnalysis: () => void;

  cursorPos: { x: number; y: number } | null;
  setCursorPos: (p: { x: number; y: number } | null) => void;

  imageSrc: string;
  setImageSrc: (s: string) => void;
  imageName: string;
  setImageName: (n: string) => void;

  /** Captures the current editor state. Returns null when no image is open. */
  captureImageState: () => (ImageStateSnapshot & { name: string; dims: { w: number; h: number } }) | null;
  /** Restores a previously captured editor state (image + adjustments + shapes) */
  applyImageState: (s: ImageStateSnapshot) => void;

  /** Opens a new image: resets shapes/history, overlays and view adjustments */
  openImageData: (dataUrl: string, name: string) => void;
  /** Closes the current document: neutral, empty state */
  closeDocument: () => void;
  /** Persists the document snapshot to localStorage (async: image re-encoded to PNG data URL).
   *  Resolves with the saved doc (for Save As… download) or null if nothing to save / storage failed. */
  saveDocument: (name?: string) => Promise<{ name: string; savedAt: string; doc: Record<string, unknown> } | null>;

  fitSignal: { a: number; b: number };
  /** Fits the active pane (or the pane passed explicitly) to the container */
  requestFit: (pane?: "A" | "B") => void;

  layers: LayerDef[];
  setLayerVisible: (id: LayerId, visible: boolean) => void;
  setLayerLocked: (id: LayerId, locked: boolean) => void;
  setLayerName: (id: LayerId, name: string) => void;
  setLayerOpacity: (id: LayerId, opacity: number) => void;
  /** Moves a layer to a paint-order index (the image layer stays at the bottom) */
  moveLayer: (id: LayerId, toIndex: number) => void;
  /** Removes the content of a layer (shapes of that type, or the Grad-CAM overlay) */
  deleteLayerContent: (id: LayerId) => void;
}

export const WorkspaceContext = createContext<WorkspaceState | null>(null);

export function useWorkspace(): WorkspaceState {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return ctx;
}
