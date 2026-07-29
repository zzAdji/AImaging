"""Conversion en niveaux de gris (1 canal), gravée sur disque.

La réplication en 3 canaux (nécessaire pour un backbone pré-entraîné
ImageNet) n'est PAS faite ici : elle est appliquée à la volée dans
torch_dataset.py, juste avant la conversion en tenseur. La graver sur
disque triplerait inutilement le poids du dataset pour des pixels
strictement identiques sur les 3 canaux.
"""

from __future__ import annotations

import numpy as np


def to_grayscale(image: np.ndarray) -> np.ndarray:
    """Convertit un tableau image (2D ou 3D) en niveaux de gris 2D uint8.

    Args:
        image: Tableau numpy, soit déjà 2D (niveaux de gris), soit 3D
            (RGB ou RGBA - le canal alpha est ignoré s'il est présent).

    Returns:
        Tableau 2D uint8.
    """
    if image.ndim == 2:
        return image.astype(np.uint8)

    if image.ndim == 3:
        rgb = image[:, :, :3]  # ignore l'alpha si présent
        # Coefficients de luminance standard (Rec. 601), cohérents avec
        # PIL.Image.convert("L") et cv2.cvtColor(..., COLOR_RGB2GRAY).
        gray = np.dot(rgb.astype(np.float32), [0.299, 0.587, 0.114])
        return np.clip(gray, 0, 255).astype(np.uint8)

    raise ValueError(f"Forme d'image inattendue : {image.shape}")
