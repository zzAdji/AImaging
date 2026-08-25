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

/**
 * Transcrit un enregistrement vocal via Gemini (endpoint serveur).
 * Privilégie le multipart/form-data : pas d'en-tête JSON qui casserait le FormData.
 */
export async function transcribeAudio(blob: Blob, language = "fr"): Promise<string> {
  const form = new FormData();
  form.append("file", blob, "voice.webm");
  form.append("language", language);
  const response = await fetch(`${API_BASE_URL}/voice/transcribe`, { method: "POST", body: form });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`API ${response.status}: ${body || response.statusText}`);
  }
  const data = (await response.json()) as { text?: string };
  const text = (data.text ?? "").trim();
  if (!text) throw new Error("Transcription vide.");
  return text;
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

/* ----------------------- Anatomie unifiée (CXAS + HybridGNet) ----------------------- */

/**
 * Résultat d'un moteur anatomique (``source=CXAS`` ou ``source=HybridGNet``).
 * Les deux moteurs ne sont jamais fusionnés mathématiquement : chaque bloc
 * reste traçable avec son statut, son erreur et son payload.
 */
export interface AnatomyAnalysisSourcePayload {
  source: "CXAS" | "HybridGNet";
  status: string; // ok | error
  error: string | null;
  inference_time_ms: number | null;
  payload: {
    segmentation?: WorkspaceAnatomyResult["segmentation"];
    measurements?: Record<string, AnatomyMeasurementValue> | WorkspaceLandmarksResult["measurements"];
    warnings?: string[];
    contours?: WorkspaceLandmarksResult["contours"];
    custom?: LandmarkCustomMeasure[];
    uncertainty?: { max_node_std_px: number; mean_node_std_px: number };
    scale_used?: "mm" | "pixels";
    ctr_method?: string;
    lines?: LandmarkLine[];
  };
}

export interface WorkspaceAnatomyAnalysisResponse {
  workspace_id: string;
  image_id: string;
  status: string; // ok | partial | error
  sources: string[];
  cxas: AnatomyAnalysisSourcePayload | null;
  hybridgnet: AnatomyAnalysisSourcePayload | null;
  warnings: string[];
  inference_time_ms: number | null;
  generated_at: string;
}

/**
 * Analyse anatomique unifiée : segmentation CXAS + landmarks HybridGNet en une
 * seule requête. Les résultats restent séparés par source (``cxas`` /
 * ``hybridgnet``) pour que le client puisse les afficher distinctement.
 */
export async function generateWorkspaceAnatomyAnalysis(
  workspaceId: string,
  image: ExamImage,
): Promise<WorkspaceAnatomyAnalysisResponse> {
  const body = new FormData();
  body.append("image_id", image.id);
  body.append("image", await imageToBlob(image), image.name || `${image.id}.png`);
  if (image.metadata?.pixelSpacingMm) {
    body.append("pixel_spacing_mm", image.metadata.pixelSpacingMm.join(","));
  }
  const response = await fetch(`${API_BASE_URL}/workspace/exams/${workspaceId}/anatomy-analysis`, { method: "POST", body });
  if (!response.ok) throw new Error(`API ${response.status}: ${await response.text() || response.statusText}`);
  return response.json() as Promise<WorkspaceAnatomyAnalysisResponse>;
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

export interface AnatomyRegionPayload {
  id: string;
  label: string;
  structures: string[];
  reference: string;
}

export interface WorkspaceAnatomyRegionsRequest {
  image_id: string;
  canvas_data_url?: string | null;
  anatomy: WorkspaceAnatomyContext;
  regions: AnatomyRegionPayload[];
}

export interface WorkspaceAnatomyRegionsResponse {
  region_texts: Record<string, string>;
  /** Statut anomalie par région : true = écart signalé par l'IA. */
  region_anomalies?: Record<string, boolean>;
}

/* --------------------- Pathologies (backend « Neuro ») --------------------- */

/** Prédiction par classe NIH (probabilité + dépassement du seuil). */
export interface PathologyPrediction {
  prob: number;
  positive: boolean;
}

/* Palette stable par classe de pathologie (boxes canvas + cartes). */
const PATHOLOGY_PALETTE = ["#f87171", "#f97316", "#eab308", "#38bdf8", "#a78bfa", "#34d399", "#f472b6"];

/** Couleur déterministe d'une classe de pathologie (hash du libellé). */
export function pathologyColorFor(label: string): string {
  let hash = 0;
  for (let i = 0; i < label.length; i++) hash = (hash * 31 + label.charCodeAt(i)) >>> 0;
  return PATHOLOGY_PALETTE[hash % PATHOLOGY_PALETTE.length];
}

export interface PathologyConfirmedFinding {
  condition: string;
  prob: number;
  threshold: number;
  normalized_conf: number;
  risk: string;
}

export interface PathologyYoloBox {
  class: string;
  conf: number;
  xyxy: [number, number, number, number];
}

export interface PathologyResultImages {
  original_b64?: string;
  heatmap_b64?: string;
  boxes_b64?: string;
  /** Heatmap Grad-CAM individuelle par pathologie positive (base64). */
  individual_heatmaps: Record<string, string>;
}

/** Réponse unifiée du pipeline Neuro (DenseNet Grad-CAM + YOLOv8). */
export interface PathologyResult {
  status: string;
  predictions: Record<string, PathologyPrediction>;
  positive_conditions: string[];
  confirmed_findings: PathologyConfirmedFinding[];
  risk_level: string;
  localization_type: Record<string, string>;
  images: PathologyResultImages;
  yolo_boxes: PathologyYoloBox[];
  case_flags: string[];
}

export interface WorkspacePathologyResponse {
  workspace_id: string;
  image_id: string;
  result: PathologyResult;
  inference_time_ms?: number | null;
}

/** Détection de pathologies + heatmaps via le backend Neuro distant. */
export async function generateWorkspacePathology(
  workspaceId: string,
  imageId: string,
  image: ExamImage,
): Promise<WorkspacePathologyResponse> {
  const body = new FormData();
  body.append("image_id", imageId);
  body.append("image", await imageToBlob(image), image.name || `${image.id}.png`);
  const response = await fetch(`${API_BASE_URL}/workspace/exams/${workspaceId}/pathology/detect`, {
    method: "POST",
    body,
  });
  if (!response.ok) {
    /* Le serveur renvoie {"detail": "..."} : afficher le détail lisible
       (ex. « Backend Neuro endormi… ») plutôt que le JSON brut. */
    let message = "";
    try {
      const payload = (await response.json()) as { detail?: string };
      message = payload.detail ?? "";
    } catch {
      message = await response.text().catch(() => "");
    }
    throw new Error(message || `API ${response.status}: requête échouée`);
  }
  return (await response.json()) as WorkspacePathologyResponse;
}

/** Génère l'interprétation IA par région anatomique d'après l'image annotée et les données CXAS. */
export function generateWorkspaceAnatomyRegions(
  workspaceId: string,
  imageId: string,
  canvasDataUrl: string | null,
  anatomy: WorkspaceAnatomyContext,
  regions: AnatomyRegionPayload[],
): Promise<WorkspaceAnatomyRegionsResponse> {
  return request<WorkspaceAnatomyRegionsResponse>(`/workspace/exams/${workspaceId}/anatomy/regions`, {
    method: "POST",
    body: JSON.stringify({
      image_id: imageId,
      canvas_data_url: canvasDataUrl,
      anatomy,
      regions,
    }),
  });
}

/* --------------------------- Landmarks (HybridGNet) --------------------------- */

export interface LandmarkMeasurement {
  value: number;
  std: number;
  unit: "ratio" | "mm" | "px" | "mm²" | "px²";
}

export interface LandmarkContour {
  x: number[];
  y: number[];
  /** Incertitude moyenne par nœud (px, grille 1024). */
  std: number[];
}

export interface LandmarkCustomMeasure {
  label: string;
  value: number;
  std: number;
  unit: string;
}

/** Segment de mesure à poser sur l'image (grille 1024 du modèle). */
export interface LandmarkLine {
  key: string;
  label: string;
  value: number;
  unit: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface WorkspaceLandmarksResult {
  status: "ok" | "error";
  error: string | null;
  contours: {
    right_lung: LandmarkContour;
    left_lung: LandmarkContour;
    heart: LandmarkContour;
  };
  measurements: {
    ctr: LandmarkMeasurement;
    heart_transverse_diameter: LandmarkMeasurement;
    thorax_transverse_diameter: LandmarkMeasurement;
    right_lung_surface: LandmarkMeasurement;
    left_lung_surface: LandmarkMeasurement;
    heart_surface: LandmarkMeasurement;
  };
  custom: LandmarkCustomMeasure[];
  warnings: string[];
  uncertainty: { max_node_std_px: number; mean_node_std_px: number };
  scale_used: "mm" | "pixels";
  ctr_method: string;
  /** Segments (diamètres…) posables sur le canvas, en coordonnées de grille 1024. */
  lines: LandmarkLine[];
  inference_time_ms: number | null;
  generated_at: string;
}

export interface WorkspaceLandmarksResponse {
  workspaceId: string;
  imageId: string;
  result: WorkspaceLandmarksResult;
}

interface WorkspaceLandmarksWire {
  workspace_id: string;
  image_id: string;
  status: "ok" | "error";
  error: string | null;
  contours: WorkspaceLandmarksResult["contours"];
  measurements: WorkspaceLandmarksResult["measurements"];
  custom: LandmarkCustomMeasure[];
  warnings: string[];
  uncertainty: { max_node_std_px: number; mean_node_std_px: number };
  scale_used: "mm" | "pixels";
  ctr_method: string;
  lines: LandmarkLine[];
  inference_time_ms: number | null;
  generated_at: string;
}

/** Traque les contours poumons + cœur (HybridGNet) et mesure CTR/diamètres/surfaces. */
export async function generateWorkspaceLandmarks(
  workspaceId: string,
  image: ExamImage,
  options?: { customMeasures?: Array<{ label: string; a: number; b: number } | { label: string; nodes: number[] }> },
): Promise<WorkspaceLandmarksResponse> {
  const body = new FormData();
  body.append("image_id", image.id);
  body.append("image", await imageToBlob(image), image.name || `${image.id}.png`);
  if (image.metadata?.pixelSpacingMm) {
    body.append("pixel_spacing_mm", image.metadata.pixelSpacingMm.join(","));
  }
  if (options?.customMeasures) {
    body.append("custom_measures", JSON.stringify(options.customMeasures));
  }
  const response = await fetch(`${API_BASE_URL}/workspace/exams/${workspaceId}/landmarks`, { method: "POST", body });
  if (!response.ok) throw new Error(`API ${response.status}: ${await response.text() || response.statusText}`);
  const raw = await response.json() as WorkspaceLandmarksWire;
  return { workspaceId: raw.workspace_id, imageId: raw.image_id, result: raw };
}

/* --------------------------- OpenCXR (tri + normalisation) --------------------------- */

/** Statuts fail-closed du tri CXR (contrat opencxr). */
export type CxrSortStatus = "ACCEPTED_CXR" | "REJECTED_NON_CXR" | "REJECTED_INVALID_IMAGE";

/** Classifications de l'Image Sorter opencxr pour une radio. */
export interface OpenCxrSortResult {
  Type: "PA" | "AP" | "lateral" | "notCXR";
  Rotation: "0" | "90" | "180" | "270";
  Inversion: "No" | "Yes";
  Lateral_Flip: "No" | "Yes";
  Type_Probs_PA_AP_lateral_notCXR: number[];
  Rotation_Probs_0_90_180_270: number[];
  Inversion_Probs_No_Yes: number[];
  Lateral_Flip_Probs_No_Yes: number[];
  inference_time_ms: number;
  /** Statut fail-closed du tri (Phase 3). */
  status: CxrSortStatus;
  /** true si l'image est considérée comme une radiographie thoracique. */
  is_cxr: boolean;
  /** Confiance CXR (1 - probabilité notCXR), si disponible. */
  confidence?: number | null;
  /** Raison de rejet (ex. low_cxr_probability, decode_failed). */
  reason?: string;
  /** Canal de décodage utilisé : simpleitk | pillow_fallback | decode_failed. */
  decoder?: string;
}

/** Image standardisée par opencxr (intensités normalisées, crop poumons, resize carré). */
export interface OpenCxrStandardizeResult {
  image_data_url: string;
  width: number;
  height: number;
  /** Opérations appliquées par opencxr (crop/resize/pad), ex. [["sc_crop_with_params", ...], ...]. */
  size_changes: unknown[];
  inference_time_ms: number;
}

/** Rejet d'une image par le tri opencxr (non-CXR ou invalide) : standardisation
 *  non lancée, aucune analyse médicale. */
export interface OpenCxrRejection {
  /** Statut fail-closed du tri : REJECTED_NON_CXR | REJECTED_INVALID_IMAGE. */
  status: CxrSortStatus;
  reason: string;
  at: number;
  /** Canal de décodage utilisé (simpleitk | pillow_fallback | decode_failed). */
  decoder?: string;
}

/** Résultats opencxr cumulés d'une image (tri + normalisation) ; standardize est absent si l'image a été rejetée. */
export interface OpenCxrImageResult {
  sort: OpenCxrSortResult;
  standardize: OpenCxrStandardizeResult | null;
  rejected?: OpenCxrRejection;
}

interface OpenCxrSortWire {
  workspace_id: string;
  image_id: string;
  result: OpenCxrSortResult;
  generated_at: string;
}

interface OpenCxrStandardizeWire {
  workspace_id: string;
  image_id: string;
  image_data_url: string;
  width: number;
  height: number;
  size_changes: unknown[];
  inference_time_ms: number;
  generated_at: string;
}

/**
 * Nom de fichier envoyé au microservice opencxr. Le blob est toujours le PNG
 * rendu de l'image (image.src), quel que soit le type source : l'extension
 * `.png` est donc forcée pour que read_file() du microservice la décode bien.
 */
function openCxrImageFilename(image: ExamImage): string {
  return `${image.id}.png`;
}

/** Classifie une radio (Frontal PA / AP / Lateral / notCXR) via le microservice opencxr. */
export async function sortWorkspaceImageOpenCxr(
  workspaceId: string,
  image: ExamImage,
): Promise<OpenCxrSortResult> {
  const body = new FormData();
  body.append("image_id", image.id);
  body.append("image", await imageToBlob(image), openCxrImageFilename(image));
  const response = await fetch(`${API_BASE_URL}/workspace/exams/${workspaceId}/opencxr/sort`, { method: "POST", body });
  if (!response.ok) throw new Error(`API ${response.status}: ${await response.text() || response.statusText}`);
  const raw = await response.json() as OpenCxrSortWire;
  return raw.result;
}

/** Normalise une radio frontale via le microservice opencxr (PNG + changements de taille). */
export async function standardizeWorkspaceImageOpenCxr(
  workspaceId: string,
  image: ExamImage,
  options?: { doCropToLungBox?: boolean; finalSquareSize?: number },
): Promise<OpenCxrStandardizeResult> {
  const body = new FormData();
  body.append("image_id", image.id);
  body.append("image", await imageToBlob(image), openCxrImageFilename(image));
  if (image.metadata?.pixelSpacingMm) {
    body.append("pixel_spacing_mm", image.metadata.pixelSpacingMm.join(","));
  }
  body.append("do_crop_to_lung_box", options?.doCropToLungBox === false ? "false" : "true");
  body.append("final_square_size", String(options?.finalSquareSize ?? 1024));
  const response = await fetch(`${API_BASE_URL}/workspace/exams/${workspaceId}/opencxr/standardize`, { method: "POST", body });
  if (!response.ok) throw new Error(`API ${response.status}: ${await response.text() || response.statusText}`);
  const raw = await response.json() as OpenCxrStandardizeWire;
  return {
    image_data_url: raw.image_data_url,
    width: raw.width,
    height: raw.height,
    size_changes: raw.size_changes,
    inference_time_ms: raw.inference_time_ms,
  };
}
