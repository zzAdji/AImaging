"""Résolution des statistiques de normalisation à appliquer au moment du
tensor (jamais gravées sur disque, voir le rationnel dans grayscale.py).

Ce module fait deux choses distinctes :
1. Résout les mean/std à utiliser pour l'entraînement, en délégant au
   backbone choisi (model_registry) — c'est la valeur réellement utilisée.
2. Calcule, à titre purement informatif pour le rapport, les statistiques
   mean/std réelles du dataset (niveaux de gris, échelle [0,1]). Cette
   valeur n'est PAS utilisée pour la normalisation par défaut (voir
   l'analyse de stratégie : ImageNet reste recommandé pour un transfer
   learning classique), mais elle est utile à documenter dans un rapport
   de stage pour justifier ce choix plutôt que de le supposer.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import List, Tuple

import numpy as np
from PIL import Image

from .config import ModelConfig
from .model_registry import get_backbone_spec
from .schemas import NormalizationStats

logger = logging.getLogger("preprocessing.normalization")


def resolve_normalization(model_config: ModelConfig) -> NormalizationStats:
    """Détermine les statistiques de normalisation à utiliser pour l'entraînement.

    Args:
        model_config: Configuration du backbone cible.

    Returns:
        NormalizationStats prête à être utilisée par torch_dataset.py et
        consignée dans le rapport.
    """
    spec = get_backbone_spec(
        model_config.architecture, model_config.pretrained, model_config.fallback_size
    )
    return NormalizationStats(
        architecture=spec.architecture,
        input_size=spec.input_size,
        mean=spec.mean,
        std=spec.std,
        source=spec.source,
    )


def compute_dataset_mean_std(
    processed_paths: List[Path], sample_size: int = 2000, seed: int = 42
) -> Tuple[float, float]:
    """Calcule mean/std réels du dataset (niveaux de gris, échelle [0,1]).

    Purement informatif (voir docstring du module) — n'échantillonne
    qu'un sous-ensemble pour rester rapide sur de gros datasets plutôt que
    de tout charger en mémoire.

    Args:
        processed_paths: Chemins des images déjà prétraitées (PNG grayscale).
        sample_size: Nombre max d'images échantillonnées.
        seed: Graine de l'échantillonnage.

    Returns:
        (mean, std) sur [0, 1].
    """
    if not processed_paths:
        return 0.0, 0.0

    rng = np.random.default_rng(seed)
    sample = rng.choice(
        np.array(processed_paths, dtype=object),
        size=min(sample_size, len(processed_paths)),
        replace=False,
    )

    pixel_sum, pixel_sq_sum, pixel_count = 0.0, 0.0, 0
    for path in sample:
        try:
            with Image.open(path) as img:
                arr = np.asarray(img, dtype=np.float64) / 255.0
            pixel_sum += arr.sum()
            pixel_sq_sum += (arr ** 2).sum()
            pixel_count += arr.size
        except Exception as exc:  # noqa: BLE001
            logger.warning("Impossible de lire %s pour le calcul de stats : %s", path, exc)

    if pixel_count == 0:
        return 0.0, 0.0

    mean = pixel_sum / pixel_count
    variance = max(pixel_sq_sum / pixel_count - mean ** 2, 0.0)
    return float(mean), float(variance ** 0.5)
