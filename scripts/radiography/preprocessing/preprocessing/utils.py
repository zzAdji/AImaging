"""Utilitaires génériques partagés par le pipeline de prétraitement."""

from __future__ import annotations

import contextlib
import logging
import time
from pathlib import Path
from typing import Iterator, List

logger = logging.getLogger("preprocessing")


def setup_logging(log_path: Path, level: int = logging.INFO) -> logging.Logger:
    """Configure le logger "preprocessing" avec une sortie console et fichier."""
    log_path.parent.mkdir(parents=True, exist_ok=True)

    root = logging.getLogger("preprocessing")
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


def ensure_dir(path: Path) -> Path:
    """Crée un dossier (et ses parents) s'il n'existe pas déjà."""
    path.mkdir(parents=True, exist_ok=True)
    return path


def unique_destination(dest_dir: Path, filename: str) -> Path:
    """Évite d'écraser un fichier existant du même nom dans dest_dir.

    Utile si deux fichiers sources de même nom mais d'extensions
    différentes (ex. image1.jpg et image1.png) coexistaient dans le même
    dossier de classe source - cas rare mais possible lors de la fusion
    de plusieurs sources.
    """
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


@contextlib.contextmanager
def timer() -> Iterator[List[float]]:
    """Context manager mesurant le temps écoulé (wall-clock).

    Usage:
        with timer() as t:
            do_work()
        print(t[0])  # secondes écoulées
    """
    start = time.perf_counter()
    box: List[float] = [0.0]
    try:
        yield box
    finally:
        box[0] = time.perf_counter() - start
