#!/usr/bin/env python3
"""Run fetal ultrasound quality filtering and plane classification on one image."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from deepfetal_adapter.config import PlaneClassifierConfig, QualityFilterConfig
from deepfetal_adapter.paths import require_file
from deepfetal_adapter.plane_inference import PlaneClassifier
from deepfetal_adapter.quality_inference import QualityFilter, QualityPrediction


def parse_args(argv=None) -> argparse.Namespace:
    defaults = PlaneClassifierConfig()
    quality_defaults = QualityFilterConfig()
    parser = argparse.ArgumentParser(
        description="Inference sur une image d'echographie foetale: qualite + plan."
    )
    parser.add_argument("--image", required=True, type=Path, help="Chemin de l'image a analyser.")
    parser.add_argument("--output", type=Path, default=None, help="Chemin JSON optionnel.")
    parser.add_argument("--device", default="auto", choices=["auto", "cpu", "cuda"])
    parser.add_argument("--deepfetal-root", type=Path, default=defaults.deepfetal_root)
    parser.add_argument("--plane-checkpoint", type=Path, default=defaults.checkpoint_path)
    parser.add_argument("--class-indices", type=Path, default=defaults.class_indices_path)
    parser.add_argument("--quality-checkpoint", type=Path, default=quality_defaults.checkpoint_path)
    parser.add_argument("--skip-quality", action="store_true", help="Desactive le filtre qualite YOLO.")
    return parser.parse_args(argv)


def unavailable_quality(reason: str) -> QualityPrediction:
    return QualityPrediction(
        score=None,
        prediction="not_run",
        probabilities={},
        available=False,
        reason=reason,
    )


def main(argv=None) -> int:
    args = parse_args(argv)

    try:
        image_path = require_file(args.image, "Image")

        plane_config = PlaneClassifierConfig(
            deepfetal_root=args.deepfetal_root,
            checkpoint_path=args.plane_checkpoint,
            class_indices_path=args.class_indices,
        )
        plane_classifier = PlaneClassifier(plane_config, device=args.device)
        plane_prediction = plane_classifier.predict(image_path)

        if args.skip_quality:
            quality_prediction = unavailable_quality("Filtre qualite desactive par --skip-quality.")
        else:
            try:
                quality_filter = QualityFilter(QualityFilterConfig(checkpoint_path=args.quality_checkpoint))
                quality_prediction = quality_filter.predict(image_path)
            except ModuleNotFoundError as exc:
                quality_prediction = unavailable_quality(str(exc))

        result = {
            "image": str(image_path),
            **quality_prediction.to_dict(),
            **plane_prediction.to_dict(),
        }

        text = json.dumps(result, ensure_ascii=False, indent=2)
        print(text)
        if args.output:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(text + "\n", encoding="utf-8")
        return 0
    except Exception as exc:
        print(f"Erreur: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
