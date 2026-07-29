#!/usr/bin/env python3
"""Point d'entrée CLI pour évaluer un ensemble de modèles déjà entraînés
par soft voting (moyenne des probabilités softmax).

Deux modes, mutuellement exclusifs :

--manifest UN_SEUL.csv
    Toutes les images viennent d'un seul prétraitement. Les modèles dont
    la taille native diffère sont servis via un ré-échantillonnage à la
    volée (pratique, mais perd en fidélité pour les modèles qui auraient
    besoin d'agrandir l'image).

--manifests m1.csv m2.csv m3.csv ...  (un par checkpoint, même ordre)
    Chaque modèle a été prétraité séparément à sa taille native (ex. un
    prétraitement à 224×224 et un autre à 380×380 pour EfficientNet-B4).
    Recommandé dès que ces prétraitements distincts existent déjà — plus
    fidèle, aucun ré-échantillonnage.

Prérequis : avoir déjà lancé main_train.py une fois par architecture
souhaitée — ce script ne fait qu'assembler des checkpoints existants.

Exemples:
    python main_ensemble.py --manifest ./manifest.csv \\
        --checkpoints runs/densenet121/densenet121_best.pt runs/resnet50/resnet50_best.pt \\
        --output ./ensemble_results

    python main_ensemble.py \\
        --manifests data_224/reports/manifest.csv data_224/reports/manifest.csv data_380/reports/manifest.csv \\
        --checkpoints runs/densenet121/densenet121_best.pt runs/resnet50/resnet50_best.pt runs/efficientnet_b4/efficientnet_b4_best.pt \\
        --output ./ensemble_results
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

from preprocessing.config import ModelConfig as PPModelConfig, PreprocessConfig  # noqa: E402
from preprocessing.normalization import resolve_normalization  # noqa: E402
from preprocessing.torch_dataset import build_dataloaders  # noqa: E402

from scripts.radiography.training.training.ensemble import (  # noqa: E402
    evaluate_ensemble,
    evaluate_ensemble_multi_manifest,
    load_model_from_checkpoint,
)
from scripts.radiography.training.training.evaluator import evaluate  # noqa: E402
from scripts.radiography.training.training.report import generate_comparison_html  # noqa: E402
from scripts.radiography.training.training.utils import resolve_device, setup_logging  # noqa: E402
from scripts.radiography.training.training.visualization import plot_confusion_matrix, plot_pr_curves, plot_roc_curves  # noqa: E402


def parse_args(argv=None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="main_ensemble",
        description="Évalue un ensemble de modèles déjà entraînés par soft voting.",
    )
    manifest_group = parser.add_mutually_exclusive_group(required=True)
    manifest_group.add_argument("--manifest", type=Path, help="Un seul manifeste partagé par tous les modèles.")
    manifest_group.add_argument("--manifests", type=Path, nargs="+", help="Un manifeste par checkpoint (même ordre que --checkpoints).")

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

    if args.manifests is not None and len(args.manifests) != len(args.checkpoints):
        print(
            f"Erreur : {len(args.checkpoints)} checkpoint(s) mais {len(args.manifests)} "
            "manifeste(s) passés à --manifests — il en faut exactement un par checkpoint, "
            "dans le même ordre.", file=sys.stderr,
        )
        return 1

    for path in [args.manifest] if args.manifest else args.manifests:
        if not path.exists():
            print(f"Erreur : le manifeste '{path}' n'existe pas.", file=sys.stderr)
            return 1
    for ckpt in args.checkpoints:
        if not ckpt.exists():
            print(f"Erreur : le checkpoint '{ckpt}' n'existe pas.", file=sys.stderr)
            return 1

    args.output.mkdir(parents=True, exist_ok=True)
    logger = setup_logging(args.output / "ensemble_logs.txt", level=logging.DEBUG if args.verbose else logging.INFO)
    device = resolve_device(args.device)
    hidden_dims = tuple(args.hidden_dims)
    mode = "manifestes distincts par modèle" if args.manifests else "manifeste partagé"

    print("=" * 60)
    print(f" Ensemble (soft voting) — {len(args.checkpoints)} modèle(s) — mode : {mode}")
    print("=" * 60)
    for ckpt in args.checkpoints:
        print(f"  - {ckpt}")
    print("-" * 60)

    try:
        individual_metrics = {}

        if args.manifests:
            # --- Mode manifestes distincts : chaque modèle lit ses propres
            # images à sa taille native. Alignement par identité géré dans
            # ensemble.py ; on réutilise les MÊMES manifestes alignés pour
            # les métriques individuelles, afin que la comparaison
            # individuel-vs-ensemble porte exactement sur les mêmes images.
            from scripts.radiography.training.training.ensemble import align_manifests_by_identity, build_test_loader_from_manifest

            raw_manifests = [pd.read_csv(p) for p in args.manifests]
            aligned_manifests, n_common = align_manifests_by_identity(raw_manifests, split="test")
            logger.info("%d image(s) commune(s) à tous les manifestes après alignement.", n_common)

            for ckpt, manifest_df in zip(args.checkpoints, aligned_manifests):
                model, payload = load_model_from_checkpoint(ckpt, hidden_dims, args.dropout, device)
                loader = build_test_loader_from_manifest(
                    manifest_df, payload["class_to_idx"], payload["normalization_mean"],
                    payload["normalization_std"], args.batch_size, args.workers,
                )
                label = f"{payload['architecture']} ({ckpt.stem})"
                metrics = evaluate(model, loader, payload["class_to_idx"], device, split_name=label)
                individual_metrics[label] = metrics
                logger.info("%s — accuracy test : %.4f", label, metrics.accuracy)

            ensemble_metrics = evaluate_ensemble_multi_manifest(
                args.checkpoints, raw_manifests, args.device, hidden_dims, args.dropout,
                args.batch_size, args.workers,
            )

        else:
            # --- Mode manifeste partagé : un seul DataLoader de référence,
            # chaque modèle est évalué avec un ré-échantillonnage explicite
            # vers SA taille native (target_size), y compris pour son
            # accuracy individuelle — sans ce paramètre, un modèle attendant
            # une taille différente de la référence serait évalué sur des
            # images à la mauvaise résolution, sans erreur mais avec un
            # résultat faux.
            manifest_df = pd.read_csv(args.manifest)
            first_payload_model, first_payload = load_model_from_checkpoint(
                args.checkpoints[0], hidden_dims, args.dropout, device
            )
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

            for ckpt in args.checkpoints:
                model, payload = load_model_from_checkpoint(ckpt, hidden_dims, args.dropout, device)
                label = f"{payload['architecture']} ({ckpt.stem})"
                metrics = evaluate(
                    model, loaders["test"], payload["class_to_idx"], device,
                    split_name=label, target_size=tuple(payload["input_size"]),
                )
                individual_metrics[label] = metrics
                logger.info("%s — accuracy test : %.4f", label, metrics.accuracy)

            ensemble_metrics = evaluate_ensemble(
                args.checkpoints, loaders["test"], args.device, hidden_dims, args.dropout
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
