"""Configuration centrale du pipeline de prétraitement.

Toutes les valeurs "métier" (plages d'augmentation, activation du
contraste) sont rassemblées dans des profils de modalité nommés
(MODALITY_PRESETS) plutôt que codées en dur dans la logique de
traitement - c'est ce qui permet de réutiliser le même pipeline pour une
autre modalité d'imagerie (ex. échographie) en ajoutant simplement un
nouveau profil, sans toucher au reste du code.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, FrozenSet, Optional, Tuple


@dataclass
class AugmentationProfile:
    """Plages d'augmentation (appliquées uniquement au split "train", à la volée).

    Toutes les valeurs sont des bornes symétriques (+/-) sauf mention contraire.

    Attributes:
        rotation_degrees: Rotation aléatoire dans [-x, +x] degrés.
        translation_fraction: Translation aléatoire, fraction de la dimension.
        zoom_range: Plage de zoom (facteur d'échelle min, max).
        brightness_jitter: Variation de luminosité relative.
        contrast_jitter: Variation de contraste relative.
        horizontal_flip_prob: Probabilité de flip horizontal.
        vertical_flip_prob: Probabilité de flip vertical. À 0.0 pour la
            radiographie thoracique : un flip vertical placerait le
            cœur/diaphragme dans une orientation anatomiquement
            impossible. Ne jamais mettre cette valeur à autre chose que
            0.0 pour ce projet, quelle que soit la modalité future,
            sans une justification anatomique explicite et documentée.
    """

    rotation_degrees: float = 7.0
    translation_fraction: float = 0.07
    zoom_range: Tuple[float, float] = (0.90, 1.10)
    brightness_jitter: float = 0.15
    contrast_jitter: float = 0.15
    horizontal_flip_prob: float = 0.5
    vertical_flip_prob: float = 0.0


@dataclass
class EnhancementProfile:
    """Paramètres d'amélioration de contraste. Désactivé par défaut.

    Attributes:
        enabled: Si False (défaut), aucune transformation de contraste
            n'est appliquée - le pipeline se contente du redimensionnement.
        method: "clahe" | "hist_eq" | "gamma".
        clahe_clip_limit: Limite de clipping CLAHE (plus haut = plus de contraste,
            plus haut risque d'amplification du bruit).
        clahe_tile_grid_size: Taille de la grille de tuiles CLAHE.
        gamma_value: Valeur gamma (1.0 = identité).
    """

    enabled: bool = False
    method: str = "clahe"
    clahe_clip_limit: float = 2.0
    clahe_tile_grid_size: Tuple[int, int] = (8, 8)
    gamma_value: float = 1.0


# Profils pré-configurés par modalité d'imagerie.
#
# "chest_xray" est le profil recommandé et testé pour ce projet.
# "ultrasound" est un point de départ indicatif pour une réutilisation
# future : le bruit de speckle, le cône de scan et les artefacts
# d'interface (calipers, annotations) propres à l'échographie sont très
# différents d'une radiographie et n'ont volontairement PAS été modélisés
# ici. Ne pas utiliser ce profil tel quel en production - le recalibrer
# une fois qu'un vrai dataset échographique est disponible.
MODALITY_PRESETS: Dict[str, Dict[str, object]] = {
    "chest_xray": {
        "augmentation": AugmentationProfile(),
        "enhancement": EnhancementProfile(),
    },
    "ultrasound": {
        "augmentation": AugmentationProfile(
            rotation_degrees=5.0,
            translation_fraction=0.05,
            zoom_range=(0.92, 1.08),
            brightness_jitter=0.10,
            contrast_jitter=0.10,
            horizontal_flip_prob=0.5,
            vertical_flip_prob=0.0,
        ),
        "enhancement": EnhancementProfile(enabled=False),
    },
}


@dataclass
class ModelConfig:
    """Décrit le backbone de Deep Learning ciblé par le prétraitement.

    Le pipeline ne dépend d'aucune architecture précise : `architecture`
    est un nom reconnu par `model_registry.py`, qui dérive automatiquement
    la taille d'entrée et les statistiques de normalisation attendues à
    partir des poids pré-entraînés torchvision officiels plutôt que de
    les recopier à la main pour chaque backbone.

    Attributes:
        architecture: Nom du backbone (voir
            model_registry.SUPPORTED_ARCHITECTURES pour la liste).
        pretrained: Si True, dérive taille/normalisation depuis les poids
            pré-entraînés ImageNet officiels. Si False, utilise
            fallback_size ci-dessous avec les statistiques ImageNet génériques.
        fallback_size: Taille utilisée si pretrained=False ou si
            l'architecture n'est pas reconnue par torchvision.
        num_classes: Nombre de classes de sortie du problème.
    """

    architecture: str = "densenet121"
    pretrained: bool = True
    fallback_size: Tuple[int, int] = (224, 224)
    num_classes: int = 3


@dataclass
class PreprocessConfig:
    """Configuration d'exécution du pipeline de prétraitement.

    Attributes:
        input_dir: Dossier `dataset_clean/<classe>/*.png|jpg` en entrée,
            jamais modifié par ce pipeline.
        output_dir: Dossier `dataset_processed/<classe>/*.png` en sortie
            (grayscale, redimensionné, pas encore normalisé/dupliqué).
        reports_dir: Dossier de sortie des rapports (CSV/JSON/HTML) et du manifeste.
        modality: Nom du profil de modalité (voir MODALITY_PRESETS).
        model: Configuration du backbone cible (voir ModelConfig).
        valid_extensions: Extensions de fichiers considérées comme images.
        num_workers: Nombre de workers parallèles (traitement pixel, CPU-bound).
        split_ratios: (train, val, test), doit sommer à 1.0.
        stratify_split: Si True, conserve les proportions de classes dans
            chaque split.
        patient_id_csv: Chemin optionnel vers un CSV externe
            (colonnes: filename, patient_id) permettant un split au
            niveau patient. Laisser None si non disponible - le split
            retombe alors sur un split stratifié au niveau image.
        grid_sample_size: Nombre d'images (avant/après) affichées par
            classe dans la grille de vérification visuelle.
        random_seed: Graine pour la reproductibilité (split + échantillonnage).
    """

    input_dir: Path
    output_dir: Optional[Path] = None
    reports_dir: Optional[Path] = None

    modality: str = "chest_xray"
    model: ModelConfig = field(default_factory=ModelConfig)

    valid_extensions: FrozenSet[str] = frozenset({".jpg", ".jpeg", ".png"})
    num_workers: int = field(default_factory=lambda: max(1, os.cpu_count() or 1))

    split_ratios: Tuple[float, float, float] = (0.80, 0.10, 0.10)
    stratify_split: bool = True
    patient_id_csv: Optional[Path] = None

    grid_sample_size: int = 16

    random_seed: int = 42

    def __post_init__(self) -> None:
        self.input_dir = Path(self.input_dir).resolve()
        self.output_dir = (
            Path(self.output_dir).resolve()
            if self.output_dir is not None
            else self.input_dir.parent / "dataset_processed"
        )
        self.reports_dir = (
            Path(self.reports_dir).resolve()
            if self.reports_dir is not None
            else self.output_dir.parent / "reports"
        )
        if self.patient_id_csv is not None:
            self.patient_id_csv = Path(self.patient_id_csv).resolve()

        if abs(sum(self.split_ratios) - 1.0) > 1e-6:
            raise ValueError(f"split_ratios doit sommer à 1.0, reçu {self.split_ratios}")
        if self.modality not in MODALITY_PRESETS:
            raise ValueError(
                f"Modalité inconnue '{self.modality}'. Options : {list(MODALITY_PRESETS)}"
            )

    @property
    def augmentation_profile(self) -> AugmentationProfile:
        return MODALITY_PRESETS[self.modality]["augmentation"]  # type: ignore[return-value]

    @property
    def enhancement_profile(self) -> EnhancementProfile:
        return MODALITY_PRESETS[self.modality]["enhancement"]  # type: ignore[return-value]

    @property
    def manifest_path(self) -> Path:
        return self.reports_dir / "manifest.csv"

    @property
    def log_path(self) -> Path:
        return self.reports_dir / "preprocessing_logs.txt"

    @property
    def csv_report_path(self) -> Path:
        return self.reports_dir / "preprocessing_report.csv"

    @property
    def json_report_path(self) -> Path:
        return self.reports_dir / "preprocessing_report.json"

    @property
    def html_report_path(self) -> Path:
        return self.reports_dir / "preprocessing_report.html"

    @property
    def visualization_dir(self) -> Path:
        return self.reports_dir / "visualizations"
