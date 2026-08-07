import type { WlValue } from "../state/workspace";

/* ------------------------------ Mock metadata ----------------------------- */
/* Deterministic pseudo-DICOM metadata: values are derived from the loaded
 * image (name + source) so they "follow" the document, while staying stable
 * for a given image. */

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) || 1;
}

const pick = <T,>(arr: readonly T[], h: number): T => arr[h % arr.length];
const pad = (n: number) => String(n).padStart(2, "0");

export interface MetadataInput {
  name: string;
  dims: { w: number; h: number };
  imageSrc: string;
  wl: WlValue;
}

export function deriveMetadata({ name, dims, imageSrc, wl }: MetadataInput): [string, string][] {
  const h = hashStr(name);
  const h2 = hashStr(imageSrc.slice(0, 4000) + name);
  const month = (h2 % 12) + 1;
  const day = (h2 % 27) + 1;
  return [
    ["Modality", pick(["CR", "DX", "CT", "MR"], h)],
    ["Manufacturer", pick(["GE Medical", "Siemens Healthineers", "Philips", "Canon Medical"], h2)],
    ["Body part", pick(["Chest", "Abdomen", "Brain", "Pelvis", "Spine"], h >> 3)],
    ["View position", pick(["PA", "AP", "Lateral"], h2 >> 4)],
    ["Columns", String(dims.w)],
    ["Rows", String(dims.h)],
    ["KVp", String(90 + (h % 31))],
    ["Exposure", `${(2 + (h % 20) / 10).toFixed(1)} mAs`],
    ["Pixel spacing", `${(0.1 + (h % 100) / 1000).toFixed(3)} mm`],
    ["Bits stored", String(10 + (h % 3) * 2)],
    ["Window / Level", `${Math.round(wl.window)} / ${Math.round(wl.level)}`],
    ["Study date", `2026-${pad(month)}-${pad(day)}`],
    ["Study UID", `1.2.826.0.1.${100000 + (h % 900000)}.${h2 % 10000}.1`],
  ];
}
