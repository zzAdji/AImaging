"""Contrat simple entre Gemini et le moteur d'actions du workspace.

Gemini ne produit jamais directement le plan technique discriminé : il propose
une réponse utilisateur et des actions génériques. Le serveur ajoute les ids,
l'ordre, les cibles implicites puis valide chaque payload avec le protocole
strict avant toute exécution navigateur.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Any
from uuid import uuid4

from pydantic import Field, TypeAdapter, ValidationError, model_validator

from workspace_protocol import (
    ActionPlan,
    ActionType,
    ActionValidationResult,
    StrictModel,
    WorkspaceAction,
    WorkspaceManifest,
    validate_plan_against_manifest,
)


class AgentIntent(StrEnum):
    EXPLAIN_PREDICTION = "explain_prediction"
    EXPLAIN_VISUAL = "explain_visual"
    CANVAS_EDIT = "canvas_edit"
    ANALYSIS_REQUEST = "analysis_request"
    REPORT_REQUEST = "report_request"
    COMPARISON_REQUEST = "comparison_request"
    MIXED = "mixed"
    CLARIFICATION = "clarification"
    WARNING = "warning"


class VisualContextNeed(StrEnum):
    NONE = "none"
    ACTIVE_IMAGE = "active_image"
    TARGET_IMAGES = "target_images"
    ALL_EXAM_IMAGES = "all_exam_images"


class EvidenceSource(StrEnum):
    PREDICTION = "prediction"
    VISUAL = "visual"
    GRADCAM = "gradcam"
    METADATA = "metadata"
    ANNOTATION = "annotation"
    MEASUREMENT = "measurement"
    ANALYSIS = "analysis"


class AgentEvidence(StrictModel):
    source: EvidenceSource
    image_id: str | None = Field(default=None, max_length=128)
    detail: str = Field(min_length=1, max_length=4_000)


class AgentActionProposal(StrictModel):
    """Action volontairement simple pour éviter les schémas oneOf/discriminator.

    Le contenu de ``payload`` est validé ensuite contre l'action technique
    correspondante par ``compile_agent_proposal``.
    """

    type: ActionType
    target_image_id: str | None = Field(default=None, max_length=128)
    reason: str = Field(min_length=1, max_length=2_000)
    payload: dict[str, Any] = Field(default_factory=dict)
    confidence: float | None = Field(default=None, ge=0, le=1)


class AgentProposal(StrictModel):
    intent: AgentIntent
    assistant_message: str = Field(min_length=1, max_length=12_000)
    evidence: list[AgentEvidence] = Field(default_factory=list, max_length=64)
    limitations: list[str] = Field(default_factory=list, max_length=32)
    needs_visual_context: VisualContextNeed = VisualContextNeed.NONE
    target_visual_image_ids: list[str] = Field(default_factory=list, max_length=64)
    actions: list[AgentActionProposal] = Field(default_factory=list, max_length=200)
    warnings: list[str] = Field(default_factory=list, max_length=64)
    clarifying_question: str | None = Field(default=None, max_length=4_000)

    @model_validator(mode="after")
    def validate_visual_targets(self) -> "AgentProposal":
        if len(self.target_visual_image_ids) != len(set(self.target_visual_image_ids)):
            raise ValueError("target_visual_image_ids ne doit pas contenir de doublon.")
        return self


class AgentTurnResponse(StrictModel):
    """Réponse utilisable par le chat, même quand aucune action n'est proposée."""

    intent: AgentIntent
    assistant_message: str
    evidence: list[AgentEvidence] = Field(default_factory=list)
    limitations: list[str] = Field(default_factory=list)
    needs_visual_context: VisualContextNeed = VisualContextNeed.NONE
    target_visual_image_ids: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    clarifying_question: str | None = None
    validation: ActionValidationResult


_ACTION_ADAPTER = TypeAdapter(WorkspaceAction)
_RESERVED_PAYLOAD_FIELDS = {"id", "order", "type", "target_image_id", "reason", "confidence"}
_TARGETED_ACTIONS = {
    ActionType.ANALYZE_IMAGE,
    ActionType.PREDICT,
    ActionType.GENERATE_GRADCAM,
    ActionType.SHOW_GRADCAM,
    ActionType.ZOOM_TO_REGION,
    ActionType.SET_WINDOW_LEVEL,
    ActionType.SET_BRIGHTNESS,
    ActionType.SET_CONTRAST,
    ActionType.INVERT,
    ActionType.CREATE_SHAPE,
    ActionType.UPDATE_SHAPE,
    ActionType.DELETE_SHAPE,
    ActionType.SET_LAYER_VISIBILITY,
    ActionType.SET_LAYER_OPACITY,
}


def _empty_plan(summary: str) -> ActionPlan:
    return ActionPlan(summary=summary, actions=[])


def _compile_one_action(
    action: AgentActionProposal,
    index: int,
    manifest: WorkspaceManifest,
    prefix: str,
) -> tuple[WorkspaceAction, str | None]:
    payload = dict(action.payload)
    forbidden = sorted(_RESERVED_PAYLOAD_FIELDS.intersection(payload))
    if forbidden:
        raise ValueError(f"payload ne peut pas redéfinir {', '.join(forbidden)}.")

    action_id = f"{prefix}-{index:03d}"
    target_image_id = action.target_image_id
    inferred_target_warning: str | None = None
    if action.type in _TARGETED_ACTIONS and target_image_id is None:
        target_image_id = manifest.active_image_id
        if target_image_id is None:
            raise ValueError("Cette action exige une image cible, mais aucune image active n'est définie.")
        inferred_target_warning = f"Action {action_id} appliquée à l'image active '{target_image_id}'."

    if action.type is ActionType.CREATE_SHAPE:
        raw_shape = payload.get("shape")
        if not isinstance(raw_shape, dict):
            raise ValueError("create_shape exige payload.shape sous forme d'objet.")
        shape = dict(raw_shape)
        shape["id"] = str(shape.get("id") or f"{prefix}-shape-{index:03d}")
        shape["created_by"] = "ai"
        shape["action_id"] = action_id
        payload["shape"] = shape

    data: dict[str, Any] = {
        "id": action_id,
        "order": index,
        "type": action.type,
        "reason": action.reason,
    }
    if target_image_id is not None:
        data["target_image_id"] = target_image_id
    if action.confidence is not None:
        data["confidence"] = action.confidence
    data.update(payload)
    return _ACTION_ADAPTER.validate_python(data), inferred_target_warning


def compile_agent_proposal(proposal: AgentProposal, manifest: WorkspaceManifest) -> ActionValidationResult:
    """Convertit une proposition IA en plan technique entièrement validé.

    Le moindre payload invalide annule tout le lot : aucune exécution partielle
    ne peut avoir lieu dans le navigateur.
    """

    prefix = f"ai-{uuid4().hex[:12]}"
    compiled: list[WorkspaceAction] = []
    compile_errors: list[str] = []
    compile_warnings: list[str] = []

    for index, action in enumerate(proposal.actions):
        try:
            compiled_action, inferred_warning = _compile_one_action(action, index, manifest, prefix)
            compiled.append(compiled_action)
            if inferred_warning:
                compile_warnings.append(inferred_warning)
        except (ValidationError, ValueError) as exc:
            compile_errors.append(f"Action proposée {index + 1} ({action.type}) invalide : {exc}")

    if compile_errors:
        return ActionValidationResult(
            accepted=False,
            plan=_empty_plan(proposal.assistant_message),
            errors=compile_errors,
            warnings=compile_warnings,
        )

    plan = ActionPlan(summary=proposal.assistant_message, actions=compiled)
    validation = validate_plan_against_manifest(plan, manifest)
    return ActionValidationResult(
        accepted=validation.accepted,
        plan=validation.plan if validation.accepted else _empty_plan(proposal.assistant_message),
        errors=validation.errors,
        warnings=[*compile_warnings, *validation.warnings],
    )


def build_agent_turn(proposal: AgentProposal, manifest: WorkspaceManifest) -> AgentTurnResponse:
    validation = compile_agent_proposal(proposal, manifest)
    known_image_ids = {image.image_id for image in manifest.images}
    context_warnings = list(proposal.warnings)

    for evidence in proposal.evidence:
        if evidence.image_id is not None and evidence.image_id not in known_image_ids:
            context_warnings.append(f"Preuve ignorée : image inconnue '{evidence.image_id}'.")
    for image_id in proposal.target_visual_image_ids:
        if image_id not in known_image_ids:
            context_warnings.append(f"Contexte visuel demandé pour une image inconnue '{image_id}'.")
    if not validation.accepted:
        context_warnings.append("Les actions proposées n'ont pas été exécutées car leur validation a échoué.")

    return AgentTurnResponse(
        intent=proposal.intent,
        assistant_message=proposal.assistant_message,
        evidence=proposal.evidence,
        limitations=proposal.limitations,
        needs_visual_context=proposal.needs_visual_context,
        target_visual_image_ids=proposal.target_visual_image_ids,
        warnings=context_warnings,
        clarifying_question=proposal.clarifying_question,
        validation=validation,
    )


def fallback_agent_turn(message: str, warning: str) -> AgentTurnResponse:
    """Retour lisible lorsqu'un LLM est indisponible ou produit un JSON invalide."""

    return AgentTurnResponse(
        intent=AgentIntent.WARNING,
        assistant_message=message,
        warnings=[warning],
        validation=ActionValidationResult(accepted=True, plan=_empty_plan(message)),
    )
