"""Intégration d'opencxr (Image Sorter + Normalisation CXR) au serveur.

opencxr exige TensorFlow, or le serveur principal tourne en Python 3.14 et il
n'existe aucune wheel ``cp314`` pour tensorflow. L'inference opencxr est donc
déléguée à un microservice Python 3.12 séparé (le venv ``.venv312``), rejoint
par HTTP — sur le même modèle que le backend 3D distant (``three_d_service``).

Le serveur démarre toujours sans opencxr : tant qu'aucune URL de microservice
n'est configurée, ``is_available()`` renvoie ``False`` et les endpoints opencxr
répondent 503 (dégradé, jamais bloquant).
"""

from __future__ import annotations

import json
import logging
import os
import threading
from pathlib import Path
from typing import Any

from config import OpenCxrServerConfig, PROJECT_ROOT

logger = logging.getLogger("server.sorter")

_REMOTE_CONFIG_FILE = PROJECT_ROOT / ".runtime" / "opencxr_remote.json"
_config = OpenCxrServerConfig()

_remote_url = _config.remote_url
_remote_url_lock = threading.Lock()

# URL du microservice opencxr local standard (celui de ``run_micro.bat``) :
# utilisé quand aucune URL n'est configurée (ni OPEN_CXR_URL, ni PUT backend).
DEFAULT_OPEN_CXR_URL = os.environ.get("OPEN_CXR_DEFAULT_URL", "http://127.0.0.1:8011").strip().rstrip("/")


class OpenCxrUnavailableError(RuntimeError):
    """Microservice opencxr absent, injoignable, ou en erreur."""


def _load_persisted_remote_url() -> None:
    global _remote_url
    try:
        if _REMOTE_CONFIG_FILE.is_file():
            data = json.loads(_REMOTE_CONFIG_FILE.read_text(encoding="utf-8"))
            saved = str(data.get("remote_url", "")).strip().rstrip("/")
            if saved:
                _remote_url = saved
                logger.info("URL du microservice opencxr rechargée : %s", saved)
    except Exception:  # noqa: BLE001
        logger.warning("Fichier de configuration opencxr illisible, ignoré.")


def get_remote_url() -> str:
    with _remote_url_lock:
        return _remote_url


def active_url() -> str:
    """URL effective du microservice : configurée, sinon le local standard."""
    configured = get_remote_url()
    return configured or DEFAULT_OPEN_CXR_URL


def set_remote_url(url: str) -> str:
    """Met à jour l'URL du microservice opencxr ('' pour le désactiver)."""
    global _remote_url
    normalized = (url or "").strip().rstrip("/")
    if normalized and not normalized.startswith(("http://", "https://")):
        raise ValueError("L'URL doit commencer par http:// ou https:// (ou être vide).")
    with _remote_url_lock:
        _remote_url = normalized
    try:
        _REMOTE_CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
        _REMOTE_CONFIG_FILE.write_text(
            json.dumps({"remote_url": normalized}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    except OSError as exc:  # noqa: BLE001
        logger.warning("Impossible de persister l'URL opencxr : %s", exc)
    logger.info("Microservice opencxr configuré : %r", normalized)
    return normalized


def clear_persisted_remote_url() -> None:
    try:
        _REMOTE_CONFIG_FILE.unlink(missing_ok=True)
    except OSError as exc:  # noqa: BLE001
        logger.warning("Impossible de supprimer le fichier opencxr : %s", exc)


_load_persisted_remote_url()

def _base_url() -> str:
    # Toujours une URL effective : la config (OPEN_CXR_URL / runtime) ou, à
    # défaut, le microservice opencxr local standard. On ne lève une erreur
    # qu'à l'appel (503), pas ici.
    return active_url()


def is_available() -> bool:
    """Le microservice opencxr est-il joignable ? (ne charge rien)."""
    url = active_url()
    try:
        import httpx

        with httpx.Client(timeout=_config.health_timeout_seconds, trust_env=False) as client:
            response = client.get(f"{url}/health")
        if response.status_code != 200:
            return False
        data = response.json()
        return data.get("status") == "ok"
    except Exception:  # noqa: BLE001
        return False


def probe_remote_backend() -> dict[str, Any] | None:
    """Renvoie la réponse /health du microservice, ou None s'il est injoignable."""
    url = active_url()
    try:
        import httpx

        with httpx.Client(timeout=_config.health_timeout_seconds, trust_env=False) as client:
            response = client.get(f"{url}/health")
        if response.status_code != 200:
            return None
        return response.json()
    except Exception:  # noqa: BLE001
        return None


def _raise_from_response(response, url: str) -> None:
    detail = (response.text or "")[:300]
    if response.status_code == 503:
        raise OpenCxrUnavailableError(f"Microservice opencxr indisponible ({url}) : {detail}")
    raise OpenCxrUnavailableError(
        f"Microservice opencxr en erreur (HTTP {response.status_code}) : {detail}"
    )


def sort_image(image: bytes, filename: str) -> dict[str, Any]:
    """Classifie une radio via l'Image Sorter opencxr (délégation HTTP)."""
    url = _base_url()
    try:
        import httpx

        with httpx.Client(timeout=_config.timeout_seconds, trust_env=False) as client:
            response = client.post(f"{url}/sort", files={"image": (filename, image)})
    except httpx.HTTPError as exc:
        raise OpenCxrUnavailableError(f"Microservice opencxr injoignable ({url}) : {exc}") from exc
    if response.status_code != 200:
        _raise_from_response(response, url)
    return response.json()


def standardize_image(
    image: bytes,
    filename: str,
    *,
    do_crop_to_lung_box: bool = True,
    final_square_size: int = 1024,
    pixel_spacing_mm: tuple[float, float] | None = None,
) -> dict[str, Any]:
    """Normalise une radio frontale via opencxr (délégation HTTP)."""
    url = _base_url()
    form_data: dict[str, str] = {
        "do_crop_to_lung_box": "true" if do_crop_to_lung_box else "false",
        "final_square_size": str(final_square_size),
    }
    if pixel_spacing_mm is not None:
        form_data["pixel_spacing_mm"] = ",".join(str(value) for value in pixel_spacing_mm)
    try:
        import httpx

        with httpx.Client(timeout=_config.timeout_seconds, trust_env=False) as client:
            response = client.post(
                f"{url}/standardize",
                files={"image": (filename, image)},
                data=form_data,
            )
    except httpx.HTTPError as exc:
        raise OpenCxrUnavailableError(f"Microservice opencxr injoignable ({url}) : {exc}") from exc
    if response.status_code != 200:
        _raise_from_response(response, url)
    return response.json()
