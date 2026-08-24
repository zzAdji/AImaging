/**
 * Accès Supabase Storage pour le bucket privé `medical-images`
 * (SUITE.md Phase 4 · §3/§7).
 *
 * Règles :
 * - bucket PRIVÉ : lecture via `.download()` (policy RLS select) ;
 * - chemin imposé : {user_id}/{workspace_id}/{examination_uuid}/images/{image_legacy_id}/{filename}
 *   — le premier segment vient TOUJOURS de la session Auth (`ensureDevSession`),
 *   jamais d'un paramètre arbitraire du frontend (§7) ;
 * - upload en upsert : une relance n'accumule pas de fichiers identiques (§15) ;
 * - aucune erreur silencieuse : les erreurs Storage sont propagées au caller.
 */

import { getSupabaseClient } from "./supabaseClient";

const BUCKET = "medical-images" as const;

/** Construit le chemin Storage normalisé d'une image d'examen. */
export function buildImagePath(
  userId: string,
  workspaceId: string,
  examinationId: string,
  imageLegacyId: string,
  filename: string,
): string {
  return `${userId}/${workspaceId}/${examinationId}/images/${imageLegacyId}/${filename}`;
}

/** Upload (upsert) du binaire image vers son chemin canonique. */
export async function uploadImageObject(path: string, blob: Blob, contentType?: string): Promise<void> {
  const { error } = await getSupabaseClient()
    .storage.from(BUCKET)
    .upload(path, blob, { contentType, upsert: true });
  if (error) {
    throw new Error(`[db] Upload Storage impossible (${path}) : ${error.message}`);
  }
}

/** Télécharge un objet image privé ; null si absent. */
export async function downloadImageObject(path: string): Promise<Blob | null> {
  const { data, error } = await getSupabaseClient().storage.from(BUCKET).download(path);
  if (error) {
    if (error.message.toLowerCase().includes("not found")) return null;
    throw new Error(`[db] Téléchargement Storage impossible (${path}) : ${error.message}`);
  }
  return data;
}

/** Supprime un objet ; ne considère pas « déjà absent » comme une erreur. */
export async function removeObject(path: string): Promise<void> {
  const { error } = await getSupabaseClient().storage.from(BUCKET).remove([path]);
  if (error) {
    throw new Error(`[db] Suppression Storage impossible (${path}) : ${error.message}`);
  }
}

/**
 * Suppression par lot (cleanup après delete examen, SUITE.md §16).
 * Les erreurs sont journalisées et propagées à l'appelant, qui décide
 * du caractère bloquant (le record DB est déjà parti via CASCADE).
 */
export async function removeImageObjects(paths: string[]): Promise<void> {
  for (const path of paths) {
    await removeObject(path);
  }
}

/* ------------------- Artefacts d'analyse (Phase 6, Option B) ----------------- */

const ARTIFACTS_BUCKET = "analysis-artifacts" as const;

/** Chemin imposé : {user}/{workspace}/{examination}/{image}/{run}/{kind}/{filename}. */
export function buildArtifactPath(
  userId: string,
  workspaceId: string,
  examinationId: string,
  imageId: string,
  runId: string,
  kind: string,
  filename: string,
): string {
  return `${userId}/${workspaceId}/${examinationId}/${imageId}/${runId}/${kind}/${filename}`;
}

/** Upload (upsert) d'un artefact d'analyse vers son chemin canonique. */
export async function uploadArtifactObject(path: string, blob: Blob, contentType?: string): Promise<void> {
  const { error } = await getSupabaseClient()
    .storage.from(ARTIFACTS_BUCKET)
    .upload(path, blob, { contentType, upsert: true });
  if (error) {
    throw new Error(`[db] Upload artefact impossible (${path}) : ${error.message}`);
  }
}

/** Télécharge un artefact privé ; null si absent. */
export async function downloadArtifactObject(path: string): Promise<Blob | null> {
  const { data, error } = await getSupabaseClient().storage.from(ARTIFACTS_BUCKET).download(path);
  if (error) {
    if (error.message.toLowerCase().includes("not found")) return null;
    throw new Error(`[db] Téléchargement artefact impossible (${path}) : ${error.message}`);
  }
  return data;
}

/* -------------------- Exports de rapports (Phase 7, §16) -------------------- */

const REPORTS_BUCKET = "reports" as const;

/**
 * Chemin imposé : {user}/{workspace}/{examination}/{report}/exports/{filename}.
 * Aucun PDF/JSON lourd en PostgreSQL : seul reports.storage_path référence ici.
 */
export function buildReportExportPath(
  userId: string,
  workspaceId: string,
  examinationId: string,
  reportId: string,
  filename: string,
): string {
  return `${userId}/${workspaceId}/${examinationId}/${reportId}/exports/${filename}`;
}

/** Upload (upsert) d'un export de rapport (JSON/PDF) vers son chemin canonique. */
export async function uploadReportObject(path: string, blob: Blob, contentType?: string): Promise<void> {
  const { error } = await getSupabaseClient()
    .storage.from(REPORTS_BUCKET)
    .upload(path, blob, { contentType, upsert: true });
  if (error) {
    throw new Error(`[db] Upload export rapport impossible (${path}) : ${error.message}`);
  }
}

/** Télécharge un export de rapport privé ; null si absent. */
export async function downloadReportObject(path: string): Promise<Blob | null> {
  const { data, error } = await getSupabaseClient().storage.from(REPORTS_BUCKET).download(path);
  if (error) {
    if (error.message.toLowerCase().includes("not found")) return null;
    throw new Error(`[db] Téléchargement export rapport impossible (${path}) : ${error.message}`);
  }
  return data;
}

