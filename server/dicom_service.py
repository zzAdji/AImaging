"""Lecture DICOM r\u00e9elle et rendu PNG s\u00fbr pour le workspace.

Les fichiers DICOM ne sont jamais transmis \u00e0 Gemini. Le serveur ne renvoie
que des pixels rendus et des m\u00e9tadonn\u00e9es minimales, sans identifiant patient
brut. Les coordonn\u00e9es du PNG sont celles des pixels DICOM originaux : elles
restent donc compatibles avec les annotations et les mesures calibr\u00e9es.
"""

from __future__ import annotations

import base64
import hashlib
import math
import os
import secrets
from dataclasses import dataclass
from io import BytesIO
from typing import Any

import numpy as np
from PIL import Image


MAX_DICOM_BYTES = 128 * 1024 * 1024
MAX_RENDERED_FRAMES = 64
MAX_FRAME_PIXELS = 20_000_000
# Au-delà, le buffer linéaire devient trop lourd pour le navigateur : le
# client retombe sur le fenêtrage CSS du rendu initial (comportement dégradé).
MAX_LINEAR_PIXELS = 12_000_000
_PSEUDONYM_KEY = os.environ.get("DICOM_PSEUDONYM_KEY") or secrets.token_hex(32)


class DicomImportError(ValueError):
    """Erreur lisible provoqu\u00e9e par un DICOM non exploitable par le viewer."""


@dataclass(frozen=True)
class DicomMetadata:
    modality: str | None
    study_instance_uid: str | None
    series_instance_uid: str | None
    sop_instance_uid: str | None
    frame_of_reference_uid: str | None
    patient_pseudonym: str | None
    pixel_spacing_mm: tuple[float, float] | None
    body_part_examined: str | None
    view_position: str | None
    study_date: str | None
    study_description: str | None
    series_description: str | None
    photometric_interpretation: str | None
    rows: int | None
    columns: int | None
    bits_stored: int | None
    window_center: float | None
    window_width: float | None
    number_of_frames: int


@dataclass(frozen=True)
class DicomFrame:
    frame_index: int
    image_data_url: str
    width: int
    height: int
    # Pixels bruts rescalees (Rescale Slope/Intercept appliques), encodes en
    # uint16 little-endian : raw = linear_min + u16 * linear_scale. Permet au
    # client d'appliquer le fenêtrage/niveau nativement sur les valeurs reelles.
    # None pour les DICOM couleur (le rendu preview fait foi).
    linear_data_url: str | None = None
    linear_min: float | None = None
    linear_max: float | None = None
    linear_scale: float | None = None


@dataclass(frozen=True)
class DicomImportResult:
    metadata: DicomMetadata
    frames: list[DicomFrame]
    warnings: list[str]


def _require_pydicom() -> Any:
    try:
        import pydicom
    except ModuleNotFoundError as exc:  # pragma: no cover - d\u00e9pend de l'installation serveur
        raise RuntimeError(
            "Le support DICOM n'est pas install\u00e9. Ex\u00e9cutez `pip install -r server/requirements.txt`."
        ) from exc
    return pydicom


def _text(dataset: Any, keyword: str) -> str | None:
    value = getattr(dataset, keyword, None)
    if value is None:
        return None
    rendered = str(value).strip()
    return rendered or None


def _number(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, (str, bytes)):
        candidate = value
    else:
        try:
            candidate = value[0]
        except (IndexError, KeyError, TypeError):
            candidate = value
    try:
        number = float(candidate)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _positive_int(dataset: Any, keyword: str) -> int | None:
    value = _number(getattr(dataset, keyword, None))
    if value is None or value <= 0:
        return None
    return int(value)


def _pixel_spacing(dataset: Any) -> tuple[float, float] | None:
    # PixelSpacing est prioritaire : ImagerPixelSpacing est une approximation
    # g\u00e9om\u00e9trique utile seulement si l'attribut principal est absent.
    raw = getattr(dataset, "PixelSpacing", None) or getattr(dataset, "ImagerPixelSpacing", None)
    if raw is None:
        return None
    try:
        row, column = float(raw[0]), float(raw[1])
    except (IndexError, TypeError, ValueError):
        return None
    if not (math.isfinite(row) and math.isfinite(column) and row > 0 and column > 0):
        return None
    return (row, column)


def _patient_pseudonym(dataset: Any) -> str | None:
    """Ne laisse jamais sortir PatientName/PatientID en clair du serveur."""
    identifier = _text(dataset, "PatientID") or _text(dataset, "PatientName")
    if not identifier:
        return None
    digest = hashlib.sha256(
        f"{_PSEUDONYM_KEY}:{identifier}".encode("utf-8", errors="replace"),
    ).hexdigest()[:12]
    return f"Patient-{digest}"


def _metadata(dataset: Any, frame_count: int) -> DicomMetadata:
    window_width = _number(getattr(dataset, "WindowWidth", None))
    return DicomMetadata(
        modality=_text(dataset, "Modality"),
        study_instance_uid=_text(dataset, "StudyInstanceUID"),
        series_instance_uid=_text(dataset, "SeriesInstanceUID"),
        sop_instance_uid=_text(dataset, "SOPInstanceUID"),
        frame_of_reference_uid=_text(dataset, "FrameOfReferenceUID"),
        patient_pseudonym=_patient_pseudonym(dataset),
        pixel_spacing_mm=_pixel_spacing(dataset),
        body_part_examined=_text(dataset, "BodyPartExamined"),
        view_position=_text(dataset, "ViewPosition"),
        study_date=_text(dataset, "StudyDate"),
        study_description=_text(dataset, "StudyDescription"),
        series_description=_text(dataset, "SeriesDescription"),
        photometric_interpretation=_text(dataset, "PhotometricInterpretation"),
        rows=_positive_int(dataset, "Rows"),
        columns=_positive_int(dataset, "Columns"),
        bits_stored=_positive_int(dataset, "BitsStored"),
        window_center=_number(getattr(dataset, "WindowCenter", None)),
        window_width=window_width if window_width is not None and window_width > 0 else None,
        number_of_frames=frame_count,
    )


def _rescaled_values(pixels: np.ndarray, dataset: Any) -> np.ndarray:
    """Applique Rescale Slope/Intercept et nettoie les valeurs non finies.

    Ces valeurs constituent le repère physique (HU pour le scanner) dans
    lequel le client applique son fenêtrage natif.
    """
    values = np.asarray(pixels, dtype=np.float64)
    slope = _number(getattr(dataset, "RescaleSlope", None)) or 1.0
    intercept = _number(getattr(dataset, "RescaleIntercept", None)) or 0.0
    values = values * slope + intercept
    return np.nan_to_num(values, nan=0.0, posinf=0.0, neginf=0.0)


def _normalise_to_uint8(pixels: np.ndarray, dataset: Any) -> np.ndarray:
    """Applique Rescale + Window Center/Width puis produit des pixels 8 bits."""
    values = _rescaled_values(pixels, dataset)

    center = _number(getattr(dataset, "WindowCenter", None))
    width = _number(getattr(dataset, "WindowWidth", None))
    if center is not None and width is not None and width > 1:
        low = center - width / 2
        high = center + width / 2
    else:
        low, high = float(values.min()), float(values.max())

    if high > low:
        normalised = np.clip((values - low) / (high - low), 0.0, 1.0)
    else:
        normalised = np.zeros_like(values, dtype=np.float64)
    if _text(dataset, "PhotometricInterpretation") == "MONOCHROME1":
        normalised = 1.0 - normalised
    return np.uint8(np.round(normalised * 255))


def _encode_linear_buffer(
    values: np.ndarray,
    *,
    min_value: float,
    max_value: float,
) -> tuple[str, float]:
    """Encode les valeurs rescalees en uint16 LE pour le fenêtrage natif.

    Retourne (base64, linear_scale). Quand la gamme tient dans 16 bits, la
    représentation est exacte (scale = 1) ; au-delà, la gamme est quantifiée
    linéairement et le client reconstruit raw = min + u16 * scale.
    """
    span = max_value - min_value
    if span <= 0:
        uint16 = np.zeros(values.size, dtype="<u2")
        scale = 1.0
    elif span <= 65_535:
        uint16 = np.clip(np.rint(values - min_value), 0, 65_535).astype("<u2")
        scale = 1.0
    else:
        uint16 = np.clip(np.rint((values - min_value) / span * 65_535), 0, 65_535).astype("<u2")
        scale = span / 65_535.0
    encoded = base64.b64encode(uint16.tobytes()).decode("ascii")
    return encoded, scale


def _colour_to_uint8(pixels: np.ndarray) -> np.ndarray:
    values = np.asarray(pixels)
    if values.ndim != 3 or values.shape[-1] < 3:
        raise DicomImportError("Le DICOM couleur a une organisation de pixels non prise en charge.")
    values = values[..., :3].astype(np.float64)
    values = np.nan_to_num(values, nan=0.0, posinf=0.0, neginf=0.0)
    minimum, maximum = float(values.min()), float(values.max())
    if maximum > minimum:
        values = (values - minimum) * (255.0 / (maximum - minimum))
    else:
        values = np.zeros_like(values)
    return np.uint8(np.clip(np.round(values), 0, 255))


def _encode_png(image: Image.Image) -> str:
    output = BytesIO()
    image.save(output, format="PNG", optimize=True)
    encoded = base64.b64encode(output.getvalue()).decode("ascii")
    return f"data:image/png;base64,{encoded}"


def _split_frames(pixel_array: np.ndarray, samples_per_pixel: int) -> list[np.ndarray]:
    array = np.asarray(pixel_array)
    if samples_per_pixel > 1:
        if array.ndim == 3:
            return [array]
        if array.ndim == 4:
            return [array[index] for index in range(array.shape[0])]
    else:
        if array.ndim == 2:
            return [array]
        if array.ndim == 3:
            return [array[index] for index in range(array.shape[0])]
    raise DicomImportError("La dimension des pixels DICOM n'est pas prise en charge.")


def _linear_frame_data(
    frame: np.ndarray,
    dataset: Any,
    samples_per_pixel: int,
) -> tuple[str | None, float | None, float | None, float | None]:
    """Prépare le buffer linéaire du frame pour le fenêtrage natif client.

    Les DICOM couleur n'ont pas de repère physique : le rendu preview fait foi.
    Les très grandes images sont exclues pour ne pas saturer le navigateur.
    """
    if samples_per_pixel > 1:
        return None, None, None, None
    if frame.shape[0] * frame.shape[1] > MAX_LINEAR_PIXELS:
        return None, None, None, None
    values = _rescaled_values(frame, dataset)
    min_value, max_value = float(values.min()), float(values.max())
    encoded, scale = _encode_linear_buffer(values, min_value=min_value, max_value=max_value)
    return encoded, min_value, max_value, scale


def _render_frame(frame: np.ndarray, dataset: Any, samples_per_pixel: int) -> Image.Image:
    if frame.size == 0:
        raise DicomImportError("Une image DICOM ne contient aucun pixel exploitable.")
    if frame.shape[0] * frame.shape[1] > MAX_FRAME_PIXELS:
        raise DicomImportError(
            f"Image DICOM trop volumineuse ({frame.shape[1]}×{frame.shape[0]} px, limite {MAX_FRAME_PIXELS} pixels)."
        )
    if samples_per_pixel > 1:
        return Image.fromarray(_colour_to_uint8(frame), mode="RGB")
    return Image.fromarray(_normalise_to_uint8(frame, dataset), mode="L").convert("RGB")


def parse_dicom_bytes(data: bytes) -> DicomImportResult:
    """D\u00e9code un DICOM de fa\u00e7on non persistante et rend ses frames en PNG."""
    if not data:
        raise DicomImportError("Le fichier DICOM est vide.")
    if len(data) > MAX_DICOM_BYTES:
        raise DicomImportError(f"Le fichier DICOM d\u00e9passe la limite de {MAX_DICOM_BYTES // (1024 * 1024)} Mo.")

    pydicom = _require_pydicom()
    try:
        dataset = pydicom.dcmread(BytesIO(data), force=True)
    except Exception as exc:  # noqa: BLE001
        raise DicomImportError("Le fichier ne peut pas \u00eatre lu comme DICOM.") from exc
    if not getattr(dataset, "PixelData", None):
        raise DicomImportError("Ce DICOM ne contient pas de Pixel Data exploitable.")
    if not getattr(dataset, "SOPClassUID", None):
        raise DicomImportError("Le fichier ne contient pas d'identifiant SOP DICOM valide.")

    try:
        pixel_array = dataset.pixel_array
    except Exception as exc:  # noqa: BLE001
        raise DicomImportError(
            "Les pixels DICOM ne peuvent pas \u00eatre d\u00e9compress\u00e9s par ce serveur. "
            "Installez le codec appropri\u00e9 ou fournissez une image non compress\u00e9e."
        ) from exc

    samples_per_pixel = _positive_int(dataset, "SamplesPerPixel") or 1
    frames = _split_frames(pixel_array, samples_per_pixel)
    if not frames:
        raise DicomImportError("Aucune image DICOM exploitable n'a \u00e9t\u00e9 trouv\u00e9e.")

    metadata = _metadata(dataset, len(frames))
    selected_indices = list(range(len(frames)))
    warnings: list[str] = []
    if len(frames) > MAX_RENDERED_FRAMES:
        selected_indices = sorted({
            round(index * (len(frames) - 1) / (MAX_RENDERED_FRAMES - 1))
            for index in range(MAX_RENDERED_FRAMES)
        })
        warnings.append(
            f"DICOM multi-frame : {len(frames)} images d\u00e9tect\u00e9es ; {len(selected_indices)} frames repr\u00e9sentatives ont \u00e9t\u00e9 import\u00e9es."
        )

    rendered: list[DicomFrame] = []
    for index in selected_indices:
        frame_array = frames[index]
        image = _render_frame(frame_array, dataset, samples_per_pixel)
        linear_data_url, linear_min, linear_max, linear_scale = _linear_frame_data(
            frame_array, dataset, samples_per_pixel
        )
        rendered.append(DicomFrame(
            frame_index=index,
            image_data_url=_encode_png(image),
            width=image.width,
            height=image.height,
            linear_data_url=linear_data_url,
            linear_min=linear_min,
            linear_max=linear_max,
            linear_scale=linear_scale,
        ))
    return DicomImportResult(metadata=metadata, frames=rendered, warnings=warnings)
