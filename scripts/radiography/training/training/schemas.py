"""Structures de données partagées par le module d'entraînement."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Tuple


@dataclass
class EpochMetrics:
    """Métriques d'une seule époque d'entraînement."""

    epoch: int
    train_loss: float
    train_accuracy: float
    val_loss: float
    val_accuracy: float
    learning_rate: float


@dataclass
class ClassMetrics:
    """Précision/rappel/F1 pour une seule classe."""

    class_name: str
    precision: float
    recall: float
    f1_score: float
    support: int
    roc_auc: Optional[float] = None
    average_precision: Optional[float] = None


@dataclass
class EvalMetrics:
    """Résultat d'une évaluation complète sur un split donné (val ou test)."""

    split_name: str
    accuracy: float
    class_metrics: List[ClassMetrics] = field(default_factory=list)
    confusion_matrix: List[List[int]] = field(default_factory=list)
    class_names: List[str] = field(default_factory=list)
    roc_curves: Dict[str, Tuple[List[float], List[float]]] = field(default_factory=dict)
    pr_curves: Dict[str, Tuple[List[float], List[float]]] = field(default_factory=dict)


@dataclass
class TrainingReport:
    """Rapport complet d'un run d'entraînement pour une architecture donnée."""

    architecture: str
    manifest_path: Path
    checkpoint_path: Path
    class_to_idx: Dict[str, int]
    epoch_history: List[EpochMetrics] = field(default_factory=list)
    best_epoch: int = 0
    best_val_accuracy: float = 0.0
    best_val_loss: float = float("inf")
    test_metrics: Optional[EvalMetrics] = None
    training_time_seconds: float = 0.0
    early_stopped: bool = False
