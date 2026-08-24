/**
 * Couche de persistance des IMAGES — Phase Database 4 (SUITE.md).
 *
 * Flux imposé (§4/§10) : identité → upload Storage → record examination_images
 * → retour ; upload OK + DB KO ⇒ nettoyage de l'objet orphelin ;
 * DB jamais présentée comme synchronisée si le fichier n'y est pas.
 *
 * Choix validés :
 * - DICOM A (§9) : l'original .dcm est uploadé quand il est disponible
 *   (capturé à l'import) ; sinon repli sur le PNG de frame rendu du cache,
 *   marqué `legacy_frame_fallback` dans metadata. LinearImageBuffer n'est
 *   JAMAIS persisté ;
 * - Duplication A (§17) : copy-on-duplicate (nouveaux chemins Storage).
 *
 * Le cache local reste la source de rendu pendant la coexistence (§5) ;
 * la lecture Storage-first complète accompagnera la suppression du cache.
 */

import { isSupabaseConfigured } from "./supabaseClient";
import { emitSyncStatus, resolveExamContext } from "./examinationStore";
import {
  createImage,
  getImageByLegacyId,
  listImagesByExamination,
} from "./repositories/imageRepository";
import {
  buildImagePath,
  downloadImageObject,
  removeObject,
  uploadImageObject,
} from "./storage";
import type { Examination } from "../examinations";
import type { Json } from "./types";

/* --------------------------- État par image (§11) --------------------------- */

/** État de synchronisation d'une image : jamais « synced » sans fichier distant. */
export type ImageSyncState = "local" | "pending" | "synced" | "error";

const syncStateByImage = new Map<string, ImageSyncState>();

export function getImageSyncState(imageLegacyId: string): ImageSyncState {
  return syncStateByImage.get(imageLegacyId) ?? "local";
}

function setImageSyncState(imageLegacyId: string, state: ImageSyncState): void {
  syncStateByImage.set(imageLegacyId, state);
}

let pendingUploads = 0;

function beginUpload(): void {
  pendingUploads += 1;
  emitSyncStatus("syncing");
}

function endUpload(success: boolean): void {
  pendingUploads = Math.max(0, pendingUploads - 1);
  if (pendingUploads === 0) {
    /* Dernier transfert terminé : l'indicateur reflète le résultat global. */
    emitSyncStatus(success ? "synced" : "error");
  }
}

/* ------------------------------- Utilitaires -------------------------------- */

/** Convertit un data URL en Blob (octets exacts encodés par FileReader). */
export function dataUrlToBlob(dataUrl: string): Blob {
  const commaIndex = dataUrl.indexOf(",");
  if (!dataUrl.startsWith("data:") || commaIndex < 0) {
    throw new Error("[db] data URL invalide : conversion Blob impossible.");
  }
  const mime = dataUrl.slice(5, commaIndex).split(";")[0] || "application/octet-stream";
  const base64 = dataUrl.slice(commaIndex + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}

function extensionFor(mime: string): string {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "application/dicom") return "dcm";
  return "bin";
}

function safeStem(name: string): string {
  const stem = name.replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9._-]+/g, "_");
  return stem.length > 0 ? stem.slice(0, 80) : "image";
}

interface SyncableImage {
  id: string;
  name: string;
  src: string;
  dims: { w: number; h: number };
  sourceKind?: "browser-image" | "dicom" | "unknown";
  metadata?: unknown;
}

/* --------------------------- Synchronisation d'examen ----------------------- */

export interface SyncImagesOptions {
  /** Duplication copy-on-duplicate : legacy id de l'examen source (§17 A). */
  duplicatedFrom?: string;
  /** Originaux capturés à l'import (DICOM .dcm notamment), par image id. */
  originalFiles?: Map<string, File>;
}

/**
 * Synchronise toutes les images d'un examen vers Storage + examination_images.
 * Idempotent : une image déjà pourvue d'un storage_path est ignorée (§15).
 * En cas d'échec, l'état local est conservé et l'erreur propagée (§10).
 */
export async function syncExamImages(
  exam: Pick<Examination, "id" | "images">,
  options: SyncImagesOptions = {},
): Promise<void> {
  if (!isSupabaseConfigured) return;
  beginUpload();
  let success = true;
  try {
    const target = await resolveExamContext(exam.id);
    const source =
      options.duplicatedFrom !== undefined ? await resolveExamContext(options.duplicatedFrom) : null;
    const sourceRows = source !== null ? await listImagesByExamination(source.examinationUuid) : [];

    for (let index = 0; index < exam.images.length; index++) {
      const image = exam.images[index] as SyncableImage;
      setImageSyncState(image.id, "pending");
      try {
        await syncOneImage(target, image, index, {
          originalFile: options.originalFiles?.get(image.id),
          sourceContext: source,
          sourceRow: sourceRows[index] ?? null,
        });
        setImageSyncState(image.id, "synced");
      } catch (exc: unknown) {
        success = false;
        setImageSyncState(image.id, "error");
        throw exc;
      }
    }
  } finally {
    endUpload(success);
  }
}

interface SyncOneSourceRow {
  storage_path: string | null;
  filename: string;
  metadata: Json;
}

interface SyncOneOptions {
  originalFile?: File;
  sourceContext: { userId: string; workspaceUuid: string; examinationUuid: string } | null;
  sourceRow: SyncOneSourceRow | null;
}

async function syncOneImage(
  target: { userId: string; workspaceUuid: string; examinationUuid: string },
  image: SyncableImage,
  sortOrder: number,
  opts: SyncOneOptions,
): Promise<void> {
  /* Idempotence : déjà synchronisée → rien à faire (§15). */
  const existing = await getImageByLegacyId(image.id);
  if (existing !== null && existing.storage_path !== null) return;

  let blob: Blob;
  let filename: string;
  let mimeType: string;
  const metadata: Record<string, Json> = { name: image.name };
  if (typeof image.metadata === "object" && image.metadata !== null) {
    metadata.dicom = image.metadata as Json;
  }

  if (opts.originalFile !== undefined) {
    /* Choix DICOM A (§9) : l'original est stocké tel quel ; les métadonnées
       pseudonymisées restent dans PostgreSQL, séparées du fichier brut. */
    blob = opts.originalFile;
    mimeType = opts.originalFile.type || "application/dicom";
    filename = `${safeStem(image.name)}.${extensionFor(mimeType)}`;
  } else if (
    opts.sourceContext !== null &&
    opts.sourceRow !== null &&
    opts.sourceRow.storage_path !== null
  ) {
    /* Duplication copy-on-duplicate (§17 A) : copie binaire contrôlée. */
    const sourceBlob = await downloadImageObject(opts.sourceRow.storage_path);
    if (sourceBlob === null) {
      throw new Error(`[db] Fichier source introuvable (${opts.sourceRow.storage_path}).`);
    }
    blob = sourceBlob;
    mimeType = sourceBlob.type || "application/octet-stream";
    filename = opts.sourceRow.filename;
    metadata.duplicated_from_storage_path = opts.sourceRow.storage_path;
  } else {
    /* Repli cache local : data URL → Blob (octets exacts côté navigateur ;
       PNG de frame rendu pour un DICOM legacy sans original). */
    blob = dataUrlToBlob(image.src);
    mimeType = blob.type || "image/png";
    filename = `${safeStem(image.name)}.${extensionFor(mimeType)}`;
    if (image.sourceKind === "dicom") metadata.legacy_frame_fallback = true;
  }

  const path = buildImagePath(
    target.userId,
    target.workspaceUuid,
    target.examinationUuid,
    image.id,
    filename,
  );

  /* Upload AVANT le record DB (§10) ; DB KO ⇒ nettoyage explicite. */
  await uploadImageObject(path, blob, mimeType);
  try {
    await createImage({
      examination_id: target.examinationUuid,
      legacy_id: image.id,
      filename,
      storage_path: path,
      mime_type: mimeType,
      width: image.dims.w > 0 ? image.dims.w : null,
      height: image.dims.h > 0 ? image.dims.h : null,
      sort_order: sortOrder,
      source_kind: image.sourceKind ?? "unknown",
      metadata,
    });
  } catch (exc: unknown) {
    try {
      await removeObject(path);
    } catch (cleanupError: unknown) {
      console.error("[db] Nettoyage de l'objet orphelin impossible.", cleanupError);
    }
    throw exc;
  }
}

/* ------------------------------ Migration (§14) ----------------------------- */

let migrationStarted = false;

/**
 * Migration idempotente des images du cache local vers Storage.
 * Appelée après le bootstrap des examens ; ne supprime JAMAIS le cache
 * local (§5/§14) — la suppression du cache est reportée après validation.
 */
export async function migrateExistingImages(
  userId?: string | null,
): Promise<{ uploaded: number; failed: number }> {
  if (!isSupabaseConfigured || migrationStarted) return { uploaded: 0, failed: 0 };
  migrationStarted = true;
  const { loadExaminations } = await import("../examinations");
  let uploaded = 0;
  let failed = 0;
  for (const exam of loadExaminations(userId)) {
    if (exam.images.length === 0) continue;
    try {
      await syncExamImages(exam);
      uploaded += exam.images.filter((image) => getImageSyncState(image.id) === "synced").length;
    } catch (exc: unknown) {
      failed += exam.images.filter((image) => getImageSyncState(image.id) === "error").length;
      console.error(`[db] Migration images incomplète pour l'examen '${exam.name}'.`, exc);
    }
  }
  return { uploaded, failed };
}

/* ------------------------------ Lecture (§12) -------------------------------- */

/**
 * Restaure une URL consommable (<img>/canvas) depuis Storage :
 * storage object → Blob → object URL — sans réécrire le viewer.
 * Retourne null si la ligne ou le fichier distant est absent : le caller
 * conserve alors son cache local comme filet (coexistence §5).
 */
export async function loadImageObjectUrl(
  examLegacyId: string,
  imageLegacyId: string,
): Promise<string | null> {
  if (!isSupabaseConfigured) return null;
  const ctx = await resolveExamContext(examLegacyId);
  const row =
    (await getImageByLegacyId(imageLegacyId)) ??
    (await listImagesByExamination(ctx.examinationUuid)).find((candidate) => candidate.legacy_id === imageLegacyId) ??
    null;
  if (row === null || row.storage_path === null) return null;
  const blob = await downloadImageObject(row.storage_path);
  if (blob === null) return null;
  return URL.createObjectURL(blob);
}

