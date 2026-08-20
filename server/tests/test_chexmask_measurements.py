"""Tests unitaires des mesures landmarks HybridGNet (chexmask).

Ne charge ni torch ni torch_geometric : uniquement numpy + les fonctions
de mesures, sur des landmarks synthétiques déterministes.
"""

from __future__ import annotations

import numpy as np
import pytest

from chexmask import measurements as m


def _result_from_points(points: np.ndarray, std: float = 1.0) -> dict:
    """Landmarks synthétiques : 120 nœuds (44 + 50 + 26) + incertitude uniforme."""
    assert len(points) == 120
    return {
        "mean_x": points[:, 0],
        "mean_y": points[:, 1],
        "std_x": np.full(120, std),
        "std_y": np.full(120, std),
    }


def _ring(size: float, cx: float, cy: float, n: int) -> np.ndarray:
    """Anneau fermé de ``n`` points échantillonnés sur un carré de côté ``size``.

    Tous les sommets sont sur le pourtour : le polygone vaut exactement le
    carré (aire ``size²``), quel que soit ``n``.
    """
    half = size / 2.0
    corners = np.array(
        [[cx - half, cy - half], [cx + half, cy - half], [cx + half, cy + half], [cx - half, cy + half]],
        dtype=float,
    )
    # Périmètre cumulé le long des 4 arêtes (retour au point de départ exclu).
    segments = np.array([np.linalg.norm(corners[(i + 1) % 4] - corners[i]) for i in range(4)])
    cum = np.concatenate([[0.0], np.cumsum(segments)])
    total = cum[-1]
    offsets = np.linspace(0.0, total, n + 1)[:-1]
    pts = np.empty((n, 2))
    for k, off in enumerate(offsets):
        edge = int(np.searchsorted(cum, off, side="right") - 1 if off < total else 3)
        edge = min(max(edge, 0), 3)
        t = (off - cum[edge]) / max(segments[edge], 1e-12)
        pts[k] = corners[edge] + t * (corners[(edge + 1) % 4] - corners[edge])
    pts[-1] = corners[3] if size > 0 else pts[-1]
    return pts


def _anatomy(heart_size: float = 40.0) -> np.ndarray:
    """120 nœuds synthétiques : RL (44), LL (50), cœur (26).

    RL : carré 100×100 centré (-50,50) ; LL : carré 100×100 centré (50,50) ;
    cœur : carré ``heart_size`` centré (0,50). Portée thorax = 200 px,
    portée cœur = ``heart_size`` px.
    """
    right_lung = _ring(size=100.0, cx=-50.0, cy=50.0, n=44)
    left_lung = _ring(size=100.0, cx=50.0, cy=50.0, n=50)
    heart = _ring(size=heart_size, cx=0.0, cy=50.0, n=26)
    return np.vstack([right_lung, left_lung, heart])


def test_ctr_donne_le_rapport_des_portees():
    """CTR = portée horizontale cœur / portée horizontale poumons."""
    result = m.compute_measurements(_result_from_points(_anatomy()), pixel_spacing_mm=(1.0, 1.0))
    assert result["measurements"]["ctr"]["value"] == pytest.approx(40.0 / 200.0)
    assert result["measurements"]["thorax_transverse_diameter"]["value"] == pytest.approx(200.0)
    assert result["measurements"]["heart_transverse_diameter"]["value"] == pytest.approx(40.0)


def test_surfaces_et_unites_avec_pixel_spacing():
    """Avec spacing 0.5 mm/px, surface en mm² = surface px × 0.25."""
    result = m.compute_measurements(_result_from_points(_anatomy()), pixel_spacing_mm=(0.5, 0.5))
    assert result["scale_used"] == "mm"
    # LL carré 100×100 = 10000 px² → 2500 mm² (± échantillonnage du pourtour)
    assert result["measurements"]["left_lung_surface"]["value"] == pytest.approx(2500.0, rel=1e-2)
    assert result["measurements"]["heart_surface"]["unit"] == "mm²"


def test_mesures_sans_spacing_restent_en_pixels():
    result = m.compute_measurements(_result_from_points(_anatomy()))
    assert result["scale_used"] == "pixels"
    for key in ("heart_transverse_diameter", "thorax_transverse_diameter"):
        assert result["measurements"][key]["unit"] == "px"


def test_mesure_personnalisee_distance_entre_noeuds():
    """Distance entre deux nœuds arbitraires = leur distance euclidienne."""
    points = _anatomy()
    a, b = 94, 107  # nœuds du cœur (formule indépendante du modèle)
    result = m.compute_measurements(
        _result_from_points(points),
        pixel_spacing_mm=(1.0, 1.0),
        custom_measures=[{"label": "largeur gauche", "a": a, "b": b}],
    )
    assert len(result["custom"]) == 1
    assert result["custom"][0]["label"] == "largeur gauche"
    assert result["custom"][0]["value"] == pytest.approx(np.linalg.norm(points[a] - points[b]), rel=1e-6)


def test_mesure_personnalisee_surface_contour():
    """Surface d'un sous-ensemble de nœuds (cœur 40×40 ≈ 1600 px²)."""
    points = _anatomy(heart_size=40.0)
    heart_idx = list(range(94, 120))  # les 26 nœuds du cœur (le carré)
    result = m.compute_measurements(
        _result_from_points(points),
        pixel_spacing_mm=(1.0, 1.0),
        custom_measures=[{"label": "chambre", "nodes": heart_idx}],
    )
    assert result["custom"][0]["value"] == pytest.approx(1600.0, rel=1e-2)


def test_incertitude_faible_pas_d_alerte():
    result = m.compute_measurements(_result_from_points(_anatomy(), std=1.0))
    assert result["uncertainty"]["max_node_std_px"] == pytest.approx(1.0)
    assert not any("Incertitude élevée" in w for w in result["warnings"])


def test_incertitude_elevee_declenche_alerte():
    result = m.compute_measurements(_result_from_points(_anatomy(), std=20.0))
    assert any("Incertitude élevée" in w for w in result["warnings"])


def test_landmark_sets_organise_les_organes():
    sets = m.landmark_sets(_result_from_points(_anatomy()))
    assert set(sets) == {"right_lung", "left_lung", "heart"}
    assert len(sets["right_lung"]["x"]) == 44
    assert len(sets["left_lung"]["x"]) == 50
    assert len(sets["heart"]["x"]) == 26


def test_lignes_de_mesure_posables_sur_l_image():
    """Les segments de mesure (grille 1024) concordent avec les mesures."""
    points = _anatomy()
    result = m.compute_measurements(_result_from_points(points), pixel_spacing_mm=(1.0, 1.0))
    lines = result["lines"]
    assert {line["key"] for line in lines} == {"heart_transverse", "thorax_transverse"}
    heart_line = next(line for line in lines if line["key"] == "heart_transverse")
    thorax_line = next(line for line in lines if line["key"] == "thorax_transverse")
    # Longueur des segments = portées mesurées (40 px cœur, 200 px thorax).
    assert abs(heart_line["x2"] - heart_line["x1"]) == pytest.approx(40.0)
    assert abs(thorax_line["x2"] - thorax_line["x1"]) == pytest.approx(200.0)
    # Les valeurs renvoyées sont celles affichées dans les mesures.
    assert heart_line["value"] == pytest.approx(result["measurements"]["heart_transverse_diameter"]["value"])
    assert thorax_line["value"] == pytest.approx(result["measurements"]["thorax_transverse_diameter"]["value"])