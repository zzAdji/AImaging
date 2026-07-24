"""Transformations d'entraînement (augmentation)"""

from __future__ import annotations

from typing import Tuple

import torchvision.transforms as T

from .config import AugmentationProfile


def build_train_transforms(
    profile: AugmentationProfile, mean: Tuple[float, ...], std: Tuple[float, ...]
) -> T.Compose:
    """Construit le pipeline de transformation pour le split d'entraînement.

    Suppose une entrée PIL Image déjà en mode "RGB" (3 canaux dupliqués,
    voir torch_dataset.py) et déjà à la taille cible (le resize+padding a
    déjà été gravé sur disque par pipeline.py) - l'augmentation ne fait
    donc que des perturbations géométriques/photométriques légères autour
    de cette taille, pas un second redimensionnement.

    Args:
        profile: Plages d'augmentation (voir config.AugmentationProfile).
        mean / std: Statistiques de normalisation du backbone cible.

    Returns:
        torchvision.transforms.Compose prêt à l'emploi.
    """
    transforms = [
        T.RandomAffine(
            degrees=profile.rotation_degrees,
            translate=(profile.translation_fraction, profile.translation_fraction),
            scale=profile.zoom_range,
        ),
        T.ColorJitter(
            brightness=profile.brightness_jitter,
            contrast=profile.contrast_jitter,
        ),
    ]
    if profile.horizontal_flip_prob > 0:
        transforms.append(T.RandomHorizontalFlip(p=profile.horizontal_flip_prob))
    if profile.vertical_flip_prob > 0:
        # Volontairement inatteignable par défaut : vertical_flip_prob=0.0
        # pour la radiographie thoracique. Conservé ici uniquement pour ne
        # pas bloquer une future modalité où cela serait anatomiquement
        # justifié et explicitement documenté.
        transforms.append(T.RandomVerticalFlip(p=profile.vertical_flip_prob))

    transforms += [T.ToTensor(), T.Normalize(mean=mean, std=std)]
    return T.Compose(transforms)


def build_eval_transforms(mean: Tuple[float, ...], std: Tuple[float, ...]) -> T.Compose:
    """Transformations pour validation/test : aucune augmentation, seulement
    la conversion en tenseur et la normalisation (le resize+padding a déjà
    été gravé sur disque, identique pour train/val/test)."""
    return T.Compose([T.ToTensor(), T.Normalize(mean=mean, std=std)])
