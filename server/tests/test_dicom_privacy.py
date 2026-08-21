"""Confidentialité : les identifiants patients bruts ne doivent JAMAIS sortir du
serveur ni être transmis à Gemini.

Deux garanties sont testées :
1. Le parsing DICOM ne renvoie que le pseudonyme déterministe, jamais le
   ``PatientName`` / ``PatientID`` brut présents dans le fichier source.
2. Le contexte reconstruit pour Gemini retire les identifiants DICOM privés
   (uids, pseudonyme) du manifeste.
"""

from __future__ import annotations

import json
from io import BytesIO

import numpy as np
import pytest
from pydicom import dcmwrite
from pydicom.dataset import Dataset
from pydicom.uid import ExplicitVRLittleEndian, generate_uid

import dicom_service
from main import _manifest_context_for_gemini
from workspace_protocol import WorkspaceManifest

from conftest import make_workspace_manifest  # noqa: E402

RAW_NAME = "DOE^JOHN"
RAW_ID = "RAW-1984-000721"


def _dicom_with_raw_identifiers() -> bytes:
    """Un DICOM contenant un PatientName/PatientID brut bien identifiable."""
    from pydicom.uid import generate_uid as _uid

    ds = Dataset()
    ds.file_meta = Dataset()
    ds.file_meta.TransferSyntaxUID = ExplicitVRLittleEndian
    ds.file_meta.MediaStorageSOPClassUID = _uid()
    ds.file_meta.MediaStorageSOPInstanceUID = _uid()
    ds.SOPClassUID = ds.file_meta.MediaStorageSOPClassUID
    ds.SOPInstanceUID = ds.file_meta.MediaStorageSOPInstanceUID
    ds.StudyInstanceUID = _uid()
    ds.SeriesInstanceUID = _uid()
    ds.FrameOfReferenceUID = _uid()
    ds.PatientName = RAW_NAME
    ds.PatientID = RAW_ID
    ds.Modality = "DX"
    ds.Rows = 8
    ds.Columns = 8
    ds.SamplesPerPixel = 1
    ds.PhotometricInterpretation = "MONOCHROME2"
    ds.BitsAllocated = 16
    ds.BitsStored = 12
    ds.HighBit = 11
    ds.PixelRepresentation = 0
    ds.RescaleSlope = 1.0
    ds.RescaleIntercept = -1024.0
    ds.WindowCenter = 40.0
    ds.WindowWidth = 400.0
    ds.NumberOfFrames = "1"
    ds.PixelData = np.zeros((8, 8), dtype=np.uint16).tobytes()

    buffer = BytesIO()
    dcmwrite(buffer, ds, enforce_file_format=True)
    return buffer.getvalue()


def test_dicom_parse_never_exposes_raw_patient_identifiers():
    result = dicom_service.parse_dicom_bytes(_dicom_with_raw_identifiers())

    assert result.metadata.patient_pseudonym is not None
    assert result.metadata.patient_pseudonym.startswith("Patient-")

    # Le pseudonyme est dérivé du PatientID brut (déterministe, testé ailleurs) ;
    # l'important ici est que le brut ne soit exposé nulle part dans la sortie.
    serialized = json.dumps(result.metadata.__dict__)
    assert RAW_ID not in serialized
    assert RAW_NAME.upper() not in serialized.upper()
    assert "DOE" not in serialized.upper()
    assert "1984" not in serialized


def test_gemini_context_never_contains_private_dicom_fields():
    manifest = WorkspaceManifest.model_validate(
        make_workspace_manifest(
            image_ids=["img-1"],
            modalities=["DX"],
            source_kinds=["dicom"],
            widths=[512],
        )
    )
    context = _manifest_context_for_gemini(manifest)

    metadata = context["images"][0]["metadata"]
    # Aucun identifiant DICOM privé ne doit rester dans le contexte envoyé à Gemini.
    for field in ("study_instance_uid", "series_instance_uid", "sop_instance_uid",
                  "frame_of_reference_uid", "patient_pseudonym"):
        assert field not in metadata

    serialized = json.dumps(context)
    assert "PSEUDO-EXAM" not in serialized  # le pseudonyme du fixture n'y est pas
