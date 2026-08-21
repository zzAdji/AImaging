"""Service landmarks HybridGNet : point d'entrée paresseux pour l'API.

Le paquet ``chexmask`` (torch, torch_geometric) n'est importé qu'à la
première analyse réelle ; le serveur démarre sans.
"""

from __future__ import annotations

import logging
import time
from pathlib import Path
from typing import Any

import numpy as np

logger = logging.getLogger("server.chexmask_service")


def is_available() -> bool:
    """Le moteur (torch + torch_geometric + poids) est-il utilisable ?"""
    try:
        from chexmask.inference import DEFAULT_WEIGHTS, LandmarkInference  # noqa: PLC0415
    except Exception:  # torch / torch_geometric / torchvision absents
        return False
    return Path(DEFAULT_WEIGHTS).exists()


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
    from chexmask.inference import LandmarkInference  # noqa: PLC0415
    from chexmask.measurements import (  # noqa: PLC0415
        compute_measurements,
        landmark_sets,
    )

    import cv2

    t0 = time.perf_counter()
    image = cv2.imread(str(image_path), cv2.IMREAD_UNCHANGED)
    if image is None:
        raise FileNotFoundError(f"Image illisible : {image_path}")

    engine = LandmarkInference(n_samples=n_samples)
    result = engine.predict_landmarks(image)

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