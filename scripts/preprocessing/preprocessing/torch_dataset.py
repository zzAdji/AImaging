"""Dataset PyTorch consommant le manifeste produit par split.py.

C'est ici, et seulement ici, que se fait :
- la réplication du niveau de gris en 3 canaux (pas sur disque, cf. grayscale.py) ;
- la normalisation (ImageNet ou dérivée du backbone, cf. normalization.py) ;
- l'augmentation (train uniquement, cf. augmentation.py).

Le chargement est fait à la demande dans `__getitem__` (jamais de
préchargement de tout le dataset en RAM), ce qui permet de traiter des
dizaines de milliers d'images sans contrainte mémoire.
"""

from __future__ import annotations

from pathlib import Path
from typing import Callable, Dict, List, Optional, Tuple

import pandas as pd
import torch
from PIL import Image
from torch.utils.data import DataLoader, Dataset

from .augmentation import build_eval_transforms, build_train_transforms
from .balancing import build_weighted_sampler
from .config import PreprocessConfig
from .schemas import NormalizationStats


class MedicalImageDataset(Dataset):
    """Dataset générique pour images médicales prétraitées (grayscale, PNG).

    Attributes:
        class_to_idx: Mapping nom de classe -> index entier, dérivé des
            classes présentes dans le manifeste (jamais codé en dur —
            fonctionne donc identiquement pour la radiographie thoracique
            ou une future modalité comme l'échographie).
    """

    def __init__(
        self,
        manifest_df: pd.DataFrame,
        split: str,
        transform: Callable,
        class_to_idx: Optional[Dict[str, int]] = None,
    ) -> None:
        self._df = manifest_df[manifest_df["split"] == split].reset_index(drop=True)
        self._transform = transform
        self.class_to_idx = class_to_idx or {
            cls: idx for idx, cls in enumerate(sorted(manifest_df["class"].unique()))
        }

    def __len__(self) -> int:
        return len(self._df)

    def __getitem__(self, index: int) -> Tuple[torch.Tensor, int]:
        row = self._df.iloc[index]
        with Image.open(row["path"]) as img:
            # Réplication grayscale -> 3 canaux, faite ici et non sur disque.
            rgb = img.convert("RGB")
            tensor = self._transform(rgb)
        label = self.class_to_idx[row["class"]]
        return tensor, label


def build_dataloaders(
    manifest_df: pd.DataFrame,
    normalization: NormalizationStats,
    config: PreprocessConfig,
    batch_size: int = 32,
) -> Dict[str, DataLoader]:
    """Construit les DataLoaders train/val/test à partir du manifeste.

    Le split "train" utilise un WeightedRandomSampler (voir balancing.py)
    et les transformations d'augmentation ; val/test utilisent un shuffle
    désactivé et aucune augmentation.

    Args:
        manifest_df: DataFrame produit par split.build_manifest.
        normalization: Statistiques de normalisation résolues (voir
            normalization.resolve_normalization).
        config: Configuration du run (profil d'augmentation, workers...).
        batch_size: Taille de batch, identique pour les trois splits.

    Returns:
        Dictionnaire {"train": DataLoader, "val": DataLoader, "test": DataLoader}.
    """
    class_to_idx = {cls: idx for idx, cls in enumerate(sorted(manifest_df["class"].unique()))}

    train_transform = build_train_transforms(
        config.augmentation_profile, normalization.mean, normalization.std
    )
    eval_transform = build_eval_transforms(normalization.mean, normalization.std)

    train_ds = MedicalImageDataset(manifest_df, "train", train_transform, class_to_idx)
    val_ds = MedicalImageDataset(manifest_df, "val", eval_transform, class_to_idx)
    test_ds = MedicalImageDataset(manifest_df, "test", eval_transform, class_to_idx)

    train_labels = [class_to_idx[c] for c in manifest_df[manifest_df["split"] == "train"]["class"]]
    sampler = build_weighted_sampler(train_labels) if train_labels else None

    loaders = {
        "train": DataLoader(
            train_ds, batch_size=batch_size, sampler=sampler,
            num_workers=config.num_workers, pin_memory=torch.cuda.is_available(),
        ),
        "val": DataLoader(
            val_ds, batch_size=batch_size, shuffle=False,
            num_workers=config.num_workers, pin_memory=torch.cuda.is_available(),
        ),
        "test": DataLoader(
            test_ds, batch_size=batch_size, shuffle=False,
            num_workers=config.num_workers, pin_memory=torch.cuda.is_available(),
        ),
    }
    return loaders
