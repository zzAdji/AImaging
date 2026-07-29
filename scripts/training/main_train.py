#!/usr/bin/env python3
"""CLI pour entraîner UN modèle sur le dataset prétraité"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

from training.utils import bootstrap_preprocessing_import

_parser_for_early_path = argparse.ArgumentParser(add_help=False)
_parser_for_early_path.add_argument("--preprocessing-path", type=Path, default=None)
_early_args, _ = _parser_for_early_path.parse_known_args()
bootstrap_preprocessing_import(_early_args.preprocessing_path)

import pandas as pd  # noqa: E402

from preprocessing.balancing import compute_class_weights  # noqa: E402
from preprocessing.config import ModelConfig as PPModelConfig, PreprocessConfig  # noqa: E402
from preprocessing.normalization import resolve_normalization  # noqa: E402
from preprocessing.torch_dataset import build_dataloaders  # noqa: E402

from training.config import TrainConfig  # noqa: E402
from training.evaluator import evaluate  # noqa: E402
from training.gradcam import generate_gradcam_grid  # noqa: E402
from training.model_builder import build_model  # noqa: E402
from training.report import (  # noqa: E402
    generate_training_csv,
    generate_training_html,
    generate_training_json,
)
from training.trainer import Trainer  # noqa: E402
from training.utils import resolve_device, seed_everything, setup_logging  # noqa: E402
from training.visualization import (  # noqa: E402
    plot_confusion_matrix,
    plot_pr_curves,
    plot_roc_curves,
    plot_training_curves,
)


def parse_args(argv=None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="main_train",
        description="Entraîne un modèle de classification par modalité.",
    )
    parser.add_argument("--manifest", required=True, type=Path, help="manifest.csv produit par le prétraitement.")
    parser.add_argument("--preprocessing-path", type=Path, default=None, help="Chemin vers le dossier contenant le package preprocessing, si non standard.")
    parser.add_argument("--output", type=Path, default=None, help="Dossier de sortie (défaut : <manifest>/../training_runs/<architecture>).")
    parser.add_argument("--modality", default="chest_xray", choices=["chest_xray", "ultrasound"])
    parser.add_argument("--architecture", default="densenet121")
    parser.add_argument("--no-pretrained", action="store_true")
    parser.add_argument("--num-classes", type=int, default=5)
    parser.add_argument("--hidden-dims", type=int, nargs="+", default=[512, 128, 32])
    parser.add_argument("--dropout", type=float, default=0.2)
    parser.add_argument("--no-freeze-backbone", action="store_true", help="Fine-tuning complet au lieu de geler le backbone.")
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--num-epochs", type=int, default=30)
    parser.add_argument("--learning-rate", type=float, default=1e-4)
    parser.add_argument("--weight-decay", type=float, default=1e-4)
    parser.add_argument("--early-stopping-patience", type=int, default=3)
    parser.add_argument("--use-weighted-loss", action="store_true", help="Utilise une loss pondérée au lieu du WeightedRandomSampler.")
    parser.add_argument("--device", default="auto", choices=["auto", "cpu", "cuda"])
    parser.add_argument("--workers", type=int, default=None)
    parser.add_argument("--gradcam-samples-per-class", type=int, default=2)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--verbose", action="store_true")
    return parser.parse_args(argv)


def main(argv=None) -> int:
    args = parse_args(argv)

    if not args.manifest.exists():
        print(f"Erreur : le manifeste '{args.manifest}' n'existe pas.", file=sys.stderr)
        return 1

    config = TrainConfig(
        manifest_path=args.manifest,
        output_dir=args.output,
        modality=args.modality,
        architecture=args.architecture,
        pretrained=not args.no_pretrained,
        num_classes=args.num_classes,
        classifier_hidden_dims=tuple(args.hidden_dims),
        classifier_dropout=args.dropout,
        freeze_backbone=not args.no_freeze_backbone,
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
    print(f" Entraînement - {config.architecture}")
    print("=" * 60)
    print(f"Manifeste       : {config.manifest_path}")
    print(f"Sortie          : {config.output_dir}")
    print(f"Backbone gelé   : {config.freeze_backbone}")
    print(f"Rééquilibrage   : {'sampler pondéré' if config.use_weighted_sampler else 'loss pondérée'}")
    print(f"Device          : {resolve_device(config.device)}")
    print("-" * 60)

    try:
        manifest_df = pd.read_csv(config.manifest_path)
        class_to_idx = {cls: idx for idx, cls in enumerate(sorted(manifest_df["class"].unique()))}

        pp_model_config = PPModelConfig(
            architecture=config.architecture, pretrained=config.pretrained, num_classes=config.num_classes
        )
        normalization = resolve_normalization(pp_model_config)

        # PreprocessConfig sert ici uniquement de porteur du profil
        # d'augmentation et du nombre de workers pour build_dataloaders ;
        # input_dir n'a pas besoin de pointer vers un dossier réel dans ce contexte.
        pp_config = PreprocessConfig(
            input_dir=config.manifest_path.parent, modality=config.modality, num_workers=config.num_workers
        )

        loaders = build_dataloaders(
            manifest_df, normalization, pp_config,
            batch_size=config.batch_size, use_weighted_sampler=config.use_weighted_sampler,
        )

        class_weights = None
        if config.use_weighted_loss:
            train_labels = [class_to_idx[c] for c in manifest_df[manifest_df["split"] == "train"]["class"]]
            class_weights = compute_class_weights(train_labels, config.num_classes)

        model = build_model(
            config.architecture, config.pretrained, config.num_classes,
            config.classifier_hidden_dims, config.classifier_dropout, config.freeze_backbone,
        )

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

        idx_to_class = {v: k for k, v in class_to_idx.items()}
        gradcam_samples = []
        test_df = manifest_df[manifest_df["split"] == "test"]
        for cls in sorted(class_to_idx):
            cls_rows = test_df[test_df["class"] == cls].head(args.gradcam_samples_per_class)
            gradcam_samples += [(Path(p), cls) for p in cls_rows["path"]]

        if gradcam_samples:
            from preprocessing.augmentation import build_eval_transforms

            eval_transform = build_eval_transforms(normalization.mean, normalization.std)
            generate_gradcam_grid(
                trainer.model, config.architecture, gradcam_samples, eval_transform,
                normalization.input_size, trainer.device, config.gradcam_dir / "gradcam_grid.png",
            )

    except Exception:  # noqa: BLE001
        logger.exception("Échec de l'entraînement.")
        print("Une erreur est survenue, voir training_logs.txt pour le détail.", file=sys.stderr)
        return 1

    print("-" * 60)
    print(f"Meilleure époque     : {report.best_epoch} (val_acc={report.best_val_accuracy:.4f})")
    print(f"Arrêt anticipé       : {report.early_stopped}")
    print(f"Accuracy test        : {report.test_metrics.accuracy:.4f}")
    print(f"Temps d'entraînement : {report.training_time_seconds:.1f} s")
    print(f"Checkpoint           : {config.checkpoint_path}")
    print(f"Rapports             : {config.reports_dir}")
    print("=" * 60)
    return 0


if __name__ == "__main__":
    sys.exit(main())
