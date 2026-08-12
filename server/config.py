from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Tuple

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_ROOT = PROJECT_ROOT / "scripts"

RADIOGRAPHY_TRAINING_ROOT = SCRIPTS_ROOT / "radiography" / "training"
RADIOGRAPHY_PREPROCESSING_ROOT = SCRIPTS_ROOT / "radiography" / "preprocessing"
RADIOGRAPHY_RUNNING_ROOT = SCRIPTS_ROOT / "radiography" / "running"
SHARED_LLM_ROOT = SCRIPTS_ROOT / "shared" / "llm"


@dataclass
class RadiographyServerConfig:
    checkpoints: List[Path] = field(default_factory=lambda: [
        PROJECT_ROOT / "models" / "chest_xray" / "densenet121_best.pt",
        PROJECT_ROOT / "models" / "chest_xray" / "resnet50_best.pt",
        PROJECT_ROOT / "models" / "chest_xray" / "resnet101_best.pt",
        PROJECT_ROOT / "models" / "chest_xray" / "efficientnet_b0_best.pt",
        PROJECT_ROOT / "models" / "chest_xray" / "efficientnet_b2_best.pt",
    ])
    hidden_dims: Tuple[int, ...] = (512, 128, 32)
    dropout: float = 0.2
    device: str = "auto"


@dataclass
class GeminiConfig:
    api_key: str = field(default_factory=lambda: os.environ.get("GEMINI_API_KEY", ""))
    model_name: str = "gemini-3.6-flash"

def validate_gemini_config(config: GeminiConfig) -> None:
    if not config.api_key:
        raise RuntimeError(
            "GEMINI_API_KEY non définie. Définir cette variable d'environnement "
            "avant de démarrer le serveur (jamais de clé en dur dans le code)."
        )
