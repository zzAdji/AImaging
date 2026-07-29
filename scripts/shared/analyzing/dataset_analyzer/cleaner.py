"""Nettoyage non destructif par défaut du dataset."""

from __future__ import annotations

import logging
import shutil
from pathlib import Path
from typing import List

from .config import AnalyzerConfig
from .schemas import AnalysisReport
from .utils import ensure_dir

logger = logging.getLogger("dataset_analyzer.cleaner")


def _unique_destination(dest_dir: Path, filename: str) -> Path:
    """Évite d'écraser un fichier existant du même nom dans dest_dir."""
    dest = dest_dir / filename
    if not dest.exists():
        return dest
    stem, suffix = Path(filename).stem, Path(filename).suffix
    counter = 1
    while True:
        candidate = dest_dir / f"{stem}_{counter}{suffix}"
        if not candidate.exists():
            return candidate
        counter += 1


class DatasetCleaner:
    """Déplace les fichiers signalés vers des sous-dossiers de `config.review_dir`."""

    def __init__(self, config: AnalyzerConfig) -> None:
        self.config = config

    def move_atypical(self, report: AnalysisReport) -> List[Path]:
        """Déplace chaque image atypique (non corrompue) vers Review/Atypical/.

        Returns:
            Liste des chemins de destination réellement écrits (vide en
            mode dry-run).
        """
        return self._move(
            [r.path for r in report.atypical_records],
            self.config.review_dir / "Atypical",
        )

    def move_corrupted(self, report: AnalysisReport) -> List[Path]:
        """Déplace chaque image corrompue vers Review/Corrupted/.

        Ne considère que les fichiers encore présents sur le disque :
        certaines raisons de corruption (ex. extension invalide) pointent
        tout de même vers un fichier réel qu'il est utile d'écarter.
        """
        paths = [r.path for r in report.corrupted_records if r.path.exists()]
        return self._move(paths, self.config.review_dir / "Corrupted")

    def move_duplicates(
        self, report: AnalysisReport, keep_originals: bool = True
    ) -> List[Path]:
        """Déplace les images en doublon vers Review/Duplicates/.

        Args:
            keep_originals: Si True (défaut), seul le côté "duplicate" de
                chaque paire est déplacé ; l'"original" reste dans le
                dataset.
        """
        paths = [g.duplicate for g in report.duplicate_groups]
        if not keep_originals:
            paths += [g.original for g in report.duplicate_groups]
        return self._move(paths, self.config.review_dir / "Duplicates")

    def _move(self, paths: List[Path], dest_dir: Path) -> List[Path]:
        moved: List[Path] = []
        if not paths:
            return moved

        if self.config.dry_run:
            logger.info(
                "[DRY-RUN] %d fichier(s) seraient déplacés vers %s", len(paths), dest_dir
            )
            return moved

        ensure_dir(dest_dir)
        for path in paths:
            try:
                if not path.exists():
                    continue
                dest = _unique_destination(dest_dir, path.name)
                shutil.move(str(path), str(dest))
                moved.append(dest)
            except OSError as exc:
                logger.error("Impossible de déplacer %s : %s", path, exc)

        logger.info("%d fichier(s) déplacé(s) vers %s", len(moved), dest_dir)
        return moved
