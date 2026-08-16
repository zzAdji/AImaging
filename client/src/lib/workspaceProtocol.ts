import { exportImageDataUrl } from "./exportImage";
import type { ExamImage, Examination } from "./examinations";
import { buildImageFilter, type Shape, type WlValue } from "../state/workspace";

export const WORKSPACE_PROTOCOL_VERSION = "1.0" as const;

export type AiActionType =
  | "analyze_image" | "analyze_exam" | "predict" | "generate_gradcam" | "show_gradcam"
  | "generate_3d" | "show_3d"
  | "zoom_to_region" | "set_window_level" | "set_brightness" | "set_contrast" | "invert"
  | "create_shape" | "update_shape" | "delete_shape" | "set_layer_visibility"
  | "set_layer_opacity" | "generate_report" | "replace_report" | "notify";

export interface PixelPoint { x: number; y: number }
export interface PixelRegion { x: number; y: number; w: number; h: number }

export interface WorkspaceCanvasShape {
  id: string;
  type: Shape["type"];
  x: number;
  y: number;
  w: number;
  h: number;
  points: PixelPoint[];
  label?: string;
  visible: boolean;
  created_by: "user" | "ai";
  action_id?: string;
  style: {
    color?: string;
    stroke_color?: string;
    fill_color?: string;
    stroke_width?: number;
    font_size?: number;
    font_family?: "sans" | "serif" | "mono";
    font_weight?: "normal" | "bold";
  };
}

export interface WorkspaceManifest {
  protocol_version: typeof WORKSPACE_PROTOCOL_VERSION;
  exam_id: string;
  exam_name: string;
  active_image_id?: string;
  images: Array<{
    image_id: string;
    name: string;
    width: number;
    height: number;
    source_kind: "browser-image" | "dicom" | "unknown";
    metadata: {
      modality?: string;
      study_instance_uid?: string;
      series_instance_uid?: string;
      sop_instance_uid?: string;
      frame_of_reference_uid?: string;
      patient_pseudonym?: string;
      pixel_spacing_mm?: [number, number];
      body_part_examined?: string;
      view_position?: string;
      study_date?: string;
      study_description?: string;
      series_description?: string;
      photometric_interpretation?: string;
      rows?: number;
      columns?: number;
      bits_stored?: number;
      window_center?: number;
      window_width?: number;
      number_of_frames?: number;
    };
    canvas: {
      shapes: WorkspaceCanvasShape[];
      rendered_canvas?: string;
      gradcam?: {
        class_name: string;
        model_count: number;
        generated_at: string;
        peak_region?: PixelRegion;
      };
    };
  }>;
}

export interface AiActionBase {
  id: string;
  order: number;
  type: AiActionType;
  target_image_id?: string;
  reason: string;
  confidence?: number;
  /** Action payload fields are validated by the server; the client executes known variants. */
  [key: string]: unknown;
}

export interface AiActionPlan {
  protocol_version: typeof WORKSPACE_PROTOCOL_VERSION;
  summary: string;
  actions: AiActionBase[];
}

export interface ActionValidationResult {
  accepted: boolean;
  plan: AiActionPlan;
  errors: string[];
  warnings: string[];
}

export interface WorkspaceSession {
  workspace_id: string;
  protocol_version: string;
  exam_id: string;
  image_count: number;
  consistency_issues?: Array<{
    level: "warning" | "error";
    code: string;
    message: string;
  }>;
}

export type ImageCanvasCapture = Record<string, string | undefined>;

function toCanvasShape(shape: Shape): WorkspaceCanvasShape {
  return {
    id: shape.id,
    type: shape.type,
    x: shape.x,
    y: shape.y,
    w: shape.w,
    h: shape.h,
    points: shape.points.map((point) => ({ ...point })),
    label: shape.label,
    visible: shape.visible !== false,
    created_by: shape.createdBy ?? "user",
    action_id: shape.actionId,
    style: {
      color: shape.color,
      stroke_color: shape.strokeColor,
      fill_color: shape.fillColor,
      stroke_width: shape.strokeWidth,
      font_size: shape.fontSize,
      font_family: shape.fontFamily,
      font_weight: shape.fontWeight,
    },
  };
}

function imageShapes(image: ExamImage): Shape[] {
  return image.state?.shapes ?? [];
}

/** Builds a JSON-only, pixel-coordinate context. Image files are deliberately sent separately. */
export function buildWorkspaceManifest(
  exam: Examination,
  activeImageId?: string,
  captures: ImageCanvasCapture = {},
): WorkspaceManifest {
  return {
    protocol_version: WORKSPACE_PROTOCOL_VERSION,
    exam_id: exam.id,
    exam_name: exam.name,
    active_image_id: activeImageId,
    images: exam.images.map((image) => ({
      image_id: image.id,
      name: image.name,
      width: image.dims.w,
      height: image.dims.h,
      source_kind: image.sourceKind ?? "browser-image",
      metadata: {
        modality: image.metadata?.modality ?? exam.modality,
        study_instance_uid: image.metadata?.studyInstanceUid,
        series_instance_uid: image.metadata?.seriesInstanceUid,
        sop_instance_uid: image.metadata?.sopInstanceUid,
        frame_of_reference_uid: image.metadata?.frameOfReferenceUid,
        patient_pseudonym: image.metadata?.patientPseudonym,
        pixel_spacing_mm: image.metadata?.pixelSpacingMm,
        body_part_examined: image.metadata?.bodyPartExamined,
        view_position: image.metadata?.viewPosition,
        study_date: image.metadata?.studyDate,
        study_description: image.metadata?.studyDescription,
        series_description: image.metadata?.seriesDescription,
        photometric_interpretation: image.metadata?.photometricInterpretation,
        rows: image.metadata?.rows,
        columns: image.metadata?.columns,
        bits_stored: image.metadata?.bitsStored,
        window_center: image.metadata?.windowCenter,
        window_width: image.metadata?.windowWidth,
        number_of_frames: image.metadata?.numberOfFrames,
      },
      canvas: {
        shapes: imageShapes(image).map(toCanvasShape),
        rendered_canvas: captures[image.id],
        gradcam: image.gradcam ? {
          class_name: image.gradcam.className,
          model_count: image.gradcam.modelCount,
          generated_at: image.gradcam.generatedAt,
          peak_region: image.gradcam.peakRegion,
        } : undefined,
      },
    })),
  };
}

/** Creates an annotated canvas capture only when a command needs visual context. */
export async function captureAnnotatedImage(image: ExamImage): Promise<string> {
  const state = image.state;
  const wl: WlValue = state?.wl ?? { window: 255, level: 127.5 };
  return exportImageDataUrl({
    imageSrc: image.src,
    dims: image.dims,
    shapes: imageShapes(image),
    filter: buildImageFilter(wl, state?.brightness ?? 50, state?.contrast ?? 50, state?.inverted ?? false),
    overlaySrc: image.gradcam?.heatmapDataUrl,
    overlayOpacity: image.gradcam ? 0.62 : undefined,
    pixelSpacingMm: image.metadata?.pixelSpacingMm,
    format: "png",
    quality: 1,
  });
}
