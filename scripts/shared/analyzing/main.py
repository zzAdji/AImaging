from __future__ import annotations

import argparse
import logging
import os
import sys
from pathlib import Path

from scripts.shared.analyzing.dataset_analyzer.analyzer import DatasetAnalyzer
from scripts.shared.analyzing.dataset_analyzer.cleaner import DatasetCleaner
from scripts.shared.analyzing.dataset_analyzer.config import AnalyzerConfig
from scripts.shared.analyzing.dataset_analyzer.report import CSVReportGenerator, PDFReportGenerator
from scripts.shared.analyzing.dataset_analyzer.utils import setup_logging
from scripts.shared.analyzing.dataset_analyzer.visualization import generate_all


def parse_args(argv: list | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="dataset_analyzer",
        description=(
            "Audite et nettoie un dataset d'images médicales "
            "(radiographies thoraciques)."
        ),
    )
    parser.add_argument(
        "--dataset", required=True, type=Path,
        help="Chemin vers le dossier racine du dataset (Dataset/Classe/*.jpg).",
    )
    parser.add_argument(
        "--output", type=Path, default=None,
        help="Dossier de sortie pour les rapports (défaut : <dataset>/../analysis_output).",
    )
    parser.add_argument(
        "--workers", type=int, default=None,
        help="Nombre de workers parallèles (défaut : nombre de cœurs CPU).",
    )
    parser.add_argument("--min-width", type=int, default=64)
    parser.add_argument("--min-height", type=int, default=64)
    parser.add_argument("--max-width", type=int, default=4096)
    parser.add_argument("--max-height", type=int, default=4096)
    parser.add_argument(
        "--duplicate-threshold", type=int, default=5,
        help="Distance de Hamming max. entre deux pHash pour être considérés doublons.",
    )
    parser.add_argument(
        "--no-ssim", action="store_true",
        help="Désactive la confirmation SSIM des quasi-doublons (plus rapide, plus de faux positifs).",
    )
    parser.add_argument(
        "--imbalance-ratio", type=float, default=1.5,
        help="Ratio classe majoritaire/minoritaire au-delà duquel le dataset est jugé déséquilibré.",
    )
    parser.add_argument(
        "--clean", action="store_true",
        help="Applique réellement les déplacements vers Review/ (défaut : dry-run, rien n'est modifié).",
    )
    parser.add_argument(
        "--remove-duplicates", action="store_true",
        help="En plus de --clean, déplace aussi les doublons vers Review/Duplicates/.",
    )
    parser.add_argument("--verbose", action="store_true", help="Active les logs de niveau DEBUG.")
    return parser.parse_args(argv)


def main(argv: list | None = None) -> int:
    args = parse_args(argv)

    if not args.dataset.exists():
        print(f"Erreur : le dossier '{args.dataset}' n'existe pas.", file=sys.stderr)
        return 1

    config = AnalyzerConfig(
        dataset_path=args.dataset,
        output_dir=args.output,
        num_workers=args.workers or (os.cpu_count() or 1),
        min_width=args.min_width,
        min_height=args.min_height,
        max_width=args.max_width,
        max_height=args.max_height,
        duplicate_hamming_threshold=args.duplicate_threshold,
        enable_ssim_confirmation=not args.no_ssim,
        class_imbalance_ratio_threshold=args.imbalance_ratio,
        dry_run=not args.clean,
    )

    logger = setup_logging(
        config.log_path, level=logging.DEBUG if args.verbose else logging.INFO
    )

    print("=" * 60)
    print(" Dataset Analyzer & Cleaner - Radiographies thoraciques")
    print("=" * 60)
    print(f"Dataset      : {config.dataset_path}")
    print(f"Sortie       : {config.output_dir}")
    print(f"Mode         : {'NETTOYAGE ACTIF' if args.clean else 'DRY-RUN (aucune modification)'}")
    print(f"Workers      : {config.num_workers}")
    print("-" * 60)

    try:
        analyzer = DatasetAnalyzer(config)
        report = analyzer.run()

        report.generated_charts = generate_all(report, config)

        CSVReportGenerator.generate(report, config.csv_report_path)
        PDFReportGenerator(report).generate(config.pdf_report_path)

        cleaner = DatasetCleaner(config)
        cleaner.move_corrupted(report)
        cleaner.move_atypical(report)
        if args.remove_duplicates:
            cleaner.move_duplicates(report)

    except Exception:  # noqa: BLE001 - dernier rempart : on log puis on sort proprement
        logger.exception("Échec de l'analyse.")
        print("Une erreur est survenue, voir logs.txt pour le détail.", file=sys.stderr)
        return 1

    print("-" * 60)
    print(f"Images analysées       : {report.total_images}")
    print(f"Images corrompues      : {len(report.corrupted_records)}")
    print(f"Images atypiques       : {len(report.atypical_records)}")
    print(f"Groupes de doublons    : {len(report.duplicate_groups)}")
    print(
        f"Classes déséquilibrées : {'Oui' if report.is_imbalanced else 'Non'} "
        f"(ratio={report.imbalance_ratio:.2f})"
    )
    print(f"Temps d'exécution      : {report.execution_time_seconds:.2f} s")
    print(f"Rapport CSV généré     : {config.csv_report_path}")
    print(f"Rapport PDF généré     : {config.pdf_report_path}")
    print(f"Logs                   : {config.log_path}")
    print("=" * 60)
    return 0


if __name__ == "__main__":
    sys.exit(main())
