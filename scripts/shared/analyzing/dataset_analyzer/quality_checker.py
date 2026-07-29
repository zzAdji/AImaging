"""Détection des images atypiques : taille, luminosité, contraste anormaux.

Ces vérifications ne s'exécutent que sur les images ayant déjà passé le
contrôle de corruption (metadata.py), opèrent sur les données pixel
brutes, et sont donc CPU-bound. Un pool de processus est utilisé plutôt
qu'un pool de threads pour exploiter réellement plusieurs cœurs (le GIL
bloquerait des threads sur du calcul numpy pur).
"""

from __future__ import annotations

import logging
from concurrent.futures import ProcessPoolExecutor, as_completed
from typing import List

import numpy as np
from PIL import Image
from tqdm import tqdm

from .config import AnalyzerConfig
from .schemas import ImageRecord

logger = logging.getLogger("dataset_analyzer.quality_checker")


def _check_one(record: ImageRecord, config: AnalyzerConfig) -> ImageRecord:
    """Renseigne is_atypical / atypical_reasons sur un seul record.

    Prend et retourne un ImageRecord complet afin que le processus 
    worker dispose de tout ce dont il a besoin sans lookup partagé, 
    et que le processus parent puisse simplement remplacer
    sa copie par le résultat.
    """
    reasons: List[str] = []

    if record.width is not None and record.height is not None:
        if record.width < config.min_width or record.height < config.min_height:
            reasons.append("too_small")
        if record.width > config.max_width or record.height > config.max_height:
            reasons.append("too_large")

    try:
        with Image.open(record.path) as img:
            gray = np.asarray(img.convert("L"), dtype=np.float32)
        mean_val = float(gray.mean())
        std_val = float(gray.std())

        if mean_val <= config.black_pixel_mean_threshold:
            reasons.append("mostly_black")
        if mean_val >= config.white_pixel_mean_threshold:
            reasons.append("mostly_white")
        if std_val <= config.low_contrast_std_threshold:
            reasons.append("low_contrast")
    except Exception as exc:  # noqa: BLE001 - un échec pixel n'est pas fatal
        logger.warning("Vérification pixel impossible pour %s : %s", record.path, exc)

    record.atypical_reasons = reasons
    record.is_atypical = len(reasons) > 0
    return record


class QualityChecker:
    """Exécute la détection d'images atypiques sur un lot de records valides."""

    def __init__(self, config: AnalyzerConfig) -> None:
        self.config = config

    def check_all(self, records: List[ImageRecord]) -> List[ImageRecord]:
        """Vérifie chaque record non corrompu pour des statistiques pixel anormales.

        Les records corrompus sont retournés inchangés : il n'y a pas de
        données pixel à vérifier, et ils sont déjà signalés ailleurs.

        Args:
            records: Records produits par MetadataExtractor.

        Returns:
            Les mêmes records, avec is_atypical / atypical_reasons
            renseignés pour chaque record ayant des données pixel valides.
        """
        valid = [r for r in records if not r.is_corrupted]
        corrupted = [r for r in records if r.is_corrupted]

        checked: List[ImageRecord] = []
        with ProcessPoolExecutor(max_workers=self.config.num_workers) as pool:
            futures = {pool.submit(_check_one, r, self.config): r for r in valid}
            for future in tqdm(
                as_completed(futures), total=len(futures), desc="Détection images atypiques"
            ):
                try:
                    checked.append(future.result())
                except Exception as exc:  # noqa: BLE001
                    original = futures[future]
                    logger.error(
                        "Échec vérification qualité pour %s : %s", original.path, exc
                    )
                    checked.append(original)

        n_atypical = sum(1 for r in checked if r.is_atypical)
        logger.info("%d image(s) atypique(s) détectée(s) sur %d", n_atypical, len(checked))
        return checked + corrupted
