"""Visualisation des résultats de segmentation (validée sur images
réelles : triés, overlays, montages). Tout en PIL/numpy, aucun besoin
de CXAS pour ces fonctions.
"""

from __future__ import annotations

import base64
import io
import logging
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

logger = logging.getLogger("anatomy.visualization")

# Palette de repli (RGBA 0..255) si les couleurs officielles cxas ne
# sont pas disponibles (overlay hors contexte moteur CXAS).
_FALLBACK_COLORS = [
    (230, 25, 75, 255), (60, 180, 75, 255), (0, 130, 200, 255),
    (245, 130, 48, 255), (250, 190, 190, 255), (170, 110, 40, 255),
    (240, 50, 230, 255), (145, 30, 180, 255), (128, 128, 0, 255),
]

_ALPHA_FILL = 130


def official_colors(engine) -> list[tuple[int, int, int, int]] | None:
    """Couleurs officielles cxas (label_mapper.colors, RGBA 0..1)."""
    try:
        from cxas.label_mapper import colors as cxas_colors

        return [tuple(round(c * 255) for c in color) for color in cxas_colors]
    except (AttributeError, TypeError, ImportError):
        return None


def _to_rgb(image_path: Path) -> Image.Image:
    return Image.open(image_path).convert("L").convert("RGB")


def _composite_mask(masks: dict[int, np.ndarray]) -> np.ndarray:
    """Union booléenne de tous les masques (itératif, mémoire bornée)."""
    acc = None
    for mask in masks.values():
        acc = mask if acc is None else np.logical_or(acc, mask)
    return acc if acc is not None else np.zeros((1, 1), dtype=bool)


def _compose_overlay(
    base: Image.Image,
    masks: dict[int, np.ndarray],
    ids: list[int],
    palette: list,
    official: bool,
) -> Image.Image:
    """Compose l'overlay coloré (polygones, alpha _ALPHA_FILL) sur l'image."""
    overlay_img = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay_img, "RGBA")
    for i, idx in enumerate(ids):
        mask = masks.get(idx)
        if mask is None:
            continue
        color = palette[idx % len(palette)] if official else palette[i % len(palette)]
        draw.polygon(_mask_to_polygon(mask), fill=(*color[:3], _ALPHA_FILL))
    return Image.alpha_composite(base.convert("RGBA"), overlay_img).convert("RGB")


def overlay(
    image_path: Path,
    masks: dict[int, np.ndarray],
    out_path: Path,
    labels: dict[int, str] | None = None,
    key_labels: dict[int, str] | None = None,
    colors: list | None = None,
) -> Path:
    """Shading coloré des structures sur l'image d'origine.

    ``key_labels`` : ids prioritaires (sinon toutes les structures).
    ``colors`` : palette RGBA officielle cxas si fournie.
    """
    base = _to_rgb(image_path)
    ids = list((key_labels or masks).keys())
    palette = colors or _FALLBACK_COLORS

    composite = _compose_overlay(base, masks, ids, palette, colors is not None)

    if labels is not None:
        legend = _legend(labels, ids, palette, colors is not None)
        canvas = Image.new(
            "RGB",
            (max(composite.width, legend.width), composite.height + legend.height),
            "black",
        )
        canvas.paste(composite, (0, 0))
        canvas.paste(legend.convert("RGB"), (0, composite.height))
        composite = canvas

    out_path.parent.mkdir(parents=True, exist_ok=True)
    composite.save(out_path)
    return out_path


def overlay_data_url(
    image_path: Path,
    masks: dict[int, np.ndarray],
    key_labels: dict[int, str] | None = None,
    colors: list | None = None,
) -> str:
    """Overlay composite (sans légende) encodé en data URL PNG pour l'API."""
    base = _to_rgb(image_path)
    ids = list((key_labels or masks).keys())
    composite = _compose_overlay(base, masks, ids, colors or _FALLBACK_COLORS, bool(colors))
    buf = io.BytesIO()
    composite.save(buf, "PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def _mask_to_polygon(mask: np.ndarray, max_vertices: int = 400) -> list[tuple]:
    """Contour approximatif d'un masque bool -> polygone PIL."""
    ys, xs = np.nonzero(mask)
    if len(ys) == 0:
        return [(0, 0)]
    y0, y1 = int(ys.min()), int(ys.max())
    x0, x1 = int(xs.min()), int(xs.max())
    if (y1 - y0) < 3 or (x1 - x0) < 3:
        return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    step = max(1, (y1 - y0) // max_vertices)
    pts = []
    for y in range(y0, y1 + 1, step):
        row = np.nonzero(mask[y])[0]
        if len(row):
            pts.append((int(row.min()), y))
            pts.append((int(row.max()), y))
    if len(pts) < 3:
        return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    return pts


def _legend(labels: dict, ids: list, palette: list, official: bool) -> Image.Image:
    n = len(ids)
    line_h, pad = 20, 6
    w = max(80, max(len(labels.get(i, str(i))) for i in ids) * 8 + 50)
    img = Image.new("RGBA", (w, n * line_h + pad), (0, 0, 0, 255))
    draw = ImageDraw.Draw(img)
    for row, i in enumerate(ids):
        color = palette[i % len(palette)] if official else palette[row % len(palette)]
        y = pad + row * line_h
        draw.rectangle((8, y + 4, 28, y + 16), fill=color)
        draw.text((34, y + 2), labels.get(i, str(i)), fill=(230, 230, 230))
    return img


def montage(
    image_path: Path,
    masks: dict[int, np.ndarray],
    out_path: Path,
    labels: dict[int, str] | None = None,
    key_labels: dict[int, str] | None = None,
    colors: list | None = None,
) -> Path:
    """Triptyque ORIGINAL | MASQUES | OVERLAY pour la validation visuelle."""
    base = _to_rgb(image_path)
    ids = list((key_labels or masks).keys())

    union = _composite_mask(masks)
    mask_img = (
        Image.fromarray((union.astype(np.uint8) * 255), mode="L")
        .resize(base.size, Image.NEAREST)
        .convert("RGB")
    )

    overlay_file = overlay(image_path, masks, out_path, labels=None,
                           key_labels=key_labels, colors=colors)
    overlay_img = Image.open(overlay_file).convert("RGB")

    band = 4
    total_w = base.width * 3 + band * 2
    up = max(base.height, mask_img.height, overlay_img.height)
    canvas = Image.new("RGB", (total_w, up), (128, 128, 128))
    canvas.paste(base, (0, (up - base.height) // 2))
    canvas.paste(mask_img, (base.width + band, (up - mask_img.height) // 2))
    canvas.paste(overlay_img, (2 * (base.width + band), (up - overlay_img.height) // 2))
    out_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out_path)
    return out_path