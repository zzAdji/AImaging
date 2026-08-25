"""Service landmarks HybridGNet : point d'entrée pour l'API.

Le paquet ``chexmask`` (torch, torch_geometric) n'est importé qu'au
premier besoin ; ``preload()`` permet au serveur de charger le modèle
dès le démarrage. Le moteur est instancié **une seule fois** et partagé
entre les requêtes : le coût ``build_model`` + ``torch.load`` n'est plus
payé à chaque analyse.
"""

from __future__ import annotations

import logging
import threading
import time
from pathlib import Path
from typing import Any

import numpy as np

logger = logging.getLogger("server.chexmask_service")

_engine_lock = threading.Lock()
_engine: Any | None = None


def is_available() -> bool:
    """Le moteur (torch + torch_geometric + poids) est-il utilisable ?"""
    try:
        from chexmask.inference import DEFAULT_WEIGHTS, LandmarkInference  # noqa: PLC0415
    except Exception:  # torch / torch_geometric / torchvision absents
        return False
    return Path(DEFAULT_WEIGHTS).exists()


def get_engine():
    """Retourne l'instance unique du moteur (instanciation thread-safe).

    Les poids eux-mêmes restent chargés au premier accès au modèle, sauf si
    ``preload()`` a déjà été appelé (cas du démarrage du serveur).
    """
    global _engine
    if _engine is None:
        with _engine_lock:
            if _engine is None:
                from chexmask.inference import DEFAULT_WEIGHTS, LandmarkInference  # noqa: PLC0415

                _engine = LandmarkInference(weights_path=DEFAULT_WEIGHTS)
                logger.info("Moteur HybridGNet instancié (device=%s).", _engine.device)
    return _engine


def preload() -> None:
    """Charge le moteur ET ses poids immédiatement (appelé au démarrage).

    Lève l'exception sous-jacente en cas d'échec (poids absents, torch
    manquant...) ; l'appelant décide — le serveur l'enregistre dans les
    erreurs de démarrage sans bloquer.
    """
    engine = get_engine()
    engine.model  # force build_model + torch.load maintenant
    logger.info("HybridGNet préchargé (device=%s, poids=%s).", engine.device, engine.weights_path)


def is_loaded() -> bool:
    """Les poids HybridGNet sont-ils déjà en mémoire ?"""
    return _engine is not None and bool(getattr(_engine, "is_loaded", False))


def analyze_landmarks(
    image_path: Path,
    pixel_spacing_mm: tuple[float, float] | None = None,
    custom_measures: list[dict] | None = None,
    n_samples: int = 50,
) -> dict[str, Any]:
    """Landmarks poumons + cœur (avec incertitude) + mesures dérivées.

    Retourne un dict prêt à sérialiser ; lève ``CheXmaskUnavailableError``
    si le moteur est absent (le serveur traduit en 503).
    """
    from chexmask.measurements import (  # noqa: PLC0415
        compute_measurements,
        landmark_sets,
    )

    import cv2

    t0 = time.perf_counter()
    image = cv2.imread(str(image_path), cv2.IMREAD_UNCHANGED)
    if image is None:
        raise FileNotFoundError(f"Image illisible : {image_path}")

    # Moteur partagé entre requêtes : les poids ne sont chargés qu'une fois
    # (idéalement au démarrage via preload()), jamais à chaque appel.
    engine = get_engine()
    result = engine.predict_landmarks(image, n_samples=n_samples)

    computed = compute_measurements(result, pixel_spacing_mm=pixel_spacing_mm, custom_measures=custom_measures)
    sets = landmark_sets(result)

    uncertainty = computed["uncertainty"]
    inf_ms = round((time.perf_counter() - t0) * 1000, 1)
    logger.info(
        "HybridGNet: n_nodes=%d input_res=%dx%d output_res=1024x1024 unit=%s "
        "uncertainty_max_px=%.2f uncertainty_mean_px=%.2f device=%s n_samples=%d inference_ms=%.1f",
        len(result["nodes"]),
        np.shape(image)[1],
        np.shape(image)[0],
        computed["scale_used"],
        uncertainty.get("max_node_std_px", float("nan")),
        uncertainty.get("mean_node_std_px", float("nan")),
        engine.device,
        n_samples,
        inf_ms,
    )

    return {
        "status": "ok",
        "contours": sets,
        "measurements": computed["measurements"],
        "custom": computed["custom"],
        "warnings": computed["warnings"],
        "uncertainty": uncertainty,
        "scale_used": computed["scale_used"],
        "ctr_method": computed["ctr_method"],
        "lines": computed["lines"],
        "inference_time_ms": inf_ms,
    }