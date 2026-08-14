"""Grad-CAM d'inférence pour l'ensemble de radiographie chargé par le serveur."""

from __future__ import annotations

import base64
from dataclasses import dataclass
from datetime import UTC, datetime
from io import BytesIO
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from PIL import Image

from main_predict import LoadedRadiographyModel, predict_with_loaded_models, preprocess_for_model
from training.gradcam import GradCAM, get_default_target_layer


@dataclass(frozen=True)
class EnsembleGradcamResult:
    class_name: str
    model_count: int
    heatmap_data_url: str
    peak_region: dict[str, float] | None
    generated_at: str
    per_model: list[dict[str, Any]]


def _encode_heatmap_values(cam: np.ndarray) -> str:
    """Encode la carte normalisée (valeurs brutes 0..255, canaux R=G=B) en PNG.

    Le colormap et le seuillage d'intensité sont appliqués côté client (canvas) :
    le client peut ainsi re-colorer en nuances de bleu uniformes et révéler les
    zones de façon progressive (seuil = 100 - intensité) sans refetch serveur.
    """
    values = np.uint8(np.clip(cam, 0, 1) * 255)
    rgba = np.dstack((values, values, values, np.full_like(values, 255)))
    output = BytesIO()
    Image.fromarray(rgba, mode="RGBA").save(output, format="PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(output.getvalue()).decode("ascii")


def _find_peak_region(cam: np.ndarray) -> dict[str, float] | None:
    """Retourne la composante d'activation dominante, en pixels image.

    Cette zone explique la contribution du réseau ; elle ne constitue pas une
    détection clinique ni une segmentation anatomique.
    """
    if cam.size == 0 or float(cam.max()) <= 0:
        return None
    mask = np.uint8(cam >= max(0.55, float(cam.max()) * 0.70))
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    if count <= 1:
        return None
    best_label = max(
        range(1, count),
        key=lambda label: float(cam[labels == label].sum()),
    )
    x, y, width, height, _area = stats[best_label]
    return {"x": float(x), "y": float(y), "w": float(width), "h": float(height)}


def _resolve_class_name(requested_class: str, class_to_idx: dict[str, int]) -> str:
    """Returns the canonical checkpoint label while accepting case variations."""
    normalized = requested_class.strip()
    if normalized in class_to_idx:
        return normalized
    matches = [name for name in class_to_idx if name.casefold() == normalized.casefold()]
    if len(matches) == 1:
        return matches[0]
    available = ", ".join(sorted(class_to_idx))
    raise ValueError(
        f"Classe Grad-CAM inconnue '{requested_class}'. Classes disponibles : {available}."
    )


def _project_cam_to_source(
    cam: np.ndarray,
    *,
    source_width: int,
    source_height: int,
    input_size: tuple[int, int],
) -> np.ndarray:
    """Replace the letterbox padding with the original image geometry.

    ``preprocess_for_model`` uses ``resize_with_padding``.  A direct resize
    of a Grad-CAM map from the feature layer to the source image would stretch
    the padded bands over the anatomy.  Reproduce the exact resize/padding
    arithmetic, crop those bands, then resize only the effective image area.
    """
    target_height, target_width = (int(input_size[0]), int(input_size[1]))
    if min(source_width, source_height, target_width, target_height) <= 0:
        raise ValueError("Dimensions d'image invalides pour projeter la Grad-CAM.")

    cam_at_input = cv2.resize(cam, (target_width, target_height), interpolation=cv2.INTER_LINEAR)
    scale = min(target_height / source_height, target_width / source_width)
    content_height = max(1, round(source_height * scale))
    content_width = max(1, round(source_width * scale))
    top = (target_height - content_height) // 2
    left = (target_width - content_width) // 2
    content_cam = cam_at_input[top : top + content_height, left : left + content_width]

    # Guard against malformed metadata or an unexpected preprocessing change.
    if content_cam.size == 0:
        content_cam = cam_at_input
    return cv2.resize(content_cam, (source_width, source_height), interpolation=cv2.INTER_LINEAR)


def generate_ensemble_gradcam(
    image_path: Path,
    loaded_models: list[LoadedRadiographyModel],
    device: object,
    class_name: str | None = None,
) -> EnsembleGradcamResult:
    """Calcule une Grad-CAM moyenne de l'ensemble dans la géométrie source."""
    if not loaded_models:
        raise ValueError("Aucun modèle radiographique chargé.")

    reference_classes = loaded_models[0].class_to_idx
    if class_name is None:
        prediction = predict_with_loaded_models(image_path, loaded_models, device)
        class_name = prediction["ensemble_prediction"]
    else:
        class_name = _resolve_class_name(class_name, reference_classes)

    with Image.open(image_path) as source_image:
        source_rgb = np.asarray(source_image.convert("RGB"))
    source_height, source_width = source_rgb.shape[:2]

    resized_cams: list[np.ndarray] = []
    per_model: list[dict[str, Any]] = []
    for loaded in loaded_models:
        class_index = loaded.class_to_idx.get(class_name)
        if class_index is None:
            raise ValueError(f"La classe '{class_name}' n'est pas disponible dans {loaded.architecture}.")
        tensor = preprocess_for_model(
            image_path,
            loaded.input_size,
            loaded.normalization_mean,
            loaded.normalization_std,
        ).to(device)
        cam_tool = GradCAM(loaded.model, get_default_target_layer(loaded.model, loaded.architecture))
        try:
            cam, used_class_index = cam_tool.generate(tensor, int(class_index))
        finally:
            cam_tool.remove_hooks()
        source_cam = _project_cam_to_source(
            cam,
            source_width=source_width,
            source_height=source_height,
            input_size=tuple(loaded.input_size),
        )
        resized_cams.append(source_cam.astype(np.float32))
        per_model.append({
            "architecture": loaded.architecture,
            "class_name": class_name,
            "class_index": int(used_class_index),
        })

    ensemble_cam = np.mean(np.stack(resized_cams, axis=0), axis=0)
    min_value, max_value = float(ensemble_cam.min()), float(ensemble_cam.max())
    if max_value > min_value:
        ensemble_cam = (ensemble_cam - min_value) / (max_value - min_value)
    else:
        ensemble_cam = np.zeros_like(ensemble_cam)

    return EnsembleGradcamResult(
        class_name=class_name,
        model_count=len(loaded_models),
        heatmap_data_url=_encode_heatmap_values(ensemble_cam),
        peak_region=_find_peak_region(ensemble_cam),
        generated_at=datetime.now(UTC).isoformat(),
        per_model=per_model,
    )
