#!/usr/bin/env python3
"""CLI pour la phase 2 : fine-tuning complet après un premier entraînement
à backbone gelé. Charge un checkpoint existant, dégèle tout le réseau,
continue l'entraînement avec un learning rate plus bas.

Exemple:
    python main_finetune.py \\
        --checkpoint training_runs/densenet121/densenet121_best.pt \\
        --manifest ../../data/dataset_processed/reports/manifest.csv
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

from scripts.radiography.training.training.utils import bootstrap_preprocessing_import

_parser_for_early_path = argparse.ArgumentParser(add_help=False)
_parser_for_early_path.add_argument("--preprocessing-path", type=Path, default=None)
_early_args, _ = _parser_for_early_path.parse_known_args()
bootstrap_preprocessing_import(_early_args.preprocessing_path)

import pandas as pd  # noqa: E402

from preprocessing.config import PreprocessConfig  # noqa: E402
from preprocessing.torch_dataset import build_dataloaders  # noqa: E402

from scripts.radiography.training.training.config import TrainConfig  # noqa: E402
from scripts.radiography.training.training.evaluator import evaluate  # noqa: E402
from scripts.radiography.training.training.gradcam import generate_gradcam_grid  # noqa: E402
from scripts.radiography.training.training.model_builder import build_model  # noqa: E402
from scripts.radiography.training.training.report import (  # noqa: E402
    generate_training_csv,
    generate_training_html,
    generate_training_json,
)
from scripts.radiography.training.training.trainer import Trainer  # noqa: E402
from scripts.radiography.training.training.utils import load_checkpoint, resolve_device, seed_everything, setup_logging  # noqa: E402
from scripts.radiography.training.training.visualization import (  # noqa: E402
    plot_confusion_matrix,
    plot_pr_curves,
    plot_roc_curves,
    plot_training_curves,
)

from preprocessing.schemas import NormalizationStats  # noqa: E402


def parse_args(argv=None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="main_finetune")
    parser.add_argument("--checkpoint", required=True, type=Path, help="Checkpoint issu d'un premier entraînement (backbone gelé).")
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--preprocessing-path", type=Path, default=None)
    parser.add_argument("--output", type=Path, default=None, help="Défaut : <dossier du checkpoint>/finetuned")
    parser.add_argument("--modality", default="chest_xray", choices=["chest_xray", "ultrasound"])
    parser.add_argument("--hidden-dims", type=int, nargs="+", default=[512, 128, 32])
    parser.add_argument("--dropout", type=float, default=0.2)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--num-epochs", type=int, default=20)
    parser.add_argument("--learning-rate", type=float, default=1e-5, help="Plus bas qu'en phase 1 (1e-4) pour ne pas détruire les poids pré-entraînés.")
    parser.add_argument("--weight-decay", type=float, default=1e-4)
    parser.add_argument("--early-stopping-patience", type=int, default=3)
    parser.add_argument("--use-weighted-loss", action="store_true")
    parser.add_argument("--device", default="auto", choices=["auto", "cpu", "cuda"])
    parser.add_argument("--workers", type=int, default=None)
    parser.add_argument("--gradcam-samples-per-class", type=int, default=2)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--verbose", action="store_true")
    return parser.parse_args(argv)


def main(argv=None) -> int:
    args = parse_args(argv)

    if not args.checkpoint.exists():
        print(f"Erreur : checkpoint '{args.checkpoint}' introuvable.", file=sys.stderr)
        return 1
    if not args.manifest.exists():
        print(f"Erreur : manifeste '{args.manifest}' introuvable.", file=sys.stderr)
        return 1

    payload = load_checkpoint(args.checkpoint)
    architecture = payload["architecture"]
    class_to_idx = payload["class_to_idx"]
    input_size = tuple(payload["input_size"])
    normalization = NormalizationStats(
        architecture=architecture,
        input_size=input_size,
        mean=tuple(payload["normalization_mean"]),
        std=tuple(payload["normalization_std"]),
        source="finetune_from_checkpoint",
    )

    config = TrainConfig(
        manifest_path=args.manifest,
        output_dir=args.output or (args.checkpoint.parent / "finetuned"),
        modality=args.modality,
        architecture=architecture,
        num_classes=len(class_to_idx),
        classifier_hidden_dims=tuple(args.hidden_dims),
        classifier_dropout=args.dropout,
        freeze_backbone=False,
        batch_size=args.batch_size,
        num_epochs=args.num_epochs,
        learning_rate=args.learning_rate,
        weight_decay=args.weight_decay,
        early_stopping_patience=args.early_stopping_patience,
        use_weighted_sampler=not args.use_weighted_loss,
        use_weighted_loss=args.use_weighted_loss,
        device=args.device,
        random_seed=args.seed,
        num_workers=args.workers if args.workers is not None else max(1, __import__("os").cpu_count() - 1),
    )

    logger = setup_logging(config.log_path, level=logging.DEBUG if args.verbose else logging.INFO)
    seed_everything(config.random_seed)

    print("=" * 60)
    print(f" Fine-tuning (phase 2) - {architecture}")
    print("=" * 60)
    print(f"Checkpoint source : {args.checkpoint}")
    print(f"Manifeste         : {config.manifest_path}")
    print(f"Sortie            : {config.output_dir}")
    print(f"Learning rate     : {config.learning_rate}")
    print(f"Device            : {resolve_device(config.device)}")
    print("-" * 60)

    try:
        manifest_df = pd.read_csv(config.manifest_path)

        pp_config = PreprocessConfig(
            input_dir=config.manifest_path.parent, modality=config.modality, num_workers=config.num_workers
        )
        loaders = build_dataloaders(
            manifest_df, normalization, pp_config,
            batch_size=config.batch_size, use_weighted_sampler=config.use_weighted_sampler,
        )

        class_weights = None
        if config.use_weighted_loss:
            from preprocessing.balancing import compute_class_weights
            train_labels = [class_to_idx[c] for c in manifest_df[manifest_df["split"] == "train"]["class"]]
            class_weights = compute_class_weights(train_labels, config.num_classes)

        # Backbone entièrement dégelé : freeze_backbone=False laisse tous
        # les paramètres entraînables (requires_grad=True par défaut sur un
        # modèle fraîchement construit). Les poids sont ensuite écrasés par
        # ceux du checkpoint (backbone ImageNet + tête déjà entraînée en phase 1).
        model = build_model(
            architecture, pretrained=False, num_classes=config.num_classes,
            hidden_dims=config.classifier_hidden_dims, dropout=config.classifier_dropout,
            freeze_backbone=False,
        )
        model.load_state_dict(payload["model_state_dict"])

        trainer = Trainer(
            model, config, class_to_idx, normalization.input_size,
            normalization.mean, normalization.std, class_weights,
        )
        report = trainer.fit(loaders["train"], loaders["val"])

        report.test_metrics = evaluate(
            trainer.model, loaders["test"], class_to_idx, trainer.device, split_name="test"
        )

        generate_training_csv(report, config.reports_dir / "training_history.csv")
        generate_training_json(report, config.reports_dir / "training_report.json")
        generate_training_html(report, config.reports_dir / "training_report.html")
        plot_training_curves(report.epoch_history, config.reports_dir / "training_curves.png")
        plot_confusion_matrix(report.test_metrics, config.reports_dir / "confusion_matrix.png")
        plot_roc_curves(report.test_metrics, config.reports_dir / "roc_curves.png")
        plot_pr_curves(report.test_metrics, config.reports_dir / "pr_curves.png")

        gradcam_samples = []
        test_df = manifest_df[manifest_df["split"] == "test"]
        for cls in sorted(class_to_idx):
            cls_rows = test_df[test_df["class"] == cls].head(args.gradcam_samples_per_class)
            gradcam_samples += [(Path(p), cls) for p in cls_rows["path"]]

        if gradcam_samples:
            from preprocessing.augmentation import build_eval_transforms
            eval_transform = build_eval_transforms(normalization.mean, normalization.std)
            generate_gradcam_grid(
                trainer.model, architecture, gradcam_samples, eval_transform,
                normalization.input_size, trainer.device, config.gradcam_dir / "gradcam_grid.png",
            )

    except Exception:  # noqa: BLE001
        logger.exception("Échec du fine-tuning.")
        print("Une erreur est survenue, voir training_logs.txt pour le détail.", file=sys.stderr)
        return 1

    print("-" * 60)
    print(f"Meilleure époque     : {report.best_epoch} (val_acc={report.best_val_accuracy:.4f})")
    print(f"Accuracy test        : {report.test_metrics.accuracy:.4f}")
    print(f"Checkpoint fine-tuné : {config.checkpoint_path}")
    print(f"Rapports             : {config.reports_dir}")
    print("=" * 60)
    return 0


if __name__ == "__main__":
    sys.exit(main())
