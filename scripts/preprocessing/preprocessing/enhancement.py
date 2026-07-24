"""Amélioration de contraste - optionnelle, désactivée par défaut.

Aucune de ces transformations n'est appliquée automatiquement. Le choix
est délibéré (voir l'analyse de stratégie) : la littérature sur la
radiographie thoracique est partagée sur l'intérêt du contraste
amélioré, et une transformation appliquée sans justification risque de
créer des caractéristiques qui n'existent pas dans l'image originale.
Ce module reste isolé pour permettre une comparaison A/B documentée
plutôt qu'un choix arbitraire.
"""

from __future__ import annotations

import logging

import cv2
import numpy as np

from .config import EnhancementProfile

logger = logging.getLogger("preprocessing.enhancement")


def apply_clahe(image: np.ndarray, clip_limit: float, tile_grid_size: tuple) -> np.ndarray:
    """Contraste local adaptatif avec limite de clipping (moins de bruit amplifié
    qu'une égalisation d'histogramme globale)."""
    clahe = cv2.createCLAHE(clipLimit=clip_limit, tileGridSize=tile_grid_size)
    return clahe.apply(image)


def apply_histogram_equalization(image: np.ndarray) -> np.ndarray:
    """Égalisation d'histogramme globale. Risque d'amplification du bruit
    non contrôlée - préférer CLAHE dans la plupart des cas."""
    return cv2.equalizeHist(image)


def apply_gamma_correction(image: np.ndarray, gamma: float) -> np.ndarray:
    """Correction gamma (courbe de tons monotone). Ne doit être utilisée que
    pour corriger un biais d'exposition systématique identifié par analyse
    exploratoire, pas appliquée arbitrairement."""
    inv_gamma = 1.0 / max(gamma, 1e-6)
    table = np.array([((i / 255.0) ** inv_gamma) * 255 for i in range(256)]).astype(np.uint8)
    return cv2.LUT(image, table)


def enhance(image: np.ndarray, profile: EnhancementProfile) -> np.ndarray:
    """Dispatcher : applique la méthode configurée, ou ne fait rien si désactivé.

    Args:
        image: Tableau 2D uint8 (niveaux de gris).
        profile: EnhancementProfile - si `enabled` est False, `image` est
            retourné inchangé.

    Returns:
        Image transformée (ou inchangée si non activé).
    """
    if not profile.enabled:
        return image

    if profile.method == "clahe":
        return apply_clahe(image, profile.clahe_clip_limit, profile.clahe_tile_grid_size)
    if profile.method == "hist_eq":
        return apply_histogram_equalization(image)
    if profile.method == "gamma":
        return apply_gamma_correction(image, profile.gamma_value)

    logger.warning("Méthode d'enhancement inconnue '%s' - image inchangée.", profile.method)
    return image
