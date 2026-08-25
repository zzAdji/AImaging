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


@dataclass
class OpenCxrServerConfig:
    """Configuration du microservice opencxr (Image Sorter + Normalisation CXR).

    opencxr requiert TensorFlow, absent en wheel pour le Python 3.14 du serveur
    principal : il tourne dans un microservice Python 3.12 séparé (venv312),
    rejoint par HTTP. Par défaut le serveur interroge le microservice local
    standard (``http://127.0.0.1:8011``, celui lancé par ``run_micro.bat``) ;
    on peut pointer vers un autre hôte via ``OPEN_CXR_URL``.
    """

    remote_url: str = os.environ.get("OPEN_CXR_URL", "").strip().rstrip("/")
    # Chargement TF + inférence multi-sorties/crops : timeout large pour le
    # traitement ET pour le coût froid (import TF + poids) du tout premier
    # appel, avant que le préchargement du microservice soit inactif.
    timeout_seconds: float = float(os.environ.get("OPEN_CXR_TIMEOUT", "300"))
    health_timeout_seconds: float = 3.0


@dataclass
class NeuroServerConfig:
    """Backend « Neuro » (projet CXR-Pathology_Analysis).

    Détection de pathologies YOLOv8 + heatmaps Grad-CAM DenseNet-121 (classes
    NIH). Le service tourne à distance (Hugging Face Space public par défaut)
    et est joint par HTTP : aucun poids ni ``ultralytics`` requis localement.
    Timeout large : cold start du container HF possible au premier appel.
    """

    remote_url: str = os.environ.get(
        "NEURO_BACKEND_URL", "https://sagarsarangi26-neuro.hf.space"
    ).strip().rstrip("/")
    timeout_seconds: float = float(os.environ.get("NEURO_TIMEOUT", "120"))
    # Sonde de santé : large car le Space peut être en cold start.
    health_timeout_seconds: float = float(os.environ.get("NEURO_HEALTH_TIMEOUT", "15"))


def validate_gemini_config(config: GeminiConfig) -> None:
    if not config.api_key:
        raise RuntimeError(
            "GEMINI_API_KEY non définie. Définir cette variable d'environnement "
            "avant de démarrer le serveur (jamais de clé en dur dans le code)."
        )
