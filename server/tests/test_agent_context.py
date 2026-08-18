"""Tests du contexte compact de l'agent : anatomie CXAS et mémoire conversationnelle."""

from __future__ import annotations

from workspace_store import AgentTurnRecord

from agent_context import WorkspaceAnatomyContext, compact_anatomy_context, conversation_context


def _anatomy(**overrides) -> WorkspaceAnatomyContext:
    base = {
        "status": "ok",
        "error": None,
        "measurements": {
            "CTR": {"available": True, "value": 0.51, "unit": "ratio"},
            "SCD": {"available": False, "value": 0.2},
            "absent": {"available": True},
        },
        "labels": {"lung": "Poumon droit", "heart": "Cœur"},
        "areas_px": {
            "lung": 1_250_000,
            "tiny": 4.2,
            "heart": 620_000,
        },
        "mask_shape": [256, 256],
        "file_size": [512, 512],
        "mask_downscaled": True,
        "generated_at": "2026-08-18T10:00:00Z",
    }
    base.update(overrides)
    return WorkspaceAnatomyContext(**base)


def test_compact_keeps_only_available_measurements_with_value():
    compact = compact_anatomy_context(_anatomy())
    assert compact["measurements"] == {"CTR": {"available": True, "value": 0.51, "unit": "ratio"}}


def test_compact_orders_key_structures_by_area_descending():
    compact = compact_anatomy_context(_anatomy())
    assert compact["key_structures"] == [("lung", 1250000), ("heart", 620000), ("tiny", 4)]


def test_compact_drops_null_or_zero_areas():
    compact = compact_anatomy_context(_anatomy(areas_px={"zero": 0.0, "neg": -5.0}))
    assert compact["key_structures"] == []


def test_compact_limits_key_structures_to_12():
    areas = {f"structure-{index}": float(1_000_000 - index) for index in range(20)}
    compact = compact_anatomy_context(_anatomy(areas_px=areas))
    assert len(compact["key_structures"]) == 12
    assert compact["key_structures"][0][0] == "structure-0"


def test_compact_forwards_state_and_provenance_fields():
    compact = compact_anatomy_context(_anatomy(status="error", error="modèle indisponible"))
    assert compact["status"] == "error"
    assert compact["error"] == "modèle indisponible"
    assert compact["mask_shape"] == [256, 256]
    assert compact["mask_downscaled"] is True
    assert compact["generated_at"] == "2026-08-18T10:00:00Z"


def test_compact_ignores_unknown_extra_fields():
    compact = compact_anatomy_context(_anatomy(extra_field="ignorée"))
    assert "extra_field" not in compact


def _turn(instruction: str, intent: str = "explain_prediction", accepted: bool = True) -> AgentTurnRecord:
    return AgentTurnRecord(
        turn_id=instruction.replace(" ", "-"),
        instruction=instruction,
        intent=intent,
        assistant_message=f"Réponse : {instruction}",
        action_types=["zoom_to_region", "create_shape"],
        validation_accepted=accepted,
    )


def test_conversation_context_preserves_chronological_order():
    turns = [_turn("Première"), _turn("Deuxième"), _turn("Troisième")]
    compact = conversation_context(turns)
    assert [entry["utilisateur"] for entry in compact] == ["Première", "Deuxième", "Troisième"]


def test_conversation_context_exposes_intent_actions_and_validation():
    compact = conversation_context([_turn("Scan", intent="apply_adaptative_windowing", accepted=False)])
    entry = compact[0]
    assert entry["intention"] == "apply_adaptative_windowing"
    assert entry["actions"] == ["zoom_to_region", "create_shape"]
    assert entry["valide"] is False


def test_conversation_context_applies_the_char_budget():
    turns = [_turn("A"), _turn("B"), _turn("C")]
    compact = conversation_context(turns, max_chars=60)
    assert len(compact) < len(turns)
    assert len(str(compact)) <= 60


def test_conversation_context_truncates_long_texts():
    long_text = "x" * 500
    compact = conversation_context([_turn(long_text)], max_chars=10_000)
    entry = compact[0]
    assert len(entry["utilisateur"]) == 200
    assert len(entry["assistant"]) == 320


def test_conversation_context_empty_when_no_turns():
    assert conversation_context([]) == []