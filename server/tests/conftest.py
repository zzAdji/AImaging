"""Configuration partagée des tests serveur.

Ajoute le dossier `server/` au sys.path (les tests vivent dans `server/tests`)
et expose des générateurs de DICOM synthétiques pour les tests de lecture.
"""

from __future__ import annotations

import os
import sys
from io import BytesIO
from pathlib import Path

import numpy as np
import pytest

SERVER_DIR = Path(__file__).resolve().parent.parent  # .../server
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

# Clé de pseudonymisation fixe : elle doit être posée AVANT l'import de
# `dicom_service` (pytest charge ce conftest avant les modules de test), afin
# que `_PSEUDONYM_KEY` soit déterministe et que les assertions sur le
# pseudonyme restent reproductibles d'une exécution à l'autre.
PSEUDONYM_KEY = "test-deterministic-pseudonym-key"
os.environ.setdefault("DICOM_PSEUDONYM_KEY", PSEUDONYM_KEY)


def expected_pseudonym(identifier: str) -> str:
    """Reproduit la pseudonymisation déterministe du serveur (SHA-256 + clé)."""
    import hashlib

    digest = hashlib.sha256(
        f"{PSEUDONYM_KEY}:{identifier}".encode("utf-8", errors="replace"),
    ).hexdigest()[:12]
    return f"Patient-{digest}"


def _set_torch_env():
    """Limite les threads OpenBLAS/OMP pour pouvoir importer les modules torch."""
    os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")
    os.environ.setdefault("OMP_NUM_THREADS", "1")


def make_dicom_bytes(
    *,
    rows: int = 8,
    cols: int = 8,
    modality: str = "CT",
    photometric: str = "MONOCHROME2",
    samples_per_pixel: int = 1,
    bits_allocated: int = 16,
    bits_stored: int = 12,
    pixel_representation: int = 0,
    slope: float = 1.0,
    intercept: float = -1024.0,
    pixel_array: np.ndarray | None = None,
    pixel_spacing: tuple[float, float] | None = (0.5, 0.5),
) -> bytes:
    """Construit un DICOM monocadre non compressé et le sérialise en mémoire."""
    from pydicom import dcmwrite
    from pydicom.dataset import Dataset
    from pydicom.uid import ExplicitVRLittleEndian, generate_uid

    if pixel_array is None:
        pixel_array = np.zeros((rows, cols), dtype=np.uint16)

    ds = Dataset()
    ds.file_meta = Dataset()
    ds.file_meta.TransferSyntaxUID = ExplicitVRLittleEndian
    ds.file_meta.MediaStorageSOPClassUID = generate_uid()
    ds.file_meta.MediaStorageSOPInstanceUID = generate_uid()
    ds.SOPClassUID = ds.file_meta.MediaStorageSOPClassUID
    ds.SOPInstanceUID = ds.file_meta.MediaStorageSOPInstanceUID
    ds.StudyInstanceUID = generate_uid()
    ds.SeriesInstanceUID = generate_uid()
    ds.FrameOfReferenceUID = generate_uid()
    ds.PatientID = "PSEUDO-001"
    ds.Modality = modality
    ds.Rows = int(pixel_array.shape[0])
    ds.Columns = int(pixel_array.shape[1])
    ds.SamplesPerPixel = samples_per_pixel
    ds.PhotometricInterpretation = photometric
    if samples_per_pixel > 1:
        # Obligatoire dès que SamplesPerPixel > 1 : 0 = interleaved
        # (RGB RGB RGB), conforme à l'organisation mémoire (rows, cols, 3).
        ds.PlanarConfiguration = 0
    ds.BitsAllocated = bits_allocated
    ds.BitsStored = bits_stored
    ds.HighBit = bits_stored - 1
    ds.PixelRepresentation = pixel_representation
    ds.RescaleSlope = slope
    ds.RescaleIntercept = intercept
    ds.WindowCenter = 40.0
    ds.WindowWidth = 400.0
    ds.NumberOfFrames = "1"
    if pixel_spacing is not None:
        ds.PixelSpacing = [str(v) for v in pixel_spacing]
    arr = np.asarray(pixel_array)
    if samples_per_pixel > 1:
        ds.PixelData = arr.tobytes()
    elif bits_allocated == 16:
        ds.PixelData = arr.astype("<u2").tobytes()
    else:
        ds.PixelData = arr.astype("uint8").tobytes()

    buffer = BytesIO()
    dcmwrite(buffer, ds, enforce_file_format=True)
    return buffer.getvalue()


def make_rgb_dicom_bytes(rows: int = 8, cols: int = 8) -> bytes:
    """DICOM couleur (RGB, 8 bits) : le fenêtrage linéaire doit être désactivé."""
    rgb = np.zeros((rows, cols, 3), dtype=np.uint8)
    rgb[..., 0] = 200
    rgb[..., 1] = 120
    rgb[..., 2] = 40
    return make_dicom_bytes(
        photometric="RGB",
        samples_per_pixel=3,
        bits_allocated=8,
        bits_stored=8,
        pixel_array=rgb,
    )


def make_compressed_dicom_bytes(rows: int = 32, cols: int = 32) -> bytes:
    """DICOM compressé JPEG Baseline (nécessite un encodeur JPEG + codec de lecture)."""
    from PIL import Image

    from pydicom import dcmwrite
    from pydicom.dataset import Dataset
    from pydicom.encaps import encapsulate
    from pydicom.uid import JPEGBaseline8Bit, generate_uid

    raw = np.zeros((rows, cols), dtype=np.uint16)
    raw[8:24, 8:24] = 3000
    image = Image.fromarray((raw >> 4).astype(np.uint8), mode="L")
    jpeg = BytesIO()
    image.save(jpeg, format="JPEG", quality=85)
    jpeg_bytes = jpeg.getvalue()

    ds = Dataset()
    ds.file_meta = Dataset()
    ds.file_meta.TransferSyntaxUID = JPEGBaseline8Bit
    ds.file_meta.MediaStorageSOPClassUID = generate_uid()
    ds.file_meta.MediaStorageSOPInstanceUID = generate_uid()
    ds.SOPClassUID = ds.file_meta.MediaStorageSOPClassUID
    ds.SOPInstanceUID = ds.file_meta.MediaStorageSOPInstanceUID
    ds.StudyInstanceUID = generate_uid()
    ds.SeriesInstanceUID = generate_uid()
    ds.PatientID = "PSEUDO-COMP-1"
    ds.Modality = "DX"
    ds.Rows = rows
    ds.Columns = cols
    ds.SamplesPerPixel = 1
    ds.PhotometricInterpretation = "MONOCHROME2"
    ds.BitsAllocated = 8
    ds.BitsStored = 8
    ds.HighBit = 7
    ds.PixelRepresentation = 0
    ds.NumberOfFrames = "1"
    ds.PixelData = encapsulate([jpeg_bytes])
    ds["PixelData"].is_undefined_length = True

    buffer = BytesIO()
    dcmwrite(buffer, ds, enforce_file_format=True)
    return buffer.getvalue()


def make_workspace_manifest(
    *,
    image_ids: list[str] | None = None,
    source_kinds: list[str] | None = None,
    study_uids: list[str | None] | None = None,
    modalities: list[str | None] | None = None,
    widths: list[int] | None = None,
    active_image_id: str | None = None,
) -> dict:
    """Builds a minimal WorkspaceManifest payload (as a plain dict)."""
    from pydicom.uid import generate_uid

    ids = image_ids or ["img-1", "img-2", "img-3"]
    images = []
    for index, image_id in enumerate(ids):
        images.append({
            "image_id": image_id,
            "name": f"Image {index + 1}",
            "width": (widths or [512] * len(ids))[index],
            "height": (widths or [512] * len(ids))[index],
            "source_kind": (source_kinds or ["dicom"] * len(ids))[index],
            "metadata": {
                "modality": (modalities or ["CT"] * len(ids))[index],
                "study_instance_uid": (study_uids or [generate_uid()] * len(ids))[index],
                "patient_pseudonym": "PSEUDO-EXAM",
                "pixel_spacing_mm": [0.5, 0.5],
            },
            "canvas": {"shapes": []},
        })
    return {
        "protocol_version": "1.0",
        "exam_id": "exam-1",
        "exam_name": "Examen de test",
        "active_image_id": active_image_id or ids[0],
        "images": images,
    }


@pytest.fixture(autouse=True)
def _torch_env():
    _set_torch_env()
    yield
