"""Tests unitaires du pont serveur -> microservice opencxr.

Le microservice opencxr (TensorFlow, Python 3.12) est mocké via un faux client
HTTP : on teste la logique de délégation de ``sorter_service`` sans jamais
charger tensorflow ni ouvrir de socket.
"""

from __future__ import annotations

import pytest

import sorter_service
import httpx
from fastapi.testclient import TestClient


class _FakeResponse:
    def __init__(self, status_code: int, payload: dict | None = None, text: str = ""):
        self.status_code = status_code
        self._payload = payload or {}
        self.text = text or (payload and "")

    def json(self) -> dict:
        return self._payload


class _FakeClient:
    """Client HTTP minimal retournant des réponses déterministes."""

    def __init__(self, requests: dict[str, _FakeResponse], timeout=None):
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
    """Réinitialise l'URL du microservice avant/après chaque test."""
    sorter_service.clear_persisted_remote_url()
    yield
    sorter_service.clear_persisted_remote_url()


def _patch_http(monkeypatch, requests: dict[tuple, _FakeResponse]) -> _FakeClient:
    client = _FakeClient(requests)

    def _factory(*args, **kwargs):
        return client

    monkeypatch.setattr(httpx, "Client", _factory)
    return client


def test_is_available_false_sans_url(monkeypatch):
    """Sans URL configurée, active_url() retombe sur le microservice local
    standard ; si ce dernier ne répond pas, le service est indisponible."""
    assert sorter_service.get_remote_url() == ""
    assert sorter_service.active_url() == sorter_service.DEFAULT_OPEN_CXR_URL
    _patch_http(monkeypatch, {})
    assert sorter_service.is_available() is False


def test_is_available_true_avec_health_ok(monkeypatch):
    sorter_service._remote_url = "http://127.0.0.1:8011"
    _patch_http(monkeypatch, {("GET", "http://127.0.0.1:8011/health"): _FakeResponse(200, {"status": "ok"})})
    assert sorter_service.is_available() is True


def test_is_available_false_si_health_ko(monkeypatch):
    sorter_service._remote_url = "http://127.0.0.1:8011"
    _patch_http(monkeypatch, {("GET", "http://127.0.0.1:8011/health"): _FakeResponse(200, {"status": "degraded"})})
    assert sorter_service.is_available() is False


def test_is_available_false_si_http_error(monkeypatch):
    sorter_service._remote_url = "http://127.0.0.1:8011"
    _patch_http(monkeypatch, {("GET", "http://127.0.0.1:8011/health"): _FakeResponse(500)})
    assert sorter_service.is_available() is False


def test_sort_image_envoie_un_multipart(monkeypatch):
    sorter_service._remote_url = "http://127.0.0.1:8011"
    payload = {"Type": "PA", "Rotation": "0", "Inversion": "No", "Lateral_Flip": "No", "inference_time_ms": 5.0}
    client = _patch_http(monkeypatch, {("POST", "http://127.0.0.1:8011/sort"): _FakeResponse(200, payload)})
    result = sorter_service.sort_image(b"\x89PNG fake", "img.png")
    assert result["Type"] == "PA"
    assert result["inference_time_ms"] == 5.0
    method, url, files, data = client.calls[0]
    assert method == "POST" and url == "http://127.0.0.1:8011/sort"
    assert files is not None and "image" in files


def test_standardize_image_passe_les_options(monkeypatch):
    sorter_service._remote_url = "http://127.0.0.1:8011"
    payload = {"image_data_url": "data:image/png;base64,abc", "width": 1024, "height": 1024, "size_changes": {}, "inference_time_ms": 12.3}
    client = _patch_http(monkeypatch, {("POST", "http://127.0.0.1:8011/standardize"): _FakeResponse(200, payload)})
    result = sorter_service.standardize_image(b"png", "img.png", do_crop_to_lung_box=False, final_square_size=512)
    assert result["width"] == 1024
    method, url, files, data = client.calls[0]
    assert url == "http://127.0.0.1:8011/standardize"
    assert data == {"do_crop_to_lung_box": "false", "final_square_size": "512"}


def test_standardize_image_transmet_pixel_spacing(monkeypatch):
    sorter_service._remote_url = "http://127.0.0.1:8011"
    payload = {"image_data_url": "data:image/png;base64,abc", "width": 1024, "height": 1024, "size_changes": {}, "inference_time_ms": 12.3}
    client = _patch_http(monkeypatch, {("POST", "http://127.0.0.1:8011/standardize"): _FakeResponse(200, payload)})
    sorter_service.standardize_image(
        b"png",
        "img.png",
        pixel_spacing_mm=(0.1688, 0.1688),
    )
    _, _, _, data = client.calls[0]
    assert data["pixel_spacing_mm"] == "0.1688,0.1688"


def test_sort_image_leve_unavailable_sur_503(monkeypatch):
    sorter_service._remote_url = "http://127.0.0.1:8011"
    _patch_http(monkeypatch, {("POST", "http://127.0.0.1:8011/sort"): _FakeResponse(503, text="service down")})
    with pytest.raises(sorter_service.OpenCxrUnavailableError):
        sorter_service.sort_image(b"data", "img.png")


def test_sort_image_sans_url_leve_unavailable(monkeypatch):
    """Sans URL configurée ET microservice local injoignable ⇒ erreur.

    Le service retombe sur DEFAULT_OPEN_CXR_URL (127.0.0.1:8011) : quand ce
    microservice tourne réellement sur la machine de dev, l'appel réussit et
    le test devenait intermittent selon l'état de la machine. On force donc
    un repli injoignable pour tester le contrat « indisponible ⇒ erreur ».
    """
    sorter_service._remote_url = ""
    monkeypatch.setattr(
        sorter_service,
        "DEFAULT_OPEN_CXR_URL",
        "http://127.0.0.1:9", # port discard : connexion refusée garantie
    )
    with pytest.raises(sorter_service.OpenCxrUnavailableError):
        sorter_service.sort_image(b"data", "img.png")


# ---------------------------------------------------------------- Phase 3

def _make_workspace(client, monkeypatch) -> str:
    """Crée un espace de travail CR copié sur la fixture conftest."""
    from workspace_protocol import WorkspaceManifest
    from conftest import make_workspace_manifest
    from main import workspace_store

    raw = make_workspace_manifest(
        modalities=["CR"], source_kinds=["dicom"], image_ids=["img-1"], widths=[256]
    )
    session = workspace_store.create(WorkspaceManifest.model_validate(raw))
    return session.id


def test_opencxr_sort_invalid_image_passe_en_200(monkeypatch):
    """Une image invalide → 200 avec REJECTED_INVALID_IMAGE (jamais un 4xx qui
    propagerait l'erreur brute SimpleITK à l'utilisateur, et jamais ACCEPTED)."""
    from main import app

    rejected_result = {
        "status": "REJECTED_INVALID_IMAGE",
        "is_cxr": False,
        "Type": "notCXR",
        "reason": "decode_failed",
        "decoder": "decode_failed",
        "inference_time_ms": 0.0,
    }
    monkeypatch.setattr("main.opencxr_available", lambda: True)
    monkeypatch.setattr(
        "main.opencxr_sort_image",
        lambda data, filename: dict(rejected_result),
    )
    client = TestClient(app)
    workspace_id = _make_workspace(client, monkeypatch)

    response = client.post(
        f"/workspace/exams/{workspace_id}/opencxr/sort",
        data={"image_id": "img-1"},
        files={"image": ("corrupt.png", b"this is not a png", "image/png")},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["result"]["status"] == "REJECTED_INVALID_IMAGE"
    assert body["result"]["is_cxr"] is False


def test_opencxr_sort_accepted_cxr_passe_les_statuts(monkeypatch):
    """Une image acceptée → 200 avec ACCEPTED_CXR + confidence, status préservés."""
    from main import app

    accepted_result = {
        "Type": "PA",
        "Type_Probs_PA_AP_lateral_notCXR": [0.9, 0.05, 0.04, 0.01],
        "status": "ACCEPTED_CXR",
        "is_cxr": True,
        "confidence": 0.99,
        "decoder": "simpleitk",
        "inference_time_ms": 7.5,
    }
    monkeypatch.setattr("main.opencxr_available", lambda: True)
    monkeypatch.setattr(
        "main.opencxr_sort_image",
        lambda data, filename: dict(accepted_result),
    )
    client = TestClient(app)
    workspace_id = _make_workspace(client, monkeypatch)

    response = client.post(
        f"/workspace/exams/{workspace_id}/opencxr/sort",
        data={"image_id": "img-1"},
        files={"image": ("radio.png", b"\x89PNG fake", "image/png")},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["result"]["status"] == "ACCEPTED_CXR"
    assert body["result"]["confidence"] == 0.99
