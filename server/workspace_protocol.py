"""Contrat versionné entre le client de visualisation et l'agent IA."""

from __future__ import annotations

from enum import StrEnum
from typing import Annotated, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, model_validator


PROTOCOL_VERSION = "1.0"


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PixelPoint(StrictModel):
    x: float = Field(ge=0)
    y: float = Field(ge=0)


class PixelRegion(StrictModel):
    x: float = Field(ge=0)
    y: float = Field(ge=0)
    w: float = Field(gt=0)
    h: float = Field(gt=0)


class ShapeStyle(StrictModel):
    color: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")
    stroke_color: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")
    fill_color: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")
    stroke_width: float | None = Field(default=None, gt=0, le=64)
    font_size: float | None = Field(default=None, ge=6, le=160)
    font_family: Literal["sans", "serif", "mono"] | None = None
    font_weight: Literal["normal", "bold"] | None = None


class CanvasShape(StrictModel):
    id: str = Field(min_length=1, max_length=128)
    type: Literal["rectangle", "ellipse", "arrow", "line", "freedraw", "measure", "distance", "angle", "annotation", "text"]
    x: float
    y: float
    w: float
    h: float
    points: list[PixelPoint] = Field(default_factory=list, max_length=10_000)
    label: str | None = Field(default=None, max_length=4_000)
    visible: bool = True
    created_by: Literal["user", "ai"] = "user"
    action_id: str | None = Field(default=None, max_length=128)
    style: ShapeStyle = Field(default_factory=ShapeStyle)


class CanvasState(StrictModel):
    shapes: list[CanvasShape] = Field(default_factory=list, max_length=10_000)
    rendered_canvas: str | None = None


class ImageMetadata(StrictModel):
    modality: str | None = Field(default=None, max_length=32)
    study_instance_uid: str | None = Field(default=None, max_length=128)
    series_instance_uid: str | None = Field(default=None, max_length=128)
    patient_pseudonym: str | None = Field(default=None, max_length=128)
    pixel_spacing_mm: tuple[float, float] | None = None


class WorkspaceImage(StrictModel):
    image_id: str = Field(min_length=1, max_length=128)
    name: str = Field(min_length=1, max_length=512)
    width: int = Field(gt=0, le=32_768)
    height: int = Field(gt=0, le=32_768)
    source_kind: Literal["browser-image", "dicom", "unknown"] = "browser-image"
    metadata: ImageMetadata = Field(default_factory=ImageMetadata)
    canvas: CanvasState = Field(default_factory=CanvasState)


class WorkspaceManifest(StrictModel):
    protocol_version: Literal[PROTOCOL_VERSION] = PROTOCOL_VERSION
    exam_id: str = Field(min_length=1, max_length=128)
    exam_name: str = Field(min_length=1, max_length=512)
    active_image_id: str | None = None
    images: list[WorkspaceImage] = Field(min_length=1, max_length=256)

    @model_validator(mode="after")
    def validate_image_ids(self) -> "WorkspaceManifest":
        image_ids = [image.image_id for image in self.images]
        if len(image_ids) != len(set(image_ids)):
            raise ValueError("Chaque image doit avoir un image_id unique.")
        if self.active_image_id is not None and self.active_image_id not in image_ids:
            raise ValueError("active_image_id ne référence aucune image de l'examen.")
        return self


class ActionType(StrEnum):
    ANALYZE_IMAGE = "analyze_image"
    ANALYZE_EXAM = "analyze_exam"
    PREDICT = "predict"
    GENERATE_GRADCAM = "generate_gradcam"
    SHOW_GRADCAM = "show_gradcam"
    ZOOM_TO_REGION = "zoom_to_region"
    SET_WINDOW_LEVEL = "set_window_level"
    SET_BRIGHTNESS = "set_brightness"
    SET_CONTRAST = "set_contrast"
    INVERT = "invert"
    CREATE_SHAPE = "create_shape"
    UPDATE_SHAPE = "update_shape"
    DELETE_SHAPE = "delete_shape"
    SET_LAYER_VISIBILITY = "set_layer_visibility"
    SET_LAYER_OPACITY = "set_layer_opacity"
    GENERATE_REPORT = "generate_report"
    REPLACE_REPORT = "replace_report"
    NOTIFY = "notify"


class ActionBase(StrictModel):
    id: str = Field(min_length=1, max_length=128)
    order: int = Field(ge=0, le=10_000)
    target_image_id: str | None = Field(default=None, max_length=128)
    reason: str = Field(min_length=1, max_length=2_000)
    confidence: float | None = Field(default=None, ge=0, le=1)


class AnalyzeImageAction(ActionBase):
    type: Literal[ActionType.ANALYZE_IMAGE]
    target_image_id: str


class AnalyzeExamAction(ActionBase):
    type: Literal[ActionType.ANALYZE_EXAM]


class PredictAction(ActionBase):
    type: Literal[ActionType.PREDICT]
    target_image_id: str


class GenerateGradcamAction(ActionBase):
    type: Literal[ActionType.GENERATE_GRADCAM]
    target_image_id: str
    class_name: str | None = Field(default=None, max_length=128)


class ShowGradcamAction(ActionBase):
    type: Literal[ActionType.SHOW_GRADCAM]
    target_image_id: str
    visible: bool = True
    opacity: int = Field(default=62, ge=0, le=100)


class ZoomToRegionAction(ActionBase):
    type: Literal[ActionType.ZOOM_TO_REGION]
    target_image_id: str
    region: PixelRegion


class SetWindowLevelAction(ActionBase):
    type: Literal[ActionType.SET_WINDOW_LEVEL]
    target_image_id: str
    window: float = Field(gt=0, le=4096)
    level: float = Field(ge=-2048, le=4096)


class SetBrightnessAction(ActionBase):
    type: Literal[ActionType.SET_BRIGHTNESS]
    target_image_id: str
    value: int = Field(ge=0, le=100)


class SetContrastAction(ActionBase):
    type: Literal[ActionType.SET_CONTRAST]
    target_image_id: str
    value: int = Field(ge=0, le=100)


class InvertAction(ActionBase):
    type: Literal[ActionType.INVERT]
    target_image_id: str
    value: bool


class CreateShapeAction(ActionBase):
    type: Literal[ActionType.CREATE_SHAPE]
    target_image_id: str
    shape: CanvasShape


class ShapePatch(StrictModel):
    x: float | None = None
    y: float | None = None
    w: float | None = None
    h: float | None = None
    points: list[PixelPoint] | None = Field(default=None, max_length=10_000)
    label: str | None = Field(default=None, max_length=4_000)
    visible: bool | None = None
    style: ShapeStyle | None = None

    @model_validator(mode="after")
    def require_change(self) -> "ShapePatch":
        if not self.model_fields_set:
            raise ValueError("La modification de forme ne contient aucun champ.")
        return self


class UpdateShapeAction(ActionBase):
    type: Literal[ActionType.UPDATE_SHAPE]
    target_image_id: str
    shape_id: str = Field(min_length=1, max_length=128)
    patch: ShapePatch


class DeleteShapeAction(ActionBase):
    type: Literal[ActionType.DELETE_SHAPE]
    target_image_id: str
    shape_id: str = Field(min_length=1, max_length=128)


class SetLayerVisibilityAction(ActionBase):
    type: Literal[ActionType.SET_LAYER_VISIBILITY]
    target_image_id: str
    layer: Literal["image", "annotations", "measurements", "gradcam"]
    visible: bool


class SetLayerOpacityAction(ActionBase):
    type: Literal[ActionType.SET_LAYER_OPACITY]
    target_image_id: str
    layer: Literal["image", "annotations", "measurements", "gradcam"]
    opacity: int = Field(ge=0, le=100)


class GenerateReportAction(ActionBase):
    type: Literal[ActionType.GENERATE_REPORT]


class ReplaceReportAction(ActionBase):
    type: Literal[ActionType.REPLACE_REPORT]
    text: str = Field(min_length=1, max_length=50_000)


class NotifyAction(ActionBase):
    type: Literal[ActionType.NOTIFY]
    level: Literal["info", "warning", "error"]
    message: str = Field(min_length=1, max_length=4_000)


WorkspaceAction = Annotated[Union[
    AnalyzeImageAction, AnalyzeExamAction, PredictAction, GenerateGradcamAction,
    ShowGradcamAction, ZoomToRegionAction, SetWindowLevelAction, SetBrightnessAction,
    SetContrastAction, InvertAction, CreateShapeAction, UpdateShapeAction,
    DeleteShapeAction, SetLayerVisibilityAction, SetLayerOpacityAction,
    GenerateReportAction, ReplaceReportAction, NotifyAction,
], Field(discriminator="type")]


class ActionPlan(StrictModel):
    protocol_version: Literal[PROTOCOL_VERSION] = PROTOCOL_VERSION
    summary: str = Field(min_length=1, max_length=4_000)
    actions: list[WorkspaceAction] = Field(default_factory=list, max_length=200)

    @model_validator(mode="after")
    def validate_ordering(self) -> "ActionPlan":
        action_ids = [action.id for action in self.actions]
        if len(action_ids) != len(set(action_ids)):
            raise ValueError("Chaque action doit avoir un id unique.")
        orders = [action.order for action in self.actions]
        if orders != sorted(orders) or len(orders) != len(set(orders)):
            raise ValueError("Les actions doivent être dans un ordre strictement croissant et unique.")
        return self


class ActionValidationResult(StrictModel):
    accepted: bool
    plan: ActionPlan
    errors: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


def validate_plan_against_manifest(plan: ActionPlan, manifest: WorkspaceManifest) -> ActionValidationResult:
    images = {image.image_id: image for image in manifest.images}
    errors: list[str] = []
    warnings: list[str] = []
    for action in plan.actions:
        if action.target_image_id is not None and action.target_image_id not in images:
            errors.append(f"Action {action.id} : image inconnue '{action.target_image_id}'.")
            continue
        target = images.get(action.target_image_id) if action.target_image_id else None
        if isinstance(action, ZoomToRegionAction) and target is not None:
            region = action.region
            if region.x + region.w > target.width or region.y + region.h > target.height:
                errors.append(f"Action {action.id} : région hors des limites de '{target.name}'.")
        if isinstance(action, CreateShapeAction) and target is not None:
            if not (0 <= action.shape.x <= target.width and 0 <= action.shape.y <= target.height):
                errors.append(f"Action {action.id} : point d'ancrage de forme hors image.")
            if action.shape.type in {"measure", "distance", "angle"} and target.metadata.pixel_spacing_mm is None:
                warnings.append(f"Action {action.id} : mesure non calibrée pour '{target.name}' (Pixel Spacing absent).")
        if isinstance(action, (UpdateShapeAction, DeleteShapeAction)) and target is not None:
            if action.shape_id not in {shape.id for shape in target.canvas.shapes}:
                errors.append(f"Action {action.id} : forme inconnue '{action.shape_id}'.")
    return ActionValidationResult(accepted=not errors, plan=plan, errors=errors, warnings=warnings)
