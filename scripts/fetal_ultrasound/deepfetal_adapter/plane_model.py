"""Model loading for DeepFetal's fetal ultrasound plane classifier."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Dict

import torch

from .config import PlaneClassifierConfig
from .paths import add_deepfetal_to_path, require_file


def resolve_device(device: str = "auto") -> torch.device:
    if device == "auto":
        return torch.device("cuda:0" if torch.cuda.is_available() else "cpu")
    if device == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("CUDA demande mais indisponible dans cet environnement.")
    return torch.device(device)


def load_class_labels(class_indices_path: Path) -> Dict[str, str]:
    path = require_file(class_indices_path, "Fichier class_indices")
    with path.open("r", encoding="utf-8") as f:
        labels = json.load(f)
    if not isinstance(labels, dict):
        raise ValueError(f"Format class_indices invalide: {path}")
    return {str(k): str(v) for k, v in labels.items()}


def load_plane_model(config: PlaneClassifierConfig, device: torch.device):
    add_deepfetal_to_path(config.deepfetal_root)
    from deepfetal.model import convnext_tiny

    checkpoint_path = require_file(config.checkpoint_path, "Checkpoint du classificateur de plans")
    model = convnext_tiny(num_classes=config.num_classes).to(device)
    state_dict = torch.load(checkpoint_path, map_location=device)
    model.load_state_dict(state_dict)
    model.eval()
    return model

