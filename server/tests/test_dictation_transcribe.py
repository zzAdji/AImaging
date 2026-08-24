"""Tests unitaires de la transcription vocale via Gemini (gemini_client.py §voice).

Aucun réseau : on mocke le client genai et on vérifie le contrat de la méthode
``transcribe_audio`` (instruction, type de part audio, renvoi du texte, retries).
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from gemini_client import GeminiReportClient


def _fake_response(text: str):
    resp = MagicMock()
    resp.text = text
    return resp


class TestTranscribeAudio:
    def test_diction_renvoie_le_texte_transcrit(self) -> None:
        client = GeminiReportClient(api_key="test")
        client.client = MagicMock()
        client.client.models.generate_content.return_value = _fake_response(
            "Le rapport montre une absence de foyer alvéolaire."
        )
        text = client.transcribe_audio(b"fake-webm-bytes")
        assert text == "Le rapport montre une absence de foyer alvéolaire."
        assert client.client.models.generate_content.call_count == 1

    def test_transcription_vide_relance_deux_fois_puis_echec(self) -> None:
        client = GeminiReportClient(api_key="test")
        client.client = MagicMock()
        client.client.models.generate_content.return_value = _fake_response("")
        with pytest.raises(RuntimeError):
            client.transcribe_audio(b"<audio>", max_retries=3)
        assert client.client.models.generate_content.call_count == 3

    def test_transcription_retry_apres_exception(self) -> None:
        client = GeminiReportClient(api_key="test")
        client.client = MagicMock()
        client.client.models.generate_content.side_effect = [
            RuntimeError("boom"),
            _fake_response("texte final"),
        ]
        text = client.transcribe_audio(b"<audio>", max_retries=2)
        assert text == "texte final"
        assert client.client.models.generate_content.call_count == 2