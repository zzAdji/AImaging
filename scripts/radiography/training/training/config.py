"""Configuration centrale du module d'entraînement"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional, Tuple


@dataclass
class TrainConfig:
    """Configuration d'un run d'entraînement pour une seule architecture.

    Attributes:
        manifest_path: Chemin vers manifest.csv produit par le pipeline
            de prétraitement (colonnes path, class, patient_id, split).
        output_dir: Dossier de sortie (checkpoint, rapports, courbes,
            Grad-CAM). Par défaut : à côté du manifeste.
        architecture: Backbone cible.
        pretrained: Poids ImageNet pré-entraînés (recommandé).
        num_classes: Nombre de classes de sortie.
        classifier_hidden_dims: Tailles des couches cachées de la tête MLP
            personnalisée qui remplace le classifieur original (defaut :
            in_features -> 512 -> 128 -> 32 -> num_classes, comme dans
            Shahzad et al. 2025).
        classifier_dropout: Taux de dropout entre les couches de la tête.
        freeze_backbone: Si True (défaut), seule la tête de classification
            est entraînée (backbone gelé) - nettement plus rapide,
            recommandé tant que la disponibilité d'un GPU n'est pas
            confirmée. Si False, le réseau entier est fine-tuné.
        batch_size: Taille de batch (identique train/val/test).
        num_epochs: Nombre maximal d'époques.
        learning_rate: Taux d'apprentissage initial (AdamW).
        weight_decay: Régularisation L2 (AdamW).
        early_stopping_patience: Nombre d'époques sans amélioration de la
            loss de validation avant arrêt anticipé.
        use_weighted_sampler: Si True (défaut), le DataLoader
            d'entraînement rééquilibre les classes par sur-échantillonnage
            (voir preprocessing.balancing). Mutuellement exclusif avec
            use_weighted_loss - ne jamais activer les deux.
        use_weighted_loss: Si True, la CrossEntropyLoss est pondérée par
            classe au lieu d'utiliser le sampler pondéré. Désactivé par
            défaut car le sampler est déjà actif par défaut.
        device: "auto" (détecte cuda si disponible), "cpu", ou "cuda".
        random_seed: Graine de reproductibilité (poids, augmentation, split).
        num_workers: Workers du DataLoader.
    """

    manifest_path: Path
    output_dir: Optional[Path] = None

    modality: str = "chest_xray"

    architecture: str = "densenet121"
    pretrained: bool = True
    num_classes: int = 5
    classifier_hidden_dims: Tuple[int, ...] = (512, 128, 32)
    classifier_dropout: float = 0.2
    freeze_backbone: bool = True

    batch_size: int = 32
    num_epochs: int = 30
    learning_rate: float = 1e-4
    weight_decay: float = 1e-4
    early_stopping_patience: int = 3

    use_weighted_sampler: bool = True
    use_weighted_loss: bool = False

    device: str = "auto"
    random_seed: int = 42
    num_workers: int = field(default_factory=lambda: max(1, (os.cpu_count() or 1) - 1))

    def __post_init__(self) -> None:
        self.manifest_path = Path(self.manifest_path).resolve()
        self.output_dir = (
            Path(self.output_dir).resolve()
            if self.output_dir is not None
            else self.manifest_path.parent / "training_runs" / self.architecture
        )
        if self.use_weighted_sampler and self.use_weighted_loss:
            raise ValueError(
                "use_weighted_sampler et use_weighted_loss ne doivent pas être "
                "activés simultanément : l'effet se cumulerait et "
                "sur-corrigerait le déséquilibre de classes."
            )

    @property
    def checkpoint_path(self) -> Path:
        return self.output_dir / f"{self.architecture}_best.pt"

    @property
    def reports_dir(self) -> Path:
        return self.output_dir / "reports"

    @property
    def gradcam_dir(self) -> Path:
        return self.output_dir / "gradcam"

    @property
    def log_path(self) -> Path:
        return self.reports_dir / "training_logs.txt"
