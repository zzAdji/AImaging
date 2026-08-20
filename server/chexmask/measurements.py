"""Mesures anatomiques à partir des landmarks HybridGNet (poumons + cœur).

Les coordonnées sont fournies en pixels (image 1024×1024) et converties
en millimètres via ``pixel_spacing_mm`` (ligne, colonne) quand disponible.

Incertitude : chaque mesure propage les écarts-types par nœud
(échantillonnage stochastique du VAE, N=50) — propagation exponentielle de
delta pour les diamètres, et Monte-Carlo léger pour la surface.

En plus des valeurs, ``compute_measurements`` expose les ``lines`` : les
segments (grille 1024) à poser sur l'image comme le ferait un radiologue
(diamètre transverse cœur, diamètre transverse thorax) pour tracer la
mesure directement dans le canevas.
"""

from __future__ import annotations

import numpy as np

from chexmask.graph import ORGAN_SLICES

HEART_RANGE = list(ORGAN_SLICES["heart"])
RIGHT_LUNG_RANGE = list(ORGAN_SLICES["right_lung"])
LEFT_LUNG_RANGE = list(ORGAN_SLICES["left_lung"])

# Seuil d'alerte (px) sur l'incertitude moyennée par nœud, en coordonnées 1024.
ALERT_SIGMA_PX = 12.0


def _mm_scale(pixel_spacing_mm: tuple[float, float] | None) -> float:
    """Facteur milli-  mètre par pixel (moyenne des deux axes si disponible)."""
    if not pixel_spacing_mm:
        return 1.0
    row, col = float(pixel_spacing_mm[0]), float(pixel_spacing_mm[1])
    return (row + col) / 2.0


def _node_sigma(result: dict) -> np.ndarray:
    """Écart-type moyen par nœud : (std_x + std_y)/2."""
    return (np.asarray(result["std_x"]) + np.asarray(result["std_y"])) / 2.0


def _diameter(points: np.ndarray, sigma: np.ndarray, scale: float, i: int, j: int, px_only=False):
    """Distance entre deux nœuds (px puis mm) + incertitude propagée."""
    d = np.linalg.norm(points[i] - points[j])
    s = np.hypot(sigma[i], sigma[j])
    if px_only:
        return d, s
    return d * scale, s * scale


def _circle_area(points: np.ndarray, sigma: np.ndarray, scale: float, px_only=False):
    """Surface (px² ou mm²) du polygone + incertitude Monte-Carlo."""
    pts = points
    if px_only:
        area_px = 0.5 * abs(np.sum(pts[:, 0] * np.roll(pts[:, 1], -1) - np.roll(pts[:, 0], -1) * pts[:, 1]))
        return area_px, _area_mc(pts, sigma, scale=1.0)
    area_px = 0.5 * abs(np.sum(pts[:, 0] * np.roll(pts[:, 1], -1) - np.roll(pts[:, 0], -1) * pts[:, 1]))
    return area_px * scale * scale, _area_mc(pts, sigma, scale)


def _area_mc(points: np.ndarray, sigma: np.ndarray, scale: float, n: int = 200) -> float:
    """Écart-type de la surface par perturbation Monte-Carlo des nœuds."""
    rng = np.random.default_rng(0)
    samples = []
    for _ in range(n):
        perturbed = points + rng.normal(0.0, sigma[:, None], points.shape)
        area = 0.5 * abs(
            np.sum(perturbed[:, 0] * np.roll(perturbed[:, 1], -1) - np.roll(perturbed[:, 0], -1) * perturbed[:, 1])
        )
        samples.append(area)
    return float(np.std(samples) * scale * scale)


def compute_measurements(
    result: dict,
    pixel_spacing_mm: tuple[float, float] | None = None,
    custom_measures: list[dict] | None = None,
) -> dict:
    """Calcule mesures standard + personnalisées depuis les landmarks.

    ``custom_measures`` : liste de {label, a (node idx), b (node idx)}
    pour une distance entre deux nœuds, ou {label, nodes: [...]} pour la
    surface d'un contour.
    """
    scale = _mm_scale(pixel_spacing_mm)
    px_only = scale == 1.0

    mx = np.asarray(result["mean_x"])
    my = np.asarray(result["mean_y"])
    sigma = _node_sigma(result)

    all_pts = np.stack([mx, my], axis=1)
    heart = all_pts[HEART_RANGE]
    right = all_pts[RIGHT_LUNG_RANGE]
    left = all_pts[LEFT_LUNG_RANGE]

    sigma_heart = sigma[HEART_RANGE]
    sigma_right = sigma[RIGHT_LUNG_RANGE]
    sigma_left = sigma[LEFT_LUNG_RANGE]

    # ---- Indice cardiotoracique (CTR) : diamètre transverse cœur / thorax ----
    # Définition clinique : portées HORIZONTALES (x_max - x_min).
    heart_w_px, heart_w_ij, heart_w_std = _hspan(heart, sigma_heart)
    thorax_w_px, thorax_w_ij, thorax_w_std = _hspan(np.vstack([right, left]), np.concatenate([sigma_right, sigma_left]))
    ctr = heart_w_px / thorax_w_px
    ctr_std = ctr * np.hypot(heart_w_std / heart_w_px, thorax_w_std / thorax_w_px)

    max_sigma = float(np.max(sigma))

    def _safe(value):  # JSON-safe scalars (float32 → float)
        if hasattr(value, "item"):
            return value.item()
        return float(value)

    heart_area, heart_area_std = _circle_area(heart, sigma_heart, scale)
    right_area, right_area_std = _circle_area(right, sigma_right, scale)
    left_area, left_area_std = _circle_area(left, sigma_left, scale)

    measurements = {
        "ctr": {"value": _safe(ctr), "std": _safe(ctr_std), "unit": "ratio"},
        "heart_transverse_diameter": {
            "value": _safe(heart_w_px * scale),
            "std": _safe(heart_w_std * scale),
            "unit": "mm" if not px_only else "px",
        },
        "thorax_transverse_diameter": {
            "value": _safe(thorax_w_px * scale),
            "std": _safe(thorax_w_std * scale),
            "unit": "mm" if not px_only else "px",
        },
        "right_lung_surface": {
            "value": _safe(right_area),
            "std": _safe(right_area_std),
            "unit": "mm²" if not px_only else "px²",
        },
        "left_lung_surface": {
            "value": _safe(left_area),
            "std": _safe(left_area_std),
            "unit": "mm²" if not px_only else "px²",
        },
        "heart_surface": {
            "value": _safe(heart_area),
            "std": _safe(heart_area_std),
            "unit": "mm²" if not px_only else "px²",
        },
    }

    # ---- Mesures personnalisées ----
    custom = []
    for m in custom_measures or []:
        label = m.get("label", "mesure")
        if "nodes" in m:  # surface d'un contour fermé
            idx = np.asarray(m["nodes"], dtype=int)
            area, astd = _circle_area(all_pts[idx], sigma[idx], scale)
            custom.append(
                {
                    "label": label,
                    "value": _safe(area),
                    "std": _safe(astd),
                    "unit": "mm²" if not px_only else "px²",
                }
            )
        else:  # distance entre deux nœuds
            i, j = int(m["a"]), int(m["b"])
            d, dstd = _diameter(all_pts, sigma, scale, i, j)
            custom.append(
                {
                    "label": label,
                    "value": _safe(d),
                    "std": _safe(dstd),
                    "unit": "mm" if not px_only else "px",
                }
            )

    warnings = []
    if max_sigma > ALERT_SIGMA_PX:
        warnings.append(
            f"Incertitude élevée sur les landmarks (σ max = {max_sigma:.1f} px, "
            f"seuil {ALERT_SIGMA_PX} px) : mesures à interpréter avec prudence."
        )
    if ctr > 0.62:
        warnings.append(f"CTR élevé ({ctr:.3f}) : cardiomégalie possible à confirmer.")
    elif ctr < 0.35:
        warnings.append(f"CTR inhabituellement bas ({ctr:.3f}) : repasser en revue la qualité d'image.")

    # ---- Segments de mesure à poser sur l'image (grille 1024) ----
    # Heart : de la bordure gauche à la bordure droite (nœuds extrêmes x).
    # Thorax : ligne horizontale au niveau moyen des deux extrêmes latéraux
    # des poumons (jambe droite du CTR, comme le tracé d'un radiologue).
    all_lung = np.vstack([right, left])
    hi, hj = heart_w_ij
    heart_a = (float(heart[hi, 0]), float(heart[hi, 1]))
    heart_b = (float(heart[hj, 0]), float(heart[hj, 1]))
    ti, tj = thorax_w_ij
    thorax_y = float((all_lung[ti, 1] + all_lung[tj, 1]) / 2.0)
    thorax_a = (float(all_lung[ti, 0]), thorax_y)
    thorax_b = (float(all_lung[tj, 0]), thorax_y)

    lines = [
        {
            "key": "heart_transverse",
            "label": "Diamètre cœur",
            "value": _safe(heart_w_px * scale),
            "unit": "mm" if not px_only else "px",
            "x1": heart_a[0],
            "y1": heart_a[1],
            "x2": heart_b[0],
            "y2": heart_b[1],
        },
        {
            "key": "thorax_transverse",
            "label": "Diamètre thorax",
            "value": _safe(thorax_w_px * scale),
            "unit": "mm" if not px_only else "px",
            "x1": thorax_a[0],
            "y1": thorax_a[1],
            "x2": thorax_b[0],
            "y2": thorax_b[1],
        },
    ]

    return {
        "measurements": measurements,
        "custom": custom,
        "warnings": warnings,
        "uncertainty": {"max_node_std_px": max_sigma, "mean_node_std_px": float(np.mean(sigma))},
        "scale_used": "mm" if not px_only else "pixels",
        "ctr_method": (
            "portées horizontales des contours HybridGNet (poumons + cœur) ; "
            "peut diverger du CTR CXAS (silhouette cardiomédiastinale vs cœur seul)"
        ),
        "lines": lines,
    }


def _hspan(points: np.ndarray, sigma: np.ndarray) -> tuple[float, tuple[int, int], float]:
    """Portée horizontale (x_max - x_min) d'un contour + écart-type propagé."""
    i_min = int(np.argmin(points[:, 0]))
    i_max = int(np.argmax(points[:, 0]))
    width = points[i_max, 0] - points[i_min, 0]
    std = (sigma[i_min] + sigma[i_max]) / 2.0
    return width, (i_min, i_max), std


def landmark_sets(result: dict) -> dict:
    """Contours par organe pour le rendu client (px, 1024×1024)."""
    mx = np.asarray(result["mean_x"])
    my = np.asarray(result["mean_y"])
    sigma = _node_sigma(result)
    sets = {}
    for organ, rng in ORGAN_SLICES.items():
        idx = list(rng)
        sets[organ] = {
            "x": mx[idx].tolist(),
            "y": my[idx].tolist(),
            "std": sigma[idx].tolist(),
        }
    return sets