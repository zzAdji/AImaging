/**
 * reportRepository — CRUD de la table `reports` (FONDATION.md §25).
 *
 * Rapport radiographique (`radiography_ai`) ou compte rendu obstétrical fœtal
 * (`fetal_obstetric`) : texte libre dans `content`, données structurées JSONB
 * dans `structured_data`, export éventuel dans le bucket privé `reports`.
 * Aucun branchement UI pendant la phase Fondation.
 */

import { getSupabaseClient } from "../supabaseClient";
import type { ReportInsert, ReportRow, ReportUpdate } from "../types";
import { queryExecuted, queryMany, queryMaybeOne, queryOne } from "../repositoryUtils";

const TABLE = "reports" as const;

/** Crée un rapport sur un examen. */
export async function createReport(values: ReportInsert): Promise<ReportRow> {
  return queryOne("reports.insert", () =>
    getSupabaseClient().from(TABLE).insert(values).select("*").single(),
  );
}

/** Lit un rapport ; null si absent. */
export async function getReport(id: string): Promise<ReportRow | null> {
  return queryMaybeOne("reports.get", () =>
    getSupabaseClient().from(TABLE).select("*").eq("id", id).maybeSingle(),
  );
}

/** Liste les rapports d'un examen, du plus récemment modifié au plus ancien. */
export async function listReportsByExamination(examinationId: string): Promise<ReportRow[]> {
  return queryMany("reports.list_by_examination", () =>
    getSupabaseClient()
      .from(TABLE)
      .select("*")
      .eq("examination_id", examinationId)
      .order("updated_at", { ascending: false }),
  );
}

/** Retourne le rapport le plus récemment modifié d'un examen ; null si aucun. */
export async function getLatestReport(examinationId: string): Promise<ReportRow | null> {
  return queryMaybeOne("reports.get_latest", () =>
    getSupabaseClient()
      .from(TABLE)
      .select("*")
      .eq("examination_id", examinationId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  );
}

/**
 * Met à jour un rapport (statut du workflow draft → generated → needs_review →
 * validated, contenu édité par le praticien…) et retourne la ligne à jour.
 */
export async function updateReport(id: string, patch: ReportUpdate): Promise<ReportRow> {
  return queryOne("reports.update", () =>
    getSupabaseClient().from(TABLE).update(patch).eq("id", id).select("*").single(),
  );
}

/** Supprime un rapport. */
export async function deleteReport(id: string): Promise<boolean> {
  return queryExecuted("reports.delete", () =>
    getSupabaseClient().from(TABLE).delete().eq("id", id),
  );
}
