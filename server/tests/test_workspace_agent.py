"""Tests du bornage des coordonnées dans le compilateur de plans du workspace agent."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pydantic import TypeAdapter

from tests.conftest import make_workspace_manifest  # noqa: E402
from workspace_agent import AgentProposal, compile_agent_proposal  # noqa: E402
from workspace_protocol import AgentIntent, WorkspaceManifest  # noqa: E402


@pytest.fixture
def manifest() -> WorkspaceManifest:
    raw = make_workspace_manifest(image_ids=["img-1"], widths=[256], active_image_id="img-1")
    raw["images"][0]["width"] = 256
    raw["images"][0]["height"] = 256
    return TypeAdapter(WorkspaceManifest).validate_python(raw)


def _compile(manifest: WorkspaceManifest, actions: list[dict]) -> object:
    proposal = TypeAdapter(AgentProposal).validate_python({
        "intent": AgentIntent.EXPLAIN_PREDICTION,
        "assistant_message": "Exécution test.",
        "actions": actions,
    })
    return compile_agent_proposal(proposal, manifest)


def test_zoom_region_out_of_bounds_is_clamped_instead_of_rejected(manifest):
    result = _compile(manifest, [
        {
            "type": "zoom_to_region",
            "target_image_id": "img-1",
            "reason": "Région signalée",
            "payload": {"region": {"x": 500, "y": 500, "w": 400, "h": 300}},
        },
    ])
    assert result.accepted is True, result.errors
    assert len(result.plan.actions) == 1
    region = result.plan.actions[0].region
    assert region.x + region.w <= 256
    assert region.y + region.h <= 256


def test_create_shape_anchor_out_of_bounds_is_clamped(manifest):
    result = _compile(manifest, [
        {
            "type": "create_shape",
            "target_image_id": "img-1",
            "reason": "Repère",
            "payload": {
                "shape": {
                    "type": "annotation",
                    "x": 900,
                    "y": -50,
                    "w": 0,
                    "h": 0,
                    "points": [],
                },
            },
        },
    ])
    assert result.accepted is True, result.errors
    shape = result.plan.actions[0].shape
    assert shape.x <= 256
    assert shape.y >= 0


def test_negative_region_values_are_clamped(manifest):
    result = _compile(manifest, [
        {
            "type": "zoom_to_region",
            "target_image_id": "img-1",
            "reason": "Test",
            "payload": {"region": {"x": -20, "y": -30, "w": 50, "h": 40}},
        },
    ])
    assert result.accepted is True, result.errors
    region = result.plan.actions[0].region
    assert region.x >= 0
    assert region.y >= 0


def test_valid_region_is_untouched(manifest):
    result = _compile(manifest, [
        {
            "type": "zoom_to_region",
            "target_image_id": "img-1",
            "reason": "Test",
            "payload": {"region": {"x": 10, "y": 20, "w": 30, "h": 40}},
        },
    ])
    assert result.accepted is True, result.errors
    region = result.plan.actions[0].region
    assert (region.x, region.y, region.w, region.h) == (10, 20, 30, 40)