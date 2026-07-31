#!/usr/bin/env python3
"""Run fetal ultrasound quality filtering and plane classification on a folder."""

from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path
from typing import Any, Dict, List

from tqdm import tqdm

from deepfetal_adapter.config import PlaneClassifierConfig, QualityFilterConfig
from deepfetal_adapter.image_io import collect_image_paths
from deepfetal_adapter.paths import require_dir
from deepfetal_adapter.plane_inference import PlaneClassifier
from deepfetal_adapter.quality_inference import QualityFilter, QualityPrediction


def parse_args(argv=None) -> argparse.Namespace:
    defaults = PlaneClassifierConfig()
    quality_defaults = QualityFilterConfig()
    parser = argparse.ArgumentParser(
        description="Inference sur un dossier d'images d'echographie foetale."
    )
    parser.add_argument("--input-dir", required=True, type=Path, help="Dossier contenant les images.")
    parser.add_argument("--output-json", type=Path, default=None, help="Chemin JSON de sortie.")
    parser.add_argument("--output-csv", type=Path, default=None, help="Chemin CSV de sortie.")
    parser.add_argument("--device", default="auto", choices=["auto", "cpu", "cuda"])
    parser.add_argument("--deepfetal-root", type=Path, default=defaults.deepfetal_root)
    parser.add_argument("--plane-checkpoint", type=Path, default=defaults.checkpoint_path)
    parser.add_argument("--class-indices", type=Path, default=defaults.class_indices_path)
    parser.add_argument("--quality-checkpoint", type=Path, default=quality_defaults.checkpoint_path)
    parser.add_argument("--skip-quality", action="store_true", help="Desactive le filtre qualite YOLO.")
    parser.add_argument("--no-recursive", action="store_true", help="Ne parcourt pas les sous-dossiers.")
    return parser.parse_args(argv)


def unavailable_quality(reason: str) -> QualityPrediction:
    return QualityPrediction(
        score=None,
        prediction="not_run",
        probabilities={},
        available=False,
        reason=reason,
    )


def build_quality_filter(args) -> QualityFilter | None:
    if args.skip_quality:
        return None
    return QualityFilter(QualityFilterConfig(checkpoint_path=args.quality_checkpoint))


def predict_one(
    image_path: Path,
    input_dir: Path,
    plane_classifier: PlaneClassifier,
    quality_filter: QualityFilter | None,
    quality_unavailable_reason: str | None,
) -> Dict[str, Any]:
    plane_prediction = plane_classifier.predict(image_path)

    if quality_filter is not None:
        quality_prediction = quality_filter.predict(image_path)
    else:
        reason = quality_unavailable_reason or "Filtre qualite desactive par --skip-quality."
        quality_prediction = unavailable_quality(reason)

    return {
        "image": str(image_path),
        "relative_path": str(image_path.relative_to(input_dir)),
        **quality_prediction.to_dict(),
        **plane_prediction.to_dict(),
    }


def write_json(path: Path, results: List[Dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(results, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_csv(path: Path, results: List[Dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = [
        "image",
        "relative_path",
        "quality_score",
        "quality_prediction",
        "quality_available",
        "quality_unavailable_reason",
        "plane_prediction",
        "plane_confidence",
    ]
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for item in results:
            writer.writerow({key: item.get(key) for key in fieldnames})


def main(argv=None) -> int:
    args = parse_args(argv)
    try:
        input_dir = require_dir(args.input_dir, "Dossier d'entree")
        image_paths = collect_image_paths(input_dir, recursive=not args.no_recursive)
        if not image_paths:
            print(f"Aucune image trouvee dans {input_dir}.", file=sys.stderr)
            return 1

        plane_config = PlaneClassifierConfig(
            deepfetal_root=args.deepfetal_root,
            checkpoint_path=args.plane_checkpoint,
            class_indices_path=args.class_indices,
        )
        plane_classifier = PlaneClassifier(plane_config, device=args.device)

        quality_unavailable_reason = None
        try:
            quality_filter = build_quality_filter(args)
        except ModuleNotFoundError as exc:
            quality_filter = None
            quality_unavailable_reason = str(exc)

        results = []
        for image_path in tqdm(image_paths, desc="Inference", unit="image"):
            results.append(
                predict_one(
                    image_path=image_path,
                    input_dir=input_dir,
                    plane_classifier=plane_classifier,
                    quality_filter=quality_filter,
                    quality_unavailable_reason=quality_unavailable_reason,
                )
            )

        if args.output_json:
            write_json(args.output_json, results)
        if args.output_csv:
            write_csv(args.output_csv, results)

        summary = {
            "input_dir": str(input_dir),
            "total_images": len(results),
            "output_json": str(args.output_json) if args.output_json else None,
            "output_csv": str(args.output_csv) if args.output_csv else None,
        }
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        return 0
    except Exception as exc:
        print(f"Erreur: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
