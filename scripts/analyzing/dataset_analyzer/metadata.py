"""Extraction des métadonnées par image et détection de corruption.

Ce module gère les deux vérifications les plus fondamentales du
pipeline : "ce fichier peut-il seulement être ouvert comme une image ?"
et, si oui, "quelles sont ses propriétés de base ?". Les deux opérations
sont I/O-bound (temps dominé par l'attente disque), la parallélisation se
fait donc via un pool de threads plutôt qu'un pool de processus.
"""

from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import List, Tuple

from PIL import Image, UnidentifiedImageError
from tqdm import tqdm

from .config import AnalyzerConfig
from .schemas import ImageRecord
from .utils import compute_sha256

logger = logging.getLogger("dataset_analyzer.metadata")

# Modes Pillow associés à un nombre de canaux. Tout mode non listé retombe
# sur len(mode), ce qui est correct pour l'immense majorité des cas.
_MODE_CHANNELS = {"1": 1, "L": 1, "P": 1, "RGB": 3, "RGBA": 4, "CMYK": 4, "YCbCr": 3}


def _extract_one(path: Path, class_name: str, valid_extensions: frozenset) -> ImageRecord:
    """Construit un ImageRecord complet pour un seul fichier.

    Ne lève jamais d'exception : tout échec est capturé sur le record
    (is_corrupted=True, corruption_reason=...) afin qu'un seul fichier
    défectueux ne puisse pas faire échouer un lot de dizaines de milliers
    d'images.
    """
    record = ImageRecord(path=path, class_name=class_name)

    if path.suffix.lower() not in valid_extensions:
        record.is_corrupted = True
        record.corruption_reason = f"invalid_extension:{path.suffix or '(aucune)'}"
        return record

    try:
        record.file_size_bytes = path.stat().st_size
    except OSError as exc:
        record.is_corrupted = True
        record.corruption_reason = f"unreadable_file_stat:{exc}"
        return record

    if record.file_size_bytes == 0:
        record.is_corrupted = True
        record.corruption_reason = "empty_file"
        return record

    try:
        with Image.open(path) as img:
            img.verify()  # Vérification structurelle légère, mais ferme le handle.
        with Image.open(path) as img:  # Réouverture : verify() rend l'image inutilisable.
            img.load()
            record.width, record.height = img.size
            record.image_format = img.format
            record.channels = _MODE_CHANNELS.get(img.mode, len(img.mode))
    except (UnidentifiedImageError, OSError, ValueError, SyntaxError) as exc:
        record.is_corrupted = True
        record.corruption_reason = f"unopenable_image:{exc}"
        return record

    try:
        record.sha256 = compute_sha256(path)
    except OSError as exc:
        logger.warning("Impossible de hacher %s : %s", path, exc)

    return record


class MetadataExtractor:
    """Extrait les métadonnées d'un lot d'images via un pool de threads."""

    def __init__(self, config: AnalyzerConfig) -> None:
        self.config = config

    def extract_all(self, files: List[Tuple[Path, str]]) -> List[ImageRecord]:
        """Extrait les métadonnées de chaque paire (chemin, classe).

        Args:
            files: Sortie de `utils.iter_image_files`, matérialisée en liste.

        Returns:
            Un ImageRecord par fichier d'entrée, dans un ordre non
            spécifié (l'analyzer ne fait qu'agréger ensuite, l'ordre n'a
            donc pas d'importance ici).
        """
        records: List[ImageRecord] = []
        with ThreadPoolExecutor(max_workers=self.config.num_workers) as pool:
            futures = {
                pool.submit(_extract_one, path, cls, self.config.valid_extensions): path
                for path, cls in files
            }
            for future in tqdm(
                as_completed(futures), total=len(futures), desc="Extraction métadonnées"
            ):
                try:
                    records.append(future.result())
                except Exception as exc:  # noqa: BLE001 - isole un worker défaillant
                    path = futures[future]
                    logger.error("Échec inattendu pour %s : %s", path, exc)
                    failed = ImageRecord(path=path, class_name=path.parent.name)
                    failed.is_corrupted = True
                    failed.corruption_reason = f"worker_exception:{exc}"
                    records.append(failed)

        logger.info("Métadonnées extraites pour %d fichier(s)", len(records))
        return records
