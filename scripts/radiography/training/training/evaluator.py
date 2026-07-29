"""Évaluation complète d'un modèle sur un split donné : accuracy,
précision/rappel/F1 par classe, matrice de confusion, courbes ROC et
Precision-Recall (approche one-vs-rest, comme dans les deux articles de
référence).
"""

from __future__ import annotations

import logging
from typing import Dict, List, Optional, Tuple

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from sklearn.metrics import (
    average_precision_score,
    confusion_matrix,
    precision_recall_curve,
    precision_recall_fscore_support,
    roc_auc_score,
    roc_curve,
)
from torch.utils.data import DataLoader

from .schemas import ClassMetrics, EvalMetrics

logger = logging.getLogger("training.evaluator")


@torch.no_grad()
def collect_predictions(
    model: nn.Module, loader: DataLoader, device: torch.device,
    target_size: Optional[Tuple[int, int]] = None,
) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Fait l'inférence sur tout un DataLoader.

    Args:
        target_size: Si fourni et différent de la taille réelle des
            images du loader, chaque batch est ré-échantillonné avant
            l'inférence. Nécessaire quand le loader a été construit pour
            un autre modèle de l'ensemble (taille de référence partagée)
            que celui évalué ici — sans ce paramètre, un modèle attendant
            380×380 recevrait silencieusement du 224×224.

    Returns:
        (y_true, y_pred, y_proba) où y_proba a la forme (N, num_classes).
    """
    model.eval()
    all_labels, all_preds, all_probs = [], [], []

    for images, labels in loader:
        images = images.to(device)
        if target_size is not None and tuple(images.shape[-2:]) != tuple(target_size):
            images = F.interpolate(images, size=target_size, mode="bilinear", align_corners=False)
        logits = model(images)
        probs = torch.softmax(logits, dim=1).cpu().numpy()
        preds = probs.argmax(axis=1)

        all_labels.append(labels.numpy())
        all_preds.append(preds)
        all_probs.append(probs)

    return (
        np.concatenate(all_labels),
        np.concatenate(all_preds),
        np.concatenate(all_probs),
    )


def compute_eval_metrics(
    y_true: np.ndarray, y_pred: np.ndarray, y_proba: np.ndarray,
    class_to_idx: Dict[str, int], split_name: str,
) -> EvalMetrics:
    """Calcule toutes les métriques à partir des prédictions déjà collectées.

    Args:
        y_true: Labels réels (N,).
        y_pred: Labels prédits (N,).
        y_proba: Probabilités softmax (N, num_classes).
        class_to_idx: Mapping nom de classe -> index, pour ordonner
            correctement les métriques par classe.
        split_name: "val" | "test" | "ensemble_test", etc.

    Returns:
        EvalMetrics entièrement renseigné.
    """
    idx_to_class = {idx: cls for cls, idx in class_to_idx.items()}
    class_names = [idx_to_class[i] for i in range(len(idx_to_class))]

    accuracy = float((y_true == y_pred).mean())
    precisions, recalls, f1s, supports = precision_recall_fscore_support(
        y_true, y_pred, labels=list(range(len(class_names))), zero_division=0
    )

    cm = confusion_matrix(y_true, y_pred, labels=list(range(len(class_names))))

    class_metrics: List[ClassMetrics] = []
    roc_curves: Dict[str, Tuple[List[float], List[float]]] = {}
    pr_curves: Dict[str, Tuple[List[float], List[float]]] = {}

    for i, cls in enumerate(class_names):
        y_true_binary = (y_true == i).astype(int)
        roc_auc, ap = None, None

        # AUC/PR nécessitent les deux classes présentes dans y_true_binary ;
        # sur un tout petit échantillon de test (ex. smoke test), ce n'est
        # pas garanti — on dégrade proprement plutôt que de lever une exception.
        if len(np.unique(y_true_binary)) == 2:
            roc_auc = float(roc_auc_score(y_true_binary, y_proba[:, i]))
            ap = float(average_precision_score(y_true_binary, y_proba[:, i]))
            fpr, tpr, _ = roc_curve(y_true_binary, y_proba[:, i])
            roc_curves[cls] = (fpr.tolist(), tpr.tolist())
            precision_c, recall_c, _ = precision_recall_curve(y_true_binary, y_proba[:, i])
            pr_curves[cls] = (recall_c.tolist(), precision_c.tolist())
        else:
            logger.warning(
                "Classe '%s' : une seule classe présente dans y_true sur ce split — "
                "ROC/PR non calculables (échantillon probablement trop petit).", cls,
            )

        class_metrics.append(
            ClassMetrics(
                class_name=cls,
                precision=float(precisions[i]),
                recall=float(recalls[i]),
                f1_score=float(f1s[i]),
                support=int(supports[i]),
                roc_auc=roc_auc,
                average_precision=ap,
            )
        )

    return EvalMetrics(
        split_name=split_name,
        accuracy=accuracy,
        class_metrics=class_metrics,
        confusion_matrix=cm.tolist(),
        class_names=class_names,
        roc_curves=roc_curves,
        pr_curves=pr_curves,
    )


def evaluate(
    model: nn.Module, loader: DataLoader, class_to_idx: Dict[str, int],
    device: torch.device, split_name: str = "test",
    target_size: Optional[Tuple[int, int]] = None,
) -> EvalMetrics:
    """Évalue un modèle sur un DataLoader complet, calcule toutes les métriques.

    Args:
        target_size: Voir collect_predictions — à fournir explicitement
            si `loader` n'a pas été construit à la taille native de `model`.
    """
    y_true, y_pred, y_proba = collect_predictions(model, loader, device, target_size)
    return compute_eval_metrics(y_true, y_pred, y_proba, class_to_idx, split_name)
