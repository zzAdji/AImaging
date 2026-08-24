/**
 * Service de persistance des RAPPORTS — Phase Database 7 (SUITE.md).
 *
 * - types : `radiography_ai` | `fetal_obstetric` uniquement (§4) ;
 * - statuts SQL : draft/generated/needs_review/validated — un rapport IA est
 *   TOUJOURS créé en `needs_review`, jamais `validated` automatiquement (§5/§18) ;
 * - génération IA = NOUVEAU report ; édition = update du report courant (§10) ;
 * - une édition d'un rapport validé le repasse en `needs_review` ;
 * - structured_data conserve les données réellement utilisées + la
 *   traçabilité `source_analysis_runs` (§7/§13) ;
 * - fallback Gemini déjà conforme : aucun rapport inventé côté appelant.
 */

import { isSupabaseConfigured } from "./supabaseClient";
import { emitSyncStatus, resolveExamContext } from "./examinationStore";
import {
  createReport,
  getLatestReport,
  updateReport,
} from "./repositories/reportRepository";
import { getSourceRunIds } from "./analysisRunService";
import type { Json, ReportRow } from "./types";

export type ReportType = "radiography_ai" | "fetal_obstetric";
export type ReportStatus = "draft" | "generated" | "needs_review" | "validated";

/* --------------------------- Radio (§6/§7/§11/§13) -------------------------- */

export interface RadioReportInput {
  /** Champs structurés renvoyés par /radiography/report (RadiologyReportFields). */
  fields: Record<string, string>;
  coherencePassed: boolean;
  coherenceIssues: string[];
  renderedText: string;
  ensemblePrediction?: string | null;
  numModels?: number | null;
}

/**
 * Crée un NOUVEAU report `radiography_ai` après génération Gemini réussie.
 * Statut imposé : needs_review. Traçabilité des runs via source_analysis_runs.
 */
export async function persistGeneratedRadioReport(
  examLegacyId: string,
  imageLegacyIds: string[],
  input: RadioReportInput,
): Promise<ReportRow | null> {
  if (!isSupabaseConfigured) return null;
  emitSyncStatus("syncing");
  try {
    const ctx = await resolveExamContext(examLegacyId);
    const sourceRuns = imageLegacyIds.flatMap((imageId) => getSourceRunIds(imageId));
    const structuredData: Record<string, Json> = {
      diagnosis: {
        class: input.ensemblePrediction ?? null,
        confidence: null,
      },
      models: {
        count: input.numModels ?? null,
        ensemble: true,
      },
      findings: input.fields as Json,
      limitations: input.coherenceIssues,
      coherence_passed: input.coherencePassed,
      source_analysis_runs: [...new Set(sourceRuns)],
    };
    const row = await createReport({
      examination_id: ctx.examinationUuid,
      type: "radiography_ai",
      status: "needs_review",
      content: input.renderedText,
      structured_data: structuredData,
      created_by: "ai",
    });
    emitSyncStatus("synced");
    return row;
  } catch (exc: unknown) {
    emitSyncStatus("error");
    throw exc;
  }
}

/** Met à jour le contenu édité ; un rapport validé repasse en needs_review. */
export async function persistReportEdit(
  reportId: string,
  content: string,
  currentStatus: ReportStatus,
): Promise<void> {
  if (!isSupabaseConfigured) return;
  emitSyncStatus("syncing");
  try {
    await updateReport(reportId, {
      content,
      ...(currentStatus === "validated" ? { status: "needs_review" } : {}),
    });
    emitSyncStatus("synced");
  } catch (exc: unknown) {
    emitSyncStatus("error");
    throw exc;
  }
}

/** Validation explicite du professionnel (§18) — jamais automatique. */
export async function validateReportById(reportId: string): Promise<void> {
  if (!isSupabaseConfigured) return;
  emitSyncStatus("syncing");
  try {
    await updateReport(reportId, { status: "validated" });
    emitSyncStatus("synced");
  } catch (exc: unknown) {
    emitSyncStatus("error");
    throw exc;
  }
}

/** Charge le dernier rapport de l'examen ; null si aucun / hors configuration. */
export async function loadLatestRadioReport(examLegacyId: string): Promise<ReportRow | null> {
  if (!isSupabaseConfigured) return null;
  const ctx = await resolveExamContext(examLegacyId);
  return getLatestReport(ctx.examinationUuid);
}

/* ------------------- Fœtal : mapping pur (§8/§17/§21) ----------------------- */

import type { FetalExam } from "../fetal/types";

export interface FetalStructuredDraft {
  sections: Record<string, { title: string; content: string; edited?: boolean }>;
  fetuses: Array<{ fetus_id: string; biometry: Record<string, { value: number | null; unit: "mm"; provenance: "mock" | "model" | "user"; measurement_local: true }> }>;
  placenta: FetalExam["placenta"];
  amniotic_fluid: FetalExam["amnioticFluid"];
  cervix: FetalExam["cervix"];
  findings: FetalExam["findings"];
  /** true ⇒ données de démonstration : ne doit JAMAIS devenir un rapport médical définitif (§8). */
  mock_data: boolean;
}

/**
 * Mapping pur `FetalExam → structured_data` (contrat DB READY).
 * Le provider actuel étant mocké, ce draft n'est PAS persisté automatiquement :
 * le mode UI de démonstration reste local (§17).
 */
export function mapFetalExamToStructuredData(exam: FetalExam): FetalStructuredDraft {
  const hasMock = exam.fetuses.some((f) => f.measurements.some((m) => m.source.kind === "mock"));
  return {
    sections: exam.report?.sections ?? {},
    fetuses: exam.fetuses.map((fetus) => ({
      fetus_id: fetus.id,
      biometry: Object.fromEntries(
        fetus.measurements.map((m) => [
          m.key.toUpperCase(),
          {
            value: m.valueMm,
            unit: "mm" as const,
            provenance: m.source.kind,
            measurement_local: true,
          },
        ]),
      ),
    })),
    placenta: exam.placenta,
    amniotic_fluid: exam.amnioticFluid,
    cervix: exam.cervix,
    findings: exam.findings,
    mock_data: hasMock || exam.anomaly.status === "not_implemented",
  };
}

/* ---------------------- Export JSON Storage (§16/§22) ----------------------- */

import { buildReportExportPath, uploadReportObject } from "./storage";

/**
 * Upload l'export JSON structuré d'un rapport vers reports/{...}/exports/.
 * L'export disque existant (downloadJson) reste inchangé.
 */
export async function uploadReportJsonExport(
  examLegacyId: string,
  report: Pick<ReportRow, "id" | "structured_data">,
): Promise<string | null> {
  if (!isSupabaseConfigured) return null;
  const ctx = await resolveExamContext(examLegacyId);
  const path = buildReportExportPath(ctx.userId, ctx.workspaceUuid, ctx.examinationUuid, report.id, "report.json");
  const blob = new Blob([JSON.stringify(report.structured_data ?? {}, null, 2)], { type: "application/json" });
  await uploadReportObject(path, blob, "application/json");
  await updateReport(report.id, { storage_path: path });
  return path;
}