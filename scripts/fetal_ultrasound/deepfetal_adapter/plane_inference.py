"""Inference wrapper for the fetal ultrasound plane classifier."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Any

import torch

from .config import PlaneClassifierConfig
from .plane_model import load_class_labels, load_plane_model, resolve_device
from .plane_preprocessing import load_plane_tensor


@dataclass
class PlanePrediction:
    predicted_label: str
    confidence: float
    probabilities: Dict[str, float]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "plane_prediction": self.predicted_label,
            "plane_confidence": self.confidence,
            "plane_probabilities": self.probabilities,
        }


class PlaneClassifier:
    def __init__(self, config: PlaneClassifierConfig | None = None, device: str = "auto"):
        self.config = config or PlaneClassifierConfig()
        self.device = resolve_device(device)
        self.class_labels = load_class_labels(self.config.class_indices_path)
        self.model = load_plane_model(self.config, self.device)

    def predict(self, image_path: Path) -> PlanePrediction:
        tensor = load_plane_tensor(image_path, self.config.image_size).to(self.device)
        with torch.no_grad():
            logits = self.model(tensor)
            probs = torch.softmax(logits, dim=1)[0].detach().cpu()

        pred_idx = int(torch.argmax(probs).item())
        predicted_label = self.class_labels.get(str(pred_idx), "Unknown")
        probabilities = {
            self.class_labels.get(str(idx), f"class_{idx}"): float(prob)
            for idx, prob in enumerate(probs.tolist())
        }
        probabilities = dict(sorted(probabilities.items(), key=lambda item: item[1], reverse=True))
        return PlanePrediction(
            predicted_label=predicted_label,
            confidence=float(probs[pred_idx].item()),
            probabilities=probabilities,
        )

