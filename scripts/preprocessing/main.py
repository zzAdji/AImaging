#!/usr/bin/env python3
"""Point d'entrée CLI du pipeline de prétraitement"""

from __future__ import annotations

import argparse
import logging
import os
import sys
from pathlib import Path

from preprocessing.config import ModelConfig, PreprocessConfig
from preprocessing.pipeline import PreprocessingPipeline
from preprocessing.report import generate_csv, generate_html, generate_json
from preprocessing.utils import setup_logging
from preprocessing.visualization import generate_all_grids


def parse_args(argv: list | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="preprocessing",
        description="Prétraitement déterministe d'un dataset d'images médicales avant entraînement.",
    )
    parser.add_argument("--input", required=True, type=Path, help="Dossier dataset_clean/<classe>/*.")
    parser.add_argument("--output", type=Path, default=None, help="Dossier dataset_processed/ (défaut : <input>/../dataset_processed).")
    parser.add_argument("--reports", type=Path, default=None, help="Dossier des rapports (défaut : <output>/../reports).")
    parser.add_argument("--modality", default="chest_xray", choices=["chest_xray", "ultrasound"], help="Profil d'augmentation/contraste à utiliser.")
    parser.add_argument("--architecture", default="densenet121", help="Backbone cible (densenet121, efficientnet_b0, resnet50, ...).")
    parser.add_argument("--no-pretrained", action="store_true", help="Ignore les poids pré-entraînés (utilise les stats ImageNet génériques).")
    parser.add_argument("--target-size", type=int, default=None, help="Force une taille cible carrée (sinon dérivée du backbone).")
    parser.add_argument("--num-classes", type=int, default=3)
    parser.add_argument("--workers", type=int, default=None, help="Nombre de workers parallèles (défaut : nombre de cœurs CPU).")
    parser.add_argument("--split-ratios", type=float, nargs=3, default=[0.80, 0.10, 0.10], metavar=("TRAIN", "VAL", "TEST"))
    parser.add_argument("--patient-id-csv", type=Path, default=None, help="CSV (filename,patient_id) pour un split au niveau patient.")
    parser.add_argument("--enable-enhancement", action="store_true", help="Active l'amélioration de contraste (désactivée par défaut).")
    parser.add_argument("--enhancement-method", default="clahe", choices=["clahe", "hist_eq", "gamma"])
    parser.add_argument("--grid-sample-size", type=int, default=16)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--verbose", action="store_true")
    return parser.parse_args(argv)


def main(argv: list | None = None) -> int:
    args = parse_args(argv)

    if not args.input.exists():
        print(f"Erreur : le dossier '{args.input}' n'existe pas.", file=sys.stderr)
        return 1

    model_config = ModelConfig(
        architecture=args.architecture,
        pretrained=not args.no_pretrained,
        fallback_size=(args.target_size, args.target_size) if args.target_size else (224, 224),
        num_classes=args.num_classes,
    )

    config = PreprocessConfig(
        input_dir=args.input,
        output_dir=args.output,
        reports_dir=args.reports,
        modality=args.modality,
        model=model_config,
        num_workers=args.workers or (os.cpu_count() or 1),
        split_ratios=tuple(args.split_ratios),
        patient_id_csv=args.patient_id_csv,
        grid_sample_size=args.grid_sample_size,
        random_seed=args.seed,
    )
    if args.enable_enhancement:
        config.enhancement_profile.enabled = True
        config.enhancement_profile.method = args.enhancement_method

    logger = setup_logging(config.log_path, level=logging.DEBUG if args.verbose else logging.INFO)

    print("=" * 60)
    print(" Pipeline de prétraitement — imagerie médicale")
    print("=" * 60)
    print(f"Entrée         : {config.input_dir}")
    print(f"Sortie         : {config.output_dir}")
    print(f"Rapports       : {config.reports_dir}")
    print(f"Modalité       : {config.modality}")
    print(f"Backbone       : {model_config.architecture} (pretrained={model_config.pretrained})")
    print(f"Enhancement    : {'activé (' + config.enhancement_profile.method + ')' if config.enhancement_profile.enabled else 'désactivé'}")
    print(f"Workers        : {config.num_workers}")
    print("-" * 60)

    try:
        pipeline = PreprocessingPipeline(config)
        report = pipeline.run()

        generate_all_grids(
            report.successful_entries, config.visualization_dir, config.grid_sample_size, config.random_seed
        )
        generate_csv(report, config.csv_report_path)
        generate_json(report, config.json_report_path)
        generate_html(report, config.html_report_path)

    except Exception:  # noqa: BLE001
        logger.exception("Échec du prétraitement.")
        print("Une erreur est survenue, voir preprocessing_logs.txt pour le détail.", file=sys.stderr)
        return 1

    print("-" * 60)
    print(f"Images traitées      : {report.total_images}")
    print(f"Réussies             : {len(report.successful_entries)}")
    print(f"Échecs               : {len(report.failed_entries)}")
    print(f"Classes              : {report.class_counts}")
    print(f"Répartition splits   : {report.split_counts}")
    print(f"Temps d'exécution    : {report.execution_time_seconds:.2f} s")
    print(f"Manifeste            : {config.manifest_path}")
    print(f"Rapport CSV          : {config.csv_report_path}")
    print(f"Rapport JSON         : {config.json_report_path}")
    print(f"Rapport HTML         : {config.html_report_path}")
    print("=" * 60)
    return 0


if __name__ == "__main__":
    sys.exit(main())
