"""Tests unitaires du pont serveur -> backend « Neuro » (pathologies).

Le backend Neuro (Hugging Face Space) est mocké via un faux client HTTP :
on teste la logique de délégation de ``pathology_service`` et les endpoints
sans jamais ouvrir de socket.
"""

from __future__ import annotations

import httpx
import pytest
from fastapi.testclient import TestClient

import pathology_service


class _FakeResponse:
    def __init__(self, status_code: int, payload: dict | None = None, text: str = ""):
        self.status_code = status_code
        self._payload = payload or {}
        self.text = text or (payload and "")

    def json(self) -> dict:
        return self._payload


class _FakeClient:
    def __init__(self, requests: dict[tuple, _FakeResponse], timeout=None):
        self._requests = requests
        self._timeout = timeout
        self.calls: list[tuple] = []

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def get(self, url: str) -> _FakeResponse:
        self.calls.append(("GET", url))
        return self._requests.get(("GET", url), _FakeResponse(404))

    def post(self, url: str, files=None, data=None) -> _FakeResponse:
        self.calls.append(("POST", url, files, data))
        return self._requests.get(("POST", url), _FakeResponse(404))


@pytest.fixture(autouse=True)
def _clean_remote_url():
    """URL par défaut avant/après chaque test (pas de surcharge persistée)."""
    pathology_service.clear_persisted_remote_url()
    yield
    pathology_service.clear_persisted_remote_url()


def _patch_http(monkeypatch, requests: dict[tuple, _FakeResponse]) -> _FakeClient:
    client = _FakeClient(requests)

    def _factory(*args, **kwargs):
        return client

    monkeypatch.setattr(httpx, "Client", _factory)
    return client


def test_active_url_retombe_sur_le_defaut_public():
    assert pathology_service.get_remote_url() == ""
    assert pathology_service.active_url().startswith("https://")


def test_is_available_true_avec_health_ok(monkeypatch):
    _patch_http(monkeypatch, {
        ("GET", pathology_service.DEFAULT_NEURO_URL + "/health/"): _FakeResponse(
            200, {"status": "ok", "models_loaded": True}
        )
    })
    assert pathology_service.is_available() is True


def test_is_available_false_si_modeles_non_charges(monkeypatch):
    _patch_http(monkeypatch, {
        ("GET", pathology_service.DEFAULT_NEURO_URL + "/health/"): _FakeResponse(
            200, {"status": "ok", "models_loaded": False}
        )
    })
    assert pathology_service.is_available() is False


def test_detect_pathologies_envoie_un_multipart_vers_predict(monkeypatch):
    payload = {
        "status": "success",
        "positive_conditions": ["Effusion"],
        "yolo_boxes": [{"class": "Effusion", "conf": 0.7, "xyxy": [1, 2, 3, 4]}],
    }
    client = _patch_http(
        monkeypatch,
        {("POST", pathology_service.DEFAULT_NEURO_URL + "/predict"): _FakeResponse(200, payload)},
    )
    result = pathology_service.detect_pathologies(b"img-bytes", "radio.png")
    assert result["positive_conditions"] == ["Effusion"]
    method, url, files, _data = client.calls[0]
    assert method == "POST" and url.endswith("/predict")
    assert files["file"][0] == "radio.png"
    assert files["file"][1] == b"img-bytes"


def test_detect_pathologies_declare_un_mime_image(monkeypatch):
    """Nom sans extension image (ex. « scan.dcm », data-URL) : le content-type
    transmis à Neuro doit quand même être image/* (sinon 400 côté remote)."""
    captured: dict = {}

    def _capture_post(url, files=None, data=None):
        captured["files"] = files
        return _FakeResponse(200, {"status": "success", "positive_conditions": []})

    monkeypatch.setattr(pathology_service, "_WAKE_RETRY_DELAY_SECONDS", 0)

    class _CaptureClient(_FakeClient):
        def post(self, url, files=None, data=None):
            self.calls.append(("POST", url, files, data))
            return _capture_post(url, files=files, data=data)

    def _factory(*args, **kwargs):
        return _CaptureClient({})

    import httpx as _httpx

    monkeypatch.setattr(_httpx, "Client", _factory)

    # Octets PNG réels sous un nom « .dcm » : doit partir en image/png.
    png_bytes = b"\x89PNG\r\n\x1a\n" + b"\x00" * 8
    pathology_service.detect_pathologies(png_bytes, "scan.dcm")
    assert captured["files"]["file"][2] == "image/png"

    # Octets JPEG : image/jpeg.
    jpeg_bytes = b"\xff\xd8\xff\xe0" + b"\x00" * 8
    pathology_service.detect_pathologies(jpeg_bytes, "radio")
    assert captured["files"]["file"][2] == "image/jpeg"


def test_detect_pathologies_leve_si_backend_ko(monkeypatch):
    """Un 503 du Space déclenche réveil + retry, puis une erreur claire."""
    monkeypatch.setattr(pathology_service, "_WAKE_RETRY_DELAY_SECONDS", 0)
    _patch_http(monkeypatch, {
        ("POST", pathology_service.DEFAULT_NEURO_URL + "/predict"): _FakeResponse(503, text="cold start")
    })
    with pytest.raises(pathology_service.PathologyUnavailableError, match="endormi"):
        pathology_service.detect_pathologies(b"img", "radio.png")


# ---------------------------------------------------------------- Endpoints

def _make_workspace() -> str:
    from workspace_protocol import WorkspaceManifest
    from conftest import make_workspace_manifest
    from main import workspace_store

    raw = make_workspace_manifest(
        modalities=["CR"], source_kinds=["dicom"], image_ids=["img-1"], widths=[256]
    )
    session = workspace_store.create(WorkspaceManifest.model_validate(raw))
    return session.id


NEURO_PAYLOAD = {
    "status": "success",
    "predictions": {"Effusion": {"prob": 0.9, "positive": True}},
    "positive_conditions": ["Effusion"],
    "confirmed_findings": [{
        "condition": "Effusion", "prob": 0.9, "threshold": 0.52,
        "normalized_conf": 0.79, "risk": "HIGH",
    }],
    "risk_level": "HIGH",
    "localization_type": {"Effusion": "boxes_and_heatmap"},
    "images": {"original_b64": "AAA=", "heatmap_b64": "BBB=", "boxes_b64": "CCC=",
               "individual_heatmaps": {"Effusion": "BBB="}},
    "yolo_boxes": [{"class": "Effusion", "conf": 0.7, "xyxy": [1, 2, 3, 4]}],
    "case_flags": [],
}


def test_endpoint_detect_renvoie_le_resultat_neuro(monkeypatch):
    from main import app

    monkeypatch.setattr("main.detect_pathologies_remote", lambda data, filename: dict(NEURO_PAYLOAD))
    client = TestClient(app)
    workspace_id = _make_workspace()

    response = client.post(
        f"/workspace/exams/{workspace_id}/pathology/detect",
        data={"image_id": "img-1"},
        files={"image": ("radio.png", b"\x89PNG fake", "image/png")},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["result"]["risk_level"] == "HIGH"
    assert body["result"]["positive_conditions"] == ["Effusion"]
    assert body["result"]["yolo_boxes"][0]["class"] == "Effusion"


def test_endpoint_detect_503_si_backend_injoignable(monkeypatch):
    from main import PathologyUnavailableError, app

    def _raise(data, filename):
        raise PathologyUnavailableError("Backend Neuro injoignable")

    monkeypatch.setattr("main.detect_pathologies_remote", _raise)
    client = TestClient(app)
    workspace_id = _make_workspace()

    response = client.post(
        f"/workspace/exams/{workspace_id}/pathology/detect",
        data={"image_id": "img-1"},
        files={"image": ("radio.png", b"data", "image/png")},
    )
    assert response.status_code == 503


def test_endpoint_backend_info_sonde_le_remote(monkeypatch):
    from main import app

    monkeypatch.setattr(
        "main.probe_pathology_backend",
        lambda: {"status": "ok", "models_loaded": True},
    )
    client = TestClient(app)
    response = client.get("/workspace/pathology/backend")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["mode"] in {"remote-default", "remote-custom"}
    assert body["reachable"] is True