import type { ExamImage, GradCamResult, ThreeDResult } from "./examinations";
import type { ActionValidationResult, AiActionPlan, WorkspaceManifest, WorkspaceSession } from "./workspaceProtocol";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

async function request<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`API ${response.status}: ${body || response.statusText}`);
  }
  return response.json() as Promise<T>;
}

export function createWorkspaceExam(manifest: WorkspaceManifest): Promise<WorkspaceSession> {
  return request<WorkspaceSession>("/workspace/exams", { method: "POST", body: JSON.stringify(manifest) });
}

export function syncWorkspaceExam(workspaceId: string, manifest: WorkspaceManifest): Promise<WorkspaceSession> {
  return request<WorkspaceSession>(`/workspace/exams/${workspaceId}`, {
    method: "PUT",
    body: JSON.stringify(manifest),
  });
}

export function validateActionPlan(workspaceId: string, plan: AiActionPlan): Promise<ActionValidationResult> {
  return request<ActionValidationResult>(`/workspace/exams/${workspaceId}/actions/validate`, {
    method: "POST",
    body: JSON.stringify(plan),
  });
}

export interface ParsedExplicitCommand {
  command: string;
  plan: AiActionPlan;
}

export function parseExplicitCommand(workspaceId: string, text: string): Promise<ParsedExplicitCommand> {
  return request<ParsedExplicitCommand>(`/workspace/exams/${workspaceId}/commands/parse`, {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

export interface WorkspacePlanResponse {
  validation: ActionValidationResult;
}

/** Delegates a free-form instruction to Gemini; the server validates its action plan. */
export async function planWorkspaceInstruction(workspaceId: string, instruction: string): Promise<AiActionPlan> {
  const response = await request<WorkspacePlanResponse>(`/workspace/exams/${workspaceId}/ai/plan`, {
    method: "POST",
    body: JSON.stringify({ instruction }),
  });
  if (!response.validation.accepted) {
    throw new Error(response.validation.errors.join(" ") || "Plan IA refusé par le serveur.");
  }
  return response.validation.plan;
}

export type AgentIntent =
  | "explain_prediction" | "explain_visual" | "canvas_edit" | "analysis_request"
  | "report_request" | "comparison_request" | "mixed" | "clarification" | "warning";

export type VisualContextNeed = "none" | "active_image" | "target_images" | "all_exam_images";

export interface WorkspaceAgentEvidence {
  source: "prediction" | "visual" | "gradcam" | "metadata" | "annotation" | "measurement" | "analysis" | "anatomy";
  image_id: string | null;
  detail: string;
}

export interface WorkspaceAgentTurnResponse {
  intent: AgentIntent;
  assistant_message: string;
  evidence: WorkspaceAgentEvidence[];
  limitations: string[];
  needs_visual_context: VisualContextNeed;
  target_visual_image_ids: string[];
  warnings: string[];
  clarifying_question: string | null;
  validation: ActionValidationResult;
}

export interface WorkspaceVisualContext {
  available: boolean;
  image_ids: string[];
}

/** Contexte CXAS compact envoyé à l'agent : mesures + structures, jamais les masques. */
export interface WorkspaceAnatomyContext {
  status: "ok" | "error";
  error: string | null;
  measurements: Record<string, AnatomyMeasurementValue>;
  labels: Record<string, string>;
  areas_px: Record<string, number>;
  mask_shape: [number, number] | null;
  file_size: [number, number] | null;
  mask_downscaled: boolean;
  generated_at: string;
}

/** Construit le contexte agent depuis un résultat d'analyse CXAS du serveur. */
export function toAnatomyContext(result: WorkspaceAnatomyResult): WorkspaceAnatomyContext {
  return {
    status: result.status,
    error: result.error,
    measurements: result.measurements,
    labels: result.segmentation.labels,
    areas_px: result.segmentation.areas_px,
    mask_shape: result.segmentation.mask_shape,
    file_size: result.segmentation.file_size,
    mask_downscaled: result.segmentation.mask_downscaled,
    generated_at: result.generated_at,
  };
}

/** Runs one free-form IA turn. Its answer stays useful even when actions are empty. */
export function runWorkspaceAgentTurn(
  workspaceId: string,
  instruction: string,
  predictions: Record<string, RadiographyPrediction>,
  visualContext: WorkspaceVisualContext,
  anatomy: Record<string, WorkspaceAnatomyContext> = {},
): Promise<WorkspaceAgentTurnResponse> {
  return request<WorkspaceAgentTurnResponse>(`/workspace/exams/${workspaceId}/ai/turn`, {
    method: "POST",
    body: JSON.stringify({ instruction, predictions, visual_context: visualContext, anatomy }),
  });
}

export interface RadiographyPrediction {
  image: string | null;
  num_models: number;
  per_model: Array<{
    architecture: string;
    predicted_class: string;
    probabilities: Record<string, number>;
  }>;
  ensemble_prediction: string;
  ensemble_probabilities: Record<string, number>;
}

export interface WorkspaceAnalysisResponse {
  workspace_id: string;
  results: Array<{ image_id: string; prediction: RadiographyPrediction }>;
  warnings: string[];
}

interface WorkspaceGradcamResponseWire {
  workspace_id: string;
  image_id: string;
  class_name: string;
  model_count: number;
  heatmap_data_url: string;
  peak_region: { x: number; y: number; w: number; h: number } | null;
  generated_at: string;
  per_model: Array<{ architecture: string; class_name: string; class_index: number }>;
}

export interface WorkspaceGradcamResponse {
  workspaceId: string;
  imageId: string;
  result: GradCamResult;
}

interface WorkspaceThreeDResponseWire {
  workspace_id: string;
  image_id: string;
  frames: Array<{ angle: number; data_url: string }>;
  volume?: { nx: number; ny: number; nz: number; spacing: number; data_b64: string };
  loss_history: number[];
  device: string;
  elapsed_sec: number;
  generated_at: string;
}

export interface WorkspaceThreeDResponse {
  workspaceId: string;
  imageId: string;
  result: ThreeDResult;
}

export interface PatientReportContext {
  nom_prenom: string;
  prescripteur?: string;
  date_examen?: string;
}

export interface RadiographyReportResponse {
  report: Record<string, string>;
  coherence_passed: boolean;
  coherence_issues: string[];
  rendered_text: string;
}

/** Generates the clinical report from an already obtained ensemble prediction. */
export function generateRadiographyReport(
  prediction: RadiographyPrediction,
  patient: PatientReportContext = { nom_prenom: "Patient non renseigné" },
): Promise<RadiographyReportResponse> {
  return request<RadiographyReportResponse>("/radiography/report", {
    method: "POST",
    body: JSON.stringify({ prediction, patient }),
  });
}

async function imageToBlob(image: ExamImage): Promise<Blob> {
  const response = await fetch(image.src);
  if (!response.ok) throw new Error(`Impossible de lire l'image '${image.name}'.`);
  return response.blob();
}

/** Generates a real ensemble Grad-CAM and maps its fields to the client model. */
export async function generateWorkspaceGradcam(
  workspaceId: string,
  image: ExamImage,
  className?: string,
): Promise<WorkspaceGradcamResponse> {
  const body = new FormData();
  body.append("image_id", image.id);
  body.append("image", await imageToBlob(image), image.name || `${image.id}.png`);
  if (className) body.append("class_name", className);
  const response = await fetch(`${API_BASE_URL}/workspace/exams/${workspaceId}/gradcam`, { method: "POST", body });
  if (!response.ok) throw new Error(`API ${response.status}: ${await response.text() || response.statusText}`);
  const raw = await response.json() as WorkspaceGradcamResponseWire;
  return {
    workspaceId: raw.workspace_id,
    imageId: raw.image_id,
    result: {
      className: raw.class_name,
      modelCount: raw.model_count,
      heatmapDataUrl: raw.heatmap_data_url,
      peakRegion: raw.peak_region ?? undefined,
      generatedAt: raw.generated_at,
      perModel: raw.per_model.map((model) => ({
        architecture: model.architecture,
        className: model.class_name,
        classIndex: model.class_index,
      })),
    },
  };
}

interface WorkspaceThreeDJobWire {
  workspace_id: string;
  image_id: string;
  job_id: string;
  status: "queued" | "running" | "done" | "error";
  progress: { fraction: number; message: string };
  error?: string | null;
}

interface WorkspaceThreeDStatusWire extends WorkspaceThreeDJobWire {
  result?: WorkspaceThreeDResponseWire | null;
}

export interface WorkspaceThreeDProgress {
  fraction: number;
  message: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** Starts a DeepScan3D reconstruction job (returns immediately with a job id). */
export async function startWorkspaceThreeD(
  workspaceId: string,
  image: ExamImage,
  iterations?: number,
): Promise<{ workspaceId: string; imageId: string; jobId: string }> {
  const body = new FormData();
  body.append("image_id", image.id);
  body.append("image", await imageToBlob(image), image.name || `${image.id}.png`);
  if (iterations !== undefined) body.append("iterations", String(iterations));
  const response = await fetch(`${API_BASE_URL}/workspace/exams/${workspaceId}/3d`, { method: "POST", body });
  if (!response.ok) throw new Error(`API ${response.status}: ${await response.text() || response.statusText}`);
  const raw = await response.json() as WorkspaceThreeDJobWire;
  return { workspaceId: raw.workspace_id, imageId: raw.image_id, jobId: raw.job_id };
}

/** Polls a reconstruction job; returns the raw wire payload. */
export async function pollWorkspaceThreeD(
  workspaceId: string,
  jobId: string,
): Promise<WorkspaceThreeDStatusWire> {
  const response = await fetch(`${API_BASE_URL}/workspace/exams/${workspaceId}/3d/jobs/${jobId}`);
  if (!response.ok) throw new Error(`API ${response.status}: ${await response.text() || response.statusText}`);
  return response.json() as Promise<WorkspaceThreeDStatusWire>;
}

/**
 * Reconstructs the DeepScan3D volume of a radiograph as a background job and
 * waits for completion, reporting progress through `onProgress`.
 */
export async function generateWorkspaceThreeD(
  workspaceId: string,
  image: ExamImage,
  iterations?: number,
  onProgress?: (progress: WorkspaceThreeDProgress) => void,
): Promise<WorkspaceThreeDResponse> {
  const started = await startWorkspaceThreeD(workspaceId, image, iterations);
  for (;;) {
    await sleep(2500);
    const status = await pollWorkspaceThreeD(workspaceId, started.jobId);
    onProgress?.(status.progress);
    if (status.status === "done" && status.result) {
      const raw = status.result;
      return {
        workspaceId: raw.workspace_id,
        imageId: raw.image_id,
        result: {
          frames: raw.frames,
          volume: raw.volume,
          device: raw.device,
          elapsedSec: raw.elapsed_sec,
          generatedAt: raw.generated_at,
        },
      };
    }
    if (status.status === "error") {
      throw new Error(status.error || "La reconstruction 3D a échoué côté serveur.");
    }
  }
}

export interface WorkspaceThreeDBackend {
  mode: "local" | "remote";
  remote_url: string | null;
  reachable: boolean | null;
  backend: { status?: string; cuda?: boolean; gpu?: string | null; device?: string } | null;
}

/** Current 3D backend (local CPU or remote GPU service) + liveness probe. */
export function getWorkspaceThreeDBackend(): Promise<WorkspaceThreeDBackend> {
  return request<WorkspaceThreeDBackend>("/workspace/3d/backend", { method: "GET" });
}

/** Switches the 3D backend at runtime ('' = local CPU); returns refreshed info. */
export function updateWorkspaceThreeDBackend(remoteUrl: string): Promise<WorkspaceThreeDBackend> {
  return request<WorkspaceThreeDBackend>("/workspace/3d/backend", {
    method: "PUT",
    body: JSON.stringify({ remote_url: remoteUrl }),
  });
}

/** Uploads original image bytes; canvas captures and metadata stay in the JSON manifest. */
export async function analyzeWorkspaceImages(workspaceId: string, images: ExamImage[]): Promise<WorkspaceAnalysisResponse> {
  const body = new FormData();
  for (const image of images) {
    body.append("image_ids", image.id);
    body.append("images", await imageToBlob(image), image.name || `${image.id}.png`);
  }
  const response = await fetch(`${API_BASE_URL}/workspace/exams/${workspaceId}/analyze`, { method: "POST", body });
  if (!response.ok) throw new Error(`API ${response.status}: ${await response.text() || response.statusText}`);
  return response.json() as Promise<WorkspaceAnalysisResponse>;
}

/* --------------------------- Anatomie (CXAS) ------------------------------ */

/* --------------------------- Anatomie CXAS --------------------------- */

export interface AnatomyMeasurementValue {
  available: boolean;
  reason?: string;
  value?: number;
  value_px_512?: number;
  value_px_original?: number;
  value_mm?: number | null;
  unit?: "ratio" | "px" | "mm";
  note?: string;
}

export interface WorkspaceAnatomyResult {
  status: "ok" | "error";
  error: string | null;
  measurements: Record<string, AnatomyMeasurementValue>;
  segmentation: {
    labels: Record<string, string>;
    label_ids_available: number[];
    file_size: [number, number];
    mask_shape: [number, number];
    areas_px: Record<string, number>;
    mask_downscaled: boolean;
    /** Masque PNG (data URL) par label, résolution mask_shape. */
    masks_b64_png: Record<string, string>;
    /** Overlay composite serveur (data URL PNG) : structures clés teintées
     *  en couleurs officielles sur l'image, en pleine résolution. */
    overlay_png?: string;
  };
  warnings: string[];
  inference_time_ms: number | null;
  generated_at: string;
}

interface WorkspaceAnatomyWire {
  workspace_id: string;
  image_id: string;
  status: "ok" | "error";
  error: string | null;
  measurements: WorkspaceAnatomyResult["measurements"];
  segmentation: WorkspaceAnatomyResult["segmentation"];
  warnings: string[];
  inference_time_ms: number | null;
  generated_at: string;
}

export interface WorkspaceAnatomyResponse {
  workspaceId: string;
  imageId: string;
  result: WorkspaceAnatomyResult;
}

/** Segmente une image (CXAS, 159 classes PAXRay) et mesure CTR/SCD. */
export async function generateWorkspaceAnatomy(
  workspaceId: string,
  image: ExamImage,
): Promise<WorkspaceAnatomyResponse> {
  const body = new FormData();
  body.append("image_id", image.id);
  body.append("image", await imageToBlob(image), image.name || `${image.id}.png`);
  if (image.metadata?.pixelSpacingMm) {
    body.append("pixel_spacing_mm", image.metadata.pixelSpacingMm.join(","));
  }
  const response = await fetch(`${API_BASE_URL}/workspace/exams/${workspaceId}/anatomy`, { method: "POST", body });
  if (!response.ok) throw new Error(`API ${response.status}: ${await response.text() || response.statusText}`);
  const raw = await response.json() as WorkspaceAnatomyWire;
  return { workspaceId: raw.workspace_id, imageId: raw.image_id, result: raw };
}
