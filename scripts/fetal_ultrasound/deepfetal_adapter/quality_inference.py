"""Optional wrapper for DeepFetal's YOLO-based quality/filter model."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict

from .config import QualityFilterConfig
from .paths import require_file


@dataclass
class QualityPrediction:
    score: float | None
    prediction: str
    probabilities: Dict[str, float]
    available: bool = True
    reason: str | None = None

    def to_dict(self) -> Dict[str, Any]:
        output = {
            "quality_score": self.score,
            "quality_prediction": self.prediction,
            "quality_probabilities": self.probabilities,
        }
        if not self.available:
            output["quality_available"] = False
            output["quality_unavailable_reason"] = self.reason
        return output


class QualityFilter:
    def __init__(self, config: QualityFilterConfig | None = None):
        self.config = config or QualityFilterConfig()
        require_file(self.config.checkpoint_path, "Checkpoint du filtre qualite")
        try:
            from ultralytics import YOLO
        except ModuleNotFoundError as exc:
            raise ModuleNotFoundError(
                "Le filtre qualite DeepFetal requiert le package 'ultralytics'. "
                "Installe-le dans l'environnement courant pour activer ce modele."
            ) from exc
        self.model = YOLO(str(self.config.checkpoint_path))

    def predict(self, image_path: Path) -> QualityPrediction:
        results = self.model(str(image_path), conf=self.config.confidence_threshold, verbose=False)
        if not results:
            return QualityPrediction(None, "unknown", {})

        result = results[0]
        if not hasattr(result, "probs") or result.probs is None:
            return QualityPrediction(None, "unknown", {})

        raw_probs = result.probs.data.detach().cpu().numpy()
        names = self.model.names
        probabilities = {str(names[i]): float(raw_probs[i]) for i in range(len(raw_probs))}
        top_idx = int(result.probs.top1)
        top_label = str(names[top_idx])
        top_conf = float(result.probs.top1conf.item())

        if self.config.accept_label is not None:
            accepted = top_label == self.config.accept_label and top_conf >= self.config.class_confidence_threshold
        else:
            accepted = top_label != self.config.reject_label and top_conf >= self.config.class_confidence_threshold

        return QualityPrediction(
            score=top_conf,
            prediction="accepted" if accepted else "rejected",
            probabilities=dict(sorted(probabilities.items(), key=lambda item: item[1], reverse=True)),
        )

