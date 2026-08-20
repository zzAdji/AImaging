"""Tests unitaires et d'intégration pour le prompt et l'endpoint des régions anatomiques."""

from __future__ import annotations

from unittest.mock import MagicMock

from fastapi.testclient import TestClient

from agent_context import WorkspaceAnatomyContext
from main import app, registry, workspace_store, WorkspaceAnatomyRegionsResponse
from region_anatomy_prompt import build_region_anatomy_prompt
from workspace_protocol import WorkspaceManifest


SAMPLE_REGIONS = [
    {
        "id": "apex-droit",
        "label": "Apex droit",
        "structures": ["right lung"],
        "reference": "Sommet pulmonaire clair, plèvre apicale fine.",
    },
    {
        "id": "silhouette-cardiaque",
        "label": "Silhouette cardiaque",
        "structures": ["heart"],
        "reference": "Index cardio-thoracique < 50 %.",
    },
]

SAMPLE_ANATOMY = WorkspaceAnatomyContext(
    status="ok",
    measurements={"Cardio-Thoracic Ratio": {"available": True, "value": 0.48}},
    areas_px={"right lung": 35000.0, "heart": 18000.0},
    labels={"135": "right lung", "121": "heart"},
)


def test_build_region_anatomy_prompt_with_attached_image():
    prompt = build_region_anatomy_prompt(
        image_id="img-1",
        anatomy=SAMPLE_ANATOMY,
        regions=SAMPLE_REGIONS,
        image_attached=True,
    )
    assert "Tu es un assistant radiologique" in prompt
    assert "Une capture de l'image courante (annotée) est jointe" in prompt
    assert "apex-droit" in prompt
    assert "silhouette-cardiaque" in prompt
    assert "Cardio-Thoracic Ratio" in prompt
    assert "RÈGLES STRICTES" in prompt


def test_build_region_anatomy_prompt_without_attached_image():
    prompt = build_region_anatomy_prompt(
        image_id="img-1",
        anatomy=SAMPLE_ANATOMY,
        regions=SAMPLE_REGIONS,
        image_attached=False,
    )
    assert "Tu es un assistant radiologique" in prompt
    assert "Aucune capture d'image n'est jointe" in prompt
    assert "RÈGLES STRICTES" in prompt
    assert "règle 7" in prompt.lower() or "analyse basée sur les données cxas" in prompt.lower()


def test_anatomy_regions_endpoint_workspace_not_found():
    client = TestClient(app)
    response = client.post(
        "/workspace/exams/non-existent-workspace-id/anatomy/regions",
        json={
            "image_id": "img-1",
            "canvas_data_url": None,
            "anatomy": SAMPLE_ANATOMY.model_dump(),
            "regions": SAMPLE_REGIONS,
        },
    )
    assert response.status_code == 404
    assert "introuvable" in response.json()["detail"]


def test_anatomy_regions_endpoint_gemini_offline(monkeypatch):
    manifest_data = {
        "protocol_version": "1.0",
        "exam_id": "exam-test",
        "exam_name": "Test Exam",
        "active_image_id": "img-1",
        "images": [
            {
                "image_id": "img-1",
                "name": "Radio face",
                "width": 1024,
                "height": 1024,
                "source_kind": "dicom",
                "canvas": {"shapes": []},
            }
        ],
    }
    session = workspace_store.create(WorkspaceManifest.model_validate(manifest_data))

    # Simuler Gemini non configuré
    monkeypatch.setattr(registry, "gemini_client", None)

    client = TestClient(app)
    response = client.post(
        f"/workspace/exams/{session.id}/anatomy/regions",
        json={
            "image_id": "img-1",
            "canvas_data_url": None,
            "anatomy": SAMPLE_ANATOMY.model_dump(),
            "regions": SAMPLE_REGIONS,
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert "region_texts" in data
    assert data["region_texts"]["apex-droit"] == "Interprétation IA indisponible (service hors ligne)."
    assert data["region_texts"]["silhouette-cardiaque"] == "Interprétation IA indisponible (service hors ligne)."


def test_anatomy_regions_endpoint_with_mocked_gemini(monkeypatch):
    manifest_data = {
        "protocol_version": "1.0",
        "exam_id": "exam-test",
        "exam_name": "Test Exam",
        "active_image_id": "img-1",
        "images": [
            {
                "image_id": "img-1",
                "name": "Radio face",
                "width": 1024,
                "height": 1024,
                "source_kind": "dicom",
                "canvas": {"shapes": []},
            }
        ],
    }
    session = workspace_store.create(WorkspaceManifest.model_validate(manifest_data))

    mock_client = MagicMock()
    mock_client.generate_json_validated.return_value = WorkspaceAnatomyRegionsResponse(
        region_texts={
            "apex-droit": "Apex droit : transparence pulmonaire normale, pas d'opacité suspecte.",
            "silhouette-cardiaque": "Silhouette cardiaque : index cardio-thoracique mesuré à 0,48, contours réguliers.",
        }
    )
    monkeypatch.setattr(registry, "gemini_client", mock_client)

    client = TestClient(app)
    # Test avec un canvas_data_url valide (PNG 1x1 base64)
    canvas_b64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
    response = client.post(
        f"/workspace/exams/{session.id}/anatomy/regions",
        json={
            "image_id": "img-1",
            "canvas_data_url": canvas_b64,
            "anatomy": SAMPLE_ANATOMY.model_dump(),
            "regions": SAMPLE_REGIONS,
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert "region_texts" in data
    assert "transparence pulmonaire normale" in data["region_texts"]["apex-droit"]
    assert "0,48" in data["region_texts"]["silhouette-cardiaque"]
    assert mock_client.generate_json_validated.called
