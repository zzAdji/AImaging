import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, FolderOpen, Pencil, Trash2 } from "lucide-react";
import {
  IMAGE_SELECTION,
  SELECT_ALL,
  TEXT_COLORS,
  buildImageFilter,
  isShapeLocked,
  isShapeVisible,
  layerOpacity,
  layerVisible,
  randomId,
  shapeBBox,
  shapeTextBox,
  type FontFamily,
  type Shape,
  type ShapePoint,
  type ShapeType,
  type Viewport,
  type WlValue,
} from "../state/workspace";
import { useWorkspace, type ToolId } from "../state/workspace";
import { ShapesLayer, type AngleDraft } from "./ShapesLayer";

const MIN_SCALE = 0.02;
const MAX_SCALE = 16;

interface Dims {
  w: number;
  h: number;
}

interface Marquee {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface Rect {
  l: number;
  t: number;
  r: number;
  b: number;
}

interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Gesture =
  | { kind: "pan"; lastX: number; lastY: number }
  | { kind: "imageDrag"; startX: number; startY: number; moved: boolean }
  | { kind: "draw"; tool: ShapeType; start: ShapePoint; draft: Shape; pushed: boolean }
  | { kind: "freedraw"; points: ShapePoint[]; pushed: boolean }
  | { kind: "shapeDrag"; id: string; start: ShapePoint; startShape: Shape; moved: boolean }
  | { kind: "resize"; id: string; handle: string; start: ShapePoint; startShape: Shape }
  | { kind: "cropMove"; startX: number; startY: number; startRect: CropRect }
  | { kind: "cropResize"; handle: string; start: ShapePoint; startRect: CropRect }
  | { kind: "cropDraw"; start: ShapePoint }
  | {
      kind: "zoomRect";
      x0: number;
      y0: number;
      x1: number;
      y1: number;
      vw: number;
      vh: number;
      alt: boolean;
    }
  | {
      kind: "adjust";
      tool: "windowlevel" | "brightness" | "contrast";
      startX: number;
      startY: number;
      startWl: WlValue;
      startBrightness: number;
      startContrast: number;
    };

const DRAW_TOOLS: Partial<Record<ToolId, ShapeType>> = {
  rectangle: "rectangle",
  ellipse: "ellipse",
  arrow: "arrow",
  line: "line",
  freedraw: "freedraw",
  measure: "measure",
  distance: "distance",
};

/** French action label recorded in normal mode when a shape is drawn */
const DRAW_ACTION_LABEL: Record<ShapeType, string> = {
  rectangle: "Rectangle tracé",
  ellipse: "Ellipse tracée",
  arrow: "Flèche tracée",
  line: "Ligne tracée",
  freedraw: "Traçage libre",
  measure: "Mesure tracée",
  distance: "Distance mesurée",
  angle: "Angle mesuré",
  annotation: "Annotation ajoutée",
  text: "Texte ajouté",
};

/** Shape types that expose stroke width / stroke color controls */
const STYLEABLE_TYPES = new Set<ShapeType>(["rectangle", "ellipse", "arrow", "line", "freedraw", "measure", "distance", "angle"]);

/** Shape types that expose fill controls */
const FILLABLE_TYPES = new Set<ShapeType>(["rectangle", "ellipse"]);

const CROSSHAIR_TOOLS = new Set<ToolId>([
  "rectangle",
  "ellipse",
  "arrow",
  "line",
  "freedraw",
  "measure",
  "angle",
  "distance",
  "annotation",
  "text",
  "crop",
]);

const TYPE_LABELS: Record<ShapeType, string> = {
  rectangle: "Rectangle",
  ellipse: "Ellipse",
  arrow: "Arrow",
  line: "Line",
  freedraw: "Free Draw",
  measure: "Measure",
  distance: "Distance",
  angle: "Angle",
  annotation: "Annotation",
  text: "Text",
};

/* ------------------------------ Rulers ------------------------------ */

function niceStep(minStep: number): number {
  const pow = Math.pow(10, Math.floor(Math.log10(Math.max(1e-9, minStep))));
  for (const m of [1, 2, 5, 10]) {
    if (pow * m >= minStep) return pow * m;
  }
  return 10 * pow;
}

function rulerTicks(view: { s: number; x: number; y: number }, size: number, axis: "x" | "y") {
  const target = 70 / Math.max(view.s, 1e-6);
  const step = niceStep(target);
  const major = step;
  const minor = step / 5;
  const from = axis === "x" ? -view.x / view.s : -view.y / view.s;
  const to = from + size / view.s;
  const ticks: { pos: number; major: boolean; label?: string }[] = [];
  const first = Math.floor(from / minor) * minor;
  for (let v = first; v <= to; v += minor) {
    const isMajor = Math.abs(v / major - Math.round(v / major)) < 1e-9;
    const label =
      isMajor && Math.abs(Math.round(v) - v) < 1e-6 ? `${Math.round(v)}` : undefined;
    ticks.push({ pos: v, major: isMajor, label });
  }
  return { ticks, major, minor };
}

/* ------------------------------ Geometry utils ------------------------------ */

const dist = (a: ShapePoint, b: ShapePoint) => Math.hypot(a.x - b.x, a.y - b.y);

const distToSegment = (p: ShapePoint, a: ShapePoint, b: ShapePoint): number => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return dist(p, a);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
};

const shapeHit = (s: Shape, p: ShapePoint, tol: number): boolean => {
  switch (s.type) {
    case "rectangle":
      return p.x >= s.x && p.x <= s.x + s.w && p.y >= s.y && p.y <= s.y + s.h;
    case "ellipse": {
      const rx = Math.abs(s.w) / 2;
      const ry = Math.abs(s.h) / 2;
      if (rx <= 0 || ry <= 0) return false;
      const dx = (p.x - (s.x + s.w / 2)) / rx;
      const dy = (p.y - (s.y + s.h / 2)) / ry;
      return dx * dx + dy * dy <= 1;
    }
    case "line":
    case "arrow":
    case "measure":
    case "distance":
      return (
        distToSegment(p, { x: s.x, y: s.y }, { x: s.x + s.w, y: s.y + s.h }) <= tol ||
        dist(p, { x: s.x, y: s.y }) <= tol ||
        dist(p, { x: s.x + s.w, y: s.y + s.h }) <= tol
      );
    case "angle": {
      const p2 = s.points[0] ?? { x: s.x, y: s.y };
      return (
        distToSegment(p, { x: s.x, y: s.y }, { x: s.x + s.w, y: s.y + s.h }) <= tol ||
        distToSegment(p, { x: s.x, y: s.y }, p2) <= tol ||
        dist(p, { x: s.x, y: s.y }) <= tol
      );
    }
    case "annotation": {
      const box = shapeTextBox(s);
      const anchor = s.points[0] ?? { x: s.x, y: s.y };
      const insideBox = p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y <= box.y + box.h;
      return insideBox || dist(p, anchor) <= tol;
    }
    case "text": {
      const box = shapeTextBox(s);
      return p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y <= box.y + box.h;
    }
    case "freedraw": {
      if (s.points.length === 0) return false;
      if (s.points.length === 1) return dist(s.points[0], p) <= tol;
      for (let i = 1; i < s.points.length; i++) {
        if (distToSegment(p, s.points[i - 1], s.points[i]) <= tol) return true;
      }
      return false;
    }
  }
};

const bboxOf = (s: Shape): Rect => {
  const bb = shapeBBox(s);
  return { l: bb.x, t: bb.y, r: bb.x + bb.w, b: bb.y + bb.h };
};

/* ------------------------------ Grad-CAM overlay ----------------------------- */

function GradCamOverlay({
  dims,
  src,
  intensity,
  layerOpacity = 1,
  transform,
}: {
  dims: Dims;
  src: string;
  intensity: number;
  layerOpacity?: number;
  transform?: string;
}) {
  return (
    <img
      src={src}
      alt="Grad-CAM"
      width={dims.w}
      height={dims.h}
      draggable={false}
      className="pointer-events-none absolute inset-0 h-full w-full select-none object-fill"
      style={{
        opacity: (intensity / 100) * layerOpacity,
        mixBlendMode: "screen",
        transform,
        transformOrigin: "50% 50%",
      }}
    />
  );
}

function ImageSelectionOverlay({ dims, selected }: { dims: Dims; selected: boolean }) {
  const h = 8;
  const handle = (cx: number, cy: number, cursor: string) => (
    <rect
      key={`${cx}-${cy}`}
      x={cx - h / 2}
      y={cy - h / 2}
      width={h}
      height={h}
      rx={1.5}
      fill="var(--color-accent)"
      stroke="#1a1a1a"
      strokeWidth={1}
      style={{ cursor }}
    />
  );
  return (
    <g>
      <rect
        x={-1}
        y={-1}
        width={dims.w + 2}
        height={dims.h + 2}
        fill="none"
        stroke={selected ? "var(--color-accent)" : "rgba(245,245,245,0.22)"}
        strokeWidth={selected ? 1.5 : 1}
      />
      {selected && (
        <>
          {handle(0, 0, "nwse-resize")}
          {handle(dims.w, 0, "nesw-resize")}
          {handle(0, dims.h, "nesw-resize")}
          {handle(dims.w, dims.h, "nwse-resize")}
          {handle(dims.w / 2, 0, "ns-resize")}
          {handle(dims.w / 2, dims.h, "ns-resize")}
          {handle(0, dims.h / 2, "ew-resize")}
          {handle(dims.w, dims.h / 2, "ew-resize")}
        </>
      )}
    </g>
  );
}

/* ------------------------------ Main viewport ------------------------------ */

export function CanvasViewport({
  onOpenImage,
  pane = "A",
}: {
  onOpenImage?: () => void;
  pane?: "A" | "B";
}) {
  const w = useWorkspace();
  const paneId = pane === "B" ? "B" : "A";
  const { setZoomPreset } = w;
  const view = paneId === "B" ? w.viewB : w.view;
  const viewRef = paneId === "B" ? w.viewBRef : w.viewRef;
  const setView = paneId === "B" ? w.setViewB : w.setView;
  const fitTick = paneId === "B" ? w.fitSignal.b : w.fitSignal.a;
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
  const [loaded, setLoaded] = useState(false);
  const [panning, setPanning] = useState(false);
  const [marquee, setMarquee] = useState<Marquee | null>(null);
  const [zoomRect, setZoomRect] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [draft, setDraft] = useState<Shape | null>(null);
  const [angleDraft, setAngleDraft] = useState<AngleDraft | null>(null);
  const [resizeCursor, setResizeCursor] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; original: string } | null>(null);
  const [editText, setEditText] = useState("");
  const [adjusting, setAdjusting] = useState(false);
  const spaceHeld = useRef(false);
  const gesture = useRef<Gesture | null>(null);

  const dims = w.dims;

  const isEditable = (t: EventTarget | null) =>
    t instanceof HTMLElement &&
    (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA" || t.isContentEditable);

  /* ------------------------------ View helpers ------------------------------ */

  /* AI mode: the image is the absolute reference — the view can never leave it */
  const clampView = useCallback(
    (v: Viewport) => {
      if (!w.aiMode) return v;
      const cw = containerSize.w;
      const ch = containerSize.h;
      if (cw <= 0 || ch <= 0 || dims.w <= 0 || dims.h <= 0) return v;
      const iw = dims.w * v.s;
      const ih = dims.h * v.s;
      if (iw <= cw) {
        v = { ...v, x: (cw - iw) / 2 };
      } else {
        v = { ...v, x: Math.min(0, Math.max(cw - iw, v.x)) };
      }
      if (ih <= ch) {
        v = { ...v, y: (ch - ih) / 2 };
      } else {
        v = { ...v, y: Math.min(0, Math.max(ch - ih, v.y)) };
      }
      return v;
    },
    [w.aiMode, containerSize, dims],
  );

  const fit = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const s = Math.min((rect.width - 180) / dims.w, (rect.height - 160) / dims.h, 1);
    const s2 = Math.max(s, MIN_SCALE);
    /* Image sits at doc (0, 0); centering happens in view space */
    setView(clampView({ s: s2, x: (rect.width - dims.w * s2) / 2, y: (rect.height - dims.h * s2) / 2 }));
  }, [dims, setView, clampView]);

  useEffect(() => {
    if (loaded) fit();
  }, [loaded, fit, fitTick]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setContainerSize((prev) => (prev.w === width && prev.h === height ? prev : { w: width, h: height }));
      if (w.zoomPreset === "fit" && loaded) fit();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [w.zoomPreset, loaded, fit]);

  /* Wheel zoom — native listener so preventDefault works */
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = viewRef.current;
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const factor = Math.exp(-e.deltaY * 0.0016);
      const s2 = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.s * factor));
      setView(
        clampView({
          s: s2,
          x: px - ((px - v.x) * s2) / v.s,
          y: py - ((py - v.y) * s2) / v.s,
        }),
      );
      setZoomPreset("actual");
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [setView, viewRef, setZoomPreset, clampView]);

  /* Space to pan */
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !isEditable(e.target)) {
        spaceHeld.current = true;
        e.preventDefault();
        setPanning(true);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        spaceHeld.current = false;
        setPanning(false);
      }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  /* Escape cancels an in-progress angle draft */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && angleDraft) {
        setAngleDraft(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [angleDraft]);

  /* Drop the angle draft if the user switches tools (render-time adjustment) */
  if (w.tool !== "angle" && angleDraft) setAngleDraft(null);

  /* --------------------------- Coordinate helpers --------------------------- */

  /* Document (canvas) coordinates: screen px → infinite doc units.
     The image top-left is pinned at doc (0, 0). */
  const screenToDoc = (px: number, py: number): ShapePoint => {
    const v = viewRef.current;
    return { x: (px - v.x) / v.s, y: (py - v.y) / v.s };
  };

  /* Screen px → image px (image origin = doc origin) */
  const screenToImg = (px: number, py: number): ShapePoint => screenToDoc(px, py);

  const isOverImage = (px: number, py: number): boolean => {
    const p = screenToDoc(px, py);
    const m = 4 / viewRef.current.s;
    return p.x >= -m && p.x <= dims.w + m && p.y >= -m && p.y <= dims.h + m;
  };

  const zoomAt = (px: number, py: number, factor: number) => {
    const v = viewRef.current;
    const s2 = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.s * factor));
    setView(
      clampView({
        s: s2,
        x: px - ((px - v.x) * s2) / v.s,
        y: py - ((py - v.y) * s2) / v.s,
      }),
    );
    setZoomPreset("actual");
  };

  /* Zoom so the dragged rectangle fills the viewport (centered) */
  const zoomToRect = (r: { x0: number; y0: number; x1: number; y1: number; vw: number; vh: number }) => {
    const rw = Math.max(1, Math.abs(r.x1 - r.x0));
    const rh = Math.max(1, Math.abs(r.y1 - r.y0));
    const cx = (r.x0 + r.x1) / 2;
    const cy = (r.y0 + r.y1) / 2;
    const s2 = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.min(r.vw / rw, r.vh / rh)));
    setView(clampView({ s: s2, x: cx - r.vw / 2 / s2, y: cy - r.vh / 2 / s2 }));
    setZoomPreset("actual");
  };

  /* AI focus: smoothly zoom into a region requested by the AI workspace */
  useEffect(() => {
    const f = w.aiFocus;
    if (!f || f.w <= 0 || f.h <= 0) return;
    const cw = containerSize.w || 1;
    const ch = containerSize.h || 1;
    const s2 = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.min(cw / f.w, ch / f.h) * 0.92));
    const cx = f.x + f.w / 2;
    const cy = f.y + f.h / 2;
    const v2 = clampView({ s: s2, x: cx - cw / 2 / s2, y: cy - ch / 2 / s2 });
    setView(v2);
    setZoomPreset("actual");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w.aiFocus]);

  const hitTest = (px: number, py: number): Shape | null => {
    const p = screenToDoc(px, py);
    const tol = 6 / viewRef.current.s;
    for (let i = w.shapes.length - 1; i >= 0; i--) {
      const s = w.shapes[i];
      if (!isShapeVisible(s, w.layers) || isShapeLocked(s, w.layers)) continue;
      if (shapeHit(s, p, tol)) return s;
    }
    return null;
  };

  /* ------------------------------ Draft geometry ---------------------------- */

  const makeShape = (type: ShapeType, x: number, y: number, width: number, height: number, points: ShapePoint[] = []): Shape => ({
    id: "draft",
    type,
    x,
    y,
    w: width,
    h: height,
    points,
    strokeWidth: w.shapeStyle.strokeWidth,
    strokeColor: w.shapeStyle.strokeColor,
    fillColor: w.shapeStyle.fillColor ?? undefined,
  });

  const updateDraftGeometry = (
    d: Shape,
    start: ShapePoint,
    p: ShapePoint,
    tool: ShapeType,
    shift: boolean,
    alt: boolean,
  ): Shape => {
    let w = p.x - start.x;
    let h = p.y - start.y;
    if (tool === "rectangle" || tool === "ellipse") {
      if (shift) {
        const m = Math.max(Math.abs(w), Math.abs(h));
        w = (Math.sign(w) || 1) * m;
        h = (Math.sign(h) || 1) * m;
      }
      let x = start.x;
      let y = start.y;
      if (alt) {
        x = start.x - w;
        y = start.y - h;
        w *= 2;
        h *= 2;
      }
      if (w < 0) {
        x += w;
        w = -w;
      }
      if (h < 0) {
        y += h;
        h = -h;
      }
      return { ...d, x, y, w, h };
    }
    if (shift) {
      const m = Math.max(Math.abs(w), Math.abs(h));
      w = (Math.sign(w) || 1) * m;
      h = (Math.sign(h) || 1) * m;
    }
    return { ...d, x: start.x, y: start.y, w, h };
  };

  const resizeShape = (s: Shape, handle: string, dx: number, dy: number): Shape => {
    if (s.type === "line" || s.type === "arrow" || s.type === "measure" || s.type === "distance") {
      if (handle === "p1") return { ...s, x: s.x + dx, y: s.y + dy };
      if (handle === "p2") return { ...s, w: s.w + dx, h: s.h + dy };
      return s;
    }
    if (s.type === "angle") {
      if (handle === "p1") return { ...s, x: s.x + dx, y: s.y + dy, w: s.w - dx, h: s.h - dy };
      if (handle === "p2") return { ...s, w: s.w + dx, h: s.h + dy };
      if (handle === "p3") {
        const p3 = s.points[0] ?? { x: s.x, y: s.y };
        return { ...s, points: [{ x: p3.x + dx, y: p3.y + dy }] };
      }
      return s;
    }
    if (s.type === "annotation") {
      if (handle === "p1") {
        const anchor = s.points[0] ?? { x: s.x, y: s.y };
        return { ...s, points: [{ x: anchor.x + dx, y: anchor.y + dy }] };
      }
      return s;
    }
    if (s.type === "freedraw") {
      const bb = shapeBBox(s);
      const kx = bb.w > 0 ? (bb.w + (handle.includes("e") ? dx : -dx)) / bb.w : 1;
      const ky = bb.h > 0 ? (bb.h + (handle.includes("s") ? dy : -dy)) / bb.h : 1;
      const sx = Math.min(20, Math.max(0.05, kx));
      const sy = Math.min(20, Math.max(0.05, ky));
      return {
        ...s,
        points: s.points.map((pt) => ({
          x: bb.x + (pt.x - bb.x) * sx,
          y: bb.y + (pt.y - bb.y) * sy,
        })),
      };
    }
    let { x, y, w, h } = s;
    switch (handle) {
      case "nw": x += dx; w -= dx; y += dy; h -= dy; break;
      case "n": y += dy; h -= dy; break;
      case "ne": w += dx; y += dy; h -= dy; break;
      case "e": w += dx; break;
      case "se": w += dx; h += dy; break;
      case "s": h += dy; break;
      case "sw": x += dx; w -= dx; h += dy; break;
      case "w": x += dx; w -= dx; break;
    }
    return { ...s, x, y, w: Math.max(2, w), h: Math.max(2, h) };
  };

  const clampCrop = (r: CropRect): CropRect => {
    let { x, y, w, h } = r;
    if (x < 0) { w += x; x = 0; }
    if (y < 0) { h += y; y = 0; }
    if (x + w > dims.w) w = dims.w - x;
    if (y + h > dims.h) h = dims.h - y;
    return { x, y, w: Math.max(0, w), h: Math.max(0, h) };
  };

  /* ------------------------------- Pointer down ----------------------------- */

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isEditable(e.target)) return;
    w.setActivePane(paneId);
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const target = e.target as Element;

    /* Crop tool */
    if (w.tool === "crop") {
      if (e.button !== 0) return;
      const imgP = screenToImg(px, py);
      if ((target instanceof SVGElement || target instanceof HTMLElement) && typeof target.dataset.cropHandle === "string" && w.crop) {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        gesture.current = {
          kind: "cropResize",
          handle: target.dataset.cropHandle,
          start: imgP,
          startRect: w.crop,
        };
        setResizeCursor(target.dataset.cropHandle);
        return;
      }
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      if (
        w.crop &&
        imgP.x >= w.crop.x &&
        imgP.x <= w.crop.x + w.crop.w &&
        imgP.y >= w.crop.y &&
        imgP.y <= w.crop.y + w.crop.h
      ) {
        gesture.current = { kind: "cropMove", startX: px, startY: py, startRect: w.crop };
      } else {
        gesture.current = { kind: "cropDraw", start: imgP };
        w.setCrop({ x: imgP.x, y: imgP.y, w: 0, h: 0 });
      }
      return;
    }

    /* Resize handles of a selected shape (move tool only) */
    if (
      w.tool === "move" &&
      e.button === 0 &&
      (target instanceof SVGElement || target instanceof HTMLElement) &&
      typeof target.dataset.handle === "string"
    ) {
      const shape = w.shapes.find((s) => s.id === target.dataset.shape);
      if (shape) {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        w.pushHistory();
        gesture.current = {
          kind: "resize",
          id: shape.id,
          handle: target.dataset.handle,
          start: screenToDoc(px, py),
          startShape: shape,
        };
        setResizeCursor(target.dataset.handle);
        return;
      }
    }

    if (e.button === 1 || (e.button === 0 && (spaceHeld.current || w.tool === "hand"))) {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      gesture.current = { kind: "pan", lastX: e.clientX, lastY: e.clientY };
      setPanning(true);
      return;
    }

    /* Window/Level, Brightness, Contrast — drag to adjust */
    if (w.tool === "windowlevel" || w.tool === "brightness" || w.tool === "contrast") {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      w.pushHistory();
      gesture.current = {
        kind: "adjust",
        tool: w.tool,
        startX: px,
        startY: py,
        startWl: w.wl,
        startBrightness: w.brightness,
        startContrast: w.contrast,
      };
      setAdjusting(true);
      return;
    }

    if (e.button !== 0) return;

    /* Angle tool — 2 clicks: vertex+first arm (drag), then second arm */
    if (w.tool === "angle") {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      const p = screenToDoc(px, py);
      if (angleDraft) {
        const d = angleDraft;
        const total = Math.hypot(d.end1.x - d.vertex.x, d.end1.y - d.vertex.y) +
          (d.end2 ? Math.hypot(d.end2.x - d.vertex.x, d.end2.y - d.vertex.y) : 0);
        if (total * viewRef.current.s < 8) {
          setAngleDraft(null);
        } else {
          const shape = makeShape(
            "angle",
            d.vertex.x,
            d.vertex.y,
            d.end1.x - d.vertex.x,
            d.end1.y - d.vertex.y,
            [{ x: d.end2?.x ?? p.x, y: d.end2?.y ?? p.y }],
          );
          shape.id = randomId();
          w.pushHistory();
          w.addShape(shape);
          w.recordAiAction("Angle mesuré");
          w.setSelection(shape.id);
          setAngleDraft(null);
        }
      } else {
        setAngleDraft({ vertex: p, end1: p, end2: null });
      }
      return;
    }

    /* Annotation / Text — click to place, then edit inline */
    if (w.tool === "annotation" || w.tool === "text") {
      e.preventDefault();
      const p = screenToDoc(px, py);
      const shape = makeShape(
        w.tool === "annotation" ? "annotation" : "text",
        p.x,
        p.y,
        0,
        0,
        w.tool === "annotation" ? [{ x: p.x, y: p.y }] : [],
      );
      shape.label = w.tool === "annotation" ? "Note" : "Text";
      shape.fontSize = w.shapeStyle.fontSize;
      shape.fontFamily = w.shapeStyle.fontFamily;
      shape.fontWeight = w.shapeStyle.fontWeight;
      shape.color = w.shapeStyle.color;
      shape.id = randomId();
      w.pushHistory();
      w.addShape(shape);
      w.recordAiAction(w.tool === "annotation" ? "Annotation ajoutée" : "Texte ajouté");
      w.setSelection(shape.id);
      setEditing({ id: shape.id, original: shape.label ?? "" });
      setEditText(shape.label ?? "");
      return;
    }

    /* Draw tools */
    const drawType = DRAW_TOOLS[w.tool];
    if (drawType) {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      const p = screenToDoc(px, py);
      if (drawType === "freedraw") {
        gesture.current = { kind: "freedraw", points: [p], pushed: false };
        setDraft(makeShape("freedraw", 0, 0, 0, 0, [p]));
      } else {
        const d = makeShape(drawType, p.x, p.y, 0, 0);
        gesture.current = { kind: "draw", tool: drawType, start: p, draft: d, pushed: false };
        setDraft(d);
      }
      return;
    }

    /* Move tool */
    if (w.tool === "move") {
      const hit = hitTest(px, py);
      if (hit) {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        w.setSelection(hit.id);
        gesture.current = {
          kind: "shapeDrag",
          id: hit.id,
          start: screenToDoc(px, py),
          startShape: hit,
          moved: false,
        };
        return;
      }
      if (isOverImage(px, py)) {
        gesture.current = { kind: "imageDrag", startX: px, startY: py, moved: false };
      } else {
        setMarquee({ x0: px, y0: py, x1: px, y1: py });
      }
      return;
    }

    /* Zoom tool */
    if (w.tool === "zoom") {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      gesture.current = { kind: "zoomRect", x0: px, y0: py, x1: px, y1: py, vw: rect.width, vh: rect.height, alt: e.altKey };
      setZoomRect({ x0: px, y0: py, x1: px, y1: py });
      return;
    }
  };

  /* ------------------------------- Pointer move ----------------------------- */

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const g = gesture.current;
    const s = viewRef.current.s;

    if (g?.kind === "pan") {
      const v = viewRef.current;
      setView(clampView({ ...v, x: v.x + (e.clientX - g.lastX), y: v.y + (e.clientY - g.lastY) }));
      g.lastX = e.clientX;
      g.lastY = e.clientY;
      setZoomPreset("actual");
    } else if (g?.kind === "imageDrag") {
      if (!g.moved && (Math.abs(px - g.startX) > 3 || Math.abs(py - g.startY) > 3)) {
        g.moved = true;
        setPanning(true);
      }
      if (g.moved) {
        const v = viewRef.current;
        setView(clampView({ ...v, x: v.x + (px - g.startX), y: v.y + (py - g.startY) }));
        g.startX = px;
        g.startY = py;
        setZoomPreset("actual");
      }
    } else if (g?.kind === "draw") {
      const p = screenToDoc(px, py);
      const d = updateDraftGeometry(g.draft, g.start, p, g.tool, e.shiftKey, e.altKey);
      if (!g.pushed && dist(p, g.start) * s > 4) {
        g.pushed = true;
        w.pushHistory();
      }
      g.draft = d;
      setDraft(d);
    } else if (g?.kind === "freedraw") {
      const p = screenToDoc(px, py);
      const last = g.points[g.points.length - 1];
      if (!last || dist(last, p) * s > 2) {
        if (!g.pushed && g.points.length >= 2) {
          g.pushed = true;
          w.pushHistory();
        }
        g.points.push(p);
        setDraft((d) => (d ? { ...d, points: [...g.points] } : d));
      }
    } else if (g?.kind === "shapeDrag") {
      if (!g.moved && (Math.abs(px - g.start.x) > 3 || Math.abs(py - g.start.y) > 3)) {
        g.moved = true;
        w.pushHistory();
      }
      if (g.moved) {
        const p = screenToDoc(px, py);
        const dx = p.x - g.start.x;
        const dy = p.y - g.start.y;
        w.updateShape(g.id, {
          x: g.startShape.x + dx,
          y: g.startShape.y + dy,
          points: g.startShape.points.map((pt) => ({ x: pt.x + dx, y: pt.y + dy })),
        });
      }
    } else if (g?.kind === "resize") {
      const p = screenToDoc(px, py);
      w.updateShape(g.id, resizeShape(g.startShape, g.handle, p.x - g.start.x, p.y - g.start.y));
    } else if (g?.kind === "cropMove") {
      const dx = (px - g.startX) / s;
      const dy = (py - g.startY) / s;
      w.setCrop(clampCrop({ x: g.startRect.x + dx, y: g.startRect.y + dy, w: g.startRect.w, h: g.startRect.h }));
    } else if (g?.kind === "cropResize") {
      const p = screenToImg(px, py);
      const r = resizeShape(
        { id: "crop", type: "rectangle", x: g.startRect.x, y: g.startRect.y, w: g.startRect.w, h: g.startRect.h, points: [], strokeWidth: 2 },
        g.handle,
        p.x - g.start.x,
        p.y - g.start.y,
      );
      w.setCrop(clampCrop({ x: r.x, y: r.y, w: r.w, h: r.h }));
    } else if (g?.kind === "cropDraw") {
      const p = screenToImg(px, py);
      w.setCrop(
        clampCrop({
          x: Math.min(g.start.x, p.x),
          y: Math.min(g.start.y, p.y),
          w: Math.abs(p.x - g.start.x),
          h: Math.abs(p.y - g.start.y),
        }),
      );
      } else if (g?.kind === "adjust") {
        const dx = px - g.startX;
        const dy = py - g.startY;
        if (g.tool === "windowlevel") {
          w.setWl({
            window: Math.min(512, Math.max(20, g.startWl.window - dy * 0.5)),
            level: Math.min(255, Math.max(0, g.startWl.level - dx * 0.5)),
        });
        } else if (g.tool === "brightness") {
          w.setBrightness(Math.min(100, Math.max(0, g.startBrightness - dy * 0.25)));
        } else if (g.tool === "contrast") {
          w.setContrast(Math.min(100, Math.max(0, g.startContrast - dy * 0.25)));
        }
      } else if (g?.kind === "zoomRect") {
        g.x1 = px;
        g.y1 = py;
        setZoomRect({ x0: g.x0, y0: g.y0, x1: px, y1: py });
      } else if (w.tool === "angle" && angleDraft) {
      const p = screenToDoc(px, py);
      setAngleDraft((d) => (d ? (d.end2 ? { ...d, end2: p } : { ...d, end1: p }) : d));
    } else if (marquee) {
      setMarquee((m) => (m ? { ...m, x1: px, y1: py } : m));
    }

    const doc = screenToDoc(px, py);
    w.setCursorPos({
      x: Math.round(doc.x),
      y: Math.round(doc.y),
    });
  };

  /* -------------------------------- Pointer up ------------------------------ */

  const finishGesture = () => {
    const g = gesture.current;
    if (!g) {
      panCleanup();
      return;
    }
    switch (g.kind) {
      case "draw": {
        const size = Math.max(g.draft.w, g.draft.h) * viewRef.current.s;
        if (g.pushed && size > 4) {
          const shape = { ...g.draft, id: randomId() };
          w.addShape(shape);
          w.recordAiAction(DRAW_ACTION_LABEL[shape.type]);
          w.setSelection(shape.id);
        }
        setDraft(null);
        break;
      }
      case "freedraw": {
        if (g.pushed && g.points.length >= 2) {
          const shape = makeShape("freedraw", 0, 0, 0, 0, [...g.points]);
          shape.id = randomId();
          w.addShape(shape);
          w.recordAiAction("Traçage libre");
          w.setSelection(shape.id);
        }
        setDraft(null);
        break;
      }
      case "shapeDrag":
        if (!g.moved) w.setSelection(g.id);
        break;
      case "resize":
        setResizeCursor(null);
        break;
      case "imageDrag":
        if (!g.moved) w.setSelection(IMAGE_SELECTION);
        break;
      case "cropDraw": {
        const c = w.crop;
        if (!c || c.w * viewRef.current.s < 8 || c.h * viewRef.current.s < 8) {
          w.setCrop(null);
        }
        break;
      }
      case "cropResize":
        setResizeCursor(null);
        break;
      case "cropMove":
        break;
      case "adjust":
        setAdjusting(false);
        break;
      case "zoomRect": {
        setZoomRect(null);
        const rw = Math.abs(g.x1 - g.x0);
        const rh = Math.abs(g.y1 - g.y0);
        if (rw < 6 && rh < 6) {
          zoomAt((g.x0 + g.x1) / 2, (g.y0 + g.y1) / 2, g.alt ? 1 / 1.5 : 1.5);
        } else {
          zoomToRect(g);
        }
        break;
      }
      default:
        break;
    }
    panCleanup();
  };

  const panCleanup = () => {
    gesture.current = null;
    setPanning(false);
  };

  const onPointerUp = () => {
    /* Angle: first drag ends → freeze arm 1, start arm 2 */
    if (w.tool === "angle" && angleDraft && angleDraft.end2 === null) {
      setAngleDraft((d) => (d ? { ...d, end2: d.end1 } : d));
      return;
    }
    if (marquee) {
      finalizeMarquee(marquee);
      setMarquee(null);
    }
    finishGesture();
  };

  const finalizeMarquee = (m: Marquee) => {
    const w2 = Math.abs(m.x1 - m.x0);
    const h2 = Math.abs(m.y1 - m.y0);
    if (w2 < 6 || h2 < 6) return;
    const a = screenToDoc(Math.min(m.x0, m.x1), Math.min(m.y0, m.y1));
    const b = screenToDoc(Math.max(m.x0, m.x1), Math.max(m.y0, m.y1));
    const mr = { l: a.x, t: a.y, r: b.x, b: b.y };
    const hit = [...w.shapes]
      .reverse()
      .find((sh) => {
        if (!isShapeVisible(sh, w.layers) || isShapeLocked(sh, w.layers)) return false;
        const bb = bboxOf(sh);
        return !(mr.r < bb.l || mr.l > bb.r || mr.b < bb.t || mr.t > bb.b);
      });
    if (hit) {
      w.setSelection(hit.id);
      return;
    }
    const imageRect = { l: 0, t: 0, r: dims.w, b: dims.h };
    const intersectsImage =
      !(mr.r < imageRect.l || mr.l > imageRect.r || mr.b < imageRect.t || mr.t > imageRect.b);
    w.setSelection(intersectsImage ? IMAGE_SELECTION : null);
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (w.tool !== "move") return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const hit = hitTest(px, py);
    if (hit && (hit.type === "annotation" || hit.type === "text")) {
      setEditing({ id: hit.id, original: hit.label ?? "" });
      setEditText(hit.label ?? "");
      return;
    }
    zoomAt(px, py, 1.5);
  };

  const cancelGesture = () => {
    gesture.current = null;
    setDraft(null);
    setMarquee(null);
    setResizeCursor(null);
    setAdjusting(false);
    setPanning(false);
    w.setCursorPos(null);
  };

  const deleteSelected = () => {
    const id = w.selection;
    if (!id || id === IMAGE_SELECTION) return;
    w.pushHistory();
    if (id === SELECT_ALL) w.removeShapes(w.shapes.map((s) => s.id));
    else w.removeShape(id);
    w.setSelection(null);
    setEditing(null);
  };

  const commitEdit = (value: string) => {
    if (!editing) return;
    const sh = w.shapes.find((s) => s.id === editing.id);
    if (sh && value !== editing.original) {
      w.pushHistory();
      w.updateShape(sh.id, { label: value });
    }
    setEditing(null);
  };

  /* --------------------------------- Render -------------------------------- */

  const cursor = panning
    ? "grabbing"
    : resizeCursor ??
      (w.tool === "hand"
        ? "grab"
        : w.tool === "zoom"
          ? "zoom-in"
          : CROSSHAIR_TOOLS.has(w.tool)
            ? "crosshair"
            : "default");

  const drawHint = DRAW_TOOLS[w.tool];
  const allSelected = w.selection === SELECT_ALL;
  const selectedShape = allSelected ? undefined : w.shapes.find((s) => s.id === w.selection);
  const editingShape = editing ? w.shapes.find((s) => s.id === editing.id) : undefined;
  const vw = containerSize.w / view.s;
  const vh = containerSize.h / view.s;

  /* Inline editor position (doc → container px) */
  const editBox = editingShape ? shapeTextBox({ ...editingShape, label: editText }) : null;
  const editingFs = editingShape?.fontSize ?? 16;

  const imgFilter = buildImageFilter(w.wl, w.brightness, w.contrast, w.inverted);
  const imgTransform =
    w.flipH || w.flipV ? `scaleX(${w.flipH ? -1 : 1}) scaleY(${w.flipV ? -1 : 1})` : undefined;

  const imageVisible = layerVisible("image", w.layers);
  const imageOpacity = layerOpacity("image", w.layers) / 100;
  const gradcamOpacity = layerOpacity("gradcam", w.layers) / 100;

  return (
    <div
      ref={containerRef}
      className="relative min-w-0 flex-1 overflow-hidden bg-canvas"
      style={{ cursor, touchAction: "none" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={cancelGesture}
      onDoubleClick={onDoubleClick}
      onPointerLeave={cancelGesture}
    >
      {/* Empty state */}
      {!w.imageSrc && (
        <div
          data-placeholder
          className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 select-none"
        >
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-border bg-panel">
            <Activity size={28} className="text-accent" strokeWidth={1.8} />
          </div>
          <div className="text-center">
            <p className="text-[13px] font-medium text-ink">No image open</p>
            <p className="mt-1 text-[12px] text-ink-3">Open a DICOM or image file to start annotating</p>
          </div>
          <button
            type="button"
            onClick={onOpenImage}
            className="flex items-center gap-1.5 rounded-lg border border-accent/40 bg-accent/15 px-3.5 py-1.5 text-[12.5px] font-medium text-accent transition-colors duration-100 hover:bg-accent/25"
          >
            <FolderOpen size={15} />
            Open Image…
          </button>
        </div>
      )}
      {/* Grid */}
      {w.gridOn && !w.aiMode && (
        <div
          data-grid
          className="pointer-events-none absolute inset-0"
          style={
            w.prefs.gridStyle === "dots"
              ? {
                  backgroundImage: "radial-gradient(circle, #2c2c2c 1px, transparent 1px)",
                  backgroundSize: `${w.prefs.gridSize}px ${w.prefs.gridSize}px`,
                }
              : {
                  backgroundImage:
                    "linear-gradient(#2c2c2c 1px, transparent 1px), linear-gradient(90deg, #2c2c2c 1px, transparent 1px)",
                  backgroundSize: `${w.prefs.gridSize}px ${w.prefs.gridSize}px`,
                  backgroundPosition: "-1px -1px",
                }
          }
        />
      )}

      {/* Rulers */}
      {w.rulersOn && w.imageSrc && (
        <div data-rulers className="pointer-events-none absolute left-0 top-0 z-40">
          <div className="absolute left-0 top-0 flex h-[18px] w-full items-center border-b border-border bg-panel/95 text-[9px] tabular-nums text-ink-3">
            <svg width="100%" height="100%" className="block">
              {rulerTicks(view, containerSize.w, "x").ticks.map((t, i) => {
                const sx = view.x + t.pos * view.s;
                if (sx < -2 || sx > containerSize.w + 2) return null;
                return (
                  <g key={i}>
                    <line
                      x1={sx}
                      y1={t.major ? 4 : 9}
                      x2={sx}
                      y2={t.major ? 13 : 11}
                      stroke="var(--color-ink-3)"
                      strokeWidth={1}
                    />
                    {t.label !== undefined && (
                      <text x={sx + 3} y={10} fontSize={9} fill="var(--color-ink-3)">
                        {t.label}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
            {w.cursorPos !== null && (
              <div
                data-ruler-marker
                className="absolute top-0 h-full"
                style={{ left: view.x + w.cursorPos.x * view.s }}
              >
                <div className="h-full w-px bg-accent/80" />
                <span className="absolute left-1 top-px rounded-sm bg-active px-1 py-px text-[9px] leading-[9px] text-ink">
                  {Math.round(w.cursorPos.x)}
                </span>
              </div>
            )}
          </div>
          <div className="absolute left-0 top-0 h-full w-[18px] border-r border-border bg-panel/95 text-[9px] tabular-nums text-ink-3">
            <svg width="100%" height="100%" className="block">
              {rulerTicks(view, containerSize.h, "y").ticks.map((t, i) => {
                const sy = view.y + t.pos * view.s;
                if (sy < -2 || sy > containerSize.h + 2) return null;
                return (
                  <g key={i}>
                    <line
                      x1={t.major ? 4 : 9}
                      y1={sy}
                      x2={t.major ? 13 : 11}
                      y2={sy}
                      stroke="var(--color-ink-3)"
                      strokeWidth={1}
                    />
                    {t.label !== undefined && (
                      <text transform={`translate(4, ${sy - 3}) rotate(-90)`} fontSize={9} fill="var(--color-ink-3)">
                        {t.label}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
            {w.cursorPos !== null && (
              <div
                className="absolute left-0 w-full"
                style={{ top: view.y + w.cursorPos.y * view.s }}
              >
                <div className="h-px w-full bg-accent/80" />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Marquee selection */}
      {marquee && (
        <div
          className="pointer-events-none absolute z-10 border border-accent bg-accent/10"
          style={{
            left: Math.min(marquee.x0, marquee.x1),
            top: Math.min(marquee.y0, marquee.y1),
            width: Math.abs(marquee.x1 - marquee.x0),
            height: Math.abs(marquee.y1 - marquee.y0),
          }}
        />
      )}

      {/* Zoom drag-rect overlay */}
      {zoomRect && (
        <div
          data-zoomrect
          className="pointer-events-none absolute z-10 border border-accent bg-accent/10"
          style={{
            left: Math.min(zoomRect.x0, zoomRect.x1),
            top: Math.min(zoomRect.y0, zoomRect.y1),
            width: Math.abs(zoomRect.x1 - zoomRect.x0),
            height: Math.abs(zoomRect.y1 - zoomRect.y0),
          }}
        />
      )}

      {/* Document layer — infinite canvas space */}
      {w.imageSrc && imageVisible && (
        <div
          className="absolute left-0 top-0"
          style={{
            transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.s})`,
            transformOrigin: "0 0",
            willChange: "transform",
          }}
        >
        {/* Image */}
        <div
          className="relative shadow-[0_10px_44px_rgba(0,0,0,0.55)]"
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: dims.w,
            height: dims.h,
            transform: `rotate(${w.rotation}deg)`,
            transformOrigin: "50% 50%",
            opacity: imageOpacity,
          }}
        >
          <img
            src={w.imageSrc}
            alt="Medical image"
            className="block h-full w-full select-none object-contain"
            draggable={false}
            onLoad={(e) => {
              const el = e.currentTarget;
              w.setDims({ w: el.naturalWidth, h: el.naturalHeight });
              setLoaded(true);
            }}
            style={{ filter: imgFilter, transform: imgTransform }}
          />

          {w.gradcamOn && w.gradcamResult && (
            <GradCamOverlay
              dims={dims}
              src={w.gradcamResult.heatmapDataUrl}
              intensity={w.gradcamIntensity}
              layerOpacity={gradcamOpacity}
              transform={imgTransform}
            />
          )}
          {w.gradcamOn && w.gradcamResult && (
            <div className="absolute left-2 top-2 flex items-center gap-1.5 rounded-md border border-accent/40 bg-[#0e0e0e]/90 px-2 py-1 text-[11px] text-ink">
              <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse-soft" />
              Grad-CAM · {w.gradcamResult.className} · {w.gradcamResult.modelCount} modèles
            </div>
          )}

          {/* Document image selection */}
          <svg
            width={dims.w}
            height={dims.h}
            viewBox={`0 0 ${dims.w} ${dims.h}`}
            className="pointer-events-none absolute inset-0"
          >
            <ImageSelectionOverlay dims={dims} selected={w.selection === IMAGE_SELECTION} />
          </svg>
          {w.selection === IMAGE_SELECTION && (
            <div className="absolute -bottom-7 left-1/2 -translate-x-1/2 rounded-md border border-border bg-[#0e0e0e] px-1.5 py-[3px] text-[11px] tabular-nums text-ink-2">
              {dims.w} × {dims.h} px
            </div>
          )}
        </div>
        </div>
      )}

      {/* Shapes — viewport-mapped document space.
          The doc layer maps doc → screen as local = view.offset + doc * scale, so the
          viewBox origin (top-left of the visible doc rect) is -view.offset / scale. */}
      <ShapesLayer
        viewBox={`${-view.x / view.s} ${-view.y / view.s} ${vw} ${vh}`}
        viewRect={{ x: -view.x / view.s, y: -view.y / view.s, w: vw, h: vh }}
        shapes={w.shapes}
        draft={draft}
        selection={w.selection}
        scale={view.s}
        angleDraft={angleDraft}
        crop={
          w.crop
            ? { id: "crop", type: "rectangle", x: w.crop.x, y: w.crop.y, w: w.crop.w, h: w.crop.h, points: [], strokeWidth: 2 }
            : null
        }
        layers={w.layers}
        pixelSpacingMm={w.pixelSpacingMm}
      />

      {/* Inline text editor */}
      {editingShape && editBox && (
        <div
          className="absolute z-30"
          style={{
            left: view.x + editBox.x * view.s - 2,
            top: view.y + editBox.y * view.s - 2,
            width: editBox.w * view.s + 4,
            minHeight: editBox.h * view.s + 4,
          }}
        >
          <textarea
            autoFocus
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={() => commitEdit(editText)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                commitEdit(editText);
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setEditing(null);
              }
            }}
            className="block w-full resize-none overflow-hidden rounded-md p-1 text-[var(--color-ink)] outline-none"
            style={{
              fontSize: editingFs * view.s,
              lineHeight: 1.35,
              fontFamily: editingShape.fontFamily === "serif" ? "Georgia, serif" : editingShape.fontFamily === "mono" ? "Consolas, monospace" : "Inter, sans-serif",
              fontWeight: editingShape.fontWeight === "bold" ? 700 : 500,
              color: editingShape.color ?? "#ffffff",
              background: editingShape.type === "annotation" ? "rgba(14,14,14,0.94)" : "transparent",
              border: editingShape.type === "annotation" ? "1px solid var(--color-accent)" : "1px dashed var(--color-accent)",
              borderRadius: 6,
              caretColor: "var(--color-accent)",
            }}
          />
        </div>
      )}

      {/* Selection actions */}
      {(selectedShape || allSelected) && !editing && (
        <div
          className="absolute left-1/2 top-2.5 z-20 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-border bg-card px-1.5 py-1 shadow-lg shadow-black/40 animate-pop"
          onPointerDownCapture={(e) => e.stopPropagation()}
        >
          <span className="px-1 text-[11px] text-ink-2">
            {allSelected ? `${w.shapes.length} Shapes` : TYPE_LABELS[selectedShape!.type]}
          </span>
          {!allSelected && selectedShape && (selectedShape.type === "text" || selectedShape.type === "annotation") && (
            <>
              <div className="h-3 w-px bg-border" />
              <select
                value={selectedShape.fontFamily ?? "sans"}
                onChange={(e) => {
                  w.pushHistory();
                  w.updateShape(selectedShape.id, { fontFamily: e.target.value as FontFamily });
                }}
                title="Font"
                className="rounded-md border border-border bg-hover px-1 py-0.5 text-[11px] text-ink-2 outline-none"
              >
                <option value="sans">Sans</option>
                <option value="serif">Serif</option>
                <option value="mono">Mono</option>
              </select>
              <button
                type="button"
                title="Bold"
                onClick={() => {
                  w.pushHistory();
                  w.updateShape(selectedShape.id, {
                    fontWeight: selectedShape.fontWeight === "bold" ? "normal" : "bold",
                  });
                }}
                className={`flex h-6 w-6 items-center justify-center rounded-md text-[12px] font-bold transition-colors duration-150 ease-out ${
                  selectedShape.fontWeight === "bold" ? "bg-accent/20 text-accent" : "text-icon hover:bg-hover hover:text-ink"
                }`}
              >
                B
              </button>
              {TEXT_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  title={c}
                  onClick={() => {
                    w.pushHistory();
                    w.updateShape(selectedShape.id, { color: c });
                  }}
                  className="h-4 w-4 rounded-full border border-border transition-transform duration-150 ease-out hover:scale-110"
                  style={{
                    backgroundColor: c,
                    outline: selectedShape.color === c ? "1.5px solid var(--color-accent)" : "none",
                    outlineOffset: 1,
                  }}
                />
              ))}
              <button
                type="button"
                title="Edit"
                onClick={() => {
                  setEditing({ id: selectedShape.id, original: selectedShape.label ?? "" });
                  setEditText(selectedShape.label ?? "");
                }}
                className="flex h-6 w-6 items-center justify-center rounded-md text-icon transition-colors duration-150 ease-out hover:bg-hover hover:text-ink"
              >
                <Pencil size={12} />
              </button>
            </>
          )}
          {!allSelected && selectedShape && STYLEABLE_TYPES.has(selectedShape.type) && (
            <>
              <div className="h-3 w-px bg-border" />
              <input
                type="range"
                min={1}
                max={12}
                step={0.5}
                value={selectedShape.strokeWidth}
                onChange={(e) => {
                  w.pushHistory();
                  w.updateShape(selectedShape.id, { strokeWidth: Number(e.target.value) });
                }}
                title="Stroke width"
                data-attr="shape-stroke-width"
                className="w-16 accent-[var(--color-accent)]"
              />
              <span className="w-8 text-[11px] tabular-nums text-ink-3">
                {selectedShape.strokeWidth.toFixed(1)}
              </span>
              <div className="h-3 w-px bg-border" />
              {TEXT_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  title={`Stroke ${c}`}
                  onClick={() => {
                    w.pushHistory();
                    w.updateShape(selectedShape.id, { strokeColor: c });
                  }}
                  data-attr={`shape-stroke-${c.replace("#", "")}`}
                  className="h-4 w-4 rounded-full border border-border transition-transform duration-150 ease-out hover:scale-110"
                  style={{
                    backgroundColor: c,
                    outline:
                      (selectedShape.strokeColor ?? "#3B82F6").toLowerCase() === c.toLowerCase()
                        ? "1.5px solid var(--color-accent)"
                        : "none",
                    outlineOffset: 1,
                  }}
                />
              ))}
              {FILLABLE_TYPES.has(selectedShape.type) && (
                <>
                  <div className="h-3 w-px bg-border" />
                  {TEXT_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      title={`Fill ${c}`}
                      onClick={() => {
                        w.pushHistory();
                        w.updateShape(selectedShape.id, { fillColor: c });
                      }}
                      data-attr={`shape-fill-${c.replace("#", "")}`}
                      className="h-4 w-4 rounded-full border border-border transition-transform duration-150 ease-out hover:scale-110"
                      style={{
                        backgroundColor: c,
                        outline:
                          selectedShape.fillColor?.toLowerCase() === c.toLowerCase()
                            ? "1.5px solid var(--color-accent)"
                            : "none",
                        outlineOffset: 1,
                      }}
                    />
                  ))}
                  <button
                    type="button"
                    title="No fill"
                    onClick={() => {
                      w.pushHistory();
                      w.updateShape(selectedShape.id, { fillColor: undefined });
                    }}
                    data-attr="shape-fill-none"
                    className="relative h-4 w-4 overflow-hidden rounded-full border border-border transition-transform duration-150 ease-out hover:scale-110"
                    style={{
                      outline: !selectedShape.fillColor ? "1.5px solid var(--color-accent)" : "none",
                      outlineOffset: 1,
                    }}
                  >
                    <span className="absolute left-1/2 top-1/2 h-[2px] w-[18px] -translate-x-1/2 -translate-y-1/2 rotate-45 rounded bg-red-400" />
                  </button>
                </>
              )}
            </>
          )}
          <div className="h-3 w-px bg-border" />
          <button
            type="button"
            title="Delete (Del)"
            onClick={deleteSelected}
            className="flex h-6 w-6 items-center justify-center rounded-md text-icon transition-colors duration-150 ease-out hover:bg-hover hover:text-red-400"
          >
            <Trash2 size={13} />
          </button>
        </div>
      )}

      {/* Crop actions */}
      {w.crop && w.tool === "crop" && (
        <div
          className="absolute left-1/2 top-2.5 z-20 flex -translate-x-1/2 items-center gap-1.5 rounded-lg border border-border bg-card px-2 py-1 shadow-lg shadow-black/40 animate-pop"
          onPointerDownCapture={(e) => e.stopPropagation()}
        >
          <span className="px-1 text-[11px] text-ink-2">
            {Math.round(w.crop.w)} × {Math.round(w.crop.h)} px
          </span>
          <button
            type="button"
            title="Apply crop (Enter)"
            onClick={() => w.applyCrop()}
            className="rounded-md bg-accent px-2.5 py-0.5 text-[11px] font-medium text-white transition-colors duration-150 ease-out hover:bg-accent/90"
          >
            Apply
          </button>
          <button
            type="button"
            title="Cancel crop (Esc)"
            onClick={() => w.setCrop(null)}
            className="rounded-md bg-hover px-2 py-0.5 text-[11px] text-ink-2 transition-colors duration-150 ease-out hover:bg-active hover:text-ink"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Live adjust values (Window/Level, Brightness, Contrast) */}
      {adjusting && (
        <div
          data-adjust-chip
          className="pointer-events-none absolute left-1/2 top-2.5 z-20 -translate-x-1/2 rounded-lg border border-border bg-card px-2.5 py-1 text-[11px] tabular-nums text-ink shadow-lg shadow-black/40"
        >
          {w.tool === "windowlevel" && `W: ${Math.round(w.wl.window)} · L: ${Math.round(w.wl.level)}`}
          {w.tool === "brightness" && `Brightness: ${Math.round((w.brightness / 50) * 100)}%`}
          {w.tool === "contrast" && `Contrast: ${Math.round((w.contrast / 50) * 100)}%`}
        </div>
      )}

      {/* Tool hint */}
      <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 text-[11px] text-ink-3/60">
        {w.tool === "move" && "Drag to move · Click to select · Scroll to zoom · Double-click to edit text"}
        {w.tool === "hand" && "Drag to pan the image"}
        {w.tool === "zoom" && "Click to zoom in · Alt-click to zoom out"}
        {w.tool === "windowlevel" && "Drag vertically for window · horizontally for level"}
        {w.tool === "brightness" && "Drag vertically to adjust brightness"}
        {w.tool === "contrast" && "Drag vertically to adjust contrast"}
        {w.tool === "angle" && (angleDraft?.end2 ? "Click to set the second arm" : angleDraft ? "Drag to set the first arm" : "Click to set the vertex, drag the first arm")}
        {w.tool === "annotation" && "Click to place a note"}
        {w.tool === "text" && "Click to add text"}
        {w.tool === "crop" && "Drag to select crop area · Enter to apply · Esc to cancel"}
        {drawHint === "freedraw" && "Drag to draw a freehand path"}
        {drawHint && drawHint !== "freedraw" && (drawHint === "measure" || drawHint === "distance" ? "Drag to measure distance" : "Drag to draw · Shift to constrain · Alt from center")}
      </div>
    </div>
  );
}
