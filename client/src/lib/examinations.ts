import type { Shape, WlValue } from "../state/workspace";

/* ------------------------------ Examination model ------------------------------ */

export interface ExamImageState {
  src: string;
  shapes: Shape[];
  wl: WlValue;
  brightness: number;
  contrast: number;
  inverted: boolean;
  rotation: number;
  flipH: boolean;
  flipV: boolean;
}

export interface ExamImage {
  id: string;
  name: string;
  src: string;
  dims: { w: number; h: number };
  sourceKind?: "browser-image" | "dicom" | "unknown";
  metadata?: ExamImageMetadata;
  state?: ExamImageState;
}

export interface ExamImageMetadata {
  modality?: string;
  studyInstanceUid?: string;
  seriesInstanceUid?: string;
  patientPseudonym?: string;
  pixelSpacingMm?: [number, number];
}

export interface Examination {
  id: string;
  name: string;
  modality: string;
  images: ExamImage[];
  createdAt: string;
  lastOpenedAt: string;
  archived: boolean;
}

export const EXAM_KEY = "aimaging.examinations";
export const MODALITIES = ["Radiography", "Ultrasound", "CT Scan", "MRI", "Other"];

export const uid = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export function loadExaminations(): Examination[] {
  try {
    const raw = localStorage.getItem(EXAM_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is Examination =>
        typeof e === "object" &&
        e !== null &&
        typeof e.id === "string" &&
        typeof e.name === "string" &&
        Array.isArray(e.images),
    );
  } catch {
    return [];
  }
}

export function saveExaminations(list: Examination[]) {
  try {
    localStorage.setItem(EXAM_KEY, JSON.stringify(list));
  } catch {
    /* storage full or unavailable */
  }
}

export type ExamBucket = "Today" | "Yesterday" | "Last week" | "Last month" | "Older" | "Archive";

export function bucketOf(iso: string, archived: boolean): ExamBucket {
  if (archived) return "Archive";
  const d = new Date(iso);
  const now = new Date();
  const startOf = (daysAgo: number) => {
    const s = new Date(now);
    s.setHours(0, 0, 0, 0);
    s.setDate(s.getDate() - daysAgo);
    return s;
  };
  if (d >= startOf(0)) return "Today";
  if (d >= startOf(1)) return "Yesterday";
  if (d >= startOf(7)) return "Last week";
  if (d >= startOf(30)) return "Last month";
  return "Older";
}

export const BUCKETS: ExamBucket[] = ["Today", "Yesterday", "Last week", "Last month", "Older", "Archive"];

/** "Last opened : Today" style short label */
export function lastOpenedLabel(iso: string, archived: boolean): string {
  if (archived) return "Archived";
  const b = bucketOf(iso, false);
  if (b !== "Older") return b;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Reads image files (dropped or picked) into ExamImage records with dims */
export async function readImageFiles(files: File[] | FileList): Promise<ExamImage[]> {
  const out: ExamImage[] = [];
  const list = Array.from(files);
  for (const file of list) {
    if (!file.type.startsWith("image/")) continue;
    const src = await new Promise<string | null>((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = () => resolve(null);
      r.readAsDataURL(file);
    });
    if (!src) continue;
    const dims = await new Promise<{ w: number; h: number }>((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => resolve({ w: 0, h: 0 });
      img.src = src;
    });
    out.push({
      id: uid(),
      name: file.name.replace(/\.[^.]+$/, ""),
      src,
      dims,
      sourceKind: "browser-image",
    });
  }
  return out;
}

export function emptyExamImages(list: ExamImage[]): boolean {
  return list.length === 0;
}
