"""Utilitaires génériques partagés par le pipeline."""

from __future__ import annotations

import contextlib
import hashlib
import logging
import time
from pathlib import Path
from typing import Iterator, List, Tuple

logger = logging.getLogger("dataset_analyzer")


def setup_logging(log_path: Path, level: int = logging.INFO) -> logging.Logger:
    """Configure le logger "dataset_analyzer" avec une sortie console et fichier.

    Args:
        log_path: Chemin du fichier logs.txt persistant.
        level: Niveau de sévérité minimal à enregistrer (INFO par défaut).

    Returns:
        L'instance du logger "dataset_analyzer" configurée.
    """
    log_path.parent.mkdir(parents=True, exist_ok=True)

    root = logging.getLogger("dataset_analyzer")
    root.setLevel(level)
    root.handlers.clear()  # Évite les handlers dupliqués en cas d'appels répétés.

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
    path.mkdir(parents=True, exist_ok=True)
    return path


def iter_image_files(
    dataset_path: Path, valid_extensions: frozenset
) -> Iterator[Tuple[Path, str]]:
    """Parcourt récursivement `dataset_path` et retourne (chemin, classe).

    Le nom de classe est déduit du dossier parent immédiat de chaque
    fichier, ce qui correspond à l'arborescence attendue
    Dataset/<Classe>/image.jpg. Les fichiers dont l'extension n'est pas
    dans `valid_extensions` sont tout de même retournés.

    Args:
        dataset_path: Dossier racine contenant un sous-dossier par classe.
        valid_extensions: Ensemble des extensions acceptées, en minuscule.

    Yields:
        Tuples (chemin absolu du fichier, nom de la classe).
    """
    for entry in sorted(dataset_path.rglob("*")):
        if not entry.is_file():
            continue
        class_name = entry.parent.name
        yield entry, class_name


def compute_sha256(path: Path, chunk_size: int = 1 << 20) -> str:
    """Calcule l'empreinte SHA-256 des octets bruts d'un fichier.

    Deux fichiers avec la même empreinte sont
    identiques octet pour octet.

    Args:
        path: Fichier à hacher.
        chunk_size: Octets lus par itération (1 MiB par défaut).

    Returns:
        L'empreinte sous forme de chaîne hexadécimale.
    """
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(chunk_size), b""):
            digest.update(chunk)
    return digest.hexdigest()


@contextlib.contextmanager
def timer() -> Iterator[List[float]]:
    """Context manager mesurant le temps écoulé (wall-clock).

    Usage:
        with timer() as t:
            do_work()
        print(t[0])  # secondes écoulées

    Yields:
        Une liste à un élément ; le temps écoulé y est écrit à la sortie
        du bloc `with`.
    """
    start = time.perf_counter()
    box: List[float] = [0.0]
    try:
        yield box
    finally:
        box[0] = time.perf_counter() - start


def format_bytes(num_bytes: float) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if num_bytes < 1024.0:
            return f"{num_bytes:.1f} {unit}"
        num_bytes /= 1024.0
    return f"{num_bytes:.1f} TB"
