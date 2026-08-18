"""Analyse anatomique des radiographies thoraciques via CXAS.

Branche indépendante du pipeline de classification : segmentation
anatomique (159 classes PAXRay) + mesures (CTR, SCD et autres features
réellement supportées par la bibliothèque cxas).

L'import de ``cxas`` est volontairement paresseux (uniquement dans
``cxas_engine``) : importer ce paquet ne charge jamais CXAS ni ses
dépendances, et ne doit jamais impacter le pipeline de classification.
"""

from __future__ import annotations

from .service import AnatomyResult, analyze_anatomy  # noqa: F401
from .config import SUPPORTED_FEATURES  # noqa: F401