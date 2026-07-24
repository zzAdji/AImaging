"""Ensemble par soft voting : moyenne des probabilités softmax de
plusieurs modèles entraînés indépendamment (approche de Shahzad et al.
2025). Chaque modèle a pu être entraîné avec sa propre taille d'entrée
(ex. EfficientNet-B4 attend du 380×380, DenseNet121 du 224×224) - ce
module gère cette hétérogénéité en ré-échantillonnant chaque batch d'image
à la taille attendue par chaque modèle avant l'inférence.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Dict, List, Tuple

import numpy as np
import torch
import torch.nn.functional as F
from torch.utils.data import DataLoader
from tqdm import tqdm

from .evaluator import compute_eval_metrics
from .model_builder import build_model
from .schemas import EvalMetrics
from .utils import load_checkpoint, resolve_device

logger = logging.getLogger("training.ensemble")


def load_model_from_checkpoint(
    checkpoint_path: Path, hidden_dims: Tuple[int, ...], dropout: float, device: torch.device
):
    """Reconstruit un modèle entraîné à partir de son checkpoint auto-suffisant.

    Args:
        checkpoint_path: Fichier sauvegardé par utils.save_checkpoint.
        hidden_dims / dropout: Doivent correspondre à la tête utilisée
            lors de l'entraînement (le checkpoint ne stocke que les poids,
            pas la config d'architecture de la tête - la reconstruction
            échouera avec un mismatch de shape explicite sinon, ce qui
            reste plus sûr qu'un échec silencieux).

    Returns:
        (model prêt pour l'inférence, class_to_idx, input_size).
    """
    payload = load_checkpoint(checkpoint_path)
    model = build_model(
        architecture=payload["architecture"],
        pretrained=False,  # les poids sont de toute façon écrasés par le state_dict
        num_classes=len(payload["class_to_idx"]),
        hidden_dims=hidden_dims,
        dropout=dropout,
        freeze_backbone=False,  # sans importance pour l'inférence
    )
    model.load_state_dict(payload["model_state_dict"])
    model = model.to(device)
    model.eval()
    return model, payload["class_to_idx"], payload["input_size"]


@torch.no_grad()
def soft_voting_predict(
    checkpoint_paths: List[Path],
    loader: DataLoader,
    device_config: str = "auto",
    hidden_dims: Tuple[int, ...] = (512, 128, 32),
    dropout: float = 0.2,
) -> Tuple[np.ndarray, np.ndarray, np.ndarray, Dict[str, int]]:
    """Charge plusieurs checkpoints, moyenne leurs probabilités softmax.

    Args:
        checkpoint_paths: Un checkpoint par modèle de l'ensemble.
        loader: DataLoader du split à évaluer (test, typiquement), déjà
            construit à la taille de référence (224×224 par ex.) -
            chaque modèle ré-échantillonne en interne si sa taille
            d'entrée diffère.
        device_config: "auto" | "cpu" | "cuda".
        hidden_dims / dropout: Doivent correspondre à la tête MLP utilisée
            à l'entraînement pour tous les checkpoints.

    Returns:
        (y_true, y_pred, y_proba_moyenne, class_to_idx) - class_to_idx
        est celui du premier checkpoint ; une incohérence entre
        checkpoints (classes différentes) lève une erreur explicite.
    """
    device = resolve_device(device_config)
    models, input_sizes = [], []
    reference_class_to_idx = None

    for path in checkpoint_paths:
        model, class_to_idx, input_size = load_model_from_checkpoint(path, hidden_dims, dropout, device)
        if reference_class_to_idx is None:
            reference_class_to_idx = class_to_idx
        elif class_to_idx != reference_class_to_idx:
            raise ValueError(
                f"Incohérence de classes entre checkpoints : {path} a "
                f"class_to_idx={class_to_idx}, attendu {reference_class_to_idx}. "
                "Tous les modèles de l'ensemble doivent partager le même mapping de classes."
            )
        models.append(model)
        input_sizes.append(tuple(input_size))
        logger.info("Checkpoint chargé : %s (%s, entrée %s)", path, path.stem, input_size)

    all_labels, all_probs_per_model = [], [[] for _ in models]

    for images, labels in tqdm(loader, desc="Ensemble (soft voting)"):
        images = images.to(device)
        all_labels.append(labels.numpy())
        for i, (model, size) in enumerate(zip(models, input_sizes)):
            resized = images if tuple(images.shape[-2:]) == size else F.interpolate(
                images, size=size, mode="bilinear", align_corners=False
            )
            probs = torch.softmax(model(resized), dim=1).cpu().numpy()
            all_probs_per_model[i].append(probs)

    y_true = np.concatenate(all_labels)
    per_model_probs = [np.concatenate(p) for p in all_probs_per_model]
    y_proba = np.mean(per_model_probs, axis=0)
    y_pred = y_proba.argmax(axis=1)

    return y_true, y_pred, y_proba, reference_class_to_idx


def evaluate_ensemble(
    checkpoint_paths: List[Path],
    loader: DataLoader,
    device_config: str = "auto",
    hidden_dims: Tuple[int, ...] = (512, 128, 32),
    dropout: float = 0.2,
) -> EvalMetrics:
    """Évalue l'ensemble par soft voting et retourne les métriques complètes."""
    y_true, y_pred, y_proba, class_to_idx = soft_voting_predict(
        checkpoint_paths, loader, device_config, hidden_dims, dropout
    )
    return compute_eval_metrics(y_true, y_pred, y_proba, class_to_idx, split_name="ensemble_test")
