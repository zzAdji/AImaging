/**
 * examinationRepository — CRUD de la table `examinations` (FONDATION.md §25).
 * Aucun branchement UI pendant la phase Fondation.
 */

import { getSupabaseClient } from "../supabaseClient";
import type { ExaminationInsert, ExaminationRow, ExaminationUpdate } from "../types";
import { queryExecuted, queryMany, queryMaybeOne, queryOne } from "../repositoryUtils";

const TABLE = "examinations" as const;

export interface ListExaminationsOptions {
  /** Inclure les examens archivés (défaut : tous). */
  includeArchived?: boolean;
  /** Limite de résultats. */
  limit?: number;
}

/** Crée un examen dans l'espace de travail donné. */
export async function createExamination(values: ExaminationInsert): Promise<ExaminationRow> {
  return queryOne("examinations.insert", () =>
    getSupabaseClient().from(TABLE).insert(values).select("*").single(),
  );
}

/** Lit un examen par son identifiant ; null si absent. */
export async function getExamination(id: string): Promise<ExaminationRow | null> {
  return queryMaybeOne("examinations.get", () =>
    getSupabaseClient().from(TABLE).select("*").eq("id", id).maybeSingle(),
  );
}

/** Liste les examens d'un espace, du plus récemment ouvert au plus ancien. */
export async function listExaminations(
  workspaceId: string,
  options: ListExaminationsOptions = {},
): Promise<ExaminationRow[]> {
  let request = getSupabaseClient()
    .from(TABLE)
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("last_opened_at", { ascending: false, nullsFirst: false });
  if (!options.includeArchived) {
    request = request.eq("archived", false);
  }
  if (options.limit !== undefined) {
    request = request.limit(options.limit);
  }
  return queryMany("examinations.list", () => request);
}

/** Recherche un examen par legacy_id (migration localStorage → Supabase). */
export async function getExaminationByLegacyId(legacyId: string): Promise<ExaminationRow | null> {
  return queryMaybeOne("examinations.get_by_legacy_id", () =>
    getSupabaseClient().from(TABLE).select("*").eq("legacy_id", legacyId).maybeSingle(),
  );
}

/** Met à jour un examen (patch partiel) et retourne la ligne à jour. */
export async function updateExamination(
  id: string,
  patch: ExaminationUpdate,
): Promise<ExaminationRow> {
  return queryOne("examinations.update", () =>
    getSupabaseClient().from(TABLE).update(patch).eq("id", id).select("*").single(),
  );
}

/** Supprime un examen (cascade sur images → annotations/analyses/mesures/rapports). */
export async function deleteExamination(id: string): Promise<boolean> {
  return queryExecuted("examinations.delete", () =>
    getSupabaseClient().from(TABLE).delete().eq("id", id),
  );
}
