"""Vérification visuelle : grille avant/après prétraitement, par classe.

Permet de confirmer visuellement (avant tout entraînement) que le
prétraitement ne déforme pas les images, ne supprime pas de détails et ne
modifie pas artificiellement les structures anatomiques.
"""

from __future__ import annotations

import logging
import random
from pathlib import Path
from typing import List, Optional

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from PIL import Image  # noqa: E402

from .schemas import ImageEntry  # noqa: E402

logger = logging.getLogger("preprocessing.visualization")


def create_before_after_grid(
    entries: List[ImageEntry],
    class_name: str,
    output_path: Path,
    sample_size: int = 16,
    seed: int = 42,
) -> Optional[Path]:
    """Grille original -> prétraité, pour un échantillon d'une classe donnée.

    Args:
        entries: Entrées traitées avec succès (load_success=True).
        class_name: Classe à illustrer.
        output_path: Chemin du PNG de sortie.
        sample_size: Nombre de paires (original, prétraité) affichées.
        seed: Graine de l'échantillonnage.

    Returns:
        Le chemin écrit, ou None en cas d'échec.
    """
    candidates = [
        e for e in entries
        if e.class_name == class_name and e.load_success and e.processed_path is not None
    ]
    if not candidates:
        return None

    rng = random.Random(seed)
    sample = rng.sample(candidates, k=min(sample_size, len(candidates)))

    n_cols = 4
    n_rows = (len(sample) + n_cols - 1) // n_cols
    fig, axes = plt.subplots(n_rows * 2, n_cols, figsize=(n_cols * 2.4, n_rows * 4.8))
    axes = axes.reshape(n_rows * 2, n_cols)

    for i, entry in enumerate(sample):
        row_pair, col = (i // n_cols) * 2, i % n_cols
        try:
            with Image.open(entry.source_path) as orig:
                axes[row_pair, col].imshow(orig.convert("L"), cmap="gray")
        except Exception:  # noqa: BLE001
            axes[row_pair, col].text(0.5, 0.5, "?", ha="center", va="center")
        axes[row_pair, col].set_title("Original", fontsize=8)
        axes[row_pair, col].axis("off")

        try:
            with Image.open(entry.processed_path) as proc:
                axes[row_pair + 1, col].imshow(proc, cmap="gray")
        except Exception:  # noqa: BLE001
            axes[row_pair + 1, col].text(0.5, 0.5, "?", ha="center", va="center")
        axes[row_pair + 1, col].set_title("Prétraitée", fontsize=8)
        axes[row_pair + 1, col].axis("off")

    for i in range(len(sample), n_rows * n_cols):
        row_pair, col = (i // n_cols) * 2, i % n_cols
        axes[row_pair, col].axis("off")
        axes[row_pair + 1, col].axis("off")

    fig.suptitle(f"Avant / après prétraitement - {class_name}")
    try:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        fig.savefig(output_path, dpi=130, bbox_inches="tight")
        return output_path
    except Exception as exc:  # noqa: BLE001
        logger.error("Échec de sauvegarde de la grille pour %s : %s", class_name, exc)
        return None
    finally:
        plt.close(fig)


def generate_all_grids(
    entries: List[ImageEntry], output_dir: Path, sample_size: int, seed: int
) -> List[Path]:
    """Génère une grille avant/après pour chaque classe présente."""
    classes = sorted({e.class_name for e in entries if e.load_success})
    paths = []
    for cls in classes:
        path = create_before_after_grid(
            entries, cls, output_dir / f"before_after_{cls}.png", sample_size, seed
        )
        if path:
            paths.append(path)
    return paths
