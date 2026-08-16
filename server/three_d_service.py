"""Reconstruction 3D (DeepScan3D/GRAF) d'une radio du workspace.

La reconstruction dure plusieurs minutes sur CPU : elle s'exécute dans un
thread de travail et expose sa progression via des jobs interrogables, afin
de ne jamais bloquer la boucle d'événements FastAPI (une seule reconstruction
à la fois, le CPU étant le facteur limitant).

Mode distant (THREE_D_REMOTE_URL) : la reconstruction est déléguée à un
service 3D hébergé ailleurs (ex. notebook Kaggle GPU derrière un tunnel).
L'API locale ne change pas : POST /3d → 202 + job, et le statut est pollé
vias GET .../3d/jobs/{job_id}, mais le calcul s'exécute côté service distant.
"""

from __future__ import annotations

import json
import logging
import os
import threading
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from config import PROJECT_ROOT

logger = logging.getLogger("server.three_d")

THREE_D_CHECKPOINT = PROJECT_ROOT / "models" / "3D_maker" / "model_best.pt"

# ---------------------------------------------------------------------------
# Backend de reconstruction configurable à chaud :
#   - vide        => reconstruction locale (CPU)
#   - http(s)://… => délégation vers un service 3D distant (ex. tunnel Kaggle GPU)
# L'URL est surchargeable à l'exécution via set_remote_url() (persistée sur
# disque pour survivre aux redémarrages) et initialisée depuis l'environnement.
# ---------------------------------------------------------------------------
_REMOTE_CONFIG_FILE = PROJECT_ROOT / ".runtime" / "three_d_remote.json"

_remote_url = os.environ.get("THREE_D_REMOTE_URL", "").strip().rstrip("/")
_remote_url_lock = threading.Lock()


def _load_persisted_remote_url() -> str:
    global _remote_url
    try:
        if _REMOTE_CONFIG_FILE.is_file():
            data = json.loads(_REMOTE_CONFIG_FILE.read_text(encoding="utf-8"))
            saved = str(data.get("remote_url", "")).strip().rstrip("/")
            if saved:
                _remote_url = saved
                logger.info("URL du service 3D distant rechargée : %s", saved)
    except Exception:  # noqa: BLE001
        logger.warning("Fichier de configuration 3D distant illisible, ignoré.")


def get_remote_url() -> str:
    with _remote_url_lock:
        return _remote_url


def set_remote_url(url: str) -> str:
    """Met à jour l'URL du service 3D distant ('' pour revenir en local)."""
    global _remote_url
    normalized = url.strip().rstrip("/")
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
        logger.warning("Impossible de persister l'URL 3D : %s", exc)
    logger.info("Service 3D distant configuré : %r", normalized)
    return normalized


def clear_persisted_remote_url() -> None:
    try:
        _REMOTE_CONFIG_FILE.unlink(missing_ok=True)
    except OSError as exc:  # noqa: BLE001
        logger.warning("Impossible de supprimer le fichier 3D distant : %s", exc)


_load_persisted_remote_url()

_generators: dict[str, object] = {}
_jobs: dict[str, "ThreeDJob"] = {}
_jobs_lock = threading.Lock()
_running_count = 0

# Job distant : mémorise le workspace d'origine pour vérifier l'accès.
_remote_meta: dict[str, dict[str, str]] = {}


class ReconstructionBusyError(RuntimeError):
    """Une reconstruction est déjà en cours sur ce serveur."""


class RemoteThreeDUnavailable(RuntimeError):
    """Le service 3D distant (GPU) est injoignable ou a répondu en erreur."""


@dataclass
class ThreeDJob:
    job_id: str
    workspace_id: str
    image_id: str
    image_name: str
    iterations: int
    status: str = "queued"  # queued | running | done | error
    progress_fraction: float = 0.0
    progress_message: str = "En attente de démarrage…"
    result: dict[str, Any] | None = None
    error: str | None = None
    created_at: str = field(default_factory=lambda: datetime.now(UTC).isoformat())

    def snapshot(self) -> dict[str, Any]:
        with _jobs_lock:
            return {
                "job_id": self.job_id,
                "workspace_id": self.workspace_id,
                "image_id": self.image_id,
                "image_name": self.image_name,
                "status": self.status,
                "progress": {"fraction": self.progress_fraction, "message": self.progress_message},
                "result": self.result,
                "error": self.error,
                "created_at": self.created_at,
            }


def _load_generator(device: str) -> object:
    """Charge le générateur DeepScan3D en cache (un exemplaire par device)."""
    import torch
    from three_d_maker.graf_model import load_generator

    if device not in _generators:
        _generators[device] = load_generator(THREE_D_CHECKPOINT, torch.device(device))
        _generators[device].eval()
        logger.info("Générateur 3D chargé (device=%s).", device)
    return _generators[device]


def _resolve_device() -> str:
    import torch

    return "cuda" if torch.cuda.is_available() else "cpu"


def get_job(job_id: str) -> dict[str, Any] | None:
    if get_remote_url():
        return _get_remote_job(job_id)
    with _jobs_lock:
        job = _jobs.get(job_id)
        return job.snapshot() if job is not None else None


def start_reconstruction(
    image_bytes: bytes,
    *,
    workspace_id: str,
    image_id: str,
    image_name: str,
    iterations: int,
) -> dict[str, Any]:
    """Lance la reconstruction (locale ou distant) et retourne l'instantané du job."""
    if get_remote_url():
        return _start_remote_reconstruction(
            image_bytes,
            workspace_id=workspace_id,
            image_id=image_id,
            image_name=image_name,
            iterations=iterations,
        )
    global _running_count
    with _jobs_lock:
        if _running_count > 0:
            raise ReconstructionBusyError(
                "Une reconstruction 3D est déjà en cours sur ce serveur. "
                "Attendez la fin de la tâche en cours avant d'en lancer une nouvelle."
            )
        _running_count += 1
        job = ThreeDJob(
            job_id=f"3d-{int(time.time() * 1000)}",
            workspace_id=workspace_id,
            image_id=image_id,
            image_name=image_name,
            iterations=iterations,
        )
        _jobs[job.job_id] = job

    thread = threading.Thread(
        target=_run_job,
        args=(job, image_bytes, iterations),
        name=f"three-d-{job.job_id}",
        daemon=True,
    )
    thread.start()
    logger.info("Reconstruction 3D démarrée : job=%s image=%s (%d itérations).", job.job_id, image_name, iterations)
    return job.snapshot()


# ---------------------------------------------------------------------------
# Mode distant : délègue au service 3D GPU (URL configurable, voir ci-dessus).
# ---------------------------------------------------------------------------
def _remote_base() -> str:
    base = get_remote_url()
    if not base:
        raise RemoteThreeDUnavailable("Aucun service 3D distant configuré.")
    return base


def probe_remote_backend(timeout: float = 8.0, attempts: int = 3) -> dict[str, Any] | None:
    """Interroge /health du service distant ; None si injoignable.

    Un quick-tunnel Cloudflare met parfois plusieurs secondes à router la
    première requête (« froide ») venant d'une nouvelle IP. On retente donc
    quelques fois avec un délai croissant au lieu d'abandonner après un seul
    timeout court — sinon le lien pourtant valide apparaît « injoignable ».
    """
    base = get_remote_url()
    if not base:
        return None
    import httpx

    for attempt in range(attempts):
        try:
            with httpx.Client(timeout=timeout) as client:
                response = client.get(f"{base}/health")
            if response.status_code == 200:
                return response.json()
            logger.warning(
                "Sonde 3D distante : HTTP %s (tentative %d/%d)",
                response.status_code, attempt + 1, attempts,
            )
        except httpx.HTTPError as exc:
            logger.warning(
                "Sonde 3D distante injoignable (tentative %d/%d) : %s",
                attempt + 1, attempts, exc,
            )
        if attempt + 1 < attempts:
            time.sleep((attempt + 1))
    return None


def _start_remote_reconstruction(
    image_bytes: bytes,
    *,
    workspace_id: str,
    image_id: str,
    image_name: str,
    iterations: int,
) -> dict[str, Any]:
    import httpx

    url = f"{_remote_base()}/v1/reconstruct"
    try:
        with httpx.Client(timeout=45.0) as client:
            response = client.post(
                url,
                files={"image": (f"{image_name or 'radio'}.jpg", image_bytes, "image/jpeg")},
                data={"image_id": image_id, "iterations": str(iterations)},
            )
    except httpx.HTTPError as exc:
        raise RemoteThreeDUnavailable(f"Service 3D distant injoignable ({url}) : {exc}") from exc

    if response.status_code == 409:
        detail = response.json().get("detail", "Une reconstruction 3D est déjà en cours sur le serveur GPU.")
        raise ReconstructionBusyError(detail)
    if response.status_code != 202:
        raise RemoteThreeDUnavailable(
            f"Service 3D distant a refusé la reconstruction (HTTP {response.status_code}) : {response.text[:300]}"
        )

    payload = response.json()
    job_id = str(payload["job_id"])
    with _jobs_lock:
        _remote_meta[job_id] = {
            "workspace_id": workspace_id,
            "image_id": image_id,
            "image_name": image_name,
        }
    logger.info("Reconstruction 3D distante démarrée : job=%s image=%s (%d itérations).", job_id, image_name, iterations)
    return {
        "job_id": job_id,
        "workspace_id": workspace_id,
        "image_id": image_id,
        "image_name": image_name,
        "status": payload.get("status", "queued"),
        "progress": payload.get("progress", {}),
        "result": None,
        "error": payload.get("error"),
        "created_at": payload.get("created_at"),
    }


def _get_remote_job(job_id: str) -> dict[str, Any] | None:
    import httpx

    with _jobs_lock:
        meta = _remote_meta.get(job_id)
    if meta is None:
        return None

    url = f"{_remote_base()}/v1/jobs/{job_id}"
    try:
        with httpx.Client(timeout=45.0) as client:
            response = client.get(url)
    except httpx.HTTPError as exc:
        raise RemoteThreeDUnavailable(f"Service 3D distant injoignable ({url}) : {exc}") from exc

    if response.status_code == 404:
        return None
    if response.status_code != 200:
        raise RemoteThreeDUnavailable(
            f"Service 3D distant en erreur (HTTP {response.status_code}) : {response.text[:300]}"
        )

    payload = response.json()
    return {
        "job_id": job_id,
        "workspace_id": meta["workspace_id"],
        "image_id": meta["image_id"],
        "image_name": meta["image_name"],
        "status": payload.get("status", "error"),
        "progress": payload.get("progress", {}),
        "result": payload.get("result"),
        "error": payload.get("error"),
        "created_at": payload.get("created_at"),
    }


def _run_job(job: ThreeDJob, image_bytes: bytes, iterations: int) -> None:
    global _running_count
    try:
        from three_d_maker.reconstruct import reconstruct_volume

        device = _resolve_device()
        _load_generator(device)

        def progress(fraction: float, message: str) -> None:
            with _jobs_lock:
                job.status = "running"
                job.progress_fraction = fraction
                job.progress_message = message
            logger.info("Reconstruction 3D [%s] %3.0f%% : %s", job.job_id, fraction * 100, message)

        result = reconstruct_volume(
            image_bytes,
            THREE_D_CHECKPOINT,
            progress=progress,
            device=device,
            n_iter=iterations,
        )
        with _jobs_lock:
            job.status = "done"
            job.progress_fraction = 1.0
            job.progress_message = "Reconstruction terminée."
            job.result = {
                "frames": result.frames,
                "volume": result.volume,
                "loss_history": result.loss_history,
                "device": result.device,
                "elapsed_sec": round(result.elapsed_sec, 2),
                "generated_at": datetime.now(UTC).isoformat(),
                "checkpoint": THREE_D_CHECKPOINT.name,
            }
        logger.info("Reconstruction 3D [%s] terminée en %.0f s.", job.job_id, result.elapsed_sec)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Reconstruction 3D [%s] en échec.", job.job_id)
        with _jobs_lock:
            job.status = "error"
            job.error = str(exc)
    finally:
        with _jobs_lock:
            _running_count -= 1