/**
 * Couche de compatibilité « gestion des examens » — Phase Database 3 (SUITE.md).
 *
 * Rôle : faire de Supabase la source persistante des EXAMENS (métadonnées
 * uniquement) sans déplacer les autres données :
 * - les images (Data URLs), résultats IA, Grad-CAM, OpenCXR et états d'édition
 *   restent dans le cache local `aimaging.examinations` (fallback officiel) ;
 * - le modèle UI `Examination` conserve son identifiant legacy : la table
 *   `examinations` stocke ce dernier dans `legacy_id` et le couple
 *   legacy_id ↔ UUID est maintenu ici (jamais de réécriture des anciens IDs) ;
 * - lecture : Supabase → fusion avec le cache local → sinon fallback local ;
 * - écriture : opération granulaire vers Supabase → mise à jour du cache local ;
 *   en cas d'échec la donnée locale est conservée et l'erreur est propagée
 *   (aucun catch {} silencieux) ;
 * - WorkspaceStore backend (sessions runtime) n'est PAS concerné (SUITE.md §4).
 */

import { isSupabaseConfigured, getCurrentUserId } from "./supabaseClient";
import {
  createWorkspace,
  listWorkspacesByOwner,
} from "./repositories/workspaceRepository";
import {
  createExamination,
  deleteExamination,
  getExaminationByLegacyId,
  listExaminations,
  updateExamination,
} from "./repositories/examinationRepository";
import { loadExaminations, saveExaminations, type Examination } from "../examinations";
import { normalizeModalityId } from "../modality";
import { listImagesByExamination } from "./repositories/imageRepository";
import { removeImageObjects } from "./storage";
import { migrateExistingImages } from "./imageStore";
import type { ExaminationInsert, ExaminationRow } from "./types";

/** Nom du workspace initial créé pour un utilisateur authentifié sans espace (§16). */
export const INITIAL_WORKSPACE_NAME = "My Workspace";
/** Nom historique de l'ère devAuth — réutilisé s'il existe (non destructif, §19). */
const LEGACY_DEV_WORKSPACE_NAME = "Default workspace";

/* ------------------------------ Statut de sync ----------------------------- */

/** Statut minimal affiché discrètement dans l'UI (SUITE.md §10). */
export type ExamSyncStatus = "synced" | "syncing" | "error" | "local-only";

type SyncListener = (status: ExamSyncStatus) => void;
let statusListener: SyncListener | null = null;

/** Enregistre l'écouteur UI du statut (null pour détacher). */
export function setExamSyncListener(listener: SyncListener | null): void {
  statusListener = listener;
}

function setStatus(status: ExamSyncStatus): void {
  statusListener?.(status);
}

/* --------------------------- État interne du store -------------------------- */

let workspaceUuid: string | null = null;
/** Couple legacy_id (uid frontend) ↔ UUID PostgreSQL. */
const legacyToUuid = new Map<string, string>();
let readyPromise: Promise<void> | null = null;

/** true lorsque la persistance Supabase des examens est active. */
export function isExamSyncActive(): boolean {
  return isSupabaseConfigured;
}

/**
 * Canal de statut partagé : permet à la couche images (imageStore) d'émettre
 * sur le même indicateur UI sans posséder l'écouteur (SUITE.md Phase 4 §11).
 */
export function emitSyncStatus(status: ExamSyncStatus): void {
  setStatus(status);
}

/** Contexte resolved pour une examen legacy : indispensable aux chemins Storage. */
export async function resolveExamContext(
  legacyId: string,
): Promise<{ userId: string; workspaceUuid: string; examinationUuid: string }> {
  await requireReady();
  const examinationUuid = await resolveUuid(legacyId);
  const userId = await getCurrentUserId();
  return { userId, workspaceUuid: workspaceUuid as string, examinationUuid };
}

function requireReady(): Promise<void> {
  if (readyPromise === null) {
    readyPromise = (async () => {
      /* Phase Database 8 : identité = auth.uid() réel (plus aucun devAuth). */
      const userId = await getCurrentUserId();
      const owned = await listWorkspacesByOwner(userId);
      const existing =
        owned.find((w) => w.name === INITIAL_WORKSPACE_NAME) ??
        owned.find((w) => w.name === LEGACY_DEV_WORKSPACE_NAME);
      workspaceUuid =
        existing?.id ??
        (await createWorkspace({ owner_id: userId, name: INITIAL_WORKSPACE_NAME })).id;
    })().catch((exc: unknown) => {
      readyPromise = null;
      throw exc;
    });
  }
  return readyPromise;
}

/* ------------------------------ Conversions -------------------------------- */

/** Libellés UI historiques correspondant aux valeurs canoniques SQL. */
const CANONICAL_TO_DISPLAY: Record<string, string> = {
  radiography: "Radiography",
  fetal_ultrasound: "Ultrasound",
  unknown: "Other",
};

function toInsert(exam: Examination, wsUuid: string): ExaminationInsert {
  return {
    workspace_id: wsUuid,
    legacy_id: exam.id,
    name: exam.name.trim().length > 0 ? exam.name.trim() : "Untitled examination",
    modality: normalizeModalityId(exam.modality),
    archived: exam.archived,
    created_at: exam.createdAt,
    last_opened_at: exam.lastOpenedAt,
  };
}

function rowToExamination(row: ExaminationRow, local?: Examination): Examination {
  const id = row.legacy_id ?? `supabase:${row.id}`;
  return {
    ...(local ?? {}),
    id,
    name: row.name,
    modality: local?.modality ?? CANONICAL_TO_DISPLAY[row.modality] ?? "Other",
    archived: row.archived,
    createdAt: row.created_at,
    lastOpenedAt: row.last_opened_at ?? row.created_at,
    images: local?.images ?? [],
  };
}

/* ------------------------------- Migration ---------------------------------- */

/** Insère l'examen legacy s'il est absent de Supabase (migration idempotente, SUITE.md §6). */
async function migrateLegacyExam(exam: Examination): Promise<void> {
  const existing = await getExaminationByLegacyId(exam.id);
  if (existing !== null) {
    legacyToUuid.set(existing.legacy_id as string, existing.id);
    return;
  }
  const inserted = await createExamination(toInsert(exam, workspaceUuid as string));
  legacyToUuid.set(inserted.legacy_id as string, inserted.id);
}

/* ------------------------------- Bootstrap ---------------------------------- */

export interface BootstrapResult {
  exams: Examination[];
  status: ExamSyncStatus;
}

/**
 * Charge les examens au démarrage de l'écran des examens :
 * 1. sans configuration Supabase → comportement localStorage inchangé ;
 * 2. sinon : session réelle (auth.uid()) → workspace de l'utilisateur →
 *    migration idempotente des métadonnées locales → lecture Supabase →
 *    fusion avec le contenu local (images/résultats) → cache → synced.
 * En cas d'échec réseau/Supabase : les données locales sont retournées telles
 * quelles et le statut passe à « error » (l'erreur est journalisée, jamais avalée).
 */
export async function bootstrapExaminations(
  userId?: string | null,
): Promise<BootstrapResult> {
  const local = loadExaminations(userId);
  if (!isSupabaseConfigured) {
    setStatus("local-only");
    return { exams: local, status: "local-only" };
  }
  setStatus("syncing");
  try {
    await requireReady();

    /* Migration idempotente des métadonnées uniquement (aucun binaire). */
    for (const exam of local) {
      await migrateLegacyExam(exam);
    }

    const remoteRows = await listExaminations(workspaceUuid as string, { includeArchived: true });
    const localById = new Map(local.map((exam) => [exam.id, exam]));
    const merged: Examination[] = remoteRows.map((row) =>
      rowToExamination(row, row.legacy_id !== null ? localById.get(row.legacy_id) : undefined),
    );

    /* Les examens créés hors ligne et pas encore vus côté distant sont conservés. */
    const knownIds = new Set(merged.map((exam) => exam.id));
    for (const exam of local) {
      if (!knownIds.has(exam.id)) merged.push(exam);
    }

    merged.sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt));
    saveExaminations(merged, userId);
    setStatus("synced");
    /* Migration des images existantes en tâche de fond (Phase 4 §14) :
       idempotente, jamais bloquante pour l'UI, cache local conservé. */
    void migrateExistingImages(userId).catch((exc: unknown) => {
      console.error("[db] Migration des images existantes échouée (reprise au prochain démarrage).", exc);
    });
    return { exams: merged, status: "synced" };
  } catch (exc: unknown) {
    console.error("[db] Synchronisation des examens impossible, bascule sur le cache local.", exc);
    setStatus("error");
    return { exams: local, status: "error" };
  }
}

/* --------------------------- Opérations persistées --------------------------- */

async function withSync<T>(operation: () => Promise<T>): Promise<T> {
  setStatus("syncing");
  try {
    const result = await operation();
    setStatus("synced");
    return result;
  } catch (exc: unknown) {
    console.error("[db] Écriture examen vers Supabase échouée (données conservées localement).", exc);
    setStatus("error");
    throw exc;
  }
}

async function resolveUuid(legacyId: string): Promise<string> {
  await requireReady();
  const cached = legacyToUuid.get(legacyId);
  if (cached !== undefined) return cached;
  const row = await getExaminationByLegacyId(legacyId);
  if (row === null) {
    throw new Error(`[db] Aucun examen Supabase pour legacy_id '${legacyId}'.`);
  }
  legacyToUuid.set(legacyId, row.id);
  return row.id;
}

/** Persiste une création (création OU duplication métadonnées seules, §12). */
export function persistCreatedExam(exam: Examination): Promise<void> {
  if (!isSupabaseConfigured) return Promise.resolve();
  return withSync(async () => {
    await requireReady();
    const existing = await getExaminationByLegacyId(exam.id);
    if (existing !== null) {
      legacyToUuid.set(exam.id, existing.id);
      return;
    }
    const inserted = await createExamination(toInsert(exam, workspaceUuid as string));
    legacyToUuid.set(exam.id, inserted.id);
  });
}

export function persistRenamedExam(legacyId: string, name: string): Promise<void> {
  if (!isSupabaseConfigured) return Promise.resolve();
  return withSync(async () => {
    await updateExamination(await resolveUuid(legacyId), { name });
  });
}

/** Archive = soft delete ; Delete = suppression DB effective (SUITE.md §13). */
export function persistArchivedExam(legacyId: string, archived: boolean): Promise<void> {
  if (!isSupabaseConfigured) return Promise.resolve();
  return withSync(async () => {
    await updateExamination(await resolveUuid(legacyId), { archived });
  });
}

export function persistLastOpenedAt(legacyId: string, isoDate: string): Promise<void> {
  if (!isSupabaseConfigured) return Promise.resolve();
  return withSync(async () => {
    await updateExamination(await resolveUuid(legacyId), { last_opened_at: isoDate });
  });
}

/**
 * Suppression effective côté base + cleanup Storage minimum viable
 * (SUITE.md Phase 4 §16) :
 * 1. listing des lignes examination_images AVANT le delete DB ;
 * 2. suppression DB (FK CASCADE purgent annotations/analyses/…) ;
 * 3. suppression des objets Storage référencés.
 * Un échec Storage est journalisé mais ne remet pas en cause l'état DB déjà
 * consolidé ; les orphelins éventuels seront traités par la phase de
 * maintenance ultérieure (documenté).
 */
export function persistDeletedExam(legacyId: string): Promise<void> {
  if (!isSupabaseConfigured) return Promise.resolve();
  return withSync(async () => {
    const uuid = await resolveUuid(legacyId);
    let storagePaths: string[] = [];
    try {
      const rows = await listImagesByExamination(uuid);
      storagePaths = rows.map((row) => row.storage_path).filter((p): p is string => typeof p === "string");
    } catch (exc: unknown) {
      console.error("[db] Listing des images avant suppression échoué (cleanup Storage limité).", exc);
    }
    await deleteExamination(uuid);
    legacyToUuid.delete(legacyId);
    if (storagePaths.length > 0) {
      try {
        await removeImageObjects(storagePaths);
      } catch (exc: unknown) {
        console.error("[db] Cleanup Storage incomplet après suppression d'examen.", exc);
      }
    }
  });
}

