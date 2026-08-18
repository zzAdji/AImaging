"""Segmentation anatomique paresseuse : exécution du pipeline CXAS et
conversion des prédictions (512x512) vers la résolution de l'image
d'origine.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from . import config
from .cxas_engine import get_cxas, path_to_native_input

logger = logging.getLogger("anatomy.segmentation")


@dataclass(slots=True)
class SegmentationData:
    """Résultat de segmentation.

    ``preds_512`` : masque bool complet (159, 512, 512), indexé par
    label — c'est l'entrée attendue par ``Extractor.extract``.
    ``masks_512`` : masques bool (512, 512) des structures détectées.
    ``masks`` : masques re-dimensionnés à la taille de l'image
    d'origine (voisin le plus proche, valeurs 0/1).
    """

    labels: dict[int, str]  # id -> nom
    file_size: tuple[int, int]  # (h, w) de l'image d'origine
    preds_512: np.ndarray = field(default_factory=lambda: np.empty((0, 0), bool))
    masks_512: dict[int, np.ndarray] = field(default_factory=dict)
    masks: dict[int, np.ndarray] = field(default_factory=dict)
    areas: dict[int, int] = field(default_factory=dict)

    def areas_by_name(self, key_labels: dict[int, str] | None = None) -> dict[str, int]:
        subset = {k: self.areas.get(k, 0) for k in (key_labels or self.areas)}
        return {self.labels.get(k, f"label-{k}"): v for k, v in subset.items()}


def _resize_mask(mask: np.ndarray, size: tuple[int, int]) -> np.ndarray:
    """Redimensionne un masque bool en (h, w) par voisin le plus proche.

    Équivalent de ``cxas.segmentor.resize_to_numpy`` (F.interpolate
    mode "nearest") mais sans torch : les masques sont déjà binarisés.
    """
    h, w = size
    if mask.shape == (h, w):
        return mask
    import cv2

    return cv2.resize(
        mask.astype(np.uint8), (w, h), interpolation=cv2.INTER_NEAREST
    ).astype(bool)


def segment(image_path: str | Path) -> SegmentationData:
    """Segmente une image (jpg/png/jpeg/dcm) et retourne les masques.

    Effectue potentiellement le téléchargement des poids au premier
    appel (gdown, voir config.CXAS_PATH). Ne lève des exceptions que
    pour des erreurs réelles : une CXAS indisponible produit une
    ``CxasUnavailableError`` documentée.
    """
    path, temp_created = path_to_native_input(Path(image_path))
    try:
        engine = get_cxas()

        # process_file retourne des dictionnaires de listes (une entrée
        # par image traitée). Prédictions déjà binarisées en 512x512.
        # (API wheel 0.0.18 : process_file est sur l'instance CXAS elle-même,
        # et output_directory est asserté -> toujours passer existant.)
        predictions = engine.process_file(
            str(path),
            do_store=False,
            output_directory=str(Path.cwd()),
            return_file=True,
        )
        preds_512 = np.asarray(predictions["segmentation_preds"][0], dtype=bool)
        file_size = tuple(predictions["file_size"][0])
        if preds_512.ndim == 3 and preds_512.shape[0] == 1:
            preds_512 = preds_512[0]

        from cxas import label_mapper  # constantes module (clés str)

        labels = {int(k): v for k, v in label_mapper.id2label_dict.items()}
        if len(labels) != preds_512.shape[0]:
            logger.warning(
                "%d labels attendus mais %d masques prédits",
                len(labels),
                preds_512.shape[0],
            )

        masks, masks_512, areas = {}, {}, {}
        for idx, name in labels.items():
            m512 = preds_512[idx]
            if not m512.any():
                continue
            masks_512[idx] = m512
            m = _resize_mask(m512, file_size)
            masks[idx] = m
            areas[idx] = int(m.sum())

        logger.info(
            "Segmentation OK : %d/%d structures détectées, image %dx%d",
            len(masks),
            len(labels),
            file_size[1],
            file_size[0],
        )
        return SegmentationData(
            labels=labels, file_size=file_size, preds_512=preds_512,
            masks_512=masks_512, masks=masks, areas=areas,
        )
    finally:
        if temp_created:
            try:
                Path(path).unlink(missing_ok=True)  # .png temporaire
            except OSError:
                pass


def label_names(labels: dict[int, str], ids: list[int]) -> list[str]:
    """Noms lisibles des labels demandés (-1 => absent)."""
    return [labels.get(i, f"label-{i}") if i >= 0 else "absent" for i in ids]