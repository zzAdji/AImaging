"""Configuration centrale du pipeline dataset_analyzer."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import FrozenSet, List, Optional


@dataclass
class AnalyzerConfig:
    """Configuration d'exécution pour une analyse donnée.

    Attributes:
        dataset_path: Dossier racine contenant un sous-dossier par classe.
        output_dir: Dossier de sortie pour rapports, CSV, graphiques et
            logs.txt. Par défaut : <dataset_path>/../analysis_output.
        review_dir: Dossier où les images atypiques/doublons sont
            déplacées pour revue manuelle. Par défaut : <output_dir>/Review.
        valid_extensions: Extensions de fichiers considérées comme des
            images candidates.
        expected_classes: Noms de classes attendus. Laisser vide pour une
            détection automatique à partir des noms de sous-dossiers ; si
            renseigné, tout dossier inattendu ou classe manquante est
            signalé dans les logs.
        num_workers: Nombre de workers pour les étapes parallèles
            (CPU-bound et I/O-bound).
        min_width / min_height: En dessous de ces valeurs, une image est
            signalée "too_small".
        max_width / max_height: Au-dessus de ces valeurs, une image est
            signalée "too_large".
        black_pixel_mean_threshold: Intensité moyenne (0-255) en dessous
            de laquelle une image est signalée "mostly_black".
        white_pixel_mean_threshold: Intensité moyenne (0-255) au-dessus
            de laquelle une image est signalée "mostly_white".
        low_contrast_std_threshold: Écart-type d'intensité en dessous
            duquel une image est signalée "low_contrast".
        phash_size: Taille (en bits par côté) du hash perceptuel
            (imagehash.phash). 8 donne un hash 64 bits.
        duplicate_hamming_threshold: Distance de Hamming maximale entre
            deux pHash pour considérer la paire comme quasi-doublon.
        enable_ssim_confirmation: Si True, chaque quasi-doublon détecté
            par pHash est re-vérifié par SSIM avant d'être retenu, pour
            réduire les faux positifs.
        ssim_threshold: Score SSIM minimal (0-1) pour confirmer un
            quasi-doublon.
        class_imbalance_ratio_threshold: Si (compte classe majoritaire /
            compte classe minoritaire) dépasse ce ratio, le dataset est
            signalé comme déséquilibré.
        grid_sample_size: Nombre d'images échantillonnées aléatoirement
            par classe pour la grille/mosaïque visuelle.
        random_seed: Graine utilisée pour tout échantillonnage aléatoire,
            pour la reproductibilité.
        dry_run: Si True (défaut), le cleaner ne fait que rapporter ce
            qu'il déplacerait, sans toucher au dataset original.
    """

    dataset_path: Path
    output_dir: Optional[Path] = None
    review_dir: Optional[Path] = None

    valid_extensions: FrozenSet[str] = frozenset(
        {".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff"}
    )
    expected_classes: List[str] = field(default_factory=list)

    num_workers: int = field(default_factory=lambda: max(1, os.cpu_count() or 1))

    min_width: int = 64
    min_height: int = 64
    max_width: int = 4096
    max_height: int = 4096

    black_pixel_mean_threshold: float = 8.0
    white_pixel_mean_threshold: float = 247.0
    low_contrast_std_threshold: float = 5.0

    phash_size: int = 8
    duplicate_hamming_threshold: int = 5
    enable_ssim_confirmation: bool = True
    ssim_threshold: float = 0.90

    class_imbalance_ratio_threshold: float = 1.5

    grid_sample_size: int = 25
    random_seed: int = 42

    dry_run: bool = True

    def __post_init__(self) -> None:
        self.dataset_path = Path(self.dataset_path).resolve()

        if self.output_dir is None:
            self.output_dir = self.dataset_path.parent / "analysis_output"
        else:
            self.output_dir = Path(self.output_dir).resolve()

        if self.review_dir is None:
            self.review_dir = self.output_dir / "Review"
        else:
            self.review_dir = Path(self.review_dir).resolve()

    @property
    def log_path(self) -> Path:
        return self.output_dir / "logs.txt"

    @property
    def csv_report_path(self) -> Path:
        return self.output_dir / "dataset_report.csv"

    @property
    def pdf_report_path(self) -> Path:
        return self.output_dir / "dataset_report.pdf"

    @property
    def charts_dir(self) -> Path:
        return self.output_dir / "charts"
