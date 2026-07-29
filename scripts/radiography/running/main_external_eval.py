#!/usr/bin/env python3
"""CLI pour évaluer un ou plusieurs modèles déjà entraînés sur un NOUVEAU
dataset.

Exemple:
    python main_external_eval.py \\
        --manifest nouveau_dataset_processed/reports/manifest.csv \\
        --checkpoints runs/densenet121/densenet121_best.pt runs/resnet50/resnet50_best.pt \\
        --output external_validation_results
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path
from typing import List, Tuple

from training.training.utils import bootstrap_preprocessing_import

_parser_for_early_path = argparse.ArgumentParser(add_help=False)
_parser_for_early_path.add_argument("--preprocessing-path", type=Path, default=None)
_early_args, _ = _parser_for_early_path.parse_known_args()
bootstrap_preprocessing_import(_early_args.preprocessing_path)

import pandas as pd  # noqa: E402

from training.training.ensemble import (  # noqa: E402
    build_test_loader_from_manifest,
    evaluate_ensemble,
    load_model_from_checkpoint,
)
from training.training.evaluator import evaluate  # noqa: E402
from training.training.report import (  # noqa: E402
    generate_eval_json,
    generate_external_validation_html,
)
from training.training.utils import resolve_device, setup_logging  # noqa: E402
from training.training.visualization import plot_confusion_matrix, plot_pr_curves, plot_roc_curves  # noqa: E402


def parse_args(argv=None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="main_external_eval",
        description="Évalue un modèle (ou ensemble) sur un nouveau dataset externe.",
    )
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--preprocessing-path", type=Path, default=None)
    parser.add_argument("--checkpoints", required=True, type=Path, nargs="+")
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--hidden-dims", type=int, nargs="+", default=[512, 128, 32])
    parser.add_argument("--dropout", type=float, default=0.2)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--device", default="auto", choices=["auto", "cpu", "cuda"])
    parser.add_argument("--workers", type=int, default=1)
    parser.add_argument("--verbose", action="store_true")
    return parser.parse_args(argv)


def filter_known_classes(
    manifest_df: pd.DataFrame, class_to_idx: dict
) -> Tuple[pd.DataFrame, List[str], int]:
    """Ne garde que les lignes dont la classe est connue du modèle.

    Returns:
        (manifeste_filtré, classes_inconnues_triées, nombre_lignes_exclues).
    """
    known = set(class_to_idx)
    mask = manifest_df["class"].isin(known)
    unknown_classes = sorted(set(manifest_df.loc[~mask, "class"]))
    unknown_count = int((~mask).sum())
    return manifest_df[mask].copy(), unknown_classes, unknown_count


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
    logger = setup_logging(args.output / "external_eval_logs.txt", level=logging.DEBUG if args.verbose else logging.INFO)
    device = resolve_device(args.device)
    hidden_dims = tuple(args.hidden_dims)

    print("=" * 60)
    print(f" Validation externe — {len(args.checkpoints)} modèle(s)")
    print("=" * 60)
    print(f"Manifeste : {args.manifest}")
    for ckpt in args.checkpoints:
        print(f"  - {ckpt}")
    print("-" * 60)

    try:
        manifest_df = pd.read_csv(args.manifest)
        total_images = len(manifest_df)

        # Charge le premier checkpoint pour connaître le mapping de classes
        # attendu ; vérifie que tous les checkpoints de l'ensemble le partagent.
        _, first_payload = load_model_from_checkpoint(args.checkpoints[0], hidden_dims, args.dropout, device)
        reference_class_to_idx = first_payload["class_to_idx"]
        for ckpt in args.checkpoints[1:]:
            _, payload = load_model_from_checkpoint(ckpt, hidden_dims, args.dropout, device)
            if payload["class_to_idx"] != reference_class_to_idx:
                print(
                    f"Erreur : '{ckpt}' a un mapping de classes différent des autres "
                    "checkpoints de l'ensemble.", file=sys.stderr,
                )
                return 1

        filtered_df, unknown_classes, unknown_count = filter_known_classes(manifest_df, reference_class_to_idx)

        if unknown_classes:
            logger.warning(
                "%d image(s) exclue(s), classes inconnues du modèle : %s",
                unknown_count, unknown_classes,
            )
            print(f"⚠ {unknown_count} image(s) exclue(s) — classe(s) inconnue(s) du modèle : {unknown_classes}")

        if filtered_df.empty:
            print(
                "Erreur : aucune image du nouveau dataset ne correspond à une classe "
                f"connue du modèle. Classes attendues : {sorted(reference_class_to_idx)}. "
                f"Classes trouvées : {sorted(manifest_df['class'].unique())}.", file=sys.stderr,
            )
            return 1

        filtered_df = filtered_df.copy()
        filtered_df["split"] = "test"

        loader = build_test_loader_from_manifest(
            filtered_df, reference_class_to_idx,
            first_payload["normalization_mean"], first_payload["normalization_std"],
            args.batch_size, args.workers,
        )

        if len(args.checkpoints) == 1:
            model, _ = load_model_from_checkpoint(args.checkpoints[0], hidden_dims, args.dropout, device)
            metrics = evaluate(model, loader, reference_class_to_idx, device, split_name="external_validation")
        else:
            metrics = evaluate_ensemble(args.checkpoints, loader, args.device, hidden_dims, args.dropout)

        generate_eval_json(metrics, args.output / "external_eval_report.json")
        generate_external_validation_html(
            metrics, unknown_classes, unknown_count, total_images,
            args.output / "external_eval_report.html",
        )
        plot_confusion_matrix(metrics, args.output / "confusion_matrix.png")
        plot_roc_curves(metrics, args.output / "roc_curves.png")
        plot_pr_curves(metrics, args.output / "pr_curves.png")

    except Exception:  # noqa: BLE001
        logger.exception("Échec de la validation externe.")
        print("Une erreur est survenue, voir external_eval_logs.txt pour le détail.", file=sys.stderr)
        return 1

    print("-" * 60)
    print(f"Images évaluées : {len(filtered_df)} / {total_images}")
    print(f"Accuracy        : {metrics.accuracy:.4f}")
    print(f"Rapport         : {args.output / 'external_eval_report.html'}")
    print("=" * 60)
    return 0


if __name__ == "__main__":
    sys.exit(main())
