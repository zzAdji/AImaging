"""Boucle d'entraînement : AdamW, cosine annealing, early stopping,
checkpointing du meilleur modèle selon la loss de validation.
"""

from __future__ import annotations

import copy
import logging
from typing import Optional

import torch
import torch.nn as nn
from torch.utils.data import DataLoader
from tqdm import tqdm

from .config import TrainConfig
from .schemas import EpochMetrics, TrainingReport
from .utils import resolve_device, save_checkpoint, seed_everything, timer

logger = logging.getLogger("training.trainer")


class Trainer:
    """Encapsule une session d'entraînement complète pour un seul modèle.

    Le modèle est supposé déjà construit (voir model_builder.build_model)
    avec son `requires_grad` déjà correctement configuré (backbone gelé
    ou non) - ce module ne fait que l'optimisation, pas la construction
    du modèle.
    """

    def __init__(
        self,
        model: nn.Module,
        config: TrainConfig,
        class_to_idx: dict,
        input_size,
        normalization_mean,
        normalization_std,
        class_weights: Optional[torch.Tensor] = None,
    ) -> None:
        self.config = config
        self.class_to_idx = class_to_idx
        self.input_size = input_size
        self.normalization_mean = normalization_mean
        self.normalization_std = normalization_std

        self.device = resolve_device(config.device)
        self.model = model.to(self.device)

        trainable_params = [p for p in self.model.parameters() if p.requires_grad]
        self.optimizer = torch.optim.AdamW(
            trainable_params, lr=config.learning_rate, weight_decay=config.weight_decay
        )
        self.scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(
            self.optimizer, T_max=config.num_epochs
        )

        weight = class_weights.to(self.device) if (config.use_weighted_loss and class_weights is not None) else None
        self.criterion = nn.CrossEntropyLoss(weight=weight)

        logger.info("Entraînement sur device : %s", self.device)

    def fit(self, train_loader: DataLoader, val_loader: DataLoader) -> TrainingReport:
        """Entraîne le modèle avec early stopping, retourne le rapport complet."""
        seed_everything(self.config.random_seed)

        report = TrainingReport(
            architecture=self.config.architecture,
            manifest_path=self.config.manifest_path,
            checkpoint_path=self.config.checkpoint_path,
            class_to_idx=self.class_to_idx,
        )

        best_val_loss = float("inf")
        best_state_dict = None
        epochs_without_improvement = 0

        with timer() as elapsed:
            for epoch in range(1, self.config.num_epochs + 1):
                train_loss, train_acc = self._run_epoch(train_loader, is_training=True)
                val_loss, val_acc = self._run_epoch(val_loader, is_training=False)
                current_lr = self.optimizer.param_groups[0]["lr"]
                self.scheduler.step()

                report.epoch_history.append(
                    EpochMetrics(
                        epoch=epoch,
                        train_loss=train_loss,
                        train_accuracy=train_acc,
                        val_loss=val_loss,
                        val_accuracy=val_acc,
                        learning_rate=current_lr,
                    )
                )
                logger.info(
                    "Époque %d/%d - train_loss=%.4f train_acc=%.4f | val_loss=%.4f val_acc=%.4f",
                    epoch, self.config.num_epochs, train_loss, train_acc, val_loss, val_acc,
                )

                if val_loss < best_val_loss:
                    best_val_loss = val_loss
                    report.best_epoch = epoch
                    report.best_val_accuracy = val_acc
                    report.best_val_loss = val_loss
                    best_state_dict = copy.deepcopy(self.model.state_dict())
                    epochs_without_improvement = 0
                else:
                    epochs_without_improvement += 1
                    if epochs_without_improvement >= self.config.early_stopping_patience:
                        logger.info(
                            "Early stopping déclenché après %d époque(s) sans amélioration "
                            "(meilleure époque : %d).", epochs_without_improvement, report.best_epoch,
                        )
                        report.early_stopped = True
                        break

        report.training_time_seconds = elapsed[0]

        if best_state_dict is not None:
            save_checkpoint(
                self.config.checkpoint_path,
                best_state_dict,
                self.config.architecture,
                self.class_to_idx,
                self.input_size,
                self.normalization_mean,
                self.normalization_std,
                extra={"best_epoch": report.best_epoch, "best_val_accuracy": report.best_val_accuracy},
            )
            self.model.load_state_dict(best_state_dict)
            logger.info("Meilleur checkpoint sauvegardé : %s", self.config.checkpoint_path)

        return report

    def _run_epoch(self, loader: DataLoader, is_training: bool) -> tuple:
        self.model.train(is_training)
        total_loss, total_correct, total_samples = 0.0, 0, 0

        context = torch.enable_grad() if is_training else torch.no_grad()
        desc = "Train" if is_training else "Val"
        with context:
            for images, labels in tqdm(loader, desc=desc, leave=False):
                images, labels = images.to(self.device), labels.to(self.device)

                if is_training:
                    self.optimizer.zero_grad()

                outputs = self.model(images)
                loss = self.criterion(outputs, labels)

                if is_training:
                    loss.backward()
                    self.optimizer.step()

                total_loss += loss.item() * images.size(0)
                total_correct += (outputs.argmax(dim=1) == labels).sum().item()
                total_samples += images.size(0)

        avg_loss = total_loss / max(total_samples, 1)
        accuracy = total_correct / max(total_samples, 1)
        return avg_loss, accuracy
