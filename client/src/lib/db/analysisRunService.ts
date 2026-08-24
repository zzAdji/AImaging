/**
 * Orchestration de la persistance des ANALYSES IA — Phase Database 6.
 *
 * Choix validé §10 : **Option B** — les artefacts lourds vivent dans le bucket
 * privé `analysis-artifacts` et leur chemin est référencé dans
 * `analysis_runs.metadata.artifact` (JSONB) ; aucune table supplémentaire tant
 * que le nombre/kind d'artefacts reste simple (gradcam_png, standardized_png).
 *
 * Traçabilité (§1/§3/§22) :
 * - UN run par EXÉCUTION ; rejouer crée un nouveau run, jamais d'écrasement ;
 * - le client persiste APRÈS l'exécution serveur : les runs sont créés avec
 *   `metadata.persistance = "post-hoc"` et des horodatages réels lorsque le
 *   résultat en porte (honnêteté > lifecycle cosmétique) ;
 * - échec de persistance ⇒ markError + rejet explicite (jamais avalé) ;
 * - qualité/plane/FetalCLIP/anomaly/multimodal mockés ou absents ⇒ AUCUN run.
 */

import { isSupabaseConfigured } from "./supabaseClient";
import { emitSyncStatus, resolveExamContext } from "./examinationStore";
import {
  addClassificationResults,
  createAnalysisRun,
  markDone,
  markError,
} from "./repositories/analysisRepository";
import { getImageByLegacyId } from "./repositories/imageRepository";
import { buildArtifactPath, uploadArtifactObject } from "./storage";
import { dataUrlToBlob } from "./imageStore";
import type { Json } from "./types";

/* ------------------------------ Formes minimales ---------------------------- */

interface PredictionLike {
  num_models: number;
  per_model: Array<{ architecture: string; predicted_class: string; probabilities: Record<string, number> }>;
  ensemble_prediction: string;
  ensemble_probabilities: Record<string, number>;
}

interface GradcamLike {
  className: string;
  modelCount: number;
  heatmapDataUrl: string;
  peakRegion?: { x: number; y: number; w: number; h: number };
  generatedAt: string;
}

interface SortOutcome {
  rejected?: { reason: string };
  result?: Record<string, unknown>;
  generatedAt?: string;
}

interface StandardizeOutcome {
  width?: number;
  height?: number;
  sizeChanges?: unknown[];
  imageDataUrl?: string;
  generatedAt?: string;
}

/* ------------------------------- Utilitaires -------------------------------- */

async function resolveRunIds(
  examLegacyId: string,
  imageLegacyId: string,
): Promise<{ examinationUuid: string; imageUuid: string }> {
  const ctx = await resolveExamContext(examLegacyId);
  const image = await getImageByLegacyId(imageLegacyId);
  if (image === null) {
    throw new Error(`[db] Image non synchronisée (${imageLegacyId}) : run impossible.`);
  }
  return { examinationUuid: ctx.examinationUuid, imageUuid: image.id };
}

function wrap<T>(operation: () => Promise<T>): Promise<T> {
  emitSyncStatus("syncing");
  return operation()
    .then((value) => {
      emitSyncStatus("synced");
      return value;
    })
    .catch((exc: unknown) => {
      emitSyncStatus("error");
      throw exc;
    });
}

const nowIso = (): string => new Date().toISOString();

/* -------------- Registre de traçabilité runs ↔ image (§13) ------------------ */

/** Dernier run réussi par image, dans l'ordre chronologique d'enregistrement. */
const runIdsByImage = new Map<string, string[]>();

function noteImageRun(imageLegacyId: string, runId: string | null): void {
  if (runId === null) return;
  const list = runIdsByImage.get(imageLegacyId) ?? [];
  list.push(runId);
  runIdsByImage.set(imageLegacyId, list.slice(-20));
}

/**
 * Identifiants des analysis_runs ayant servi aux résultats courants de
 * l'image — consommés par reports.structured_data.source_analysis_runs.
 */
export function getSourceRunIds(imageLegacyId: string): string[] {
  return [...(runIdsByImage.get(imageLegacyId) ?? [])];
}

/** Réinitialise le registre (tests). */
export function __resetRunRegistryForTests(): void {
  runIdsByImage.clear();
}

/* --------------------------- Classification (§7/§8) ------------------------- */

/**
 * Persiste un run `classification` : per-model + ensemble dans
 * classification_results (aucune table séparée, §8). Retourne l'id du run.
 */
export async function persistClassificationRun(
  examLegacyId: string,
  imageLegacyId: string,
  prediction: PredictionLike,
): Promise<string | null> {
  if (!isSupabaseConfigured) return null;
  return wrap(async () => {
    const { examinationUuid, imageUuid } = await resolveRunIds(examLegacyId, imageLegacyId);
    const run = await createAnalysisRun({
      examination_id: examinationUuid,
      image_id: imageUuid,
      analysis_type: "classification",
      model_name: `ensemble(${prediction.num_models})`,
      status: "running",
      started_at: nowIso(),
      metadata: { persistance: "post-hoc" },
    });
    try {
      const rows = [
        ...prediction.per_model.flatMap((model) =>
          Object.entries(model.probabilities).map(([class_name, probability]) => ({
            analysis_run_id: run.id,
            class_name,
            probability,
            source: "per_model" as const,
            model_architecture: model.architecture,
          })),
        ),
        ...Object.entries(prediction.ensemble_probabilities).map(([class_name, probability]) => ({
          analysis_run_id: run.id,
          class_name,
          probability,
          source: "ensemble" as const,
          model_architecture: null,
        })),
      ];
      await addClassificationResults(rows);
      const done = await markDone(run.id, {
        ensemble_prediction: prediction.ensemble_prediction,
        num_models: prediction.num_models,
      });
      noteImageRun(imageLegacyId, done.id);
      return done.id;
    } catch (exc: unknown) {
      await markError(run.id, exc instanceof Error ? exc.message : String(exc));
      throw exc;
    }
  });
}

/* ------------------------------- Grad-CAM (§9) ------------------------------ */

/** Run gradcam + upload de la heatmap vers analysis-artifacts (Option B). */
export async function persistGradcamRun(
  examLegacyId: string,
  imageLegacyId: string,
  gradcam: GradcamLike,
): Promise<string | null> {
  if (!isSupabaseConfigured) return null;
  return wrap(async () => {
    const ctx = await resolveExamContext(examLegacyId);
    const image = await getImageByLegacyId(imageLegacyId);
    if (image === null) throw new Error(`[db] Image non synchronisée (${imageLegacyId}).`);
    const run = await createAnalysisRun({
      examination_id: ctx.examinationUuid,
      image_id: image.id,
      analysis_type: "gradcam",
      status: "running",
      started_at: gradcam.generatedAt || nowIso(),
      metadata: { persistance: "post-hoc" },
    });
    try {
      const blob = dataUrlToBlob(gradcam.heatmapDataUrl);
      const path = buildArtifactPath(
        ctx.userId,
        ctx.workspaceUuid,
        ctx.examinationUuid,
        image.id,
        run.id,
        "gradcam",
        "heatmap.png",
      );
      await uploadArtifactObject(path, blob, "image/png");
      const done = await markDone(run.id, {
        class_name: gradcam.className,
        model_count: gradcam.modelCount,
        peak_region: gradcam.peakRegion ?? null,
        generated_at: gradcam.generatedAt,
        artifact: { type: "gradcam_png", storage_path: path, mime_type: "image/png" },
      });
      noteImageRun(imageLegacyId, done.id);
      return done.id;
    } catch (exc: unknown) {
      await markError(run.id, exc instanceof Error ? exc.message : String(exc));
      throw exc;
    }
  });
}

/* --------------------------- OpenCXR (§13, fail-closed) --------------------- */

/**
 * Run `opencxr_sort`. Une image rejetée (REJECTED_*) produit un run
 * `rejected` — et l'appelant ne doit PAS enchaîner de classification (§13).
 */
export async function persistOpencxrSortRun(
  examLegacyId: string,
  imageLegacyId: string,
  outcome: SortOutcome,
): Promise<string | null> {
  if (!isSupabaseConfigured) return null;
  return wrap(async () => {
    const { examinationUuid, imageUuid } = await resolveRunIds(examLegacyId, imageLegacyId);
    const rejected = outcome.rejected !== undefined;
    const run = await createAnalysisRun({
      examination_id: examinationUuid,
      image_id: imageUuid,
      analysis_type: "opencxr_sort",
      status: rejected ? "rejected" : "done",
      error_message: rejected ? (outcome.rejected as { reason: string }).reason : null,
      started_at: outcome.generatedAt ?? nowIso(),
      completed_at: outcome.generatedAt ?? nowIso(),
      metadata: {
        persistance: "post-hoc",
        ...(outcome.result ?? {}),
        ...(rejected ? {} : { sort: outcome.result ?? null }),
      } as Json,
    });
    return run.id;
  });
}

/** Run `opencxr_standardize` (+ artefact PNG standardisé si fourni). */
export async function persistOpencxrStandardizeRun(
  examLegacyId: string,
  imageLegacyId: string,
  outcome: StandardizeOutcome,
): Promise<string | null> {
  if (!isSupabaseConfigured) return null;
  return wrap(async () => {
    const ctx = await resolveExamContext(examLegacyId);
    const image = await getImageByLegacyId(imageLegacyId);
    if (image === null) throw new Error(`[db] Image non synchronisée (${imageLegacyId}).`);
    const run = await createAnalysisRun({
      examination_id: ctx.examinationUuid,
      image_id: image.id,
      analysis_type: "opencxr_standardize",
      status: "running",
      started_at: outcome.generatedAt || nowIso(),
      metadata: { persistance: "post-hoc" },
    });
    try {
      let artifact: Json | null = null;
      if (outcome.imageDataUrl) {
        const blob = dataUrlToBlob(outcome.imageDataUrl);
        const path = buildArtifactPath(
          ctx.userId,
          ctx.workspaceUuid,
          ctx.examinationUuid,
          image.id,
          run.id,
          "standardized",
          "standardized.png",
        );
        await uploadArtifactObject(path, blob, "image/png");
        artifact = { type: "standardized_png", storage_path: path, mime_type: "image/png" };
      }
      const done = await markDone(run.id, {
        width: outcome.width ?? null,
        height: outcome.height ?? null,
        size_changes: (outcome.sizeChanges ?? []) as Json,
        generated_at: outcome.generatedAt ?? null,
        artifact,
      });
      noteImageRun(imageLegacyId, done.id);
      return done.id;
    } catch (exc: unknown) {
      await markError(run.id, exc instanceof Error ? exc.message : String(exc));
      throw exc;
    }
  });
}

/* ------------------------- CXAS / HybridGNet (§11/§12) ---------------------- */

/**
 * Run `cxas` ou `hybridgnet` créé après une exécution réelle du modèle.
 * Retourne l'id pour rattacher `measurements.analysis_run_id` (Phase 5 reliquat).
 * Le masque CXAS n'existe pas comme fichier côté client (payload dict) :
 * seul un résumé est conservé dans metadata — documenté (§21).
 */
export async function persistAnatomyRun(
  kind: "cxas" | "hybridgnet",
  examLegacyId: string,
  imageLegacyId: string,
  summary: Record<string, unknown>,
): Promise<string | null> {
  if (!isSupabaseConfigured) return null;
  return wrap(async () => {
    const { examinationUuid, imageUuid } = await resolveRunIds(examLegacyId, imageLegacyId);
    const run = await createAnalysisRun({
      examination_id: examinationUuid,
      image_id: imageUuid,
      analysis_type: kind,
      model_name: kind === "hybridgnet" ? "HybridGNet" : "CXAS",
      status: "done",
      completed_at: nowIso(),
      metadata: { persistance: "post-hoc", ...summary } as Json,
    });
    noteImageRun(imageLegacyId, run.id);
    return run.id;
  });
}

