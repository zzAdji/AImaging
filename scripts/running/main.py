#!/usr/bin/env python3
"""
Inference terrain sur images externes au dataset.

- Prend un dossier d'images ou un manifest CSV.
- Charge 1 ou plusieurs checkpoints.
- Applique le bon resize / normalisation par modèle.
- Fait une prédiction simple ou un soft voting d'ensemble.
- Sauvegarde un CSV de résultats.
- Optionnel : calcule accuracy/f1 si les labels sont fournis.

Exemples :
  Single model:
    python main_infer.py \
      --image-dir /data/nouvelles_images \
      --checkpoint ./training_results/best.pt \
      --output ./infer_out/predictions.csv

  Ensemble:
    python main_infer.py \
      --image-dir /data/nouvelles_images \
      --checkpoints ./m1.pt ./m2.pt ./m3.pt ./m4.pt ./m5.pt \
      --output ./infer_out/predictions.csv

  Avec labels pour évaluation:
    python main_infer.py \
      --manifest ./new_data.csv \
      --checkpoints ./m1.pt ./m2.pt \
      --output ./infer_out/predictions.csv \
      --label-col label
"""

from __future__ import annotations

import argparse
import csv
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np
import pandas as pd
import torch
import torch.nn.functional as F
from PIL import Image
from sklearn.metrics import accuracy_score, classification_report, f1_score
from torch.utils.data import DataLoader, Dataset
from torchvision import transforms as T
from tqdm import tqdm

from training.model_builder import build_model
from training.utils import load_checkpoint, resolve_device, setup_logging

logger = logging.getLogger("inference.terrain")

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff", ".webp"}


def _as_size(x) -> Tuple[int, int]:
    if isinstance(x, (list, tuple)) and len(x) == 2:
        return int(x[0]), int(x[1])
    if isinstance(x, int):
        return int(x), int(x)
    raise ValueError(f"input_size invalide: {x}")


def build_inference_transform(input_size: Tuple[int, int], mean: Sequence[float], std: Sequence[float]):
    return T.Compose([
        T.Resize(input_size),
        T.ToTensor(),
        T.Normalize(mean=tuple(mean), std=tuple(std)),
    ])


class InferenceDataset(Dataset):
    def __init__(
        self,
        items: List[Tuple[str, Optional[int]]],
        transform=None,
    ):
        self.items = items
        self.transform = transform

    def __len__(self) -> int:
        return len(self.items)

    def __getitem__(self, idx: int):
        path_str, label = self.items[idx]
        path = Path(path_str)

        img = Image.open(path).convert("RGB")
        if self.transform is not None:
            img = self.transform(img)

        if label is None:
            return img, path_str
        return img, label, path_str


def collate_no_labels(batch):
    images, paths = zip(*batch)
    return torch.stack(images, dim=0), list(paths)


def collate_with_labels(batch):
    images, labels, paths = zip(*batch)
    return torch.stack(images, dim=0), torch.tensor(labels, dtype=torch.long), list(paths)


def collect_image_paths(image_dir: Path) -> List[str]:
    paths = []
    for p in sorted(image_dir.rglob("*")):
        if p.is_file() and p.suffix.lower() in IMAGE_EXTS:
            paths.append(str(p))
    return paths


def read_manifest_csv(manifest: Path, path_col: str, label_col: Optional[str]) -> List[Tuple[str, Optional[int]]]:
    df = pd.read_csv(manifest)
    if path_col not in df.columns:
        raise ValueError(f"Colonne '{path_col}' introuvable dans {manifest}")

    items: List[Tuple[str, Optional[int]]] = []
    for _, row in df.iterrows():
        path = str(row[path_col])
        label = None
        if label_col and label_col in df.columns and pd.notna(row[label_col]):
            label = int(row[label_col])
        items.append((path, label))
    return items


def load_model_from_checkpoint(
    checkpoint_path: Path,
    hidden_dims: Tuple[int, ...],
    dropout: float,
    device: torch.device,
):
    payload = load_checkpoint(checkpoint_path)

    model = build_model(
        architecture=payload["architecture"],
        pretrained=False,
        num_classes=len(payload["class_to_idx"]),
        hidden_dims=hidden_dims,
        dropout=dropout,
        freeze_backbone=False,
    )
    model.load_state_dict(payload["model_state_dict"])
    model = model.to(device)
    model.eval()

    input_size = _as_size(payload["input_size"])
    mean = payload.get("normalization_mean", (0.485, 0.456, 0.406))
    std = payload.get("normalization_std", (0.229, 0.224, 0.225))

    return model, payload["class_to_idx"], input_size, mean, std, payload["architecture"]


@torch.no_grad()
def predict_one_model(
    checkpoint_path: Path,
    items: List[Tuple[str, Optional[int]]],
    device: torch.device,
    batch_size: int,
    num_workers: int,
    hidden_dims: Tuple[int, ...],
    dropout: float,
):
    model, class_to_idx, input_size, mean, std, architecture = load_model_from_checkpoint(
        checkpoint_path, hidden_dims, dropout, device
    )
    transform = build_inference_transform(input_size, mean, std)

    dataset = InferenceDataset(items, transform=transform)
    has_labels = any(label is not None for _, label in items)

    if has_labels:
        loader = DataLoader(
            dataset,
            batch_size=batch_size,
            shuffle=False,
            num_workers=num_workers,
            pin_memory=(device.type == "cuda"),
            collate_fn=collate_with_labels,
        )
    else:
        loader = DataLoader(
            dataset,
            batch_size=batch_size,
            shuffle=False,
            num_workers=num_workers,
            pin_memory=(device.type == "cuda"),
            collate_fn=collate_no_labels,
        )

    all_paths: List[str] = []
    all_probs: List[np.ndarray] = []
    all_preds: List[np.ndarray] = []
    all_true: List[np.ndarray] = []

    for batch in tqdm(loader, desc=f"Inference {architecture}", leave=False):
        if has_labels:
            images, labels, paths = batch
            all_true.append(labels.numpy())
        else:
            images, paths = batch

        images = images.to(device)
        logits = model(images)
        probs = torch.softmax(logits, dim=1).cpu().numpy()
        preds = probs.argmax(axis=1)

        all_paths.extend(paths)
        all_probs.append(probs)
        all_preds.append(preds)

    probs = np.concatenate(all_probs, axis=0)
    preds = np.concatenate(all_preds, axis=0)
    y_true = np.concatenate(all_true, axis=0) if has_labels else None

    idx_to_class = {v: k for k, v in class_to_idx.items()}
    class_names = [idx_to_class[i] for i in range(len(idx_to_class))]

    return {
        "architecture": architecture,
        "class_names": class_names,
        "class_to_idx": class_to_idx,
        "paths": all_paths,
        "y_true": y_true,
        "y_pred": preds,
        "y_proba": probs,
        "input_size": input_size,
    }


def predict_ensemble(
    checkpoint_paths: List[Path],
    items: List[Tuple[str, Optional[int]]],
    device: torch.device,
    batch_size: int,
    num_workers: int,
    hidden_dims: Tuple[int, ...],
    dropout: float,
):
    model_outputs = []
    reference_class_to_idx = None
    reference_class_names = None
    reference_paths = None
    reference_y_true = None

    for ckpt in checkpoint_paths:
        out = predict_one_model(
            ckpt,
            items,
            device=device,
            batch_size=batch_size,
            num_workers=num_workers,
            hidden_dims=hidden_dims,
            dropout=dropout,
        )

        if reference_class_to_idx is None:
            reference_class_to_idx = out["class_to_idx"]
            reference_class_names = out["class_names"]
            reference_paths = out["paths"]
            reference_y_true = out["y_true"]
        else:
            if out["class_to_idx"] != reference_class_to_idx:
                raise ValueError(
                    f"Mapping de classes différent entre checkpoints. "
                    f"{ckpt.name} n'a pas le même class_to_idx que le premier checkpoint."
                )
            if out["paths"] != reference_paths:
                raise ValueError("Ordre des images différent entre checkpoints. Vérifie la construction du dataset.")

        model_outputs.append(out)

    probs_stack = np.stack([o["y_proba"] for o in model_outputs], axis=0)
    mean_probs = probs_stack.mean(axis=0)
    y_pred = mean_probs.argmax(axis=1)

    return {
        "class_names": reference_class_names,
        "class_to_idx": reference_class_to_idx,
        "paths": reference_paths,
        "y_true": reference_y_true,
        "y_pred": y_pred,
        "y_proba": mean_probs,
        "n_models": len(model_outputs),
    }


def save_predictions_csv(
    output_csv: Path,
    paths: List[str],
    y_pred: np.ndarray,
    y_proba: np.ndarray,
    class_names: List[str],
    y_true: Optional[np.ndarray] = None,
):
    rows = []
    pred_labels = [class_names[i] for i in y_pred]
    confidences = y_proba.max(axis=1)

    for i, path in enumerate(paths):
        row = {
            "filepath": path,
            "pred_idx": int(y_pred[i]),
            "pred_label": pred_labels[i],
            "confidence": float(confidences[i]),
        }
        if y_true is not None:
            row["true_idx"] = int(y_true[i])
            row["true_label"] = class_names[int(y_true[i])]
            row["correct"] = int(int(y_true[i]) == int(y_pred[i]))

        for j, cls in enumerate(class_names):
            row[f"proba_{cls}"] = float(y_proba[i, j])

        rows.append(row)

    df = pd.DataFrame(rows)
    df.to_csv(output_csv, index=False)
    return df


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Inference terrain sur images externes.")
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--image-dir", type=Path, help="Dossier contenant les images brutes.")
    source.add_argument("--manifest", type=Path, help="CSV contenant au minimum une colonne filepath.")

    parser.add_argument("--path-col", type=str, default="filepath", help="Colonne des chemins dans le manifest.")
    parser.add_argument("--label-col", type=str, default=None, help="Colonne des labels dans le manifest (optionnel).")

    parser.add_argument(
        "--checkpoint",
        type=Path,
        default=None,
        help="Chemin d'un checkpoint unique.",
    )
    parser.add_argument(
        "--checkpoints",
        type=Path,
        nargs="+",
        default=None,
        help="Un ou plusieurs checkpoints pour faire un ensemble.",
    )

    parser.add_argument("--output", type=Path, required=True, help="CSV de sortie des prédictions.")
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--workers", type=int, default=2)
    parser.add_argument("--device", default="auto", choices=["auto", "cpu", "cuda"])
    parser.add_argument("--hidden-dims", type=int, nargs="+", default=[512, 128, 32])
    parser.add_argument("--dropout", type=float, default=0.2)
    parser.add_argument("--log-file", type=Path, default=None)
    parser.add_argument("--verbose", action="store_true")

    args = parser.parse_args(argv)

    if args.checkpoint is None and args.checkpoints is None:
        parser.error("Fournis --checkpoint ou --checkpoints.")
    if args.checkpoint is not None and args.checkpoints is not None:
        parser.error("Utilise soit --checkpoint soit --checkpoints, pas les deux.")

    if args.checkpoint is not None:
        checkpoint_paths = [args.checkpoint]
    else:
        checkpoint_paths = list(args.checkpoints)

    for ckpt in checkpoint_paths:
        if not ckpt.exists():
            raise FileNotFoundError(f"Checkpoint introuvable: {ckpt}")

    if args.image_dir is not None:
        if not args.image_dir.exists():
            raise FileNotFoundError(f"Dossier introuvable: {args.image_dir}")
        paths = collect_image_paths(args.image_dir)
        items = [(p, None) for p in paths]
    else:
        if not args.manifest.exists():
            raise FileNotFoundError(f"Manifest introuvable: {args.manifest}")
        items = read_manifest_csv(args.manifest, args.path_col, args.label_col)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    setup_logging(args.log_file or args.output.with_suffix(".log"), level=logging.DEBUG if args.verbose else logging.INFO)

    device = resolve_device(args.device)

    print("=" * 70)
    print(f"Inference terrain | {len(checkpoint_paths)} checkpoint(s)")
    for ckpt in checkpoint_paths:
        print(f" - {ckpt}")
    print(f"Nombre d'images: {len(items)}")
    print("=" * 70)

    outputs = []
    for ckpt in checkpoint_paths:
        out = predict_one_model(
            ckpt,
            items=items,
            device=device,
            batch_size=args.batch_size,
            num_workers=args.workers,
            hidden_dims=tuple(args.hidden_dims),
            dropout=args.dropout,
        )
        outputs.append(out)

    if len(outputs) == 1:
        final_out = outputs[0]
        mode_name = final_out["architecture"]
    else:
        final_out = predict_ensemble(
            checkpoint_paths,
            items=items,
            device=device,
            batch_size=args.batch_size,
            num_workers=args.workers,
            hidden_dims=tuple(args.hidden_dims),
            dropout=args.dropout,
        )
        mode_name = f"ensemble_{len(checkpoint_paths)}"

    df = save_predictions_csv(
        args.output,
        paths=final_out["paths"],
        y_pred=final_out["y_pred"],
        y_proba=final_out["y_proba"],
        class_names=final_out["class_names"],
        y_true=final_out["y_true"],
    )

    print(f"Fichier de sortie: {args.output}")

    if final_out["y_true"] is not None:
        y_true = final_out["y_true"]
        y_pred = final_out["y_pred"]
        acc = accuracy_score(y_true, y_pred)
        f1_macro = f1_score(y_true, y_pred, average="macro")
        print("-" * 70)
        print(f"Métriques ({mode_name})")
        print(f"Accuracy : {acc:.4f}")
        print(f"F1 macro  : {f1_macro:.4f}")
        print("\nRapport de classification:")
        print(classification_report(y_true, y_pred, target_names=final_out["class_names"], digits=4))
        print("-" * 70)
    else:
        print("Aucun label fourni : prédictions générées sans métriques.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())