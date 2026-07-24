"""Scan récursif du dataset et chargement robuste des images.

Fonctionne quelle que soit la structure exacte des dossiers sources
(l'unique convention supposée est : nom de classe = dossier parent
immédiat du fichier), ce qui permet de traiter un dataset déjà fusionné
(dataset_clean/<classe>/...) comme des sources hétérogènes non fusionnées.

Le chargement essaie Pillow en premier (cohérent avec le reste du
pipeline, basé sur PIL/numpy), puis retombe sur OpenCV en cas d'échec :
certains fichiers légèrement non conformes sont décodables par l'un mais
pas l'autre, et cumuler les deux augmente le taux de succès sans coût
significatif.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Iterator, List, Optional, Tuple

import cv2
import numpy as np
from PIL import Image, UnidentifiedImageError

from .schemas import ImageEntry

logger = logging.getLogger("preprocessing.loader")


def iter_source_files(input_dir: Path, valid_extensions: frozenset) -> Iterator[Tuple[Path, str]]:
    """Parcourt récursivement `input_dir`, retourne (chemin, classe).

    Args:
        input_dir: Dossier racine (un sous-dossier par classe).
        valid_extensions: Extensions acceptées (en minuscule, avec le point).

    Yields:
        Tuples (chemin absolu, nom de classe = dossier parent).
    """
    for entry in sorted(input_dir.rglob("*")):
        if not entry.is_file():
            continue
        if entry.suffix.lower() not in valid_extensions:
            continue
        yield entry, entry.parent.name


def load_image_array(path: Path) -> Tuple[Optional[np.ndarray], Optional[str]]:
    """Charge une image en tableau numpy uint8, tente Pillow puis OpenCV.

    Args:
        path: Chemin du fichier image.

    Returns:
        (array, None) en cas de succès (array 2D grayscale ou 3D RGB),
        (None, raison_erreur) en cas d'échec des deux chargeurs.
    """
    try:
        with Image.open(path) as img:
            img.verify()
        with Image.open(path) as img:
            img.load()
            return np.array(img), None
    except (UnidentifiedImageError, OSError, ValueError, SyntaxError) as pil_exc:
        logger.debug("Échec Pillow pour %s : %s - tentative OpenCV", path, pil_exc)

    try:
        array = cv2.imread(str(path), cv2.IMREAD_UNCHANGED)
        if array is None:
            raise ValueError("cv2.imread a retourné None")
        # OpenCV décode en BGR ; on reconvertit en RGB pour rester cohérent
        # avec la convention Pillow utilisée dans le reste du pipeline.
        if array.ndim == 3 and array.shape[2] == 3:
            array = cv2.cvtColor(array, cv2.COLOR_BGR2RGB)
        return array, None
    except Exception as cv_exc:  # noqa: BLE001
        return None, f"illisible_pillow_et_opencv:{cv_exc}"


def scan_and_load(input_dir: Path, valid_extensions: frozenset) -> List[ImageEntry]:
    """Construit la liste initiale d'ImageEntry (chargement non encore fait ici).

    Cette fonction ne fait que le scan (léger) ; le chargement/traitement
    pixel proprement dit est délégué à pipeline.py, exécuté en parallèle
    sur cette liste, pour ne jamais matérialiser toutes les images en RAM
    simultanément.
    """
    entries = [
        ImageEntry(source_path=path, class_name=cls)
        for path, cls in iter_source_files(input_dir, valid_extensions)
    ]
    logger.info("%d fichier(s) candidat(s) trouvé(s) sous %s", len(entries), input_dir)
    return entries
