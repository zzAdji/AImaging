"""Utilitaires génériques"""

from __future__ import annotations

import contextlib
import logging
import random
import sys
import time
from pathlib import Path
from typing import Dict, Iterator, List, Optional

import numpy as np
import torch

logger = logging.getLogger("training")


def bootstrap_preprocessing_import(preprocessing_path: Optional[Path] = None) -> None:
    """Rend le package `preprocessing` importable.

    Args:
        preprocessing_path: Chemin explicite vers le dossier contenant le
            package `preprocessing` (le dossier qui contient lui-même
            `preprocessing/__init__.py`), si non standard.
    """
    try:
        import preprocessing  # noqa: F401
        return
    except ImportError:
        pass

    candidates: List[Path] = []
    if preprocessing_path is not None:
        candidates.append(Path(preprocessing_path).resolve())

    here = Path(__file__).resolve()
    candidates += [
        here.parents[2] / "preprocessing",
        here.parents[1] / "preprocessing",
    ]

    for candidate in candidates:
        if candidate.exists() and str(candidate) not in sys.path:
            sys.path.insert(0, str(candidate))
            try:
                import preprocessing  # noqa: F401
                logger.info("Package 'preprocessing' résolu via %s", candidate)
                return
            except ImportError:
                continue

    raise ImportError(
        "Impossible d'importer le package 'preprocessing'. Placez le dossier "
        "'preprocessing/' au même niveau que "
        "'training/', ou passez --preprocessing-path explicitement."
    )


def setup_logging(log_path: Path, level: int = logging.INFO) -> logging.Logger:
    log_path.parent.mkdir(parents=True, exist_ok=True)
    root = logging.getLogger("training")
    root.setLevel(level)
    root.handlers.clear()

    fmt = logging.Formatter(
        "%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    file_handler = logging.FileHandler(log_path, mode="w", encoding="utf-8")
    file_handler.setFormatter(fmt)
    root.addHandler(file_handler)

    console_handler = logging.StreamHandler()
    console_handler.setFormatter(fmt)
    root.addHandler(console_handler)
    return root


def seed_everything(seed: int) -> None:
    """Fixe la graine pour random, numpy et torch (CPU + CUDA)."""
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


def resolve_device(device_config: str) -> torch.device:
    """Résout "auto"/"cpu"/"cuda" en torch.device réel.

    "auto" retombe sur CPU si CUDA n'est pas disponible, sans lever
    d'erreur - le run reste utilisable partout, juste plus lent.
    """
    if device_config == "cpu":
        return torch.device("cpu")
    if device_config == "cuda":
        if not torch.cuda.is_available():
            logger.warning("CUDA demandé mais indisponible - bascule sur CPU.")
            return torch.device("cpu")
        return torch.device("cuda")
    # "auto"
    return torch.device("cuda" if torch.cuda.is_available() else "cpu")


def save_checkpoint(
    path: Path,
    model_state_dict: Dict,
    architecture: str,
    class_to_idx: Dict[str, int],
    input_size,
    normalization_mean,
    normalization_std,
    extra: Optional[Dict] = None,
) -> None:
    """Sauvegarde un checkpoint auto-suffisant (poids + métadonnées de reconstruction).

    Inclure architecture/class_to_idx/normalisation dans le checkpoint
    évite d'avoir à deviner ces valeurs au moment du chargement (pour
    l'ensemble ou le Grad-CAM) - le fichier est reconstructible seul.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "model_state_dict": model_state_dict,
        "architecture": architecture,
        "class_to_idx": class_to_idx,
        "input_size": input_size,
        "normalization_mean": normalization_mean,
        "normalization_std": normalization_std,
    }
    if extra:
        payload.update(extra)
    torch.save(payload, path)


def load_checkpoint(path: Path, map_location: str = "cpu") -> Dict:
    """Charge un checkpoint sauvegardé par `save_checkpoint`."""
    return torch.load(path, map_location=map_location, weights_only=False)


@contextlib.contextmanager
def timer() -> Iterator[List[float]]:
    start = time.perf_counter()
    box: List[float] = [0.0]
    try:
        yield box
    finally:
        box[0] = time.perf_counter() - start
