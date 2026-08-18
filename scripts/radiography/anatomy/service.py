"""Service d'analyse anatomique : point d'entrée unique de la branche.

``analyze_anatomy()`` orchestre segmentation + mesures + artefacts et
retourne un ``AnatomyResult`` sérialisable. Ne lève jamais : les
erreurs (CXAS indisponible, image invalide, ...) sont portées dans le
résultat (``status="error"``) pour un usage CLI comme API.
"""

from __future__ import annotations

import base64
import io
import json
import logging
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

from . import config
from .cxas_engine import CxasUnavailableError, get_cxas
from .measurements import extract_measurements
from .segmentation import SegmentationData, _resize_mask, segment
from .visualization import montage, official_colors, overlay, overlay_data_url

logger = logging.getLogger("anatomy.service")


@dataclass(slots=True)
class AnatomyResult:
    image: str
    status: str = "ok"  # "ok" | "error"
    error: str | None = None
    model_name: str = config.CXAS_MODEL_NAME
    device: str = config.CXAS_DEVICE
    inference_time_ms: float | None = None
    segmentation: dict[str, Any] = field(default_factory=dict)
    measurements: dict[str, Any] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)
    saved: dict[str, str] = field(default_factory=dict)  # artefact -> chemin

    def as_dict(self) -> dict[str, Any]:
        return {
            "image": self.image,
            "status": self.status,
            "error": self.error,
            "model_name": self.model_name,
            "device": self.device,
            "inference_time_ms": self.inference_time_ms,
            "segmentation": self.segmentation,
            "measurements": self.measurements,
            "warnings": self.warnings,
            "saved": self.saved,
        }


def _segmentation_summary(data: SegmentationData, mask_max_side: int | None) -> dict:
    """Résumé structuré : labels, aires, masques (bornés si demandé)."""
    masks = data.masks
    downscaled = False
    if mask_max_side and max(data.file_size) > mask_max_side:
        scale = mask_max_side / max(data.file_size)
        new_size = (
            max(1, round(data.file_size[0] * scale)),
            max(1, round(data.file_size[1] * scale)),
        )
        masks = {k: _resize_mask(m, new_size) for k, m in data.masks.items()}
        downscaled = True

    return {
        "labels": data.labels,
        "label_ids_available": sorted(masks.keys()),
        "file_size": list(data.file_size),
        "mask_shape": list(next(iter(masks.values())).shape) if masks else [],
        "areas_px": data.areas_by_name(config.KEY_LABELS),
        "masks": {str(k): v.tolist() for k, v in masks.items()},
        "mask_downscaled": downscaled,
    }


def _save_artefacts(
    image_path: Path,
    data: SegmentationData,
    result: AnatomyResult,
    output_dir: Path,
    colors: list | None,
    with_montage: bool,
) -> dict[str, str]:
    """Écrit masques PNG, overlays, montage et results.json."""
    saved: dict[str, str] = {}
    dirs = {
        name: output_dir / f"{image_path.stem}_{name}"
        for name in ("images", "masks", "overlays", "measurements")
    }
    for d in dirs.values():
        d.mkdir(parents=True, exist_ok=True)

    for idx, mask in data.masks.items():
        Image.fromarray(mask.astype(np.uint8) * 255, mode="L").save(
            dirs["masks"] / f"{data.labels[idx].replace(' ', '_')}.png"
        )

    over = dirs["overlays"] / "overlay.png"
    overlay(
        image_path, data.masks, over,
        labels=data.labels, key_labels=config.KEY_LABELS, colors=colors,
    )
    saved["overlay"] = str(over)

    if with_montage:
        trip = dirs["overlays"] / "montage.png"
        montage(
            image_path, data.masks, trip,
            labels=data.labels, key_labels=config.KEY_LABELS, colors=colors,
        )
        saved["montage"] = str(trip)

    Image.open(image_path).convert("RGB").save(dirs["images"] / "original.png")
    saved["image"] = str(dirs["images"] / "original.png")

    with (dirs["measurements"] / "results.json").open("w", encoding="utf-8") as fh:
        json.dump(result.as_dict(), fh, indent=2, ensure_ascii=False)
    return saved


def _masks_to_data_urls(masks: dict[str, list]) -> dict[str, str]:
    """Encodage PNG des masques (data URL) pour l'affichage web (API)."""
    out = {}
    for name, m in masks.items():
        buf = io.BytesIO()
        Image.fromarray(np.asarray(m, dtype=bool).astype(np.uint8) * 255, "L").save(
            buf, "PNG"
        )
        out[name] = (
            "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()
        )
    return out


def analyze_anatomy(
    image_path: str | Path,
    features: tuple[str, ...] = config.DEFAULT_FEATURES,
    pixel_spacing_mm: tuple[float, float] | None = None,
    save_outputs: bool = False,
    output_dir: Path | None = None,
    with_montage: bool = True,
    mask_max_side: int | None = config.MASK_MAX_SIDE,
) -> AnatomyResult:
    """Analyse anatomique complète d'une radiographie.

    ``features``        : sous-ensemble de (CTR, SCD, area, perimeter,
        compactness, centroid, box, convexity, radiomics).
    ``pixel_spacing_mm``: (row, col) du DICOM source pour la conversion
        SCD en mm (JPG : None).
    ``save_outputs``    : écrit masques/overlays/montages/results.json
        dans ``output_dir`` (défaut: ``outputs/cxas/<image>/``).
    ``mask_max_side``   : borne les masques du résultat structuré
        (les fichiers disque restent en pleine résolution).
    """
    image_path = Path(image_path)
    result = AnatomyResult(image=str(image_path))

    try:
        t0 = time.perf_counter()

        # 1. Segmentation (charge CXAS au premier appel, poids inclus).
        data: SegmentationData = segment(image_path)

        if not data.masks:
            result.status = "error"
            result.error = "aucune structure anatomique détectée"
            return result

        # 2. Mesures (extracteur officiel CXAS, grille 512x512).
        engine = get_cxas()
        meas = extract_measurements(
            engine, data.preds_512, data.file_size, features, pixel_spacing_mm
        )

        result.inference_time_ms = round((time.perf_counter() - t0) * 1000, 1)
        result.measurements = meas.values
        result.warnings = list(meas.warnings)

        # 3. Résumé de segmentation (masques éventuellement réduits) +
        #    overlay composite officiel (PNG, plein résolution, sans légende).
        summary = _segmentation_summary(data, mask_max_side)
        result.segmentation = {
            "labels": summary["labels"],
            "label_ids_available": summary["label_ids_available"],
            "file_size": summary["file_size"],
            "mask_shape": summary["mask_shape"],
            "areas_px": summary["areas_px"],
            "mask_downscaled": summary["mask_downscaled"],
            "masks_b64_png": _masks_to_data_urls(summary["masks"]),
            "overlay_png": overlay_data_url(
                image_path,
                data.masks,
                config.KEY_LABELS,
                official_colors(engine),
            ),
        }

        # 4. Artefacts (masques/overlays/montages) si demandé.
        if save_outputs:
            out_dir = output_dir or config.OUTPUT_ROOT / image_path.stem
            result.saved = _save_artefacts(
                image_path, data, result, out_dir,
                official_colors(engine), with_montage,
            )

        available = {
            k: v.get("value", v.get("value_px_512"))
            for k, v in meas.values.items() if v.get("available")
        }
        logger.info(
            "Analyse %s en %.1f ms : %s",
            image_path.name, result.inference_time_ms, available,
        )
        return result

    except CxasUnavailableError as exc:
        result.status = "error"
        result.error = str(exc)
        return result
    except Exception as exc:
        logger.exception("Analyse %s en échec", image_path)
        result.status = "error"
        result.error = f"{type(exc).__name__}: {exc}"
        return result