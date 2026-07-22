"""Structures de données partagées par l'ensemble du pipeline de prétraitement."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Tuple


@dataclass
class ImageEntry:
    """Trace complète d'une image à travers le pipeline de prétraitement.

    Attributes:
        source_path: Chemin de l'image originale (dataset_clean/...), jamais modifié.
        class_name: Classe déduite du dossier parent immédiat.
        load_success: True si l'image a pu être chargée et traitée.
        error_reason: Raison de l'échec, si load_success est False.
        original_width / original_height: Dimensions avant traitement.
        processed_width / processed_height: Dimensions après resize+padding
            (toujours égales à la taille cible si load_success est True).
        processed_path: Chemin de l'image traitée dans dataset_processed/,
            None si le traitement a échoué.
        patient_id: Identifiant patient si disponible (None sinon — le
            split retombe alors sur un split stratifié au niveau image).
        split: "train" | "val" | "test", assigné par split.py.
    """

    source_path: Path
    class_name: str
    load_success: bool = True
    error_reason: Optional[str] = None
    original_width: Optional[int] = None
    original_height: Optional[int] = None
    processed_width: Optional[int] = None
    processed_height: Optional[int] = None
    processed_path: Optional[Path] = None
    patient_id: Optional[str] = None
    split: Optional[str] = None


@dataclass
class NormalizationStats:
    """Statistiques de normalisation retenues pour ce run.

    Attributes:
        architecture: Backbone pour lequel ces statistiques sont dérivées.
        input_size: Taille (H, W) attendue en entrée du modèle.
        mean: Moyenne de normalisation par canal.
        std: Écart-type de normalisation par canal.
        source: "pretrained_weights" | "imagenet_fallback" | "dataset_computed".
        dataset_mean_std: Statistiques mean/std calculées sur l'échantillon
            réel du dataset (niveaux de gris, [0,1]), fournies à titre
            informatif dans le rapport même si non utilisées pour la
            normalisation appliquée (voir analyse : ImageNet reste le défaut
            recommandé pour un transfer learning classique).
    """

    architecture: str
    input_size: Tuple[int, int]
    mean: Tuple[float, ...]
    std: Tuple[float, ...]
    source: str
    dataset_mean_std: Optional[Tuple[float, float]] = None


@dataclass
class PreprocessingReport:
    """Rapport agrégé d'un run de prétraitement complet."""

    input_dir: Path
    output_dir: Path
    entries: List[ImageEntry] = field(default_factory=list)
    class_counts: Dict[str, int] = field(default_factory=dict)
    split_counts: Dict[str, Dict[str, int]] = field(default_factory=dict)
    normalization: Optional[NormalizationStats] = None
    enhancement_applied: bool = False
    enhancement_method: Optional[str] = None
    execution_time_seconds: float = 0.0

    @property
    def total_images(self) -> int:
        return len(self.entries)

    @property
    def successful_entries(self) -> List[ImageEntry]:
        return [e for e in self.entries if e.load_success]

    @property
    def failed_entries(self) -> List[ImageEntry]:
        return [e for e in self.entries if not e.load_success]
