"""Tests de lecture DICOM réelle : métadonnées, buffer linéaire, replis, compressé."""

from __future__ import annotations

import base64

import numpy as np
import pytest

import dicom_service
from dicom_service import DicomImportError, parse_dicom_bytes

from conftest import (
    expected_pseudonym,
    make_compressed_dicom_bytes,
    make_dicom_bytes,
    make_rgb_dicom_bytes,
)


def test_parse_monochrome_metadata_and_linear_buffer():
    data = make_dicom_bytes(rows=16, cols=16, modality="CT", intercept=-1024)
    result = parse_dicom_bytes(data)
    assert result.metadata.modality == "CT"
    assert result.metadata.patient_pseudonym == expected_pseudonym("PSEUDO-001")
    assert result.metadata.rows == 16
    assert result.metadata.columns == 16
    assert result.metadata.pixel_spacing_mm == (0.5, 0.5)
    assert len(result.frames) == 1
    frame = result.frames[0]
    assert frame.width == 16 and frame.height == 16
    assert frame.linear_data_url is not None
    assert frame.linear_min == -1024.0
    assert frame.linear_max == -1024.0  # pixels tous nuls → valeurs = intercept
    assert frame.linear_scale == 1.0
    assert frame.image_data_url.startswith("data:image/png;base64,")

    raw = base64.b64decode(frame.linear_data_url)
    decoded = np.frombuffer(raw, dtype="<u2")
    assert len(decoded) == 16 * 16
    values = frame.linear_min + decoded.astype(np.float64) * frame.linear_scale
    np.testing.assert_allclose(values, -1024.0)


def test_linear_buffer_applies_rescale_slope_and_intercept():
    arr = np.arange(256, dtype=np.uint16).reshape(16, 16)
    data = make_dicom_bytes(pixel_array=arr, slope=2.0, intercept=10.0)
    frame = parse_dicom_bytes(data).frames[0]
    assert frame.linear_min == pytest.approx(10.0)
    assert frame.linear_max == pytest.approx(10.0 + 2.0 * 255)
    raw = np.frombuffer(base64.b64decode(frame.linear_data_url), dtype="<u2")
    values = frame.linear_min + raw.astype(np.float64) * frame.linear_scale
    assert values[0] == pytest.approx(10.0)
    assert values[-1] == pytest.approx(10.0 + 2.0 * 255)


def test_monochrome1_still_provides_linear_buffer():
    data = make_dicom_bytes(
        photometric="MONOCHROME1",
        intercept=0,
        pixel_array=np.full((8, 8), 500, dtype=np.uint16),
    )
    result = parse_dicom_bytes(data)
    assert result.metadata.photometric_interpretation == "MONOCHROME1"
    assert result.frames[0].linear_data_url is not None


def test_rgb_dicom_disables_linear_buffer():
    data = make_rgb_dicom_bytes(rows=8, cols=8)
    result = parse_dicom_bytes(data)
    assert result.metadata.photometric_interpretation == "RGB"
    frame = result.frames[0]
    assert frame.linear_data_url is None
    assert frame.linear_min is None
    assert frame.linear_max is None
    assert frame.linear_scale is None


def test_linear_buffer_fallback_when_too_large(monkeypatch):
    monkeypatch.setattr(dicom_service, "MAX_LINEAR_PIXELS", 1)
    data = make_dicom_bytes(rows=16, cols=16)
    frame = parse_dicom_bytes(data).frames[0]
    assert frame.linear_data_url is None
    assert frame.image_data_url  # le rendu PNG reste disponible


def test_empty_and_garbage_raise():
    with pytest.raises(DicomImportError):
        parse_dicom_bytes(b"")
    with pytest.raises(DicomImportError):
        parse_dicom_bytes(b"ceci n'est pas un DICOM")


def test_compressed_jpeg_dicom(monkeypatch):
    """DICOM compressé JPEG Baseline : skip si aucun codec de lecture n'est installé."""
    try:
        data = make_compressed_dicom_bytes(rows=32, cols=32)
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"Impossible de générer un DICOM JPEG : {exc}")
    try:
        result = parse_dicom_bytes(data)
    except DicomImportError as exc:
        if "codec" in str(exc) or "compress" in str(exc).lower():
            pytest.skip(f"Codec JPEG indisponible sur cette machine : {exc}")
        raise
    assert result.metadata.modality == "DX"
    assert len(result.frames) == 1
    assert result.frames[0].linear_data_url is not None
