"""Orchestration du prétraitement déterministe complet.

Ne fait volontairement AUCUNE augmentation ni normalisation mean/std :
ces étapes sont appliquées à la volée au moment de l'entraînement (voir
torch_dataset.py). Ce module se contente de matérialiser sur disque une
version propre, uniforme, en niveaux de gris, redimensionnée avec
préservation du ratio — jamais les images originales.
"""

from __future__ import annotations

import logging
from collections import Counter, defaultdict
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path
from typing import List

import numpy as np
from PIL import Image
from tqdm import tqdm

from .config import PreprocessConfig
from .enhancement import enhance
from .grayscale import to_grayscale
from .loader import load_image_array, scan_and_load
from .normalization import compute_dataset_mean_std, resolve_normalization
from .resize import resize_with_padding
from .schemas import ImageEntry, PreprocessingReport
from .split import assign_splits, build_manifest
from .utils import ensure_dir, timer, unique_destination

logger = logging.getLogger("preprocessing.pipeline")


def _process_one(entry: ImageEntry, config: PreprocessConfig, target_size) -> ImageEntry:
    """Traite une image de bout en bout : charge, grayscale, resize+pad,
    contraste optionnel, sauvegarde PNG. Ne lève jamais d'exception : tout
    échec est capturé sur l'entrée (load_success=False)."""
    array, error = load_image_array(entry.source_path)
    if array is None:
        entry.load_success = False
        entry.error_reason = error
        return entry

    entry.original_height, entry.original_width = array.shape[:2]

    try:
        gray = to_grayscale(array)
        resized = resize_with_padding(gray, target_size)
        final = enhance(resized, config.enhancement_profile)

        dest_dir = config.output_dir / entry.class_name
        dest = unique_destination(dest_dir, entry.source_path.stem + ".png")
        dest_dir.mkdir(parents=True, exist_ok=True)
        Image.fromarray(final, mode="L").save(dest)

        entry.processed_path = dest
        entry.processed_height, entry.processed_width = final.shape[:2]
        entry.load_success = True
        return entry
    except Exception as exc:  # noqa: BLE001
        entry.load_success = False
        entry.error_reason = f"echec_traitement:{exc}"
        return entry


class PreprocessingPipeline:
    """Coordonne scan, traitement parallèle, split, visualisation et rapport."""

    def __init__(self, config: PreprocessConfig) -> None:
        self.config = config

    def run(self) -> PreprocessingReport:
        with timer() as elapsed:
            ensure_dir(self.config.output_dir)
            ensure_dir(self.config.reports_dir)

            entries = scan_and_load(self.config.input_dir, self.config.valid_extensions)
            if not entries:
                logger.warning("Aucune image trouvée sous %s", self.config.input_dir)

            normalization = resolve_normalization(self.config.model)
            target_size = normalization.input_size

            entries = self._process_all(entries, target_size)
            entries = assign_splits(entries, self.config)

            manifest_df = build_manifest(entries)
            manifest_df.to_csv(self.config.manifest_path, index=False, encoding="utf-8")
            logger.info("Manifeste écrit : %s (%d lignes)", self.config.manifest_path, len(manifest_df))

            processed_paths = [e.processed_path for e in entries if e.load_success]
            normalization.dataset_mean_std = compute_dataset_mean_std(
                processed_paths, seed=self.config.random_seed
            )

            report = PreprocessingReport(
                input_dir=self.config.input_dir,
                output_dir=self.config.output_dir,
                entries=entries,
                class_counts=dict(Counter(e.class_name for e in entries)),
                split_counts=self._compute_split_counts(entries),
                normalization=normalization,
                enhancement_applied=self.config.enhancement_profile.enabled,
                enhancement_method=(
                    self.config.enhancement_profile.method
                    if self.config.enhancement_profile.enabled
                    else None
                ),
            )

        report.execution_time_seconds = elapsed[0]
        self._log_summary(report)
        return report

    def _process_all(self, entries: List[ImageEntry], target_size) -> List[ImageEntry]:
        processed: List[ImageEntry] = []
        with ProcessPoolExecutor(max_workers=self.config.num_workers) as pool:
            futures = {
                pool.submit(_process_one, e, self.config, target_size): e for e in entries
            }
            for future in tqdm(as_completed(futures), total=len(futures), desc="Prétraitement"):
                try:
                    processed.append(future.result())
                except Exception as exc:  # noqa: BLE001
                    original = futures[future]
                    logger.error("Échec inattendu pour %s : %s", original.source_path, exc)
                    original.load_success = False
                    original.error_reason = f"worker_exception:{exc}"
                    processed.append(original)
        return processed

    @staticmethod
    def _compute_split_counts(entries: List[ImageEntry]) -> dict:
        counts: dict = defaultdict(lambda: defaultdict(int))
        for e in entries:
            if e.load_success and e.split:
                counts[e.split][e.class_name] += 1
        return {split: dict(cls_counts) for split, cls_counts in counts.items()}

    @staticmethod
    def _log_summary(report: PreprocessingReport) -> None:
        logger.info("=== Résumé du prétraitement ===")
        logger.info("Images totales    : %d", report.total_images)
        logger.info("Réussies          : %d", len(report.successful_entries))
        logger.info("Échecs            : %d", len(report.failed_entries))
        logger.info("Classes           : %s", report.class_counts)
        logger.info("Répartition split : %s", report.split_counts)
        logger.info("Temps d'exécution : %.2f s", report.execution_time_seconds)
