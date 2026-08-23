/**
 * measurementRepository — CRUD de la table `measurements` (FONDATION.md §25).
 *
 * Unité explicite par mesure (ratio pour CTR, px/mm pour les distances, mm pour
 * la biométrie fœtale) ; value nullable pour une saisie en attente ;
 * source user/ai ; confidence 0..1.
 * Aucun branchement UI pendant la phase Fondation.
 */

import { getSupabaseClient } from "../supabaseClient";
import type { MeasurementInsert, MeasurementRow, MeasurementUpdate } from "../types";
import { queryExecuted, queryMany, queryMaybeOne, queryOne } from "../repositoryUtils";

const TABLE = "measurements" as const;

/** Crée une mesure rattachée au minimum à une image. */
export async function createMeasurement(values: MeasurementInsert): Promise<MeasurementRow> {
  return queryOne("measurements.insert", () =>
    getSupabaseClient().from(TABLE).insert(values).select("*").single(),
  );
}

/** Lit une mesure ; null si absente. */
export async function getMeasurement(id: string): Promise<MeasurementRow | null> {
  return queryMaybeOne("measurements.get", () =>
    getSupabaseClient().from(TABLE).select("*").eq("id", id).maybeSingle(),
  );
}

/** Liste les mesures posées sur une image, par type puis date de création. */
export async function listMeasurementsByImage(imageId: string): Promise<MeasurementRow[]> {
  return queryMany("measurements.list_by_image", () =>
    getSupabaseClient()
      .from(TABLE)
      .select("*")
      .eq("image_id", imageId)
      .order("type", { ascending: true })
      .order("created_at", { ascending: true }),
  );
}

/** Liste les mesures produites par un run d'analyse IA donné. */
export async function listMeasurementsByAnalysisRun(analysisRunId: string): Promise<MeasurementRow[]> {
  return queryMany("measurements.list_by_analysis_run", () =>
    getSupabaseClient()
      .from(TABLE)
      .select("*")
      .eq("analysis_run_id", analysisRunId)
      .order("created_at", { ascending: true }),
  );
}

/** Met à jour une mesure (valeur saisie, unité, confiance…) et retourne la ligne à jour. */
export async function updateMeasurement(
  id: string,
  patch: MeasurementUpdate,
): Promise<MeasurementRow> {
  return queryOne("measurements.update", () =>
    getSupabaseClient().from(TABLE).update(patch).eq("id", id).select("*").single(),
  );
}

/** Supprime une mesure. */
export async function deleteMeasurement(id: string): Promise<boolean> {
  return queryExecuted("measurements.delete", () =>
    getSupabaseClient().from(TABLE).delete().eq("id", id),
  );
}
