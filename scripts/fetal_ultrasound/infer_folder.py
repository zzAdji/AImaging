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
from deepfetal_adapter.schemas import (
    ExamResult,
    ImageResult,
    PlaneResult,
    QualityResult,
    exam_id_from_path,
    image_id_from_path,
)
from plane_grouping import group_exam_by_plane, load_known_planes, write_plane_groups_json


def parse_args(argv=None) -> argparse.Namespace:
    defaults = PlaneClassifierConfig()
    quality_defaults = QualityFilterConfig()
    parser = argparse.ArgumentParser(
        description="Inference sur un dossier d'images d'echographie foetale."
    )
    parser.add_argument("--input-dir", required=True, type=Path, help="Dossier contenant les images.")
    parser.add_argument("--output-json", type=Path, default=None, help="Chemin JSON de sortie.")
    parser.add_argument("--output-csv", type=Path, default=None, help="Chemin CSV de sortie.")
    parser.add_argument("--output-exam-json", type=Path, default=None, help="Chemin JSON structure par examen.")
    parser.add_argument(
        "--output-plane-groups-json", type=Path, default=None,
        help="Chemin JSON du regroupement par plan (Phase F). Necessite --class-indices.",
    )
    parser.add_argument(
        "--include-unfiltered-plane-groups", action="store_true",
        help="Inclut dans le regroupement par plan les images classifiees via --skip-quality "
             "(par defaut, seules les images correctement filtrees qualite sont regroupees).",
    )
    parser.add_argument(
        "--min-plane-confidence", type=float, default=None,
        help="Seuil de confiance minimal (0-1) pour qu'une image reste dans son groupe de plan "
             "dans le regroupement Phase F. Desactive par defaut.",
    )
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


def to_quality_result(prediction: QualityPrediction) -> QualityResult:
    return QualityResult(
        score=prediction.score,
        prediction=prediction.prediction,
        probabilities=prediction.probabilities,
        available=prediction.available,
        reason=prediction.reason,
    )


def to_plane_result(prediction, class_labels: dict[str, str], status: str = "predicted") -> PlaneResult:
    name_to_id = {name: int(idx) for idx, name in class_labels.items()}
    return PlaneResult(
        name=prediction.predicted_label,
        confidence=prediction.confidence,
        probabilities=prediction.probabilities,
        plane_id=name_to_id.get(prediction.predicted_label),
        status=status,
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
    classify_without_quality: bool,
) -> ImageResult:
    if quality_filter is not None:
        quality_prediction = quality_filter.predict(image_path)
    else:
        reason = quality_unavailable_reason or "Filtre qualite desactive par --skip-quality."
        quality_prediction = unavailable_quality(reason)

    quality_result = to_quality_result(quality_prediction)
    plane_result = None
    if quality_result.accepted:
        plane_prediction = plane_classifier.predict(image_path)
        plane_result = to_plane_result(plane_prediction, plane_classifier.class_labels)
    elif classify_without_quality:
        plane_prediction = plane_classifier.predict(image_path)
        plane_result = to_plane_result(
            plane_prediction,
            plane_classifier.class_labels,
            status="predicted_without_quality_filter",
        )
    elif quality_result.prediction == "rejected":
        plane_result = PlaneResult(
            name=None,
            confidence=None,
            probabilities={},
            plane_id=None,
            status="skipped_quality_rejected",
        )
    else:
        plane_result = PlaneResult(
            name=None,
            confidence=None,
            probabilities={},
            plane_id=None,
            status="skipped_quality_unavailable",
        )

    return ImageResult(
        image_id=image_id_from_path(image_path),
        path=str(image_path),
        relative_path=str(image_path.relative_to(input_dir)),
        quality=quality_result,
        plane=plane_result,
    )


def write_json(path: Path, results: List[Dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(results, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_exam_json(path: Path, exam: ExamResult) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(exam.to_structured_dict(), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_csv(path: Path, results: List[Dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = [
        "image",
        "relative_path",
        "quality_score",
        "quality_prediction",
        "quality_available",
        "quality_unavailable_reason",
        "plane_id",
        "plane_prediction",
        "plane_confidence",
        "plane_status",
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

        exam = ExamResult(exam_id=exam_id_from_path(input_dir), exam_path=str(input_dir))
        for image_path in tqdm(image_paths, desc="Inference", unit="image"):
            exam.images.append(
                predict_one(
                    image_path=image_path,
                    input_dir=input_dir,
                    plane_classifier=plane_classifier,
                    quality_filter=quality_filter,
                    quality_unavailable_reason=quality_unavailable_reason,
                    classify_without_quality=args.skip_quality,
                )
            )

        results = exam.to_flat_records()
        if args.output_json:
            write_json(args.output_json, results)
        if args.output_csv:
            write_csv(args.output_csv, results)
        if args.output_exam_json:
            write_exam_json(args.output_exam_json, exam)

        plane_grouping_summary = None
        if args.output_plane_groups_json:
            known_planes = load_known_planes(plane_config.class_indices_path)
            grouping = group_exam_by_plane(
                exam, known_planes,
                include_unfiltered_predictions=args.include_unfiltered_plane_groups,
                min_plane_confidence=args.min_plane_confidence,
            )
            write_plane_groups_json(args.output_plane_groups_json, grouping)
            plane_grouping_summary = {
                "planes_observed": grouping.planes_observed,
                "planes_known": len(known_planes),
                "planes_missing": len(grouping.missing_planes),
                "unclassified_images": len(grouping.unclassified_images),
                "low_confidence_images": len(grouping.low_confidence_images),
            }

        summary = {
            "input_dir": str(input_dir),
            "exam_id": exam.exam_id,
            "total_images": exam.images_total,
            "images_accepted": exam.images_accepted,
            "images_rejected": exam.images_rejected,
            "output_json": str(args.output_json) if args.output_json else None,
            "output_csv": str(args.output_csv) if args.output_csv else None,
            "output_exam_json": str(args.output_exam_json) if args.output_exam_json else None,
            "output_plane_groups_json": str(args.output_plane_groups_json) if args.output_plane_groups_json else None,
            "plane_grouping": plane_grouping_summary,
        }
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        return 0
    except Exception as exc:
        print(f"Erreur: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())