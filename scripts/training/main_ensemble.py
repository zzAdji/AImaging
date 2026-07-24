#!/usr/bin/env python3
"""CLI pour évaluer un ensemble de modèles déjà entraînés par soft voting."""

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

from preprocessing.preprocessing.config import ModelConfig as PPModelConfig, PreprocessConfig  # noqa: E402
from preprocessing.preprocessing.normalization import resolve_normalization  # noqa: E402
from preprocessing.preprocessing.torch_dataset import build_dataloaders  # noqa: E402

from training.ensemble import evaluate_ensemble, load_model_from_checkpoint  # noqa: E402
from training.evaluator import evaluate  # noqa: E402
from training.report import generate_comparison_html  # noqa: E402
from training.utils import load_checkpoint, resolve_device, setup_logging  # noqa: E402
from training.visualization import plot_confusion_matrix, plot_pr_curves, plot_roc_curves  # noqa: E402


def parse_args(argv=None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="main_ensemble",
        description="Évalue un ensemble de modèles déjà entraînés par soft voting.",
    )
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--preprocessing-path", type=Path, default=None)
    parser.add_argument("--checkpoints", required=True, type=Path, nargs="+", help="Un ou plusieurs fichiers .pt produits par main_train.py.")
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--modality", default="chest_xray", choices=["chest_xray", "ultrasound"])
    parser.add_argument("--hidden-dims", type=int, nargs="+", default=[512, 128, 32])
    parser.add_argument("--dropout", type=float, default=0.2)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--device", default="auto", choices=["auto", "cpu", "cuda"])
    parser.add_argument("--workers", type=int, default=1)
    parser.add_argument("--verbose", action="store_true")
    return parser.parse_args(argv)


def main(argv=None) -> int:
    args = parse_args(argv)

    if not args.manifest.exists():
        print(f"Erreur : le manifeste '{args.manifest}' n'existe pas.", file=sys.stderr)
        return 1
    for ckpt in args.checkpoints:
        if not ckpt.exists():
            print(f"Erreur : le checkpoint '{ckpt}' n'existe pas.", file=sys.stderr)
            return 1

    args.output.mkdir(parents=True, exist_ok=True)
    logger = setup_logging(args.output / "ensemble_logs.txt", level=logging.DEBUG if args.verbose else logging.INFO)

    print("=" * 60)
    print(f" Ensemble - {len(args.checkpoints)} modèle(s)")
    print("=" * 60)
    for ckpt in args.checkpoints:
        print(f"  - {ckpt}")
    print("-" * 60)

    try:
        manifest_df = pd.read_csv(args.manifest)

        # Les DataLoaders sont construits à une taille de référence (celle du
        # premier checkpoint) ; ensemble.soft_voting_predict ré-échantillonne
        # en interne pour les modèles dont la taille d'entrée diffère (ex.
        # EfficientNet-B4 en 380x380 alors que le manifeste a été prétraité en 224x224).
        first_payload = load_checkpoint(args.checkpoints[0])
        pp_model_config = PPModelConfig(architecture=first_payload["architecture"], pretrained=False)
        normalization = resolve_normalization(pp_model_config)
        normalization.input_size = tuple(first_payload["input_size"])
        normalization.mean = tuple(first_payload["normalization_mean"])
        normalization.std = tuple(first_payload["normalization_std"])

        pp_config = PreprocessConfig(
            input_dir=args.manifest.parent, modality=args.modality, num_workers=args.workers
        )
        loaders = build_dataloaders(
            manifest_df, normalization, pp_config, batch_size=args.batch_size, use_weighted_sampler=False
        )

        device = resolve_device(args.device)

        individual_metrics = {}
        for ckpt in args.checkpoints:
            payload = load_checkpoint(ckpt)
            model, class_to_idx, _ = load_model_from_checkpoint(
                ckpt, tuple(args.hidden_dims), args.dropout, device
            )
            metrics = evaluate(model, loaders["test"], class_to_idx, device, split_name=payload["architecture"])
            individual_metrics[payload["architecture"]] = metrics
            logger.info("%s - accuracy test : %.4f", payload["architecture"], metrics.accuracy)

        ensemble_metrics = evaluate_ensemble(
            args.checkpoints, loaders["test"], args.device, tuple(args.hidden_dims), args.dropout
        )

        generate_comparison_html(individual_metrics, ensemble_metrics, args.output / "comparison_report.html")
        plot_confusion_matrix(ensemble_metrics, args.output / "ensemble_confusion_matrix.png")
        plot_roc_curves(ensemble_metrics, args.output / "ensemble_roc_curves.png")
        plot_pr_curves(ensemble_metrics, args.output / "ensemble_pr_curves.png")

    except Exception:  # noqa: BLE001
        logger.exception("Échec de l'évaluation de l'ensemble.")
        print("Une erreur est survenue, voir ensemble_logs.txt pour le détail.", file=sys.stderr)
        return 1

    print("-" * 60)
    print("Accuracy par modèle :")
    for arch, metrics in individual_metrics.items():
        print(f"  {arch:20s} : {metrics.accuracy:.4f}")
    print(f"  {'Ensemble (soft voting)':20s} : {ensemble_metrics.accuracy:.4f}")
    print(f"Rapport comparatif : {args.output / 'comparison_report.html'}")
    print("=" * 60)
    return 0


if __name__ == "__main__":
    sys.exit(main())
