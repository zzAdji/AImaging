import { formatDistance, type PixelSpacingMm, type Shape } from "../state/workspace";

/* --------------------------- Canvas export helpers --------------------------- */

const FONT_MAP: Record<string, string> = {
  sans: "Inter, sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  mono: "'JetBrains Mono', Consolas, monospace",
};

function resolveAccent(): string {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue("--color-accent").trim();
    return v || "#3B82F6";
  } catch {
    return "#3B82F6";
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawChip(ctx: CanvasRenderingContext2D, cx: number, cy: number, text: string): void {
  const fs = 11;
  const w = text.length * fs * 0.62 + 14;
  const h = 18;
  ctx.fillStyle = "#0e0e0e";
  ctx.globalAlpha = 0.92;
  roundRect(ctx, cx - w / 2, cy - h - 2, w, h, 5);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 1;
  roundRect(ctx, cx - w / 2, cy - h - 2, w, h, 5);
  ctx.stroke();
  ctx.fillStyle = "#e8e8e8";
  ctx.font = `600 ${fs}px Inter, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, cx, cy - h / 2);
}

function drawTextLines(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  label: string,
  fontSize: number,
  weight: number,
  font: string,
  fill: string,
): void {
  ctx.font = `${weight} ${fontSize}px ${font}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = fill;
  label.split("\n").forEach((line, i) => {
    ctx.fillText(line, x, y + i * fontSize * 1.35);
  });
}

function drawArrowHead(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  size: number,
): void {
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const a1 = ang - 0.42;
  const a2 = ang + 0.42;
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - size * Math.cos(a1), y2 - size * Math.sin(a1));
  ctx.lineTo(x2 - size * Math.cos(a2), y2 - size * Math.sin(a2));
  ctx.closePath();
  ctx.fill();
}

function drawAngleArc(
  ctx: CanvasRenderingContext2D,
  vx: number,
  vy: number,
  a1: number,
  a2: number,
  r: number,
): void {
  let delta = a2 - a1;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;
  if (Math.abs(delta) < 0.02) return;
  ctx.beginPath();
  ctx.arc(vx, vy, r, a1, a2, delta < 0);
  ctx.stroke();
}

export function drawShapeOnCanvas(
  ctx: CanvasRenderingContext2D,
  s: Shape,
  pixelSpacingMm: PixelSpacingMm | null = null,
): void {
  const accent = resolveAccent();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.fillStyle = accent;
  ctx.strokeStyle = accent;
  switch (s.type) {
    case "rectangle": {
      ctx.lineWidth = s.strokeWidth;
      ctx.strokeStyle = s.strokeColor ?? accent;
      if (s.fillColor) {
        ctx.fillStyle = s.fillColor;
        ctx.fillRect(s.x, s.y, s.w, s.h);
      }
      ctx.strokeRect(s.x, s.y, s.w, s.h);
      break;
    }
    case "ellipse": {
      ctx.lineWidth = s.strokeWidth;
      ctx.strokeStyle = s.strokeColor ?? accent;
      if (s.fillColor) {
        ctx.fillStyle = s.fillColor;
        ctx.beginPath();
        ctx.ellipse(s.x + s.w / 2, s.y + s.h / 2, Math.abs(s.w) / 2, Math.abs(s.h) / 2, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.ellipse(s.x + s.w / 2, s.y + s.h / 2, Math.abs(s.w) / 2, Math.abs(s.h) / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case "line":
      ctx.lineWidth = s.strokeWidth;
      ctx.strokeStyle = s.strokeColor ?? accent;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x + s.w, s.y + s.h);
      ctx.stroke();
      break;
    case "arrow": {
      ctx.lineWidth = s.strokeWidth;
      ctx.strokeStyle = s.strokeColor ?? accent;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x + s.w, s.y + s.h);
      ctx.stroke();
      ctx.fillStyle = s.strokeColor ?? accent;
      drawArrowHead(ctx, s.x, s.y, s.x + s.w, s.y + s.h, 14);
      break;
    }
    case "freedraw": {
      if (s.points.length === 0) break;
      ctx.lineWidth = s.strokeWidth;
      ctx.strokeStyle = s.strokeColor ?? accent;
      ctx.beginPath();
      ctx.moveTo(s.points[0].x, s.points[0].y);
      for (const p of s.points.slice(1)) ctx.lineTo(p.x, p.y);
      ctx.stroke();
      break;
    }
    case "measure":
    case "distance": {
      const len = formatDistance(s.w, s.h, pixelSpacingMm);
      ctx.lineWidth = s.strokeWidth;
      ctx.strokeStyle = s.strokeColor ?? accent;
      ctx.fillStyle = s.strokeColor ?? accent;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x + s.w, s.y + s.h);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(s.x, s.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(s.x + s.w, s.y + s.h, 3.5, 0, Math.PI * 2);
      ctx.fill();
      drawChip(ctx, s.x + s.w / 2, s.y + s.h / 2, len);
      break;
    }
    case "angle": {
      const p2 = s.points[0] ?? { x: s.x, y: s.y };
      const ex = s.x + s.w;
      const ey = s.y + s.h;
      const a1 = Math.atan2(s.h, s.w);
      const a2 = Math.atan2(p2.y - s.y, p2.x - s.x);
      const cos = Math.max(
        -1,
        Math.min(1, (s.w * (p2.x - s.x) + s.h * (p2.y - s.y)) /
          (Math.hypot(s.w, s.h) * Math.hypot(p2.x - s.x, p2.y - s.y) || 1)),
      );
      const deg = (Math.acos(cos) * 180) / Math.PI;
      ctx.lineWidth = s.strokeWidth;
      ctx.strokeStyle = s.strokeColor ?? accent;
      ctx.fillStyle = s.strokeColor ?? accent;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
      ctx.lineWidth = 1.25;
      drawAngleArc(ctx, s.x, s.y, a1, a2, 20);
      ctx.beginPath();
      ctx.arc(s.x, s.y, 3, 0, Math.PI * 2);
      ctx.fill();
      drawChip(ctx, s.x + 36, s.y - 22, `${deg.toFixed(1)}°`);
      break;
    }
    case "annotation": {
      const anchor = s.points[0] ?? { x: s.x, y: s.y };
      const fs = s.fontSize ?? 16;
      const lines = (s.label ?? "").split("\n");
      const len = Math.max(1, ...lines.map((l) => l.length));
      const box = { x: s.x, y: s.y, w: len * fs * 0.62 + 20, h: lines.length * fs * 1.35 + 14 };
      const tx = anchor.x > box.x + box.w / 2 ? box.x + box.w : box.x;
      const ty = Math.max(box.y + 4, Math.min(box.y + box.h - 4, anchor.y));
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(anchor.x, anchor.y, 7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(anchor.x, anchor.y, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.moveTo(anchor.x, anchor.y);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      ctx.globalAlpha = 0.94;
      ctx.fillStyle = "#0e0e0e";
      roundRect(ctx, box.x, box.y, box.w, box.h, 6);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1;
      roundRect(ctx, box.x, box.y, box.w, box.h, 6);
      ctx.stroke();
      drawTextLines(
        ctx,
        box.x + 10,
        box.y + fs + 7,
        s.label ?? "",
        fs,
        s.fontWeight === "bold" ? 700 : 500,
        FONT_MAP[s.fontFamily ?? "sans"],
        "#f5f5f5",
      );
      break;
    }
    case "text": {
      const fs = s.fontSize ?? 16;
      drawTextLines(
        ctx,
        s.x,
        s.y + fs,
        s.label ?? "",
        fs,
        s.fontWeight === "bold" ? 700 : 500,
        FONT_MAP[s.fontFamily ?? "sans"],
        s.color ?? "#ffffff",
      );
      break;
    }
  }
}

export interface ExportOptions {
  imageSrc: string;
  dims: { w: number; h: number };
  shapes: Shape[];
  /** CSS filter applied to the image (window/level, brightness, contrast…) */
  filter: string;
  /** Optional server-computed overlay rendered in the image coordinate system. */
  overlaySrc?: string;
  overlayOpacity?: number;
  /** DICOM Pixel Spacing for calibrated measurement labels. */
  pixelSpacingMm?: PixelSpacingMm | null;
  format: "png" | "jpeg";
  quality?: number;
  scale?: number;
}

/** Renders image + annotations to a canvas and returns a data URL. */
export async function exportImageDataUrl(opts: ExportOptions): Promise<string> {
  const scale = opts.scale ?? 1;
  const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("Image could not be loaded"));
    i.src = src;
  });
  const [img, overlay] = await Promise.all([
    loadImage(opts.imageSrc),
    opts.overlaySrc ? loadImage(opts.overlaySrc) : Promise.resolve(null),
  ]);

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(opts.dims.w * scale));
  canvas.height = Math.max(1, Math.round(opts.dims.h * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");

  ctx.scale(scale, scale);
  if (opts.format === "jpeg") {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, opts.dims.w, opts.dims.h);
  }
  ctx.filter = opts.filter;
  ctx.drawImage(img, 0, 0, opts.dims.w, opts.dims.h);
  ctx.filter = "none";
  if (overlay) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, Math.max(0, opts.overlayOpacity ?? 1));
    ctx.globalCompositeOperation = "screen";
    ctx.drawImage(overlay, 0, 0, opts.dims.w, opts.dims.h);
    ctx.restore();
  }
  for (const s of opts.shapes) drawShapeOnCanvas(ctx, s, opts.pixelSpacingMm);

  const mime = opts.format === "jpeg" ? "image/jpeg" : "image/png";
  return canvas.toDataURL(mime, opts.format === "jpeg" ? opts.quality ?? 0.9 : undefined);
}

export function downloadDataUrl(dataUrl: string, filename: string): void {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function downloadJson(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  downloadDataUrl(url, filename);
}

/** Re-encodes an image (blob/data URL) to a PNG data URL (used by Save). */
export function imageToPngDataUrl(src: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, img.naturalWidth);
      canvas.height = Math.max(1, img.naturalHeight);
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve("");
        return;
      }
      ctx.drawImage(img, 0, 0);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => resolve("");
    img.src = src;
  });
}
