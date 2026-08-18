"""Tests du store du workspace : mémoire conversationnelle et journal d'audit."""

from __future__ import annotations

from pydantic import TypeAdapter

from conftest import make_workspace_manifest  # noqa: E402
from workspace_protocol import WorkspaceManifest

from workspace_store import (
    MAX_AUDIT_KEPT,
    MAX_TURNS_KEPT,
    AgentTurnRecord,
    WorkspaceStore,
)


def _manifest() -> WorkspaceManifest:
    return TypeAdapter(WorkspaceManifest).validate_python(
        make_workspace_manifest(image_ids=["img-1"], active_image_id="img-1"),
    )


def _turn(instruction: str, accepted: bool = True) -> AgentTurnRecord:
    return AgentTurnRecord(
        turn_id=instruction.replace(" ", "-"),
        instruction=instruction,
        intent="explain_prediction",
        assistant_message=f"Réponse à : {instruction}",
        action_types=["zoom_to_region"],
        validation_accepted=accepted,
    )


def test_recording_a_turn_makes_it_available_for_conversation():
    store = WorkspaceStore()
    session = store.create(_manifest())
    store.record_turn(session.id, _turn("Première instruction"))
    turns = store.conversation_turns(session.id)
    assert len(turns) == 1
    assert turns[0].instruction == "Première instruction"


def test_conversation_turns_is_bounded_to_latest_12():
    store = WorkspaceStore()
    session = store.create(_manifest())
    for index in range(MAX_TURNS_KEPT + 5):
        store.record_turn(session.id, _turn(f"Instruction {index}"))
    turns = store.conversation_turns(session.id, limit=MAX_TURNS_KEPT + 10)
    assert len(turns) == MAX_TURNS_KEPT
    assert turns[0].instruction == "Instruction 5"
    assert turns[-1].instruction == f"Instruction {MAX_TURNS_KEPT + 4}"


def test_conversation_turns_limit_slices_from_the_end():
    store = WorkspaceStore()
    session = store.create(_manifest())
    for index in range(10):
        store.record_turn(session.id, _turn(f"Instruction {index}"))
    turns = store.conversation_turns(session.id, limit=3)
    assert [t.instruction for t in turns] == ["Instruction 7", "Instruction 8", "Instruction 9"]


def test_audit_is_bounded_to_latest_50():
    store = WorkspaceStore()
    session = store.create(_manifest())
    for index in range(MAX_AUDIT_KEPT + 7):
        store.record_audit(session.id, {"index": index, "route": "/ai/turn"})
    audit = store.get(session.id).audit
    assert len(audit) == MAX_AUDIT_KEPT
    assert audit[0]["index"] == 7
    assert audit[-1]["index"] == MAX_AUDIT_KEPT + 6


def test_record_on_unknown_session_is_a_noop():
    store = WorkspaceStore()
    store.record_turn("ghost-session", _turn("Perdue"))
    store.record_audit("ghost-session", {"route": "/ai/plan"})
    assert store.conversation_turns("ghost-session") == []


def test_replace_preserves_turns_and_audit():
    store = WorkspaceStore()
    session = store.create(_manifest())
    store.record_turn(session.id, _turn("Avant remplacement"))
    store.record_audit(session.id, {"route": "/ai/plan"})
    updated = store.replace(session.id, _manifest())
    assert updated is not None
    assert store.conversation_turns(session.id)[0].instruction == "Avant remplacement"
    assert store.get(session.id).audit[-1]["route"] == "/ai/plan"


def test_replace_on_unknown_session_returns_none():
    store = WorkspaceStore()
    assert store.replace("ghost-session", _manifest()) is None