"""Analyse anatomique CXAS : point d'entrée paresseux pour l'API.

L'import du paquet ``scripts.radiography.anatomy`` (donc de ``cxas``)
n'a lieu qu'à la première analyse effective : le serveur démarre
normalement sans CXAS, ni ses poids, ni le réseau associé.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from config import CxasServerConfig

logger = logging.getLogger("server.anatomy_service")


def _anatomy_package():
    """Retourne le paquet ``scripts.radiography.anatomy`` (import paresseux)."""
    from scripts.radiography.anatomy import service as anatomy_service  # noqa: PLC0415

    return anatomy_service


def is_available() -> bool:
    """CXAS est-il importable sur ce poste ? (n'instancie rien)."""
    try:
        from scripts.radiography.anatomy.cxas_engine import is_available as _avail

        return _avail()
    except Exception:
        return False


def analyze_anatomy_image(
    image_path: Path,
    config: CxasServerConfig,
    pixel_spacing_mm: tuple[float, float] | None = None,
) -> dict[str, Any]:
    """Analyse anatomique complète d'une image (masques, CTR, SCD).

    Retourne le ``AnatomyResult`` du module anatomy, en dict prêt à
    sérialiser. Lève ``CxasUnavailableError`` si CXAS est absent ou
    inutilisable (le serveur la traduit en 503).
    """
    service = _anatomy_package()
    result = service.analyze_anatomy(
        image_path,
        features=config.features,
        pixel_spacing_mm=pixel_spacing_mm,
        save_outputs=False,
        mask_max_side=config.mask_max_side,
    )
    if result.status == "error":
        logger.warning("Analyse anatomique échouée pour %s : %s", image_path.name, result.error)
    return result.as_dict()