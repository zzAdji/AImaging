/** Native DICOM window/level rendering on the raw rescaled pixels.

Remplace l'approximation CSS (filtre sur la prévisualisation PNG) par un
véritable fenêtrage dans le repère physique des valeurs rescalees (HU pour le
scanner) : chaque pixel = min + uint16 * scale, puis mapping linéaire
window/level, inversion photométrique (MONOCHROME1) et post-réglages
luminosité/contraste de l'utilisateur.
 */

import type { LinearImageBuffer } from "./dicom";
import type { WlValue } from "../state/workspace";

const RAW_CACHE = new Map<string, Uint16Array>();
const RAW_CACHE_MAX = 4;

/** Decodes the base64 uint16 little-endian payload, cached per buffer. */
export function decodeLinearUint16(buffer: LinearImageBuffer): Uint16Array {
  const cached = RAW_CACHE.get(buffer.dataUrl);
  if (cached) return cached;
  const bin = atob(buffer.dataUrl);
  const out = new Uint16Array(bin.length >> 1);
  for (let i = 0; i < out.length; i++) {
    out[i] = bin.charCodeAt(i << 1) | (bin.charCodeAt((i << 1) | 1) << 8);
  }
  if (RAW_CACHE.size >= RAW_CACHE_MAX) {
    const first = RAW_CACHE.keys().next().value;
    if (first !== undefined) RAW_CACHE.delete(first);
  }
  RAW_CACHE.set(buffer.dataUrl, out);
  return out;
}

export interface LinearRenderOptions {
  wl: WlValue;
  /** 0-100, 50 = neutre (même échelle que l'ancien filtre CSS). */
  brightness: number;
  /** 0-100, 50 = neutre. */
  contrast: number;
  /** Inversion demandée par l'utilisateur (indépendante de MONOCHROME1). */
  inverted: boolean;
}

/** Paints the windowed grayscale frame at (0, 0) of the given context. */
export function paintLinearFrame(
  ctx: CanvasRenderingContext2D,
  buffer: LinearImageBuffer,
  options: LinearRenderOptions,
): void {
  const raw = decodeLinearUint16(buffer);
  const n = raw.length;
  const { wl, brightness, contrast, inverted } = options;
  const low = wl.level - wl.window / 2;
  const win = Math.max(1e-4, wl.window);
  const b = brightness / 50;
  const c = 1 + (contrast - 50) / 40;
  const flip = buffer.inverted !== inverted;

  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    let x = (buffer.min + raw[i] * buffer.scale - low) / win;
    if (x < 0) x = 0;
    else if (x > 1) x = 1;
    if (flip) x = 1 - x;
    x = ((x - 0.5) * c + 0.5) * b;
    if (x < 0) x = 0;
    else if (x > 1) x = 1;
    const g = (x * 255) | 0;
    const j = i * 4;
    out[j] = g;
    out[j + 1] = g;
    out[j + 2] = g;
    out[j + 3] = 255;
  }
  ctx.putImageData(new ImageData(out, buffer.width, buffer.height), 0, 0);
}

/** Renders the windowed frame to a data URL (for thumbnails, export, print). */
export function linearToDataUrl(buffer: LinearImageBuffer, options: LinearRenderOptions): string {
  const canvas = document.createElement("canvas");
  canvas.width = buffer.width;
  canvas.height = buffer.height;
  const ctx = canvas.getContext("2d");
  if (ctx) paintLinearFrame(ctx, buffer, options);
  return canvas.toDataURL("image/png");
}