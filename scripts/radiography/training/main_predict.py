#!/usr/bin/env python3
"""CLI pour prédire la classe d'UNE image via un ou plusieurs modèles.

    # Un seul modèle
    python main_predict.py --image radio.png --checkpoints runs/densenet121/densenet121_best.pt

    # Ensemble (soft voting)
    python main_predict.py --image ../../data/chest-xray/Normal/IM-0001-0001.jpeg \
        --checkpoints ../../models/chest_xray/densenet121_best.pt \
                  ../../models/chest_xray/efficientnet_b0_best.pt \
                  ../../models/chest_xray/efficientnet_b2_best.pt \
                  ../../models/chest_xray/resnet101_best.pt \
                  ../../models/chest_xray/resnet50_best.pt
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Dict, List, Tuple

from training.utils import bootstrap_preprocessing_import

_parser_for_early_path = argparse.ArgumentParser(add_help=False)
_parser_for_early_path.add_argument("--preprocessing-path", type=Path, default=None)
_early_args, _ = _parser_for_early_path.parse_known_args()
bootstrap_preprocessing_import(_early_args.preprocessing_path)

import numpy as np  # noqa: E402
import torch  # noqa: E402
from PIL import Image  # noqa: E402

from preprocessing.preprocessing.grayscale import to_grayscale  # noqa: E402
from preprocessing.preprocessing.resize import resize_with_padding  # noqa: E402

from training.ensemble import load_model_from_checkpoint  # noqa: E402
from training.utils import resolve_device  # noqa: E402


def parse_args(argv=None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="main_predict",
        description="Prédit la classe d'une image via un ou plusieurs modèles (soft voting).",
    )
    parser.add_argument("--image", required=True, type=Path)
    parser.add_argument("--checkpoints", required=True, type=Path, nargs="+")
    parser.add_argument("--preprocessing-path", type=Path, default=None)
    parser.add_argument("--hidden-dims", type=int, nargs="+", default=[512, 128, 32])
    parser.add_argument("--dropout", type=float, default=0.2)
    parser.add_argument("--device", default="auto", choices=["auto", "cpu", "cuda"])
    parser.add_argument("--output", type=Path, default=None, help="Chemin JSON optionnel pour sauvegarder le résultat.")
    return parser.parse_args(argv)


def preprocess_for_model(image_path: Path, target_size, mean, std) -> torch.Tensor:
    """Reproduit le prétraitement déterministe (grayscale + resize+padding)
    puis la normalisation, à la taille native attendue par un modèle donné."""
    with Image.open(image_path) as img:
        array = np.array(img.convert("RGB"))

    gray = to_grayscale(array)
    resized = resize_with_padding(gray, tuple(target_size))

    rgb = np.stack([resized] * 3, axis=-1).astype(np.float32) / 255.0
    mean_arr = np.array(mean, dtype=np.float32).reshape(1, 1, 3)
    std_arr = np.array(std, dtype=np.float32).reshape(1, 1, 3)
    normalized = (rgb - mean_arr) / std_arr

    return torch.from_numpy(normalized).permute(2, 0, 1).unsqueeze(0).float()


from dataclasses import dataclass


@dataclass
class LoadedRadiographyModel:
    architecture: str
    model: "torch.nn.Module"
    class_to_idx: dict
    input_size: tuple
    normalization_mean: tuple
    normalization_std: tuple


def load_radiography_models(
    checkpoints: List[Path],
    hidden_dims: Tuple[int, ...] = (512, 128, 32),
    dropout: float = 0.2,
    device_config: str = "auto",
) -> List[LoadedRadiographyModel]:
    device = resolve_device(device_config)
    loaded: List[LoadedRadiographyModel] = []
    reference_class_to_idx = None

    for ckpt in checkpoints:
        model, payload = load_model_from_checkpoint(ckpt, hidden_dims, dropout, device)
        class_to_idx = payload["class_to_idx"]
        if reference_class_to_idx is None:
            reference_class_to_idx = class_to_idx
        elif class_to_idx != reference_class_to_idx:
            raise ValueError(
                f"'{ckpt}' a un mapping de classes différent des checkpoints précédents "
                f"({class_to_idx} != {reference_class_to_idx})."
            )
        loaded.append(LoadedRadiographyModel(
            architecture=payload["architecture"], model=model, class_to_idx=class_to_idx,
            input_size=tuple(payload["input_size"]), normalization_mean=payload["normalization_mean"],
            normalization_std=payload["normalization_std"],
        ))
    return loaded


def predict_with_loaded_models(
    image_path: Path, loaded_models: List[LoadedRadiographyModel], device: "torch.device"
) -> dict:
    per_model_results = []
    all_probs = []
    reference_class_to_idx = loaded_models[0].class_to_idx

    for lm in loaded_models:
        tensor = preprocess_for_model(image_path, lm.input_size, lm.normalization_mean, lm.normalization_std).to(device)
        with torch.no_grad():
            probs = torch.softmax(lm.model(tensor), dim=1).cpu().numpy()[0]

        idx_to_class = {v: k for k, v in lm.class_to_idx.items()}
        pred_idx = int(probs.argmax())
        per_model_results.append({
            "architecture": lm.architecture,
            "predicted_class": idx_to_class[pred_idx],
            "probabilities": {idx_to_class[i]: float(p) for i, p in enumerate(probs)},
        })
        all_probs.append(probs)

    ensemble_probs = np.mean(all_probs, axis=0)
    idx_to_class = {v: k for k, v in reference_class_to_idx.items()}
    ensemble_pred_idx = int(ensemble_probs.argmax())

    return {
        "image": str(image_path),
        "num_models": len(loaded_models),
        "per_model": per_model_results,
        "ensemble_prediction": idx_to_class[ensemble_pred_idx],
        "ensemble_probabilities": {idx_to_class[i]: float(p) for i, p in enumerate(ensemble_probs)},
    }


def run_ensemble_prediction(
    image_path: Path,
    checkpoints: List[Path],
    hidden_dims: Tuple[int, ...] = (512, 128, 32),
    dropout: float = 0.2,
    device_config: str = "auto",
) -> dict:
    device = resolve_device(device_config)
    loaded_models = load_radiography_models(checkpoints, hidden_dims, dropout, device_config)
    return predict_with_loaded_models(image_path, loaded_models, device)


def main(argv=None) -> int:
    args = parse_args(argv)

    if not args.image.exists():
        print(f"Erreur : image '{args.image}' introuvable.", file=sys.stderr)
        return 1
    for ckpt in args.checkpoints:
        if not ckpt.exists():
            print(f"Erreur : checkpoint '{ckpt}' introuvable.", file=sys.stderr)
            return 1

    try:
        result = run_ensemble_prediction(
            args.image, args.checkpoints, tuple(args.hidden_dims), args.dropout, args.device
        )
    except Exception as exc:  # noqa: BLE001
        print(f"Erreur lors de la prédiction : {exc}", file=sys.stderr)
        return 1

    print("=" * 60)
    print(f" Prédiction — {args.image.name}")
    print("=" * 60)
    for r in result["per_model"]:
        probs_str = ", ".join(f"{k}={v:.3f}" for k, v in r["probabilities"].items())
        print(f"{r['architecture']:20s} -> {r['predicted_class']:15s} ({probs_str})")
    if result["num_models"] > 1:
        print("-" * 60)
        probs_str = ", ".join(f"{k}={v:.3f}" for k, v in result["ensemble_probabilities"].items())
        print(f"{'ENSEMBLE (soft voting)':20s} -> {result['ensemble_prediction']:15s} ({probs_str})")
    print("=" * 60)

    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"Résultat sauvegardé : {args.output}")

    return 0


if __name__ == "__main__":
    sys.exit(main())