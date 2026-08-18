"""Contexte compact de l'agent : anatomie CXAS et mémoire conversationnelle.

Module pur (aucun modèle lourd, aucune dépendance fastapi) afin de pouvoir
être testé indépendamment du serveur.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class WorkspaceAnatomyContext(BaseModel):
    """Contexte compact de la segmentation CXAS d'une image (jamais les masques binaires).

    Ce qui est transmis : état, mesures (CTR, SCD...), structures clés avec
    leur aire en pixels, labels, dimensions du masque, provenance. Les data
    URLs (masques/overlay) sont exclues pour ne pas gonfler le prompt.
    """

    model_config = {"extra": "ignore"}

    status: str = "ok"
    error: str | None = None
    measurements: dict[str, dict] = Field(default_factory=dict)
    labels: dict[str, str] = Field(default_factory=dict)
    areas_px: dict[str, float] = Field(default_factory=dict)
    mask_shape: list[int] | None = None
    file_size: list[int] | None = None
    mask_downscaled: bool | None = None
    generated_at: str | None = None


def compact_anatomy_context(anatomy: WorkspaceAnatomyContext) -> dict:
    """Résumé texte des mesures/structures CXAS, sans clés vides ni binaire."""
    measurements = {
        name: value
        for name, value in anatomy.measurements.items()
        if value.get("available") is True and "value" in value
    }
    return {
        "status": anatomy.status,
        "error": anatomy.error,
        "measurements": measurements,
        "key_structures": sorted(
            ((name, round(area)) for name, area in anatomy.areas_px.items() if area > 0),
            key=lambda item: item[1],
            reverse=True,
        )[:12],
        "structure_labels": anatomy.labels,
        "mask_shape": anatomy.mask_shape,
        "mask_downscaled": anatomy.mask_downscaled,
        "generated_at": anatomy.generated_at,
    }


def conversation_context(turns: list[Any], max_chars: int = 4_000) -> list[dict]:
    """Mémoire conversationnelle compacte : messages + intentions + actions."""
    compact: list[dict] = []
    remaining = max_chars
    for turn in reversed(turns):
        instruction = turn.instruction[:200]
        message = turn.assistant_message[:320]
        entry = {
            "utilisateur": instruction,
            "assistant": message,
            "intention": turn.intent,
            "actions": turn.action_types[:8],
            "valide": turn.validation_accepted,
        }
        size = len(str(entry))
        if remaining - size < 0:
            break
        compact.append(entry)
        remaining -= size
    return list(reversed(compact))
