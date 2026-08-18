"""Configuration de la branche CXAS (anatomie thoracique).

Toutes les valeurs sont surchargeables par variables d'environnement
``CXAS_*``. Aucune dépendance lourde n'est importée ici.
"""

from __future__ import annotations

import os
from pathlib import Path

# Racine du dépôt : scripts/radiography/anatomy/config.py -> parents[3]
PROJECT_ROOT = Path(__file__).resolve().parents[3]

# Modèle CXAS officiel (poids téléchargés automatiquement via gdown au
# premier instantiation, dans CXAS_PATH ou ~/.cxas/weights/).
CXAS_MODEL_NAME = os.environ.get("CXAS_MODEL_NAME", "UNet_ResNet50_default")

# Dossier contenant les poids CXAS. Par défaut : ~/.cxas (standard cxas).
CXAS_PATH = os.environ.get("CXAS_PATH", str(Path.home() / ".cxas"))

# Device par défaut : pas de CUDA sur la machine cible -> CPU.
CXAS_DEVICE = os.environ.get("CXAS_DEVICE", "cpu")

# Masque la bannière de bienvenue de cxas ("CXAS_NO_WELCOME": "1").
CXAS_NO_WELCOME = os.environ.get("CXAS_NO_WELCOME", "1")

# Root de sortie des artefacts (masques, overlays, mesures).
OUTPUT_ROOT = Path(
    os.environ.get(
        "CXAS_OUTPUT_ROOT", str(PROJECT_ROOT / "outputs" / "cxas")
    )
)

# Répertoires de sortie, créés à la demande.
OUTPUT_SUBDIRS = {
    "images": "images",
    "masks": "masks",
    "overlays": "overlays",
    "measurements": "measurements",
}

# Features réellement supportées par cxas (Extractor.methods), par
# ordre de pertinence pour le projet. Réévalué au runtime.
SUPPORTED_FEATURES = (
    "Cardio-Thoracic Ratio",
    "CTR",
    "Spine-Center Distance",
    "SCD",
    "perimeter",
    "compactness",
    "area",
    "centroid",
    "box",
    "convexity",
    "radiomics",
)

# Features standard demandées par défaut (pas de radiomics : coûteux).
DEFAULT_FEATURES = ("CTR", "SCD")

# Labels PAXRay prioritaires pour l'overlay composite et le rapport
# (indices réels de cxas.label_mapper.id2label_dict, vérifiés au runtime).
KEY_LABELS = {
    134: "lung",
    135: "right lung",
    136: "left lung",
    121: "heart",
    107: "right hemidiaphragm",
    106: "left hemidiaphragm",
    0: "spine",
}

# Side maximum (pixels) auquel les masques sont réduits dans le résultat
# structuré (API / mémoire). Les fichiers sur disque restent en pleine
# résolution.
MASK_MAX_SIDE = int(os.environ.get("CXAS_MASK_MAX_SIDE", "1024"))

# Extensions d'image reconnues par CXAS lui-même (FileLoader.file_types).
# Attention : le dataset utilise des .jpeg, non supportés -> conversion
# .png temporaire assurée par notre module.
CXAS_NATIVE_EXTENSIONS = {".jpg", ".png", ".dcm"}


def ensure_output_dirs() -> dict[str, Path]:
    """Crée (si besoin) les répertoires de sortie et les retourne."""
    dirs = {name: OUTPUT_ROOT / sub for name, sub in OUTPUT_SUBDIRS.items()}
    for d in dirs.values():
        d.mkdir(parents=True, exist_ok=True)
    return dirs