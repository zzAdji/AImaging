"""Partie 12 — Vérification que le soft voting ne moyenne JAMAIS des classes
dans un ordre différent entre les 5 checkpoints.

Le garde-fou est implémenté dans ``main_predict.load_radiography_models`` :
il lève une ``ValueError`` dès qu'un checkpoint présente un ``class_to_idx``
différent de celui du premier modèle. Sans cette cohérence, la moyenne
positionnelle des probabilités serait mathématiquement invalide.

Import de ``main_predict`` volontairement lent (torch + torchvision) : ce test
vérifie une garantie critique du pipeline, il vaut la peine d'être coché.
"""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest

SERVER_DIR = Path(__file__).resolve().parent.parent
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

from paths import bootstrap_all  # noqa: E402

bootstrap_all()

from main_predict import load_radiography_models  # noqa: E402

SAMPLED_ARGUMENTS = (Path("dummy.pt"),), {"hidden_dims": (512, 128, 32), "dropout": 0.2}


def _fake_loaded(architecture: str, class_to_idx: dict) -> tuple[MagicMock, dict]:
    model = MagicMock()
    payload = {
        "architecture": architecture,
        "class_to_idx": class_to_idx,
        "input_size": (224, 224),
        "normalization_mean": (0.5, 0.5, 0.5),
        "normalization_std": (0.5, 0.5, 0.5),
    }
    return model, payload


def test_mapping_de_classes_identique_accepte(monkeypatch):
    reference = {"Normal": 0, "Pneumonia": 1, "Emphysema": 2, "Tuberculosis": 3}
    _, first_payload = _fake_loaded("densenet121", reference)
    _, second_payload = _fake_loaded("resnet50", reference)
    monkeypatch.setattr(
        "main_predict.load_model_from_checkpoint",
        MagicMock(side_effect=[(MagicMock(), first_payload), (MagicMock(), second_payload)]),
    )
    loaded = load_radiography_models(
        [Path("a.pt"), Path("b.pt")],
        hidden_dims=(512, 128, 32),
        dropout=0.2,
        device_config="cpu",
    )
    assert len(loaded) == 2
    assert [item.architecture for item in loaded] == ["densenet121", "resnet50"]


def test_mapping_de_classes_different_leve_valueerror(monkeypatch):
    reference = {"Normal": 0, "Pneumonia": 1, "Emphysema": 2, "Tuberculosis": 3}
    other = {"Normal": 0, "Emphysema": 1, "Pneumonia": 2, "Tuberculosis": 3}  # ordre différent !
    _, first_payload = _fake_loaded("densenet121", reference)
    _, second_payload = _fake_loaded("resnet50", other)

    monkeypatch.setattr(
        "main_predict.load_model_from_checkpoint",
        MagicMock(side_effect=[(MagicMock(), first_payload), (MagicMock(), second_payload)]),
    )
    with pytest.raises(ValueError, match="mapping de classes différen"):
        load_radiography_models(
            [Path("a.pt"), Path("b.pt")],
            hidden_dims=(512, 128, 32),
            dropout=0.2,
            device_config="cpu",
        )
