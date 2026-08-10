import {
  MM_PER_PX,
  SELECT_ALL,
  isShapeVisible,
  shapeBBox,
  shapeLayerId,
  shapeTextBox,
  type FontFamily,
  type LayerDef,
  type Shape,
} from "../state/workspace";

const ACCENT = "var(--color-accent)";

const FONT_MAP: Record<FontFamily, string> = {
  sans: "Inter, sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  mono: "'JetBrains Mono', Consolas, monospace",
};

const HANDLE_CURSOR: Record<string, string> = {
  nw: "nwse-resize",
  se: "nwse-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
  p1: "move",
  p2: "move",
  p3: "move",
};

/* ------------------------------ Small pieces ------------------------------ */

function ArrowHead({
  x1,
  y1,
  x2,
  y2,
  size,
  color,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  size: number;
  color: string;
}) {
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const a1 = ang - 0.42;
  const a2 = ang + 0.42;
  const points = `${x2},${y2} ${x2 - size * Math.cos(a1)},${y2 - size * Math.sin(a1)} ${x2 - size * Math.cos(a2)},${y2 - size * Math.sin(a2)}`;
  return <polygon points={points} fill={color} />;
}

/** Fixed screen-size chip (text is sized in doc units so it stays constant on screen) */
function Chip({
  cx,
  cy,
  text,
  scale,
}: {
  cx: number;
  cy: number;
  text: string;
  scale: number;
}) {
  const fs = 11 / scale;
  const w = text.length * fs * 0.62 + 14 / scale;
  const h = 18 / scale;
  return (
    <g>
      <rect
        x={cx - w / 2}
        y={cy - h - 2 / scale}
        width={w}
        height={h}
        rx={5 / scale}
        fill="#0e0e0e"
        fillOpacity={0.92}
        stroke="rgba(255,255,255,0.18)"
        strokeWidth={1 / scale}
      />
      <text
        x={cx}
        y={cy - h / 2 + fs * 0.36}
        textAnchor="middle"
        fontSize={fs}
        fontWeight={600}
        fill="#e8e8e8"
        style={{ userSelect: "none" }}
      >
        {text}
      </text>
    </g>
  );
}

function TextLines({
  x,
  y,
  label,
  fontSize,
  ...props
}: {
  x: number;
  y: number;
  label: string;
  fontSize: number;
} & React.SVGProps<SVGTextElement>) {
  const lines = label.split("\n");
  return (
    <text {...props} x={x} y={y} fontSize={fontSize}>
      {lines.map((l, i) => (
        <tspan key={i} x={x} dy={i === 0 ? 0 : fontSize * 1.35}>
          {l}
        </tspan>
      ))}
    </text>
  );
}

function AngleArc({
  vx,
  vy,
  a1,
  a2,
  r,
  color,
}: {
  vx: number;
  vy: number;
  a1: number;
  a2: number;
  r: number;
  color: string;
}) {
  let delta = a2 - a1;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;
  if (Math.abs(delta) < 0.02) return null;
  const large = Math.abs(delta) > Math.PI ? 1 : 0;
  const sweep = delta > 0 ? 1 : 0;
  const x1 = vx + r * Math.cos(a1);
  const y1 = vy + r * Math.sin(a1);
  const x2 = vx + r * Math.cos(a2);
  const y2 = vy + r * Math.sin(a2);
  return <path d={`M ${x1} ${y1} A ${r} ${r} 0 ${large} ${sweep} ${x2} ${y2}`} fill="none" stroke={color} strokeWidth={1.25} />;
}

/* ------------------------------ Shape elements ------------------------------ */

function ShapeElement({ shape, draft, scale }: { shape: Shape; draft?: boolean; scale: number }) {
  const dash = draft ? "7 5" : undefined;
  const sw = shape.strokeWidth;
  const stroke = shape.strokeColor ?? ACCENT;
  const attrs = { "data-shape": shape.id, "data-type": shape.type };
  switch (shape.type) {
    case "rectangle":
      return (
        <rect
          {...attrs}
          x={shape.x}
          y={shape.y}
          width={shape.w}
          height={shape.h}
          fill={shape.fillColor ?? "none"}
          stroke={stroke}
          strokeWidth={sw}
          strokeDasharray={dash}
        />
      );
    case "ellipse":
      return (
        <ellipse
          {...attrs}
          cx={shape.x + shape.w / 2}
          cy={shape.y + shape.h / 2}
          rx={Math.abs(shape.w) / 2}
          ry={Math.abs(shape.h) / 2}
          fill={shape.fillColor ?? "none"}
          stroke={stroke}
          strokeWidth={sw}
          strokeDasharray={dash}
        />
      );
    case "line":
      return (
        <line
          {...attrs}
          x1={shape.x}
          y1={shape.y}
          x2={shape.x + shape.w}
          y2={shape.y + shape.h}
          stroke={stroke}
          strokeWidth={sw}
          strokeLinecap="round"
          strokeDasharray={dash}
        />
      );
    case "arrow":
      return (
        <g {...attrs}>
          <line
            x1={shape.x}
            y1={shape.y}
            x2={shape.x + shape.w}
            y2={shape.y + shape.h}
            stroke={stroke}
            strokeWidth={sw}
            strokeLinecap="round"
            strokeDasharray={dash}
          />
          <ArrowHead
            x1={shape.x}
            y1={shape.y}
            x2={shape.x + shape.w}
            y2={shape.y + shape.h}
            size={14}
            color={stroke}
          />
        </g>
      );
    case "freedraw":
      return (
        <polyline
          {...attrs}
          points={shape.points.map((p) => `${p.x},${p.y}`).join(" ")}
          fill="none"
          stroke={stroke}
          strokeWidth={sw}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={dash}
        />
      );
    case "measure":
    case "distance": {
      const len = Math.hypot(shape.w, shape.h) * MM_PER_PX;
      const text = `${len.toFixed(1)} mm`;
      const mcx = shape.x + shape.w / 2;
      const mcy = shape.y + shape.h / 2;
      return (
        <g {...attrs}>
          <line
            x1={shape.x}
            y1={shape.y}
            x2={shape.x + shape.w}
            y2={shape.y + shape.h}
            stroke={stroke}
            strokeWidth={sw}
            strokeLinecap="round"
            strokeDasharray={dash}
          />
          <circle cx={shape.x} cy={shape.y} r={3.5} fill={stroke} />
          <circle cx={shape.x + shape.w} cy={shape.y + shape.h} r={3.5} fill={stroke} />
          <Chip cx={mcx} cy={mcy} text={text} scale={scale} />
        </g>
      );
    }
    case "angle": {
      const p2 = shape.points[0] ?? { x: shape.x, y: shape.y };
      const ex = shape.x + shape.w;
      const ey = shape.y + shape.h;
      const a1 = Math.atan2(shape.h, shape.w);
      const a2 = Math.atan2(p2.y - shape.y, p2.x - shape.x);
      const cos = Math.max(-1, Math.min(1, (shape.w * (p2.x - shape.x) + shape.h * (p2.y - shape.y)) /
        (Math.hypot(shape.w, shape.h) * Math.hypot(p2.x - shape.x, p2.y - shape.y) || 1)));
      const deg = (Math.acos(cos) * 180) / Math.PI;
      const r = 20;
      return (
        <g {...attrs}>
          <line x1={shape.x} y1={shape.y} x2={ex} y2={ey} stroke={stroke} strokeWidth={sw} strokeLinecap="round" strokeDasharray={dash} />
          <line x1={shape.x} y1={shape.y} x2={p2.x} y2={p2.y} stroke={stroke} strokeWidth={sw} strokeLinecap="round" strokeDasharray={dash} />
          <AngleArc vx={shape.x} vy={shape.y} a1={a1} a2={a2} r={r} color={stroke} />
          <circle cx={shape.x} cy={shape.y} r={3} fill={stroke} />
          <Chip cx={shape.x + r + 16} cy={shape.y - r - 2} text={`${deg.toFixed(1)}°`} scale={scale} />
        </g>
      );
    }
    case "annotation": {
      const anchor = shape.points[0] ?? { x: shape.x, y: shape.y };
      const box = shapeTextBox(shape);
      const fs = shape.fontSize ?? 16;
      const tx = anchor.x > box.x + box.w / 2 ? box.x + box.w : box.x;
      const ty = Math.max(box.y + 4, Math.min(box.y + box.h - 4, anchor.y));
      return (
        <g {...attrs}>
          <circle cx={anchor.x} cy={anchor.y} r={7} fill="none" stroke={ACCENT} strokeWidth={1} strokeOpacity={0.55} />
          <circle cx={anchor.x} cy={anchor.y} r={3} fill={ACCENT} />
          <line x1={anchor.x} y1={anchor.y} x2={tx} y2={ty} stroke={ACCENT} strokeWidth={1.25} />
          <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={6} fill="#0e0e0e" fillOpacity={0.94} stroke={ACCENT} strokeWidth={1} />
          <TextLines
            x={box.x + 10}
            y={box.y + fs + 7}
            label={shape.label ?? ""}
            fontSize={fs}
            fontWeight={shape.fontWeight === "bold" ? 700 : 500}
            fontFamily={FONT_MAP[shape.fontFamily ?? "sans"]}
            fill="#f5f5f5"
            style={{ userSelect: "none" }}
          />
        </g>
      );
    }
    case "text":
      return (
        <TextLines
          {...attrs}
          x={shape.x}
          y={shape.y + (shape.fontSize ?? 16)}
          label={shape.label ?? ""}
          fontSize={shape.fontSize ?? 16}
          fontWeight={shape.fontWeight === "bold" ? 700 : 500}
          fontFamily={FONT_MAP[shape.fontFamily ?? "sans"]}
          fill={shape.color ?? "#ffffff"}
          style={{ userSelect: "none" }}
        />
      );
  }
}

/* ------------------------------ Selection handles ------------------------------ */

function Handle({
  x,
  y,
  handle,
  shapeId,
  cropMode,
}: {
  x: number;
  y: number;
  handle: string;
  shapeId: string;
  cropMode?: boolean;
}) {
  return (
    <rect
      x={x - 4.5}
      y={y - 4.5}
      width={9}
      height={9}
      rx={1.5}
      fill={ACCENT}
      stroke="#1a1a1a"
      strokeWidth={1}
      pointerEvents="all"
      data-handle={handle}
      data-shape={shapeId}
      data-crop-handle={cropMode ? handle : undefined}
      style={{ cursor: HANDLE_CURSOR[handle] ?? "default" }}
    />
  );
}

function ShapeSelection({ shape }: { shape: Shape }) {
  if (shape.type === "line" || shape.type === "arrow" || shape.type === "measure" || shape.type === "distance") {
    return (
      <g>
        <Handle x={shape.x} y={shape.y} handle="p1" shapeId={shape.id} />
        <Handle x={shape.x + shape.w} y={shape.y + shape.h} handle="p2" shapeId={shape.id} />
      </g>
    );
  }
  if (shape.type === "angle") {
    const p3 = shape.points[0] ?? { x: shape.x, y: shape.y };
    const bb = shapeBBox(shape);
    return (
      <g>
        <rect
          x={bb.x - 1}
          y={bb.y - 1}
          width={bb.w + 2}
          height={bb.h + 2}
          fill="none"
          stroke={ACCENT}
          strokeWidth={1}
          strokeDasharray="4 3"
        />
        <Handle x={shape.x} y={shape.y} handle="p1" shapeId={shape.id} />
        <Handle x={shape.x + shape.w} y={shape.y + shape.h} handle="p2" shapeId={shape.id} />
        <Handle x={p3.x} y={p3.y} handle="p3" shapeId={shape.id} />
      </g>
    );
  }
  if (shape.type === "annotation") {
    const anchor = shape.points[0] ?? { x: shape.x, y: shape.y };
    const box = shapeTextBox(shape);
    return (
      <g>
        <rect
          x={box.x - 1}
          y={box.y - 1}
          width={box.w + 2}
          height={box.h + 2}
          fill="none"
          stroke={ACCENT}
          strokeWidth={1}
          strokeDasharray="4 3"
        />
        <Handle x={anchor.x} y={anchor.y} handle="p1" shapeId={shape.id} />
      </g>
    );
  }
  if (shape.type === "text") {
    const box = shapeTextBox(shape);
    return (
      <rect
        x={box.x - 2}
        y={box.y - 2}
        width={box.w + 4}
        height={box.h + 4}
        fill="none"
        stroke={ACCENT}
        strokeWidth={1}
        strokeDasharray="4 3"
      />
    );
  }
  const bb = shapeBBox(shape);
  const corners = [
    { x: bb.x, y: bb.y, h: "nw" },
    { x: bb.x + bb.w, y: bb.y, h: "ne" },
    { x: bb.x + bb.w, y: bb.y + bb.h, h: "se" },
    { x: bb.x, y: bb.y + bb.h, h: "sw" },
  ];
  const edges =
    shape.type === "freedraw"
      ? []
      : [
          { x: bb.x + bb.w / 2, y: bb.y, h: "n" },
          { x: bb.x + bb.w, y: bb.y + bb.h / 2, h: "e" },
          { x: bb.x + bb.w / 2, y: bb.y + bb.h, h: "s" },
          { x: bb.x, y: bb.y + bb.h / 2, h: "w" },
        ];
  return (
    <g>
      <rect
        x={bb.x - 1}
        y={bb.y - 1}
        width={bb.w + 2}
        height={bb.h + 2}
        fill="none"
        stroke={ACCENT}
        strokeWidth={1}
        strokeDasharray="4 3"
      />
      {corners.map((c) => (
        <Handle key={c.h} x={c.x} y={c.y} handle={c.h} shapeId={shape.id} />
      ))}
      {edges.map((c) => (
        <Handle key={c.h} x={c.x} y={c.y} handle={c.h} shapeId={shape.id} />
      ))}
    </g>
  );
}

/* ------------------------------ Crop overlay ------------------------------ */

function CropOverlay({ crop, viewRect }: { crop: Shape; viewRect: { x: number; y: number; w: number; h: number } }) {
  const { x, y, w, h } = crop;
  const vx = viewRect.x;
  const vy = viewRect.y;
  const vw = viewRect.w;
  const vh = viewRect.h;
  const corners = [
    { x, y, h: "nw" },
    { x: x + w, y, h: "ne" },
    { x: x + w, y: y + h, h: "se" },
    { x, y: y + h, h: "sw" },
  ];
  const edges = [
    { x: x + w / 2, y, h: "n" },
    { x: x + w, y: y + h / 2, h: "e" },
    { x: x + w / 2, y: y + h, h: "s" },
    { x, y: y + h / 2, h: "w" },
  ];
  return (
    <g>
      {w > 0 && h > 0 && (
        <>
          <rect x={vx} y={vy} width={Math.max(0, x - vx)} height={vh} fill="#000000" fillOpacity={0.45} />
          <rect x={x + w} y={vy} width={Math.max(0, vx + vw - x - w)} height={vh} fill="#000000" fillOpacity={0.45} />
          <rect x={x} y={vy} width={w} height={Math.max(0, y - vy)} fill="#000000" fillOpacity={0.45} />
          <rect x={x} y={y + h} width={w} height={Math.max(0, vy + vh - y - h)} fill="#000000" fillOpacity={0.45} />
          <rect x={x} y={y} width={w} height={h} fill="none" stroke={ACCENT} strokeWidth={1.5} strokeDasharray="6 4" />
          {corners.map((c) => (
            <Handle key={c.h} x={c.x} y={c.y} handle={c.h} shapeId="crop" cropMode />
          ))}
          {edges.map((c) => (
            <Handle key={c.h} x={c.x} y={c.y} handle={c.h} shapeId="crop" cropMode />
          ))}
        </>
      )}
    </g>
  );
}

/* ------------------------------ Angle draft ------------------------------ */

export interface AngleDraft {
  vertex: { x: number; y: number };
  end1: { x: number; y: number };
  end2: { x: number; y: number } | null;
}

function AngleDraftLayer({ draft, scale }: { draft: AngleDraft; scale: number }) {
  const { vertex, end1, end2 } = draft;
  const a1 = Math.atan2(end1.y - vertex.y, end1.x - vertex.x);
  const a2 = end2 ? Math.atan2(end2.y - vertex.y, end2.x - vertex.x) : a1;
  return (
    <g>
      <line x1={vertex.x} y1={vertex.y} x2={end1.x} y2={end1.y} stroke={ACCENT} strokeWidth={1.75} strokeDasharray="7 5" />
      {end2 && (
        <line x1={vertex.x} y1={vertex.y} x2={end2.x} y2={end2.y} stroke={ACCENT} strokeWidth={1.75} strokeDasharray="7 5" />
      )}
      {end2 && <AngleArc vx={vertex.x} vy={vertex.y} a1={a1} a2={a2} r={20} color={ACCENT} />}
      <circle cx={vertex.x} cy={vertex.y} r={3} fill={ACCENT} />
      {end2 && (
        <Chip cx={vertex.x + 36} cy={vertex.y - 22} text={angleText(vertex, end1, end2)} scale={scale} />
      )}
    </g>
  );
}

function angleText(vertex: { x: number; y: number }, e1: { x: number; y: number }, e2: { x: number; y: number }): string {
  const v1 = { x: e1.x - vertex.x, y: e1.y - vertex.y };
  const v2 = { x: e2.x - vertex.x, y: e2.y - vertex.y };
  const cos = Math.max(-1, Math.min(1, (v1.x * v2.x + v1.y * v2.y) /
    (Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y) || 1)));
  return `${((Math.acos(cos) * 180) / Math.PI).toFixed(1)}°`;
}

/* ------------------------------ Layer ------------------------------ */

export function ShapesLayer({
  viewBox,
  viewRect,
  shapes,
  draft,
  selection,
  scale,
  angleDraft,
  crop,
  layers,
}: {
  viewBox: string;
  viewRect: { x: number; y: number; w: number; h: number };
  shapes: Shape[];
  draft: Shape | null;
  selection: string | null;
  scale: number;
  angleDraft: AngleDraft | null;
  crop: Shape | null;
  layers: LayerDef[];
}) {
  const paintOrder = (id: LayerDef["id"]) => layers.findIndex((l) => l.id === id);
  const visibleShapes = shapes
    .filter((s) => isShapeVisible(s, layers))
    .sort(
      (a, b) => paintOrder(shapeLayerId(a)) - paintOrder(shapeLayerId(b)),
    );
  const selectedShape = visibleShapes.find((s) => s.id === selection);
  return (
    <svg
      width="100%"
      height="100%"
      viewBox={viewBox}
      className="pointer-events-none absolute inset-0"
    >
      <g>
        {visibleShapes.map((s) => (
          <g key={s.id} opacity={layerOpacityFor(s, layers) / 100}>
            <ShapeElement shape={s} scale={scale} />
          </g>
        ))}
      </g>
      {draft && <ShapeElement shape={draft} draft scale={scale} />}
      {angleDraft && <AngleDraftLayer draft={angleDraft} scale={scale} />}
      {selection === SELECT_ALL
        ? visibleShapes.map((s) => <ShapeSelection key={s.id} shape={s} />)
        : selectedShape && <ShapeSelection shape={selectedShape} />}
      {crop && <CropOverlay crop={crop} viewRect={viewRect} />}
    </svg>
  );
}

function layerOpacityFor(s: Shape, layers: LayerDef[]): number {
  return layers.find((l) => l.id === shapeLayerId(s))?.opacity ?? 100;
}
