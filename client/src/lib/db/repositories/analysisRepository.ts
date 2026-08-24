/**
 * analysisRepository — CRUD de `analysis_runs` et de ses `classification_results`
 * (FONDATION.md §25).
 *
 * Couvre les exécutions IA radiographie (classification, gradcam, cxas,
 * hybridgnet, opencxr_*) et fœtales (quality, plane, fetalclip, anomaly).
 * reconstruction_3d volontairement absent : la 3D est hors périmètre
 * (FONDATION.md §2). Aucun branchement UI pendant la phase Fondation.
 */

import { getSupabaseClient } from "../supabaseClient";
import type {
  AnalysisRunInsert,
  AnalysisRunRow,
  AnalysisRunUpdate,
  ClassificationResultInsert,
  ClassificationResultRow,
  Json,
} from "../types";
import { queryExecuted, queryMany, queryMaybeOne, queryOne } from "../repositoryUtils";

const RUNS = "analysis_runs" as const;
const RESULTS = "classification_results" as const;

/* ------------------------------- analysis_runs ------------------------------ */

/** Démarre un run d'analyse attaché à un examen (et optionnellement à une image). */
export async function createAnalysisRun(values: AnalysisRunInsert): Promise<AnalysisRunRow> {
  return queryOne("analysis_runs.insert", () =>
    getSupabaseClient().from(RUNS).insert(values).select("*").single(),
  );
}

/** Lit un run d'analyse ; null si absent. */
export async function getAnalysisRun(id: string): Promise<AnalysisRunRow | null> {
  return queryMaybeOne("analysis_runs.get", () =>
    getSupabaseClient().from(RUNS).select("*").eq("id", id).maybeSingle(),
  );
}

/** Liste les runs d'un examen, du plus récent au plus ancien. */
export async function listAnalysisRunsByExamination(examinationId: string): Promise<AnalysisRunRow[]> {
  return queryMany("analysis_runs.list_by_examination", () =>
    getSupabaseClient()
      .from(RUNS)
      .select("*")
      .eq("examination_id", examinationId)
      .order("created_at", { ascending: false }),
  );
}

/** Liste les runs rattachés à une image précise. */
export async function listAnalysisRunsByImage(imageId: string): Promise<AnalysisRunRow[]> {
  return queryMany("analysis_runs.list_by_image", () =>
    getSupabaseClient()
      .from(RUNS)
      .select("*")
      .eq("image_id", imageId)
      .order("created_at", { ascending: false }),
  );
}

/** Met à jour le cycle de vie d'un run (status, timestamps, erreur…). */
export async function updateAnalysisRun(id: string, patch: AnalysisRunUpdate): Promise<AnalysisRunRow> {
  return queryOne("analysis_runs.update", () =>
    getSupabaseClient().from(RUNS).update(patch).eq("id", id).select("*").single(),
  );
}

/** Supprime un run (cascade sur classification_results ; mesures détachées en NULL). */
export async function deleteAnalysisRun(id: string): Promise<boolean> {
  return queryExecuted("analysis_runs.delete", () =>
    getSupabaseClient().from(RUNS).delete().eq("id", id),
  );
}

/** Passe le run en `running` (début d'exécution effective). */
export async function markRunning(id: string, startedAt?: string): Promise<AnalysisRunRow> {
  return updateAnalysisRun(id, { status: "running", started_at: startedAt ?? new Date().toISOString() });
}

/** Termine un run en `done`, avec métadonnées de résultats/artefacts. */
export async function markDone(id: string, metadata?: Json, completedAt?: string): Promise<AnalysisRunRow> {
  return updateAnalysisRun(id, {
    status: "done",
    completed_at: completedAt ?? new Date().toISOString(),
    ...(metadata !== undefined ? { metadata } : {}),
  });
}

/** Termine un run en `error` avec message exploitable (§22). */
export async function markError(id: string, errorMessage: string): Promise<AnalysisRunRow> {
  return updateAnalysisRun(id, { status: "error", error_message: errorMessage, completed_at: new Date().toISOString() });
}

/** Marque un run `rejected` (fail-closed opencxr, §13) sans message d'erreur système. */
export async function markRejected(id: string, reason: string): Promise<AnalysisRunRow> {
  return updateAnalysisRun(id, { status: "rejected", error_message: reason, completed_at: new Date().toISOString() });
}

/* --------------------------- classification_results ------------------------- */

/** Ajoute une probabilité par classe (par modèle ou ensemble) à un run. */
export async function addClassificationResult(
  values: ClassificationResultInsert,
): Promise<ClassificationResultRow> {
  return queryOne("classification_results.insert", () =>
    getSupabaseClient().from(RESULTS).insert(values).select("*").single(),
  );
}

/** Ajoute plusieurs résultats de classification en une seule requête. */
export async function addClassificationResults(
  values: ClassificationResultInsert[],
): Promise<ClassificationResultRow[]> {
  if (values.length === 0) return [];
  return queryMany("classification_results.insert_many", () =>
    getSupabaseClient().from(RESULTS).insert(values).select("*"),
  );
}

/** Liste les résultats de classification d'un run. */
export async function listClassificationResults(runId: string): Promise<ClassificationResultRow[]> {
  return queryMany("classification_results.list_by_run", () =>
    getSupabaseClient()
      .from(RESULTS)
      .select("*")
      .eq("analysis_run_id", runId)
      .order("probability", { ascending: false }),
  );
}
