"""Tests du bornage des coordonnées dans le compilateur de plans du workspace agent."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pydantic import TypeAdapter

from conftest import make_workspace_manifest  # noqa: E402
from workspace_agent import AgentIntent, AgentProposal, compile_agent_proposal  # noqa: E402
from workspace_protocol import WorkspaceManifest  # noqa: E402


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


def test_create_shape_accepts_points_as_objects(manifest):
    result = _compile(manifest, [
        {
            "type": "create_shape",
            "target_image_id": "img-1",
            "reason": "Mesure",
            "payload": {
                "shape": {
                    "type": "measure",
                    "x": 10,
                    "y": 20,
                    "w": 30,
                    "h": 40,
                    "points": [{"x": 10, "y": 20}, {"x": 40, "y": 60}],
                },
            },
        },
    ])
    assert result.accepted is True, result.errors
    points = result.plan.actions[0].shape.points
    assert [(p.x, p.y) for p in points] == [(10.0, 20.0), (40.0, 60.0)]


def test_create_shape_accepts_points_as_pair_lists(manifest):
    result = _compile(manifest, [
        {
            "type": "create_shape",
            "target_image_id": "img-1",
            "reason": "Mesure",
            "payload": {
                "shape": {
                    "type": "measure",
                    "x": 10,
                    "y": 20,
                    "w": 30,
                    "h": 40,
                    "points": [[10, 20], [40, 60]],
                },
            },
        },
    ])
    assert result.accepted is True, result.errors
    points = result.plan.actions[0].shape.points
    assert [(p.x, p.y) for p in points] == [(10.0, 20.0), (40.0, 60.0)]


def test_create_shape_rejects_wrong_point_shapes(manifest):
    result = _compile(manifest, [
        {
            "type": "create_shape",
            "target_image_id": "img-1",
            "reason": "Mesure",
            "payload": {
                "shape": {
                    "type": "measure",
                    "x": 10,
                    "y": 20,
                    "w": 30,
                    "h": 40,
                    "points": [[10, 20, 30]],
                },
            },
        },
    ])
    assert result.accepted is False


def test_create_shape_accepts_type_alias_and_stray_fields(manifest):
    result = _compile(manifest, [
        {
            "type": "create_shape",
            "target_image_id": "img-1",
            "reason": "Mesure",
            "payload": {
                "shape": {
                    "type": "measurement",
                    "color": "red",
                    "stroke": 2,
                    "fontSize": 12,
                    "x": 10,
                    "y": 20,
                    "w": 30,
                    "h": 40,
                    "points": [[10, 20], [40, 60]],
                },
            },
        },
    ])
    assert result.accepted is True, result.errors
    shape = result.plan.actions[0].shape
    assert shape.type == "measure"
    assert [(p.x, p.y) for p in shape.points] == [(10.0, 20.0), (40.0, 60.0)]


def test_create_shape_normalises_style_colors_and_fonts(manifest):
    result = _compile(manifest, [
        {
            "type": "create_shape",
            "target_image_id": "img-1",
            "reason": "Vue",
            "payload": {
                "shape": {
                    "type": "rectangle",
                    "x": 10,
                    "y": 20,
                    "w": 30,
                    "h": 40,
                    "label": "Repère",
                    "style": {
                        "stroke_color": "red",
                        "fill_color": "#abc",
                        "color": "not-a-color",
                        "font_family": "sans-serif",
                        "font_weight": "700",
                    },
                },
            },
        },
    ])
    assert result.accepted is True, result.errors
    style = result.plan.actions[0].shape.style
    assert style.stroke_color == "#ff0000"
    assert style.fill_color == "#aabbcc"
    assert style.color is None
    assert style.font_family == "sans"
    assert style.font_weight == "bold"


def test_naive_coordinates_are_rejected_but_nan_is_defaulted(manifest):
    result = _compile(manifest, [
        {
            "type": "zoom_to_region",
            "target_image_id": "img-1",
            "reason": "Test",
            "payload": {"region": {"x": "nan", "y": 20, "w": "nan", "h": 40}},
        },
    ])
    assert result.accepted is True, result.errors
    region = result.plan.actions[0].region
    assert region.w >= 1.0


def test_show_gradcam_accepts_fraction_opacity(manifest):
    result = _compile(manifest, [
        {
            "type": "show_gradcam",
            "target_image_id": "img-1",
            "reason": "Test",
            "payload": {"visible": True, "opacity": 0.62},
        },
    ])
    assert result.accepted is True, result.errors
    assert result.plan.actions[0].opacity == 62


def test_brightness_contrast_accepts_percent_and_fraction(manifest):
    for action_type in ("set_brightness", "set_contrast"):
        result = _compile(manifest, [
            {
                "type": action_type,
                "target_image_id": "img-1",
                "reason": "Test",
                "payload": {"value": "75%"},
            },
        ])
        assert result.accepted is True, result.errors
        assert result.plan.actions[0].value == 75
    result = _compile(manifest, [
        {
            "type": "set_contrast",
            "target_image_id": "img-1",
            "reason": "Test",
            "payload": {"value": 0.5},
        },
    ])
    assert result.accepted is True, result.errors
    assert result.plan.actions[0].value == 50


def test_window_level_is_clamped_instead_of_rejected(manifest):
    result = _compile(manifest, [
        {
            "type": "set_window_level",
            "target_image_id": "img-1",
            "reason": "Test",
            "payload": {"window": 0, "level": 99999},
        },
    ])
    assert result.accepted is True, result.errors
    action = result.plan.actions[0]
    assert action.window >= 1.0
    assert action.level <= 4096


def test_zoom_region_ignores_stray_fields(manifest):
    result = _compile(manifest, [
        {
            "type": "zoom_to_region",
            "target_image_id": "img-1",
            "reason": "Test",
            "payload": {"region": {"x": 10, "y": 20, "w": 30, "h": 40, "fraction": True}},
        },
    ])
    assert result.accepted is True, result.errors


def test_notify_accepts_level_aliases(manifest):
    result = _compile(manifest, [
        {
            "type": "notify",
            "reason": "Test",
            "payload": {"level": "success", "message": "Terminé."},
        },
    ])
    assert result.accepted is True, result.errors
    assert result.plan.actions[0].level == "info"


def test_layer_actions_accept_aliases_and_opacity_fraction(manifest):
    result = _compile(manifest, [
        {
            "type": "set_layer_visibility",
            "target_image_id": "img-1",
            "reason": "Test",
            "payload": {"layer": "annotation", "visible": False},
        },
        {
            "type": "set_layer_opacity",
            "target_image_id": "img-1",
            "reason": "Test",
            "payload": {"layer": "grad-cam", "opacity": 0.4},
        },
    ])
    assert result.accepted is True, result.errors
    actions = result.plan.actions
    assert actions[0].layer == "annotations"
    assert actions[1].layer == "gradcam"
    assert actions[1].opacity == 40


def test_proposal_tolerates_missing_reason_and_duplicate_visual_targets(manifest):
    proposal = TypeAdapter(AgentProposal).validate_python({
        "intent": AgentIntent.EXPLAIN_PREDICTION,
        "assistant_message": "Réponse.",
        "actions": [
            {"type": "show_gradcam", "target_image_id": "img-1", "payload": {"visible": True}},
        ],
        "target_visual_image_ids": ["img-1", "img-1"],
    })
    assert proposal.actions[0].reason == "Action demandée par l'utilisateur."
    assert proposal.target_visual_image_ids == ["img-1"]


def test_proposal_tolerates_empty_message_and_evidence_aliases(manifest):
    proposal = TypeAdapter(AgentProposal).validate_python({
        "intent": AgentIntent.EXPLAIN_PREDICTION,
        "assistant_message": "   ",
        "evidence": [
            {"source": "cxas", "image_id": "img-1", "detail": "CTR 0.40"},
            {"source": "predictions", "image_id": "img-1", "detail": ""},
        ],
    })
    assert proposal.assistant_message == "Réponse générée."
    assert proposal.evidence[0].source.value == "anatomy"
    assert proposal.evidence[1].source.value == "prediction"
    assert proposal.evidence[1].detail == "Détail non fourni par le modèle."