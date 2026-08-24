/**
 * reportTemplateRepository — CRUD `report_templates`
 * (INSTRUCTIONS.md §6/§7/§13/§15) : templates JSONB validés côté app,
 * un défaut possible par (owner, modality) via index unique partiel.
 */

import { getSupabaseClient } from "../supabaseClient";
import type {
  ReportTemplateInsert,
  ReportTemplateModality,
  ReportTemplateRow,
  ReportTemplateUpdate,
} from "../types";
import { queryMany, queryMaybeOne, queryOne } from "../repositoryUtils";

const TABLE = "report_templates" as const;

export async function createTemplate(values: ReportTemplateInsert): Promise<ReportTemplateRow> {
  return queryOne("report_templates.insert", () =>
    getSupabaseClient().from(TABLE).insert(values).select("*").single(),
  );
}

export async function getTemplate(id: string): Promise<ReportTemplateRow | null> {
  return queryMaybeOne("report_templates.get", () =>
    getSupabaseClient().from(TABLE).select("*").eq("id", id).maybeSingle(),
  );
}

/** Templates du propriétaire pour une modalité, défaut d'abord puis récents. */
export async function listTemplatesByModality(
  modality: ReportTemplateModality,
): Promise<ReportTemplateRow[]> {
  return queryMany("report_templates.list_by_modality", () =>
    getSupabaseClient()
      .from(TABLE)
      .select("*")
      .eq("modality", modality)
      .order("is_default", { ascending: false })
      .order("updated_at", { ascending: false }),
  );
}

export async function getDefaultTemplate(
  modality: ReportTemplateModality,
): Promise<ReportTemplateRow | null> {
  return queryMaybeOne("report_templates.get_default", () =>
    getSupabaseClient()
      .from(TABLE)
      .select("*")
      .eq("modality", modality)
      .eq("is_default", true)
      .maybeSingle(),
  );
}

export async function updateTemplate(
  id: string,
  patch: ReportTemplateUpdate,
): Promise<ReportTemplateRow> {
  return queryOne("report_templates.update", () =>
    getSupabaseClient().from(TABLE).update(patch).eq("id", id).select("*").single(),
  );
}

export async function deleteTemplate(id: string): Promise<boolean> {
  const { error } = await getSupabaseClient().from(TABLE).delete().eq("id", id);
  if (error !== null) throw new Error(`report_templates.delete : ${error.message}`);
  return true;
}
