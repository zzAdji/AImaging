import type { PixelSpacingMm, Shape, WlValue } from "../state/workspace";
import { normalizeModalityId, type ModalityId } from "./modality";
import type { OpenCxrRejection, OpenCxrSortResult, OpenCxrStandardizeResult, RadiographyPrediction } from "./workspaceApi";
import type { LinearImageBuffer } from "./dicom";
import { isDicomFile, parseDicomFile } from "./dicom";

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

/** Résultat Grad-CAM calculé par le serveur dans le repère de l'image source. */
export interface GradCamResult {
  className: string;
  modelCount: number;
  heatmapDataUrl: string;
  peakRegion?: { x: number; y: number; w: number; h: number };
  generatedAt: string;
  perModel: Array<{ architecture: string; className: string; classIndex: number }>;
}

/** Reconstruction DeepScan3D d'une radio : vues rotatives + volume densité brut. */
export interface ThreeDResult {
  frames: Array<{ angle: number; data_url: string }>;
  volume?: { nx: number; ny: number; nz: number; spacing: number; data_b64: string };
  device: string;
  elapsedSec: number;
  generatedAt: string;
}

/**
 * Interrupteur global de la vue/reconstruction 3D côté client.
 * Mis à `false` tant que la qualité de la reconstruction 3D (DeepScan3D/GRAF)
 * n'est pas au point : le bouton « 3D » est grisé/inactif et aucune vue ou
 * reconstruction ne peut être déclenchée depuis le client. Remettre à `true`
 * une fois la 3D jugée correcte.
 */
export const THREE_D_FEATURE_ENABLED = false;

export interface ExamImage {
  id: string;
  name: string;
  src: string;
  dims: { w: number; h: number };
  sourceKind?: "browser-image" | "dicom" | "unknown";
  metadata?: ExamImageMetadata;
  /** Pixels rescalees pour le fenêtrage natif (seulement pour les DICOM monochromes). */
  linear?: LinearImageBuffer;
  prediction?: RadiographyPrediction;
  cxrSort?: OpenCxrSortResult;
  cxrStandardize?: OpenCxrStandardizeResult;
  /** Rejet par le tri opencxr (image non frontale) : la standardisation n'a pas été lancée. */
  cxrRejected?: OpenCxrRejection;
  gradcam?: GradCamResult;
  threeD?: ThreeDResult;
  state?: ExamImageState;
}

export interface ExamImageMetadata {
  modality?: string;
  studyInstanceUid?: string;
  seriesInstanceUid?: string;
  sopInstanceUid?: string;
  frameOfReferenceUid?: string;
  patientPseudonym?: string;
  pixelSpacingMm?: PixelSpacingMm;
  bodyPartExamined?: string;
  viewPosition?: string;
  studyDate?: string;
  studyDescription?: string;
  seriesDescription?: string;
  photometricInterpretation?: string;
  rows?: number;
  columns?: number;
  bitsStored?: number;
  windowCenter?: number;
  windowWidth?: number;
  numberOfFrames?: number;
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

/** Modalité canonique d'un examen (voir lib/modality.ts). */
export function examModality(exam: Pick<Examination, "modality">): ModalityId {
  return normalizeModalityId(exam.modality);
}

/** Garde typée : l'examen appartient-il à la modalité radiographique ? */
export function isRadiographyExam(exam: Pick<Examination, "modality">): boolean {
  return examModality(exam) === "radiography";
}

/** Garde typée : l'examen appartient-il à la modalité échographie fœtale ? */
export function isFetalUltrasoundExam(exam: Pick<Examination, "modality">): boolean {
  return examModality(exam) === "fetal_ultrasound";
}


export const uid = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Phase Database 8 : clé par utilisateur `aimaging.<userId>.examinations`
 * afin d'isoler les caches locaux entre utilisateurs. Sans userId, on retombe
 * sur la clé legacy EXAM_KEY — non destructif (données récupérables, §19).
 */
export function examinationsStorageKey(userId?: string | null): string {
  return userId ? `aimaging.${userId}.examinations` : EXAM_KEY;
}

export function loadExaminations(userId?: string | null): Examination[] {
  try {
    const raw = localStorage.getItem(examinationsStorageKey(userId));
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

export function saveExaminations(list: Examination[], userId?: string | null) {
  try {
    localStorage.setItem(examinationsStorageKey(userId), JSON.stringify(list));
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
export interface ImportedImageBatch {
  images: ExamImage[];
  warnings: string[];
  /**
   * Phase Database 4 : fichiers originaux capturés à l'import, par image id
   * (un DICOM multi-frames référence le même File pour chacune de ses frames).
   * Transitoire — jamais sérialisé dans le cache local.
   */
  originalFiles: Map<string, File>;
}

/**
 * Contexte optionnel d'une création d'examen côté UI :
 * - originalFiles : octets originaux à uploader vers Storage ;
 * - duplicatedFrom : duplication copy-on-duplicate depuis cet examen legacy.
 */
export interface CreateExamContext {
  originalFiles?: Map<string, File>;
  duplicatedFrom?: string;
}

function imageStem(filename: string): string {
  return filename.replace(/\.[^.]+$/, "") || "Image";
}

function dicomMetadata(metadata: Awaited<ReturnType<typeof parseDicomFile>>["metadata"]): ExamImageMetadata {
  return {
    modality: metadata.modality ?? undefined,
    studyInstanceUid: metadata.study_instance_uid ?? undefined,
    seriesInstanceUid: metadata.series_instance_uid ?? undefined,
    sopInstanceUid: metadata.sop_instance_uid ?? undefined,
    frameOfReferenceUid: metadata.frame_of_reference_uid ?? undefined,
    patientPseudonym: metadata.patient_pseudonym ?? undefined,
    pixelSpacingMm: metadata.pixel_spacing_mm ?? undefined,
    bodyPartExamined: metadata.body_part_examined ?? undefined,
    viewPosition: metadata.view_position ?? undefined,
    studyDate: metadata.study_date ?? undefined,
    studyDescription: metadata.study_description ?? undefined,
    seriesDescription: metadata.series_description ?? undefined,
    photometricInterpretation: metadata.photometric_interpretation ?? undefined,
    rows: metadata.rows ?? undefined,
    columns: metadata.columns ?? undefined,
    bitsStored: metadata.bits_stored ?? undefined,
    windowCenter: metadata.window_center ?? undefined,
    windowWidth: metadata.window_width ?? undefined,
    numberOfFrames: metadata.number_of_frames,
  };
}

async function readBrowserImage(file: File): Promise<ExamImage | null> {
  if (!file.type.startsWith("image/")) return null;
  const src = await new Promise<string | null>((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => resolve(null);
    r.readAsDataURL(file);
  });
  if (!src) return null;
  const dims = await new Promise<{ w: number; h: number }>((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve({ w: 0, h: 0 });
    img.src = src;
  });
  return {
    id: uid(),
    name: imageStem(file.name),
    src,
    dims,
    sourceKind: "browser-image",
  };
}

/** Reads conventional images and DICOM files. A multi-frame DICOM becomes one workspace image per frame. */
export async function readImportedImageFiles(files: File[] | FileList): Promise<ImportedImageBatch> {
  const out: ExamImage[] = [];
  const warnings: string[] = [];
  const originalFiles = new Map<string, File>();
  const list = Array.from(files);
  for (const file of list) {
    if (isDicomFile(file)) {
      try {
        const parsed = await parseDicomFile(file);
        const baseName = imageStem(file.name);
        const metadata = dicomMetadata(parsed.metadata);
        const inverted = (metadata.photometricInterpretation ?? "").trim().toUpperCase() === "MONOCHROME1";
        for (const frame of parsed.frames) {
          out.push({
            id: uid(),
            name: parsed.frames.length > 1 ? `${baseName} · frame ${frame.frame_index + 1}` : baseName,
            src: frame.image_data_url,
            dims: { w: frame.width, h: frame.height },
            sourceKind: "dicom",
            metadata: { ...metadata },
            linear:
              frame.linear_data_url !== null &&
              frame.linear_min !== null &&
              frame.linear_max !== null &&
              frame.linear_scale !== null
                ? {
                    dataUrl: frame.linear_data_url,
                    min: frame.linear_min,
                    max: frame.linear_max,
                    scale: frame.linear_scale,
                    width: frame.width,
                    height: frame.height,
                    inverted,
                  }
                : undefined,
          });
        }
        warnings.push(...parsed.warnings.map((warning) => `${file.name} : ${warning}`));
      } catch (error) {
        warnings.push(error instanceof Error ? error.message : `Import DICOM impossible : ${file.name}`);
      }
      continue;
    }
    const image = await readBrowserImage(file);
    if (image) {
      out.push(image);
      originalFiles.set(image.id, file);
    } else {
      warnings.push(`${file.name} : format non pris en charge.`);
    }
  }
  return { images: out, warnings, originalFiles };
}

/** Compatibility helper for existing callers that do not need import diagnostics. */
export async function readImageFiles(files: File[] | FileList): Promise<ExamImage[]> {
  return (await readImportedImageFiles(files)).images;
}

export function emptyExamImages(list: ExamImage[]): boolean {
  return list.length === 0;
}

/** The currently loaded ensemble was trained for chest radiographs, not CT/MR/US. */
export function isRadiographyCompatible(image: ExamImage): boolean {
  if (image.sourceKind !== "dicom") return true;
  const modality = image.metadata?.modality?.trim().toUpperCase();
  return modality === "CR" || modality === "DX";
}

/**
 * Phase 3 — Filtrage fail-closed du pipeline médical.
 *
 * Une image est prise en charge par le pipeline radiographique SEULEMENT si le
 * tri opencxr l'a acceptée (ACCEPTED_CXR). Les statuts rejetés (non-CXR ou
 * invalide) bloquent toute analyse médicale : ensemble, Grad-CAM, CXAS,
 * HybridGNet et rapport.
 */
export function isImageRejectedByOpenCxr(image: ExamImage): boolean {
  if (image.cxrRejected) {
    return image.cxrRejected.status === "REJECTED_NON_CXR" || image.cxrRejected.status === "REJECTED_INVALID_IMAGE";
  }
  const status = image.cxrSort?.status;
  if (status === "REJECTED_NON_CXR" || status === "REJECTED_INVALID_IMAGE") return true;
  // Rétro-compatibilité : un tri sans statut explicite est accepté s'il n'est pas notCXR.
  return image.cxrSort?.Type === "notCXR";
}

export interface ExamConsistencyIssue {
  level: "warning" | "error";
  message: string;
}

const distinct = <T,>(values: Array<T | null | undefined>): T[] =>
  [...new Set(values.filter((value): value is T => value !== null && value !== undefined))];

/**
 * Reports whether images can safely be treated as one DICOM examination.
 * It never prevents individual viewing or prediction; it only prevents a
 * misleading inter-image clinical comparison.
 */
export function inspectExamConsistency(images: ExamImage[]): ExamConsistencyIssue[] {
  const issues: ExamConsistencyIssue[] = [];
  const dicomImages = images.filter((image) => image.sourceKind === "dicom");
  if (dicomImages.length === 0) return issues;

  const studyUids = distinct(dicomImages.map((image) => image.metadata?.studyInstanceUid));
  const patientIds = distinct(dicomImages.map((image) => image.metadata?.patientPseudonym));
  const modalities = distinct(dicomImages.map((image) => image.metadata?.modality));
  const frameOfReferenceUids = distinct(dicomImages.map((image) => image.metadata?.frameOfReferenceUid));
  const singleFrameImages = dicomImages.filter((image) => (image.metadata?.numberOfFrames ?? 1) <= 1);
  const sopUids = distinct(singleFrameImages.map((image) => image.metadata?.sopInstanceUid));
  const spacing = distinct(dicomImages.map((image) => image.metadata?.pixelSpacingMm?.join("×")));

  if (studyUids.length > 1) {
    issues.push({
      level: "error",
      message: "Les images DICOM appartiennent à plusieurs Study Instance UID : la comparaison inter-images est bloquée.",
    });
  }
  if (patientIds.length > 1) {
    issues.push({
      level: "error",
      message: "Les images DICOM correspondent à plusieurs patients pseudonymisés : elles ne doivent pas être analysées comme un seul examen.",
    });
  }
  if (modalities.length > 1) {
    issues.push({
      level: "error",
      message: `Modalités DICOM incompatibles dans le même espace (${modalities.join(", ")}).`,
    });
  }
  if (frameOfReferenceUids.length > 1) {
    issues.push({
      level: "warning",
      message: "Les images utilisent plusieurs Frame of Reference UID : ne transposez pas de coordonnées d'une image à l'autre.",
    });
  }
  if (spacing.length > 1) {
    issues.push({
      level: "warning",
      message: "Les images n'ont pas le même Pixel Spacing : les longueurs calibrées restent valides par image mais ne sont pas directement comparables.",
    });
  }
  if (sopUids.length !== singleFrameImages.filter((image) => image.metadata?.sopInstanceUid).length) {
    issues.push({
      level: "warning",
      message: "Certaines images réutilisent le même SOP Instance UID ; vérifiez qu'il ne s'agit pas de doublons.",
    });
  }
  if (studyUids.length === 0 && dicomImages.length > 1) {
    issues.push({
      level: "warning",
      message: "Study Instance UID absent : la cohérence inter-images ne peut pas être démontrée.",
    });
  }
  if (dicomImages.length !== images.length) {
    issues.push({
      level: "warning",
      message: "L'espace mélange des DICOM et des images sans métadonnées DICOM ; la comparaison clinique est limitée.",
    });
  }
  return issues;
}
