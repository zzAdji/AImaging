"""Pont vers le backend « Neuro » (CXR-Pathology_Analysis).

Le projet Neuro expose une API FastAPI (Hugging Face Space) combinant :
- classification multi-labels DenseNet-121 (14 pathologies NIH) avec
  heatmaps Grad-CAM par pathologie positive ;
- détection YOLOv8s (bounding boxes ChestX-Det) filtrée par les classes
  confirmées par la classification.

Contrairement à opencxr, il n'existe pas d'instance locale de repli :
l'URL par défaut pointe sur le Space public communiqué. Le serveur reste
utilisable si le service est injoignable — les endpoints répondent alors
503 (dégradé, jamais bloquant), sur le modèle de ``sorter_service``.
"""

from __future__ import annotations

import json
import logging
import threading
import time
from pathlib import Path
from typing import Any

from config import NeuroServerConfig, PROJECT_ROOT

logger = logging.getLogger("server.pathology")

_REMOTE_CONFIG_FILE = PROJECT_ROOT / ".runtime" / "neuro_remote.json"
_config = NeuroServerConfig()

# Délai avant la 2e tentative après le ping de réveil du Space.
_WAKE_RETRY_DELAY_SECONDS = 8.0

# URL par défaut (Space public communiqué) : utilisée tant qu'aucune URL
# personnalisée n'est configurée via NEURO_BACKEND_URL ou l'endpoint PUT.
DEFAULT_NEURO_URL = _config.remote_url

_remote_url_lock = threading.Lock()
_remote_url_override: str = ""


class PathologyUnavailableError(RuntimeError):
    """Backend Neuro absent, injoignable, ou en erreur."""


def _load_persisted_remote_url() -> None:
    global _remote_url_override
    try:
        if _REMOTE_CONFIG_FILE.is_file():
            data = json.loads(_REMOTE_CONFIG_FILE.read_text(encoding="utf-8"))
            saved = str(data.get("remote_url", "")).strip().rstrip("/")
            if saved:
                _remote_url_override = saved
                logger.info("URL du backend Neuro rechargée : %s", saved)
    except Exception:  # noqa: BLE001
        logger.warning("Fichier de configuration Neuro illisible, ignoré.")


def get_remote_url() -> str:
    """Surcharge configurée ('' = utiliser l'URL par défaut)."""
    with _remote_url_lock:
        return _remote_url_override


def active_url() -> str:
    """URL effective du backend Neuro : surcharge, sinon défaut public."""
    return get_remote_url() or DEFAULT_NEURO_URL


def set_remote_url(url: str) -> str:
    """Définit une surcharge d'URL ('' = revenir au défaut)."""
    global _remote_url_override
    normalized = (url or "").strip().rstrip("/")
    if normalized and not normalized.startswith(("http://", "https://")):
        raise ValueError("L'URL doit commencer par http:// ou https:// (ou être vide).")
    with _remote_url_lock:
        _remote_url_override = normalized
    try:
        _REMOTE_CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
        if normalized:
            _REMOTE_CONFIG_FILE.write_text(
                json.dumps({"remote_url": normalized}, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        else:
            _REMOTE_CONFIG_FILE.unlink(missing_ok=True)
    except OSError as exc:  # noqa: BLE001
        logger.warning("Impossible de persister l'URL Neuro : %s", exc)
    logger.info("Backend Neuro configuré : %r (surcharge)", normalized or "<défaut>")
    return normalized


def clear_persisted_remote_url() -> None:
    global _remote_url_override
    try:
        _REMOTE_CONFIG_FILE.unlink(missing_ok=True)
    except OSError as exc:  # noqa: BLE001
        logger.warning("Impossible de supprimer le fichier Neuro : %s", exc)
    _remote_url_override = ""


_load_persisted_remote_url()


def probe_remote_backend() -> dict[str, Any] | None:
    """Renvoie la réponse /health du backend, ou None s'il est injoignable."""
    url = active_url()
    try:
        import httpx

        # follow_redirects : le Space HF peut rediriger /health/ -> /health (307).
        with httpx.Client(timeout=_config.health_timeout_seconds, trust_env=False, follow_redirects=True) as client:
            response = client.get(f"{url}/health/")
        if response.status_code != 200:
            return None
        return response.json()
    except Exception:  # noqa: BLE001
        return None


def is_available() -> bool:
    """Le backend Neuro est-il joignable avec ses modèles chargés ?"""
    data = probe_remote_backend()
    return bool(data and data.get("status") == "ok" and data.get("models_loaded"))


def _sniff_image_mime(data: bytes) -> str:
    """Type MIME réel de l'image, déduit de sa signature binaire.

    Le front peut envoyer la photo sous un nom sans extension d'image
    (ex. « scan.dcm », data-URL…) ; le backend Neuro refuse tout fichier
    dont le content_type ne commence pas par ``image/``. PIL, lui, lit le
    format réel des octets : déclarer le MIME sniffé est donc toujours sûr.
    """
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8"):
        return "image/jpeg"
    if data.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    if data.startswith(b"BM"):
        return "image/bmp"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    # TIFF (petit/boutiste) — sinon défaut sûr accepté par PIL.
    if data[:2] in (b"II", b"MM"):
        return "image/tiff"
    return "image/png"


def detect_pathologies(image: bytes, filename: str) -> dict[str, Any]:
    """Analyse une radio via le pipeline Neuro (délégation HTTP).

    Retourne le JSON unifié de ``/predict`` : prédictions par classe,
    findings confirmés, niveau de risque, heatmaps Grad-CAM et boxes YOLO
    (base64). Lève ``PathologyUnavailableError`` si le backend est injoignable.

    Le Space Hugging Face s'endort après inactivité : sur une erreur 5xx du
    remote, on le réveille (ping /health/) puis on retente une fois avant
    d'abandonner — l'utilisateur n'a plus à relancer manuellement.
    """
    url = active_url()
    try:
        import httpx

        # Content-type explicite déduit des octets réels : jamais application/
        # octet-stream ni application/dicom, que Neuro rejette (HTTP 400
        # « file provided is not an image »).
        files = {"file": (filename, image, _sniff_image_mime(image))}
        # follow_redirects : le Space HF peut rediriger les routes (307).
        with httpx.Client(timeout=_config.timeout_seconds, trust_env=False, follow_redirects=True) as client:
            response = client.post(f"{url}/predict", files=files)
            if response.status_code >= 500:
                # Cold start / Space endormi : ping de réveil puis 1 retry.
                logger.warning("Backend Neuro en erreur %s : tentative de réveil.", response.status_code)
                try:
                    client.get(f"{url}/health/", timeout=_config.health_timeout_seconds)
                except Exception:  # noqa: BLE001
                    pass
                time.sleep(_WAKE_RETRY_DELAY_SECONDS)
                response = client.post(f"{url}/predict", files=files)
    except Exception as exc:  # noqa: BLE001
        raise PathologyUnavailableError(f"Backend Neuro injoignable ({url}) : {exc}") from exc
    if response.status_code != 200:
        if response.status_code in (502, 503):
            raise PathologyUnavailableError(
                "Backend Neuro endormi ou en redémarrage (cold start). "
                "Réessayez dans environ une minute."
            )
        detail = (response.text or "")[:300]
        raise PathologyUnavailableError(
            f"Backend Neuro en erreur (HTTP {response.status_code}) ({url}) : {detail}"
        )
    return response.json()