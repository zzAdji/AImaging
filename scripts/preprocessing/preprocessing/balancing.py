"""Équilibrage des classes - sans suppression de données.

Deux mécanismes équivalents mais à ne PAS cumuler (l'effet se
combinerait et sur-corrigerait le déséquilibre) :

- `compute_class_weights` : pondération de la fonction de perte
  (`nn.CrossEntropyLoss(weight=...)`).
- `build_weighted_sampler` : rééchantillonnage au niveau du DataLoader
  (`WeightedRandomSampler`), qui ne duplique aucun fichier - seule la
  probabilité de tirage change.

Recommandation par défaut de ce pipeline : `WeightedRandomSampler` seul,
combiné à `shuffle=False` dans le DataLoader (le sampler gère déjà l'ordre
aléatoire). Chaque image sur-échantillonnée reçoit sa propre augmentation
aléatoire à chaque tirage, ce qui limite le risque de sur-apprentissage
sur des doublons identiques.
"""

from __future__ import annotations

from collections import Counter
from typing import List, Sequence

import torch
from torch.utils.data import WeightedRandomSampler


def compute_class_weights(labels: Sequence[int], num_classes: int) -> torch.Tensor:
    """Poids inversement proportionnels à la fréquence de classe, pour la loss.

    Args:
        labels: Labels entiers (un par échantillon d'entraînement).
        num_classes: Nombre total de classes.

    Returns:
        Tenseur de poids de taille (num_classes,), normalisé pour que sa
        moyenne vaille 1.0 (évite de changer l'échelle globale de la loss).
    """
    counts = Counter(labels)
    weights = torch.tensor(
        [1.0 / counts.get(c, 1) for c in range(num_classes)], dtype=torch.float32
    )
    return weights * (num_classes / weights.sum())


def build_weighted_sampler(labels: Sequence[int]) -> WeightedRandomSampler:
    """Sampler qui sur-tire les classes minoritaires proportionnellement à leur rareté.

    Args:
        labels: Labels entiers (un par échantillon du split d'entraînement
            uniquement - ne jamais appliquer ceci au split de validation/test).

    Returns:
        WeightedRandomSampler prêt à être passé à un DataLoader
        (avec shuffle=False, le sampler remplace le mécanisme de shuffle).
    """
    counts = Counter(labels)
    sample_weights: List[float] = [1.0 / counts[label] for label in labels]
    return WeightedRandomSampler(
        weights=sample_weights, num_samples=len(sample_weights), replacement=True
    )
