import { createContext, useContext, type RefObject } from "react";
import type { ExamImageMetadata, GradCamResult } from "../lib/examinations";
import type { LinearImageBuffer } from "../lib/dicom";
import type { AiActionPlan } from "../lib/workspaceProtocol";

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
  | "gradcam"
  | "probe";

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

/** Window / Level presets destinés au fenêtrage natif sur valeurs rescalees (HU). */
export const WL_PRESETS_HU: { label: string; wl: WlValue }[] = [
  { label: "Lung", wl: { window: 1500, level: -600 } },
  { label: "Mediastinum", wl: { window: 350, level: 40 } },
  { label: "Bone", wl: { window: 2000, level: 500 } },
  { label: "Soft Tissue", wl: { window: 400, level: 40 } },
  { label: "Abdomen", wl: { window: 400, level: 60 } },
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
  /** Default stroke thickness for new shapes (doc units) */
  strokeWidth: number;
  /** Default stroke color for new shapes */
  strokeColor: string;
  /** Default fill color for new rect/ellipse shapes (null = no fill) */
  fillColor: string | null;
}

export const FONT_FAMILY_LABEL: Record<FontFamily, string> = {
  sans: "Sans",
  serif: "Serif",
  mono: "Mono",
};

export const TEXT_COLORS = ["#3B82F6", "#ffffff", "#111111"];

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
  strokeWidth: 2,
  strokeColor: "#3b82f6",
  fillColor: null,
};

/** DICOM Pixel Spacing in millimetres: [row (vertical), column (horizontal)]. */
export type PixelSpacingMm = [number, number];

export function isPixelSpacingMm(value: unknown): value is PixelSpacingMm {
  return Array.isArray(value)
    && value.length === 2
    && value.every((part) => typeof part === "number" && Number.isFinite(part) && part > 0);
}

/** Converts a vector in image pixels to a physical length when DICOM calibration exists. */
export function distanceMm(dx: number, dy: number, pixelSpacingMm: PixelSpacingMm | null | undefined): number | null {
  if (!isPixelSpacingMm(pixelSpacingMm)) return null;
  const [rowSpacing, columnSpacing] = pixelSpacingMm;
  return Math.hypot(dx * columnSpacing, dy * rowSpacing);
}

/** Never invents a millimetre calibration: uncalibrated measures remain in pixels. */
export function formatDistance(dx: number, dy: number, pixelSpacingMm: PixelSpacingMm | null | undefined): string {
  const calibrated = distanceMm(dx, dy, pixelSpacingMm);
  return calibrated === null
    ? `${Math.hypot(dx, dy).toFixed(1)} px`
    : `${calibrated.toFixed(1)} mm`;
}

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
  /** Per-shape stroke color (defaults to the app accent) */
  strokeColor?: string;
  /** Per-shape fill for rect/ellipse (absent = no fill) */
  fillColor?: string;
  /** Per-shape visibility (hidden shapes are not rendered nor hit-tested) */
  visible?: boolean;
  /** Provenance required by the AI action protocol. Existing user shapes default to "user". */
  createdBy?: "user" | "ai";
  /** Identifier of the structured AI action that created or last updated the shape. */
  actionId?: string;
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

/* ------------------------------ AI workspace ------------------------------ */

export interface AiDiagnosis {
  label: string;
  prob: number;
  severity: "low" | "medium" | "high";
  /** Suspected region in doc px (used to focus the canvas) */
  region?: { x: number; y: number; w: number; h: number };
}

export interface AiHistoryItem {
  id: string;
  text: string;
  summary: string;
  /** Full natural-language answer returned by the IA. */
  answer?: string;
  warnings?: string[];
  limitations?: string[];
  at: number;
}

/** Action réelle capturée pendant l'utilisation normale (réglages, dessin…).
 *  `type` vide = simple libellé non rejouable. */
export interface AiRecordedAction {
  id: string;
  label: string;
  type: string;
  payload: Record<string, unknown>;
  at: number;
}

/** Prompt enregistré : une phrase attribuée à une série d'actions capturées. */
export interface AiPrompt {
  id: string;
  text: string;
  actions: AiRecordedAction[];
  at: number;
}

export interface AiResults {
  diagnostics: AiDiagnosis[];
  report: string | null;
  lastSummary: string | null;
  lastResponse: string | null;
  lastWarnings: string[];
  lastLimitations: string[];
  modelName: string | null;
  modelCount: number | null;
}

export interface AiActionExecutionResult {
  appliedActionIds: string[];
  warnings: string[];
}

export interface AiCommandResolution {
  plan: AiActionPlan;
  assistantMessage: string;
  warnings?: string[];
  limitations?: string[];
  /** Remplace le décompte local des actions appliquées (exécution multi-images). */
  actionSummary?: string;
}

export type AiCommandResolver = (text: string) => Promise<AiCommandResolution>;

/** Region the canvas should zoom into (fresh object per request → drives an effect) */
export interface AiFocus {
  x: number;
  y: number;
  w: number;
  h: number;
  ts: number;
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
  /** Affichage du calque Grad-CAM : nuance de bleu uniforme ou carte de chaleur (JET). */
  gradcamMode: "blue" | "heatmap";
  setGradcamMode: (m: "blue" | "heatmap") => void;
  /** Server-computed Grad-CAM for the image currently loaded in the canvas. */
  gradcamResult: GradCamResult | null;
  setGradcamResult: (result: GradCamResult | null) => void;
  /** DICOM calibration for the active image; absent means measurements stay in px. */
  pixelSpacingMm: PixelSpacingMm | null;
  setPixelSpacingMm: (spacing: PixelSpacingMm | null) => void;

  wl: WlValue;
  setWl: (v: WlValue) => void;
  brightness: number;
  setBrightness: (v: number) => void;
  contrast: number;
  setContrast: (v: number) => void;
  inverted: boolean;
  setInverted: (o: boolean) => void;

  /** Sonde anatomique : point posé sur l'image (fractions 0..1) — relie le canvas à la carte anatomique. */
  probe: { x: number; y: number } | null;
  setProbe: (p: { x: number; y: number } | null) => void;

  collapsed: Record<SectionId, boolean>;
  toggleSection: (id: SectionId) => void;

  analysis: AnalysisState;
  runAnalysis: () => void;

  /* ------------------------------ AI workspace ------------------------------ */

  /** AI mode: the editor swaps its sidebars for the AI workspace */
  aiMode: boolean;
  setAiMode: (v: boolean) => void;
  /** "Don't show the disclaimer again during this session" */
  aiDisclaimerAck: boolean;
  setAiDisclaimerAck: (v: boolean) => void;
  /** Transient dismissal of the disclaimer (reset on each AI mode entry) */
  aiDisclaimerDismissed: boolean;
  setAiDisclaimerDismissed: (v: boolean) => void;
  /** True while a command is being processed (fake latency) */
  aiBusy: boolean;
  aiHistory: AiHistoryItem[];
  aiResults: AiResults;
  setAiDiagnostics: (diagnostics: AiDiagnosis[], metadata?: { modelName?: string; modelCount?: number }) => void;
  /** Region to zoom into; fresh object each time → CanvasViewport reacts to it */
  aiFocus: AiFocus | null;
  /** "Asks the canvas to zoom into a region (px in image space)" */
  focusAiRegion: (r: { x: number; y: number; w: number; h: number }) => void;
  /** Parses a natural-language command and applies the matching action(s) to the document */
  runAiCommand: (raw: string) => void;
  /** Registers the shell-specific bridge from instructions to the backend workspace API. */
  setAiCommandResolver: (resolver: AiCommandResolver | null) => void;
  /** Applies a server-validated action plan as one undoable canvas transaction. */
  executeAiActionPlan: (plan: AiActionPlan) => AiActionExecutionResult;
  /** Registers the shell's whole-exam multi-image undo (Ctrl+Z / bouton). */
  setAiTransactionUndo: (fn: (() => boolean) | null) => void;
  /** Undoes the last multi-image AI transaction across all touched images. */
  undoAiTransaction: () => boolean;
  /** True while a multi-image AI transaction is pending undo (enables the button). */
  aiTransactionUndoable: boolean;
  setAiTransactionUndoable: (v: boolean) => void;

  /** User-saved prompts (phrase + actions capturées), persisted to localStorage (`aimaging.aiPrompts`) */
  aiCustomPrompts: AiPrompt[];
  addAiCustomPrompt: (text: string, actions?: AiRecordedAction[]) => void;
  removeAiCustomPrompt: (id: string) => void;
  /** Recent user actions recorded in normal mode (drawing, windowing…) — source for new prompts */
  aiActionLog: AiRecordedAction[];
  recordAiAction: (text: string, action?: { type: string; payload: Record<string, unknown> }) => void;
  /** Exécute un prompt : rejoue ses actions enregistrées, ou envoie sa phrase
   *  à la commande IA si aucune action rejouable n'est disponible. */
  runAiPrompt: (prompt: AiPrompt) => void;
  /** Supprime une entrée de l'historique des commandes. */
  removeAiHistory: (id: string) => void;
  /** Vide l'historique des commandes. */
  clearAiHistory: () => void;
  /** Current reflection step shown above the command bar, null when idle */
  aiThought: { id: string; text: string } | null;
  /** Report editor modal state */
  reportEditOpen: boolean;
  setReportEditOpen: (v: boolean) => void;
  /** Working copy of the report being edited */
  reportDraft: string;
  setReportDraft: (v: string) => void;
  /** Opens the editor with the latest generated report */
  openReportEditor: () => void;
  /** Commits the draft as the report and closes the editor */
  saveReportDraft: () => void;

  cursorPos: { x: number; y: number } | null;
  setCursorPos: (p: { x: number; y: number } | null) => void;

imageSrc: string;
  setImageSrc: (s: string) => void;
  /** Image prête à afficher : rendu fenêtrage natif pour les DICOM linéaires,
   *  sinon l'image source telle quelle (le filtre CSS prend le relais). */
  renderSrc: string;
  /** Pixels rescalees du DICOM actif, ou null pour une image ordinaire. */
  dicomLinear: LinearImageBuffer | null;
  setDicomLinear: (buffer: LinearImageBuffer | null) => void;
  /** Stable examination image identifier; distinct from the human-readable name. */
  imageId: string | null;
  setImageId: (id: string | null) => void;
  /** Référence live de l'image active (lue hors rendu par les flux asynchrones). */
  imageIdRef: { current: string | null };
  imageName: string;
  setImageName: (n: string) => void;
  /** Real DICOM metadata for the active image, or null for an ordinary browser image. */
  imageMetadata: ExamImageMetadata | null;
  setImageMetadata: (metadata: ExamImageMetadata | null) => void;

  /** Captures the current editor state. Returns null when no image is open. */
  captureImageState: () => (ImageStateSnapshot & { name: string; dims: { w: number; h: number } }) | null;
  /** Restores a previously captured editor state (image + adjustments + shapes) */
  applyImageState: (s: ImageStateSnapshot) => void;

  /** Opens a new image: resets shapes/history, overlays and view adjustments */
  openImageData: (dataUrl: string, name: string, imageId?: string) => void;
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
