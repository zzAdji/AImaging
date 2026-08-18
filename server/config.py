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
THREE_D_MAKER_ROOT = SCRIPTS_ROOT / "three_d_maker"

# URL du service 3D externe (ex. tunnel Cloudflare vers un notebook Kaggle GPU).
# Vide => la reconstruction 3D s'exécute en local (CPU). Renseigné => le
# serveur local forwarde les requêtes 3D vers ce service distant.
THREE_D_REMOTE_URL = os.environ.get("THREE_D_REMOTE_URL", "").strip().rstrip("/")


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


@dataclass
class CxasServerConfig:
    """Analyse anatomique CXAS (segmentation 159 classes + CTR/SCD).

    Surcharges par variables d'environnement ``CXAS_*``. Les poids sont
    chargés à la première analyse (voir install_cxas.py dans
    scripts/radiography/anatomy/).
    """

    model_name: str = os.environ.get("CXAS_MODEL_NAME", "UNet_ResNet50_default")
    device: str = os.environ.get("CXAS_DEVICE", "cpu")
    # Dossier racine des poids : cxas imbrique ``.cxas/weights`` dessous.
    weights_path: str = os.environ.get("CXAS_PATH", str(Path.home() / ".cxas"))
    features: Tuple[str, ...] = ("CTR", "SCD")
    # Les masques de la réponse API sont bornés à ce côté (pixels) :
    # pleine résolution inutile pour l'affichage, payload réduit.
    mask_max_side: int = 512

def validate_gemini_config(config: GeminiConfig) -> None:
    if not config.api_key:
        raise RuntimeError(
            "GEMINI_API_KEY non définie. Définir cette variable d'environnement "
            "avant de démarrer le serveur (jamais de clé en dur dans le code)."
        )
