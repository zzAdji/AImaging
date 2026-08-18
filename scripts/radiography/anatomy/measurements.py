"""Extraction des mesures anatomiques via l'extracteur officiel CXAS.

Uniquement les features réellement implémentées par la bibliothèque
(``Extractor.methods``) : CTR, SCD, perimeter, compactness, area,
centroid, box, convexity, radiomics.

Unités :
- CTR  : coefficient sans dimension (rapport cardiothoracique).
- SCD  : distance en pixels, exprimée sur la grille 512x512 de CXAS ;
  une conversion vers la résolution d'origine (puis en mm si le
  PixelSpacing des DICOM est fourni) est fournie à titre indicatif,
  en supposant un redimensionnement homogène — documenté, non clinique.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

import numpy as np

logger = logging.getLogger("anatomy.measurements")

# Alias pratiques -> méthode officielle de l'extracteur.
FEATURE_ALIASES = {
    "CTR": "Cardio-Thoracic Ratio",
    "SCD": "Spine-Center Distance",
}

# Sentinelle "structure absente" retournée par cxas.
SCORE_ABSENT = -1.0


@dataclass(slots=True)
class Measurements:
    values: dict[str, dict] = field(default_factory=dict)  # feature -> détail
    warnings: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {"measurements": self.values, "warnings": self.warnings}


def _validate_features(features: tuple[str, ...], methods: dict) -> tuple[str, ...]:
    """Résout les alias, filtre les features non supportées par l'extracteur."""
    resolved, skipped = [], []
    for f in features:
        method = FEATURE_ALIASES.get(f, f)
        if method in methods:
            resolved.append(method)
        else:
            skipped.append(f)
    if skipped:
        logger.warning("Features non supportées par l'extracteur : %s", skipped)
    return tuple(resolved)


def _scale_to_original(score_px_512: float, file_size: tuple[int, int]) -> float:
    """approx. homogène du facteur 512 -> image d'origine."""
    h, w = file_size
    return score_px_512 * ((h / 512.0 + w / 512.0) / 2.0)


def _to_mm(
    score_px_512: float,
    file_size: tuple[int, int],
    pixel_spacing_mm: tuple[float, float] | None,
) -> tuple[float | None, bool, str | None]:
    """Conversion px(512) -> mm, ou None si PixelSpacing absent."""
    if pixel_spacing_mm is None:
        return None, False, (
            "aucun PixelSpacing fourni (format JPG) : SCD non "
            "convertible en millimètres"
        )
    spacing = float(np.mean(pixel_spacing_mm))
    mm = _scale_to_original(score_px_512, file_size) * spacing
    return mm, True, f"PixelSpacing moyen {spacing:.4f} mm/px"


def extract_measurements(
    engine,
    preds_512: np.ndarray,
    file_size: tuple[int, int],
    features: tuple[str, ...] = ("CTR", "SCD"),
    pixel_spacing_mm: tuple[float, float] | None = None,
) -> Measurements:
    """Calcule les mesures demandées avec l'extracteur officiel CXAS.

    ``preds_512`` : masque bool (159, 512, 512) sur la grille CXAS —
    c'est l'entrée attendue par ``Extractor.extract`` (fidèle à la
    bibliothèque).
    """
    methods = engine.extractor.methods
    features = _validate_features(features, methods)
    result = Measurements()

    for method in features:
        try:
            payload = engine.extractor.extract(
                file=preds_512, image=None, method=method
            )
        except (AssertionError, ValueError, KeyError) as exc:
            result.values[method] = {
                "available": False,
                "reason": f"structures anatomiques absentes : {exc}",
            }
            continue
        except Exception as exc:  # erreur imprévue de l'extracteur
            result.warnings.append(f"{method} : échec ({exc!r})")
            continue

        # Contract cxas : extract() renvoie {"score": ..., "drawing": ...}
        # (score -1 = structure absente, sans exception).
        if not isinstance(payload, dict) or "score" not in payload:
            result.values[method] = {"available": False, "reason": "sortie inattendue"}
            continue
        score = payload["score"]
        if score is None:
            result.values[method] = {"available": False, "reason": "aucune valeur"}
            continue

        if method == "Cardio-Thoracic Ratio":
            if score <= SCORE_ABSENT:
                result.values[method] = {
                    "available": False,
                    "reason": "structure absente (poumons/hémi-diaphragme/"
                              "cœur non détectés)",
                }
            else:
                result.values[method] = {
                    "available": True,
                    "value": float(score),
                    "unit": "ratio",
                }
            continue

        score = float(score)
        if score > SCORE_ABSENT:
            mm, mm_ok, note = _to_mm(score, file_size, pixel_spacing_mm)
            result.values[method] = {
                "available": True,
                "value_px_512": score,
                "value_px_original": round(_scale_to_original(score, file_size), 2),
                "value_mm": round(mm, 3) if mm is not None else None,
                "unit": "mm" if mm_ok else "px",
                "note": note or "pixels sur la grille 512x512 de CXAS",
            }
        else:
            result.values[method] = {"available": False, "reason": "structure absente"}

    return result