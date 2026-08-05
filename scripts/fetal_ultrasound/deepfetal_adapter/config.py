"""Default paths and inference settings for the fetal ultrasound adapter."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[3]


@dataclass(frozen=True)
class PlaneClassifierConfig:
    deepfetal_root: Path = PROJECT_ROOT / "DeepFetal"
    checkpoint_path: Path = PROJECT_ROOT / "models" / "fetal_ultrasound" / "plane_classifier.pth"
    class_indices_path: Path = PROJECT_ROOT / "data" / "fetal_ultrasound" / "class_indices_41.json"
    image_size: int = 224
    num_classes: int = 41


@dataclass(frozen=True)
class QualityFilterConfig:
    checkpoint_path: Path = PROJECT_ROOT / "models" / "fetal_ultrasound" / "filter.pt"
    confidence_threshold: float = 0.5
    class_confidence_threshold: float = 0.85
    accept_label: str | None = None
    reject_label: str = "neg"


@dataclass(frozen=True)
class FetalCLIPConfig:
    """Config pour FetalCLIP (https://github.com/BioMedIA-MBZUAI/FetalCLIP),
    un modele vision-langage base sur open_clip, fine-tune sur 210 035
    images d'echographie foetale. Phase G n'utilise que l'encodeur visuel.
    """

    weights_path: Path = PROJECT_ROOT / "models" / "fetal_ultrasound" / "FetalCLIP_weights.pt"
    config_path: Path = PROJECT_ROOT / "data" / "fetal_ultrasound" / "FetalCLIP_config.json"
    model_name: str = "FetalCLIP"
    embed_dim: int = 768