"""Orchestration de haut niveau du pipeline d'analyse complet."""

from __future__ import annotations

import logging
import statistics as stats_mod
from collections import Counter
from typing import Dict, List, Tuple

from .config import AnalyzerConfig
from .duplicate_detector import DuplicateDetector
from .metadata import MetadataExtractor
from .quality_checker import QualityChecker
from .schemas import AnalysisReport, ClassStatistics, ImageRecord
from .utils import iter_image_files, timer

logger = logging.getLogger("dataset_analyzer.analyzer")


class DatasetAnalyzer:
    """Coordonne scan, extraction, contrôles qualité et agrégation."""

    def __init__(self, config: AnalyzerConfig) -> None:
        self.config = config
        self._metadata_extractor = MetadataExtractor(config)
        self._quality_checker = QualityChecker(config)
        self._duplicate_detector = DuplicateDetector(config)

    def run(self) -> AnalysisReport:
        """Exécute le pipeline complet et retourne le rapport d'analyse."""
        with timer() as elapsed:
            files = list(
                iter_image_files(self.config.dataset_path, self.config.valid_extensions)
            )
            logger.info(
                "%d fichier(s) trouvé(s) sous %s", len(files), self.config.dataset_path
            )
            if not files:
                logger.warning("Aucun fichier trouvé : vérifiez le chemin du dataset.")

            records = self._metadata_extractor.extract_all(files)
            records = self._quality_checker.check_all(records)

            valid_records = [r for r in records if not r.is_corrupted]
            self._duplicate_detector.compute_phashes(valid_records)
            duplicate_groups = self._duplicate_detector.detect_all(valid_records)

            class_counts = Counter(r.class_name for r in records)
            format_counts = Counter(
                r.image_format for r in valid_records if r.image_format
            )
            class_stats = self._compute_class_statistics(valid_records)
            is_imbalanced, ratio = self._check_label_balance(class_counts)
            self._check_expected_classes(class_counts)

            report = AnalysisReport(
                dataset_path=self.config.dataset_path,
                records=records,
                duplicate_groups=duplicate_groups,
                class_statistics=class_stats,
                class_counts=dict(class_counts),
                format_counts=dict(format_counts),
                is_imbalanced=is_imbalanced,
                imbalance_ratio=ratio,
            )

        report.execution_time_seconds = elapsed[0]
        self._log_summary(report)
        return report

    def _compute_class_statistics(
        self, valid_records: List[ImageRecord]
    ) -> List[ClassStatistics]:
        by_class: Dict[str, List[ImageRecord]] = {}
        for r in valid_records:
            by_class.setdefault(r.class_name, []).append(r)

        result: List[ClassStatistics] = []
        for class_name, recs in sorted(by_class.items()):
            widths = [r.width for r in recs if r.width is not None]
            heights = [r.height for r in recs if r.height is not None]
            if not widths or not heights:
                continue
            result.append(
                ClassStatistics(
                    class_name=class_name,
                    count=len(recs),
                    mean_width=stats_mod.mean(widths),
                    mean_height=stats_mod.mean(heights),
                    median_width=stats_mod.median(widths),
                    median_height=stats_mod.median(heights),
                    min_width=min(widths),
                    max_width=max(widths),
                    min_height=min(heights),
                    max_height=max(heights),
                )
            )
        return result

    def _check_label_balance(self, class_counts: Counter) -> Tuple[bool, float]:
        """Compare la classe majoritaire à la classe minoritaire.

        Returns:
            (is_imbalanced, ratio) où ratio = max_count / min_count.
        """
        counts = [c for c in class_counts.values() if c > 0]
        if len(counts) < 2:
            return False, 1.0
        ratio = max(counts) / min(counts)
        return ratio > self.config.class_imbalance_ratio_threshold, ratio

    def _check_expected_classes(self, class_counts: Counter) -> None:
        """Signale les écarts entre classes trouvées et classes attendues."""
        if not self.config.expected_classes:
            return
        expected = set(self.config.expected_classes)
        found = set(class_counts.keys())
        unexpected = found - expected
        missing = expected - found
        if unexpected:
            logger.warning("Dossier(s) inattendu(s) trouvé(s) : %s", sorted(unexpected))
        if missing:
            logger.warning("Classe(s) attendue(s) manquante(s) : %s", sorted(missing))

    def _log_summary(self, report: AnalysisReport) -> None:
        logger.info("=== Résumé de l'analyse ===")
        logger.info("Images totales         : %d", report.total_images)
        logger.info("Images corrompues      : %d", len(report.corrupted_records))
        logger.info("Images atypiques       : %d", len(report.atypical_records))
        logger.info("Groupes de doublons    : %d", len(report.duplicate_groups))
        logger.info(
            "Classes déséquilibrées : %s (ratio=%.2f)",
            report.is_imbalanced,
            report.imbalance_ratio,
        )
        logger.info("Temps d'exécution      : %.2f s", report.execution_time_seconds)
