"""Génération des graphiques et grilles d'images, via matplotlib (backend headless)"""

from __future__ import annotations

import logging
import random
from collections import Counter
from pathlib import Path
from typing import Dict, List, Optional

import matplotlib

matplotlib.use("Agg")  # Headless : aucun serveur d'affichage requis sur un serveur/CI.
import matplotlib.pyplot as plt  # noqa: E402
from PIL import Image  # noqa: E402

from .config import AnalyzerConfig  # noqa: E402
from .schemas import AnalysisReport, ImageRecord  # noqa: E402

logger = logging.getLogger("dataset_analyzer.visualization")


def _save(fig, output_path: Path) -> Optional[Path]:
    try:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        fig.savefig(output_path, dpi=150, bbox_inches="tight")
        return output_path
    except Exception as exc:  # noqa: BLE001
        logger.error("Échec de sauvegarde du graphique %s : %s", output_path, exc)
        return None
    finally:
        plt.close(fig)


def plot_class_distribution_bar(
    class_counts: Dict[str, int], output_path: Path
) -> Optional[Path]:
    """Diagramme en barres du nombre d'images par classe."""
    fig, ax = plt.subplots(figsize=(8, 5))
    classes = list(class_counts.keys())
    counts = list(class_counts.values())
    ax.bar(classes, counts, color="#4C72B0")
    ax.set_title("Nombre d'images par classe")
    ax.set_ylabel("Nombre d'images")
    for i, v in enumerate(counts):
        ax.text(i, v, str(v), ha="center", va="bottom")
    return _save(fig, output_path)


def plot_class_distribution_pie(
    class_counts: Dict[str, int], output_path: Path
) -> Optional[Path]:
    """Camembert de répartition des classes."""
    fig, ax = plt.subplots(figsize=(6, 6))
    ax.pie(
        list(class_counts.values()),
        labels=list(class_counts.keys()),
        autopct="%1.1f%%",
        startangle=90,
    )
    ax.set_title("Répartition des classes")
    return _save(fig, output_path)


def plot_dimension_histogram(
    records: List[ImageRecord], output_path: Path
) -> Optional[Path]:
    """Histogramme des largeurs et hauteurs d'images."""
    widths = [r.width for r in records if r.width is not None]
    heights = [r.height for r in records if r.height is not None]
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(10, 4))
    ax1.hist(widths, bins=30, color="#55A868")
    ax1.set_title("Distribution des largeurs")
    ax2.hist(heights, bins=30, color="#C44E52")
    ax2.set_title("Distribution des hauteurs")
    return _save(fig, output_path)


def plot_format_distribution(
    records: List[ImageRecord], output_path: Path
) -> Optional[Path]:
    """Diagramme en barres de la répartition des formats de fichiers."""
    counts = Counter(r.image_format for r in records if r.image_format)
    fig, ax = plt.subplots(figsize=(6, 4))
    ax.bar(list(counts.keys()), list(counts.values()), color="#8172B2")
    ax.set_title("Répartition des formats de fichiers")
    return _save(fig, output_path)


def create_image_grid(
    records: List[ImageRecord],
    class_name: str,
    output_path: Path,
    sample_size: int = 25,
    seed: int = 42,
) -> Optional[Path]:
    """Grille (mosaïque) d'un échantillon aléatoire d'images pour une classe."""
    candidates = [r for r in records if r.class_name == class_name]
    if not candidates:
        return None
    rng = random.Random(seed)
    sample = rng.sample(candidates, k=min(sample_size, len(candidates)))

    n_cols = 5
    n_rows = (len(sample) + n_cols - 1) // n_cols
    fig, axes = plt.subplots(n_rows, n_cols, figsize=(n_cols * 2, n_rows * 2))
    flat_axes = axes.flatten() if hasattr(axes, "flatten") else [axes]

    for ax, record in zip(flat_axes, sample):
        try:
            with Image.open(record.path) as img:
                ax.imshow(img.convert("RGB"))
        except Exception:  # noqa: BLE001
            ax.text(0.5, 0.5, "?", ha="center", va="center")
        ax.axis("off")
    for ax in flat_axes[len(sample):]:
        ax.axis("off")

    fig.suptitle(f"Échantillon aléatoire - {class_name}")
    return _save(fig, output_path)


def generate_all(report: AnalysisReport, config: AnalyzerConfig) -> Dict[str, Path]:
    charts: Dict[str, Path] = {}
    charts_dir = config.charts_dir

    bar = plot_class_distribution_bar(
        report.class_counts, charts_dir / "class_distribution_bar.png"
    )
    pie = plot_class_distribution_pie(
        report.class_counts, charts_dir / "class_distribution_pie.png"
    )
    dims = plot_dimension_histogram(
        report.valid_records, charts_dir / "dimension_histogram.png"
    )
    fmts = plot_format_distribution(
        report.valid_records, charts_dir / "format_distribution.png"
    )

    for name, path in [
        ("class_bar", bar),
        ("class_pie", pie),
        ("dimensions", dims),
        ("formats", fmts),
    ]:
        if path:
            charts[name] = path

    for class_name in sorted(report.class_counts.keys()):
        grid_path = create_image_grid(
            report.valid_records,
            class_name,
            charts_dir / f"grid_{class_name}.png",
            sample_size=config.grid_sample_size,
            seed=config.random_seed,
        )
        if grid_path:
            charts[f"grid_{class_name}"] = grid_path

    return charts
