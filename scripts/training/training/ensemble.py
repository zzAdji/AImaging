"""Ensemble par soft voting : moyenne des probabilités softmax de
plusieurs modèles entraînés indépendamment (approche de Shahzad et al.
2025).

Deux modes sont supportés :

1. **Manifeste partagé** (`soft_voting_predict` / `evaluate_ensemble`) :
   toutes les images viennent d'un seul prétraitement (une seule taille).
   Les modèles dont la taille native diffère de cette taille de référence
   sont servis via un ré-échantillonnage à la volée (perte de qualité
   pour les modèles qui auraient besoin d'agrandir l'image).

2. **Manifestes distincts par modèle** (`soft_voting_predict_multi_manifest`
   / `evaluate_ensemble_multi_manifest`) : chaque modèle lit ses propres
   images, prétraitées à sa taille native (ex. un prétraitement séparé à
   224×224 et un autre à 380×380 pour EfficientNet-B4).
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Dict, List, Tuple

import numpy as np
import pandas as pd
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
) -> Tuple[torch.nn.Module, dict]:
    """Reconstruit un modèle entraîné à partir de son checkpoint auto-suffisant.

    Args:
        checkpoint_path: Fichier sauvegardé par utils.save_checkpoint.
        hidden_dims / dropout: Doivent correspondre à la tête utilisée
            lors de l'entraînement (le checkpoint ne stocke que les poids,
            pas la config d'architecture de la tête — la reconstruction
            échouera avec un mismatch de shape explicite sinon, ce qui
            reste plus sûr qu'un échec silencieux).

    Returns:
        (model prêt pour l'inférence, payload complet du checkpoint —
        architecture, class_to_idx, input_size, normalization_mean/std).
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
    return model, payload


def _maybe_resize(images: torch.Tensor, target_size: Tuple[int, int]) -> torch.Tensor:
    if tuple(images.shape[-2:]) == tuple(target_size):
        return images
    return F.interpolate(images, size=target_size, mode="bilinear", align_corners=False)


def _check_class_consistency(reference: Dict[str, int], candidate: Dict[str, int], path: Path) -> None:
    if candidate != reference:
        raise ValueError(
            f"Incohérence de classes entre checkpoints : {path} a "
            f"class_to_idx={candidate}, attendu {reference}. "
            "Tous les modèles de l'ensemble doivent partager le même mapping de classes."
        )


# --------------------------------------------------------------------------
# Mode 1 : manifeste partagé (ré-échantillonnage à la volée si besoin)
# --------------------------------------------------------------------------

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
            construit à une taille de référence — chaque modèle
            ré-échantillonne en interne si sa taille d'entrée diffère.
            Si vos modèles ont été prétraités séparément à leur taille
            native, préférez soft_voting_predict_multi_manifest.
        device_config: "auto" | "cpu" | "cuda".
        hidden_dims / dropout: Doivent correspondre à la tête MLP utilisée
            à l'entraînement pour tous les checkpoints.

    Returns:
        (y_true, y_pred, y_proba_moyenne, class_to_idx).
    """
    device = resolve_device(device_config)
    models, input_sizes = [], []
    reference_class_to_idx = None

    for path in checkpoint_paths:
        model, payload = load_model_from_checkpoint(path, hidden_dims, dropout, device)
        if reference_class_to_idx is None:
            reference_class_to_idx = payload["class_to_idx"]
        else:
            _check_class_consistency(reference_class_to_idx, payload["class_to_idx"], path)
        models.append(model)
        input_sizes.append(tuple(payload["input_size"]))
        logger.info("Checkpoint chargé : %s (%s, entrée %s)", path, path.stem, payload["input_size"])

    all_labels, all_probs_per_model = [], [[] for _ in models]

    for images, labels in tqdm(loader, desc="Ensemble (soft voting)"):
        images = images.to(device)
        all_labels.append(labels.numpy())
        for i, (model, size) in enumerate(zip(models, input_sizes)):
            resized = _maybe_resize(images, size)
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
    """Évalue l'ensemble par soft voting (manifeste partagé) et retourne les métriques complètes."""
    y_true, y_pred, y_proba, class_to_idx = soft_voting_predict(
        checkpoint_paths, loader, device_config, hidden_dims, dropout
    )
    return compute_eval_metrics(y_true, y_pred, y_proba, class_to_idx, split_name="ensemble_test")


# --------------------------------------------------------------------------
# Mode 2 : manifestes distincts par modèle, alignés par identité d'image
# --------------------------------------------------------------------------

def align_manifests_by_identity(
    manifests: List[pd.DataFrame], split: str = "test"
) -> Tuple[List[pd.DataFrame], int]:
    """Aligne plusieurs manifestes issus de prétraitements séparés des
    MÊMES images sources sur un ensemble commun, dans le même ordre.

    L'identité d'une image est (classe, nom de fichier sans extension) —
    le pipeline de prétraitement conserve le nom de fichier d'origine
    (seule l'extension change, normalisée en .png), donc cette clé
    identifie la même photo source à travers des prétraitements distincts
    (tailles différentes), même si les chemins complets diffèrent.

    Args:
        manifests: Un DataFrame par modèle (déjà lu depuis son propre
            manifest.csv), dans le même ordre que les checkpoints
            correspondants.
        split: Split à aligner (typiquement "test").

    Returns:
        (manifestes_alignés, nombre_images_communes) — une liste de
        DataFrames de même longueur et dans le même ordre, un par
        manifeste d'entrée. Seules les images présentes dans TOUS les
        manifestes pour ce split sont conservées ; celles qui manquent
        (ex. échec de prétraitement pour une taille mais pas une autre)
        sont exclues avec un avertissement.
    """
    filtered = []
    for df in manifests:
        sub = df[df["split"] == split].copy()
        sub["_key"] = list(zip(sub["class"], sub["path"].apply(lambda p: Path(p).stem)))
        n_before = len(sub)
        sub = sub.drop_duplicates(subset="_key", keep="first")
        if len(sub) < n_before:
            logger.warning(
                "%d doublon(s) de clé (classe, nom de fichier) détecté(s) dans un manifeste — "
                "conservé la première occurrence uniquement.", n_before - len(sub),
            )
        filtered.append(sub)

    common_keys = set(filtered[0]["_key"])
    for sub in filtered[1:]:
        common_keys &= set(sub["_key"])
    common_keys = sorted(common_keys)

    if not common_keys:
        raise ValueError(
            "Aucune image commune trouvée entre les manifestes fournis pour le split "
            f"'{split}'. Vérifiez que les manifestes correspondent bien aux mêmes images "
            "sources (mêmes noms de fichiers, mêmes classes)."
        )

    for i, n_total in enumerate([len(m[m['split'] == split]) for m in manifests]):
        if n_total != len(common_keys):
            logger.warning(
                "Manifeste #%d : %d image(s) sur ce split, %d retenue(s) après alignement "
                "(images absentes des autres manifestes exclues).", i, n_total, len(common_keys),
            )

    aligned = []
    for sub in filtered:
        indexed = sub.set_index("_key")
        aligned_df = indexed.loc[common_keys].reset_index(drop=True)
        aligned.append(aligned_df.drop(columns=["_key"], errors="ignore"))

    return aligned, len(common_keys)


def build_test_loader_from_manifest(
    manifest_df: pd.DataFrame,
    class_to_idx: Dict[str, int],
    mean: Tuple[float, ...],
    std: Tuple[float, ...],
    batch_size: int = 32,
    num_workers: int = 1,
) -> DataLoader:
    """Construit un DataLoader d'évaluation directement depuis un manifeste
    déjà filtré sur un split (typiquement le résultat de
    align_manifests_by_identity), sans passer par build_dataloaders (qui
    construirait aussi des datasets train/val vides et inutiles ici)."""
    from preprocessing.preprocessing.augmentation import build_eval_transforms
    from preprocessing.preprocessing.torch_dataset import MedicalImageDataset

    transform = build_eval_transforms(mean, std)
    dataset = MedicalImageDataset(manifest_df, "test", transform, class_to_idx)
    return DataLoader(dataset, batch_size=batch_size, shuffle=False, num_workers=num_workers)


@torch.no_grad()
def soft_voting_predict_multi_manifest(
    checkpoint_paths: List[Path],
    manifests: List[pd.DataFrame],
    device_config: str = "auto",
    hidden_dims: Tuple[int, ...] = (512, 128, 32),
    dropout: float = 0.2,
    batch_size: int = 32,
    num_workers: int = 1,
) -> Tuple[np.ndarray, np.ndarray, np.ndarray, Dict[str, int], int]:
    """Comme soft_voting_predict, mais avec un manifeste distinct par
    modèle (chacun prétraité à sa propre taille native — aucun
    ré-échantillonnage à la volée nécessaire).

    Args:
        checkpoint_paths: Un checkpoint par modèle, dans le même ordre
            que `manifests`.
        manifests: Un DataFrame par modèle (lu depuis son propre
            manifest.csv), même ordre que `checkpoint_paths`. Alignés en
            interne par identité d'image (voir align_manifests_by_identity).

    Returns:
        (y_true, y_pred, y_proba_moyenne, class_to_idx, n_images_communes).
    """
    if len(checkpoint_paths) != len(manifests):
        raise ValueError(
            f"{len(checkpoint_paths)} checkpoint(s) mais {len(manifests)} manifeste(s) — "
            "il faut exactement un manifeste par checkpoint, dans le même ordre."
        )

    device = resolve_device(device_config)
    aligned_manifests, n_common = align_manifests_by_identity(manifests, split="test")
    logger.info("%d image(s) commune(s) après alignement des %d manifeste(s).", n_common, len(manifests))

    reference_class_to_idx = None
    y_true = None
    per_model_probs = []

    for path, manifest_df in zip(checkpoint_paths, aligned_manifests):
        model, payload = load_model_from_checkpoint(path, hidden_dims, dropout, device)
        class_to_idx = payload["class_to_idx"]
        if reference_class_to_idx is None:
            reference_class_to_idx = class_to_idx
        else:
            _check_class_consistency(reference_class_to_idx, class_to_idx, path)

        loader = build_test_loader_from_manifest(
            manifest_df, class_to_idx, payload["normalization_mean"], payload["normalization_std"],
            batch_size, num_workers,
        )

        labels_this_model, probs_this_model = [], []
        for images, labels in tqdm(loader, desc=f"Inférence ({payload['architecture']})"):
            images = images.to(device)
            probs = torch.softmax(model(images), dim=1).cpu().numpy()
            probs_this_model.append(probs)
            labels_this_model.append(labels.numpy())

        labels_this_model = np.concatenate(labels_this_model)
        if y_true is None:
            y_true = labels_this_model
        elif not np.array_equal(y_true, labels_this_model):
            raise ValueError(
                f"Les labels du modèle '{payload['architecture']}' ne correspondent pas à "
                "ceux du premier modèle après alignement — les manifestes ne décrivent "
                "probablement pas les mêmes images dans le même ordre."
            )

        per_model_probs.append(np.concatenate(probs_this_model))
        logger.info("Checkpoint traité : %s (%s)", path, payload["architecture"])

    y_proba = np.mean(per_model_probs, axis=0)
    y_pred = y_proba.argmax(axis=1)

    return y_true, y_pred, y_proba, reference_class_to_idx, n_common


def evaluate_ensemble_multi_manifest(
    checkpoint_paths: List[Path],
    manifests: List[pd.DataFrame],
    device_config: str = "auto",
    hidden_dims: Tuple[int, ...] = (512, 128, 32),
    dropout: float = 0.2,
    batch_size: int = 32,
    num_workers: int = 1,
) -> EvalMetrics:
    """Évalue l'ensemble par soft voting avec un manifeste distinct par modèle."""
    y_true, y_pred, y_proba, class_to_idx, _ = soft_voting_predict_multi_manifest(
        checkpoint_paths, manifests, device_config, hidden_dims, dropout, batch_size, num_workers
    )
    return compute_eval_metrics(y_true, y_pred, y_proba, class_to_idx, split_name="ensemble_test")
