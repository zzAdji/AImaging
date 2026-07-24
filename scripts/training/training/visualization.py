"""Visualisations des résultats d'entraînement et d'évaluation."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import List, Optional

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402

from .schemas import EpochMetrics, EvalMetrics  # noqa: E402

logger = logging.getLogger("training.visualization")


def _save(fig, output_path: Path) -> Optional[Path]:
    try:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        fig.savefig(output_path, dpi=140, bbox_inches="tight")
        return output_path
    except Exception as exc:  # noqa: BLE001
        logger.error("Échec de sauvegarde du graphique %s : %s", output_path, exc)
        return None
    finally:
        plt.close(fig)


def plot_training_curves(epoch_history: List[EpochMetrics], output_path: Path) -> Optional[Path]:
    """Courbes loss + accuracy (train/val) sur toutes les époques."""
    epochs = [e.epoch for e in epoch_history]
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(11, 4))

    ax1.plot(epochs, [e.train_loss for e in epoch_history], label="train")
    ax1.plot(epochs, [e.val_loss for e in epoch_history], label="val")
    ax1.set_title("Loss")
    ax1.set_xlabel("Époque")
    ax1.legend()

    ax2.plot(epochs, [e.train_accuracy for e in epoch_history], label="train")
    ax2.plot(epochs, [e.val_accuracy for e in epoch_history], label="val")
    ax2.set_title("Accuracy")
    ax2.set_xlabel("Époque")
    ax2.legend()

    return _save(fig, output_path)


def plot_confusion_matrix(metrics: EvalMetrics, output_path: Path) -> Optional[Path]:
    """Matrice de confusion annotée."""
    cm = np.array(metrics.confusion_matrix)
    fig, ax = plt.subplots(figsize=(5.5, 5))
    im = ax.imshow(cm, cmap="Blues")
    ax.set_xticks(range(len(metrics.class_names)))
    ax.set_yticks(range(len(metrics.class_names)))
    ax.set_xticklabels(metrics.class_names, rotation=45, ha="right")
    ax.set_yticklabels(metrics.class_names)
    ax.set_xlabel("Prédit")
    ax.set_ylabel("Réel")
    ax.set_title(f"Matrice de confusion - {metrics.split_name}")

    for i in range(cm.shape[0]):
        for j in range(cm.shape[1]):
            ax.text(j, i, str(cm[i, j]), ha="center", va="center",
                     color="white" if cm[i, j] > cm.max() / 2 else "black")

    fig.colorbar(im, ax=ax)
    return _save(fig, output_path)


def plot_roc_curves(metrics: EvalMetrics, output_path: Path) -> Optional[Path]:
    """Courbes ROC one-vs-rest, une par classe."""
    if not metrics.roc_curves:
        logger.warning("Aucune courbe ROC disponible pour %s (échantillon trop petit ?)", metrics.split_name)
        return None

    fig, ax = plt.subplots(figsize=(6, 5))
    for class_metric in metrics.class_metrics:
        if class_metric.class_name not in metrics.roc_curves:
            continue
        fpr, tpr = metrics.roc_curves[class_metric.class_name]
        auc_label = f"{class_metric.class_name} (AUC={class_metric.roc_auc:.3f})"
        ax.plot(fpr, tpr, label=auc_label)

    ax.plot([0, 1], [0, 1], "k--", alpha=0.5)
    ax.set_xlabel("Taux de faux positifs")
    ax.set_ylabel("Taux de vrais positifs")
    ax.set_title(f"Courbes ROC - {metrics.split_name}")
    ax.legend(loc="lower right", fontsize=8)
    return _save(fig, output_path)


def plot_pr_curves(metrics: EvalMetrics, output_path: Path) -> Optional[Path]:
    """Courbes Precision-Recall one-vs-rest, une par classe."""
    if not metrics.pr_curves:
        logger.warning("Aucune courbe PR disponible pour %s (échantillon trop petit ?)", metrics.split_name)
        return None

    fig, ax = plt.subplots(figsize=(6, 5))
    for class_metric in metrics.class_metrics:
        if class_metric.class_name not in metrics.pr_curves:
            continue
        recall, precision = metrics.pr_curves[class_metric.class_name]
        ap_label = f"{class_metric.class_name} (AP={class_metric.average_precision:.3f})"
        ax.plot(recall, precision, label=ap_label)

    ax.set_xlabel("Recall")
    ax.set_ylabel("Precision")
    ax.set_title(f"Courbes Precision-Recall - {metrics.split_name}")
    ax.legend(loc="lower left", fontsize=8)
    return _save(fig, output_path)
