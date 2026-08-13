import type { ExamImage, GradCamResult } from "./examinations";
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
  source: "prediction" | "visual" | "gradcam" | "metadata" | "annotation" | "measurement" | "analysis";
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

/** Runs one free-form IA turn. Its answer stays useful even when actions are empty. */
export function runWorkspaceAgentTurn(
  workspaceId: string,
  instruction: string,
  predictions: Record<string, RadiographyPrediction>,
  visualContext: WorkspaceVisualContext,
): Promise<WorkspaceAgentTurnResponse> {
  return request<WorkspaceAgentTurnResponse>(`/workspace/exams/${workspaceId}/ai/turn`, {
    method: "POST",
    body: JSON.stringify({ instruction, predictions, visual_context: visualContext }),
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
