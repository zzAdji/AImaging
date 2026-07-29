"""Redimensionnement préservant le ratio d'aspect (letterbox / padding).

Un resize direct (sans préservation du ratio) déforme les proportions
anatomiques dès que l'image source n'est pas déjà carrée - inacceptable
pour de l'imagerie médicale où les proportions ont un sens. Ce module
redimensionne pour tenir dans la taille cible sans dépasser, puis
complète (pad) avec une valeur constante (noir par défaut, cohérent avec
le fond typiquement sombre d'une radiographie thoracique) pour atteindre
exactement la taille cible.
"""

from __future__ import annotations

from typing import Tuple

import cv2
import numpy as np


def resize_with_padding(
    image: np.ndarray, target_size: Tuple[int, int], pad_value: int = 0
) -> np.ndarray:
    """Redimensionne une image 2D en conservant le ratio, puis la complète (pad).

    Args:
        image: Tableau 2D (niveaux de gris) uint8.
        target_size: (hauteur, largeur) cible.
        pad_value: Valeur de remplissage (0 = noir par défaut).

    Returns:
        Tableau 2D uint8 de taille exactement `target_size`.
    """
    target_h, target_w = target_size
    src_h, src_w = image.shape[:2]

    scale = min(target_h / src_h, target_w / src_w)
    new_h, new_w = max(1, round(src_h * scale)), max(1, round(src_w * scale))

    # INTER_AREA est recommandé pour la réduction (moins d'aliasing),
    # INTER_LINEAR pour l'agrandissement (plus rapide, qualité suffisante
    # pour ce cas d'usage - pas de sur-interprétation de détails inexistants).
    interpolation = cv2.INTER_AREA if scale < 1.0 else cv2.INTER_LINEAR
    resized = cv2.resize(image, (new_w, new_h), interpolation=interpolation)

    canvas = np.full((target_h, target_w), pad_value, dtype=np.uint8)
    top = (target_h - new_h) // 2
    left = (target_w - new_w) // 2
    canvas[top: top + new_h, left: left + new_w] = resized
    return canvas
