"""Tests de l'analyseur de commandes explicites (@...) côté serveur.

Couvre notamment :
- le rapport workspace (@report → generate_report) ;
- l'analyse anatomique unifiée (@anatomy → analyze_anatomy) ;
- la désactivation de la 3D (@3d n'est plus une commande du catalogue).
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from conftest import make_workspace_manifest  # noqa: E402
from workspace_commands import CommandError, parse_explicit_command  # noqa: E402
from workspace_protocol import WorkspaceManifest  # noqa: E402


@pytest.fixture
def manifest() -> WorkspaceManifest:
    raw = make_workspace_manifest(
        image_ids=["img-1"], widths=[512], modalities=["CR"], source_kinds=["dicom"]
    )
    return WorkspaceManifest.model_validate(raw)


def test_report_command_produces_generate_report(manifest):
    result = parse_explicit_command("@report", manifest)
    assert result.command == "report"
    types = [action.type for action in result.plan.actions]
    assert types == ["generate_report"]


def test_report_command_rejects_options(manifest):
    with pytest.raises(CommandError):
        parse_explicit_command("@report extra:1", manifest)


def test_anatomy_command_produces_analyze_anatomy(manifest):
    result = parse_explicit_command("@anatomy image:img-1", manifest)
    assert result.command == "anatomy"
    action = result.plan.actions[0]
    assert action.type == "analyze_anatomy"
    assert action.target_image_id == "img-1"


def test_anatomy_command_uses_active_image(manifest):
    result = parse_explicit_command("@anatomy", manifest)
    action = result.plan.actions[0]
    assert action.type == "analyze_anatomy"
    assert action.target_image_id == "img-1"


def test_3d_command_is_no_longer_available(manifest):
    """La 3D est abandonnée : @3d ne doit plus exister dans le catalogue."""
    with pytest.raises(CommandError):
        parse_explicit_command("@3d image:img-1", manifest)


def test_help_returns_empty_plan(manifest):
    result = parse_explicit_command("@help", manifest)
    assert result.command == "help"
    assert result.plan.actions == []
