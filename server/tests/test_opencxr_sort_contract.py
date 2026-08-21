"""Tests du contrat fail-closed du tri opencxr (Phase 3, Parties 3-4).

Le module ``sort_contract`` est volontairement indépendant de TensorFlow et de
SimpleITK : il transforme le résultat brut de l'Image Sorter en un des trois
statuts distincts exigés :

- ACCEPTED_CXR            → image valide et radiographie thoracique ;
- REJECTED_NON_CXR        → image valide mais non radiographie thoracique ;
- REJECTED_INVALID_IMAGE  → image techniquement illisible/endommagée.

Règle : aucune image avec un échec de décodage ne peut être ACCEPTED_CXR.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

_OPEN_CXR_DIR = Path(__file__).resolve().parents[2] / "scripts" / "opencxr"
sys.path.insert(0, str(_OPEN_CXR_DIR))

import sort_contract as sc  # noqa: E402


# ---------------------------------------------------------------- acceptation

@pytest.mark.parametrize("type_label", ["PA", "AP", "lateral"])
def test_type_frontal_est_cxr(type_label):
    assert sc.is_cxr_type(type_label) is True


def test_enrich_accepte_pa():
    raw = {"Type": "PA", "Type_Probs_PA_AP_lateral_notCXR": [0.9, 0.05, 0.04, 0.01]}
    result = sc.enrich_sort_result(raw, decoder="simpleitk")
    assert result["status"] == sc.STATUS_ACCEPTED_CXR
    assert result["is_cxr"] is True
    assert result["confidence"] == pytest.approx(0.99)
    assert result["decoder"] == "simpleitk"
    # Le payload original est conservé (rétro-compatibilité).
    assert result["Type"] == "PA"


# ---------------------------------------------------------------- rejets

def test_enrich_rejette_avec_stats_notcxr():
    raw = {"Type": "notCXR", "Type_Probs_PA_AP_lateral_notCXR": [0.1, 0.1, 0.1, 0.7]}
    result = sc.enrich_sort_result(raw, decoder="pillow_fallback")
    assert result["status"] == sc.STATUS_REJECTED_NON_CXR
    assert result["is_cxr"] is False
    assert result["reason"] == sc.REASON_LOW_CXR_PROBABILITY
    assert result["confidence"] == pytest.approx(0.3)
    assert result["decoder"] == "pillow_fallback"


def test_reject_invalid_structure_fail_closed():
    body = sc.reject_invalid(decoder="decode_failed", detail="cassé")
    assert body["status"] == sc.STATUS_REJECTED_INVALID_IMAGE
    assert body["is_cxr"] is False
    assert body["reason"] == sc.REASON_DECODE_FAILED
    assert body["decoder"] == "decode_failed"
    assert "cassé" in body["detail"]


def test_confidence_retourne_none_si_probs_absentes():
    assert sc.cxr_confidence({"Type": "PA"}) is None
    assert sc.cxr_confidence({"Type": "PA", "Type_Probs_PA_AP_lateral_notCXR": [0.5]}) is None


def test_jamais_accepte_sur_erreur_de_decodage():
    """Fail-closed : reject_invalid n'expose JAMAIS un ACCEPTED_CXR."""
    for reason in (sc.REASON_DECODE_FAILED, "validation_technique"):
        body = sc.reject_invalid(reason=reason)
        assert body["status"] != sc.STATUS_ACCEPTED_CXR
        assert body["is_cxr"] is False
