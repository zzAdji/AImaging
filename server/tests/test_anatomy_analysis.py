"""Tests du endpoint d'analyse anatomique unifiée (CXAS + HybridGNet)."""

from __future__ import annotations

import sys
import types
from unittest.mock import MagicMock

from fastapi.testclient import TestClient

from main import _is_cxas_infrastructure_error, app, workspace_store
from workspace_protocol import WorkspaceManifest

from conftest import make_workspace_manifest

TINY_PNG = (
    b"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
)


class CxasUnavailableError(Exception):
    pass


class CheXmaskUnavailableError(Exception):
    pass


def _mock_engine_modules(monkeypatch, *, anatomy_result=None, anatomy_raises=None,
                         landmarks_result=None, landmarks_raises=None):
    """Remplace les 4 modules chargés paresseusement par le endpoint."""
    anatomy_mod = types.ModuleType("anatomy_service")
    anatomy_mod.analyze_anatomy_image = MagicMock(
        return_value=anatomy_result, side_effect=anatomy_raises
    )
    cxas_engine = types.ModuleType("anatomy.cxas_engine")
    cxas_engine.CxasUnavailableError = CxasUnavailableError

    chexmask_mod = types.ModuleType("chexmask_service")
    chexmask_mod.analyze_landmarks = MagicMock(
        return_value=landmarks_result, side_effect=landmarks_raises
    )
    chexmask_inference = types.ModuleType("chexmask.inference")
    chexmask_inference.CheXmaskUnavailableError = CheXmaskUnavailableError

    monkeypatch.setitem(sys.modules, "anatomy_service", anatomy_mod)
    monkeypatch.setitem(sys.modules, "anatomy.cxas_engine", cxas_engine)
    monkeypatch.setitem(sys.modules, "chexmask_service", chexmask_mod)
    monkeypatch.setitem(sys.modules, "chexmask.inference", chexmask_inference)
    return anatomy_mod, chexmask_mod


def _post_anatomy_analysis(client, workspace_id: str, image_id: str = "img-1"):
    return client.post(
        f"/workspace/exams/{workspace_id}/anatomy-analysis",
        data={"image_id": image_id},
        files={"image": ("img.png", TINY_PNG, "image/png")},
    )


def _create_session():
    manifest = make_workspace_manifest(
        source_kinds=["browser-image", "browser-image", "browser-image"],
        modalities=["CR", "CR", "CR"],
    )
    return workspace_store.create(WorkspaceManifest.model_validate(manifest))


def test_anatomy_analysis_merges_both_sources(monkeypatch):
    _mock_engine_modules(
        monkeypatch,
        anatomy_result={
            "status": "ok",
            "segmentation": {"labels": {"135": "right lung"}},
            "measurements": {"Cardio-Thoracic Ratio": {"available": True, "value": 0.48}},
            "warnings": [],
            "inference_time_ms": 1200.0,
        },
        landmarks_result={
            "status": "ok",
            "contours": {"right_lung": [[0, 0]]},
            "measurements": {"ctr": 0.5},
            "custom": [],
            "warnings": [],
            "uncertainty": {"mean_node_std_px": 0.3},
            "scale_used": "mm",
            "ctr_method": "cranio-caudal",
            "lines": [],
            "inference_time_ms": 800.0,
        },
    )
    session_id = _create_session().id

    response = _post_anatomy_analysis(TestClient(app), session_id)
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["sources"] == ["CXAS", "HybridGNet"]
    assert data["warnings"] == []
    assert data["cxas"]["payload"]["measurements"]["Cardio-Thoracic Ratio"]["value"] == 0.48
    assert data["cxas"]["payload"]["segmentation"]["labels"]["135"] == "right lung"
    assert data["hybridgnet"]["payload"]["ctr_method"] == "cranio-caudal"
    assert data["hybridgnet"]["payload"]["uncertainty"]["mean_node_std_px"] == 0.3
    assert data["cxas"]["inference_time_ms"] == 1200.0
    assert data["hybridgnet"]["inference_time_ms"] == 800.0


def test_anatomy_analysis_partial_when_cxas_unavailable(monkeypatch):
    _mock_engine_modules(
        monkeypatch,
        anatomy_raises=CxasUnavailableError("La bibliothèque CXAS n'est pas installée sur ce poste."),
        landmarks_result={
            "status": "ok",
            "contours": {},
            "measurements": {"ctr": 0.5},
            "custom": [],
            "warnings": [],
            "uncertainty": {},
            "scale_used": "pixels",
            "ctr_method": "",
            "lines": [],
        },
    )
    session_id = _create_session().id

    response = _post_anatomy_analysis(TestClient(app), session_id)
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "partial"
    assert data["cxas"]["status"] == "error"
    assert "n'est pas installée" in data["cxas"]["error"]
    assert data["hybridgnet"]["status"] == "ok"
    assert any("indisponible" in w for w in data["warnings"])


def test_anatomy_analysis_both_sources_fail(monkeypatch):
    _mock_engine_modules(
        monkeypatch,
        anatomy_result={"status": "error", "error": "aucune structure anatomique détectée dans cette image"},
        landmarks_raises=CheXmaskUnavailableError("poids du modèle non téléchargés"),
    )
    session_id = _create_session().id

    response = _post_anatomy_analysis(TestClient(app), session_id)
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "error"
    assert data["sources"] == ["CXAS", "HybridGNet"]
    assert data["cxas"]["status"] == "error"
    assert data["hybridgnet"]["status"] == "error"
    assert len(data["warnings"]) == 2


def test_anatomy_analysis_validation():
    client = TestClient(app)
    session_id = _create_session().id

    missing = client.post(f"/workspace/exams/{session_id}/anatomy-analysis", data={})
    assert missing.status_code == 422

    unknown_ws = _post_anatomy_analysis(client, "workspace-inconnu")
    assert unknown_ws.status_code == 404

    unknown_img = client.post(
        f"/workspace/exams/{session_id}/anatomy-analysis",
        data={"image_id": "img-inexistante"},
        files={"image": ("img.png", TINY_PNG, "image/png")},
    )
    assert unknown_img.status_code == 422

    bad_spacing = client.post(
        f"/workspace/exams/{session_id}/anatomy-analysis",
        data={"image_id": "img-1", "pixel_spacing_mm": "abc"},
        files={"image": ("img.png", TINY_PNG, "image/png")},
    )
    assert bad_spacing.status_code == 422


def test_anatomy_analysis_rejects_non_radiography_dicom():
    manifest = make_workspace_manifest(
        modalities=["CT", "CT", "CT"],
        source_kinds=["dicom", "dicom", "dicom"],
    )
    session = workspace_store.create(WorkspaceManifest.model_validate(manifest))
    response = _post_anatomy_analysis(TestClient(app), session.id)
    assert response.status_code == 422
    assert "CR/DX" in response.json()["detail"]


def test_is_cxas_infrastructure_error_helper():
    assert _is_cxas_infrastructure_error("La bibliothèque CXAS n'est pas installée sur ce poste.")
    assert _is_cxas_infrastructure_error("le pipeline n'a pas pu être instancié (poids non téléchargés)")
    assert not _is_cxas_infrastructure_error("aucune structure anatomique détectée dans cette image")
    assert not _is_cxas_infrastructure_error("Aucune anomalie détectée")
    assert not _is_cxas_infrastructure_error("")
    assert not _is_cxas_infrastructure_error(None)