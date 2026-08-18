from __future__ import annotations

import json
import logging
import time
from typing import Type, TypeVar

from google import genai
from google.genai import types
from pydantic import BaseModel

logger = logging.getLogger("medical_report.gemini_client")

T = TypeVar("T", bound=BaseModel)


class GeminiReportClient:
    """Appelle Gemini avec une sortie structurée validée par Pydantic."""

    def __init__(self, api_key: str, model_name: str = "gemini-3.6-flash"):
        self.client = genai.Client(api_key=api_key)
        self.model_name = model_name

    def generate_structured(
        self,
        system_instruction: str,
        prompt: str,
        response_schema: Type[T],
        max_retries: int = 4,
    ) -> T:
        last_error: Exception | None = None
        for attempt in range(max_retries):
            try:
                response = self.client.models.generate_content(
                    model=self.model_name,
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        system_instruction=system_instruction,
                        response_mime_type="application/json",
                        response_schema=response_schema,
                    ),
                )
                if response.parsed is None:
                    raise ValueError(
                        "Gemini a répondu mais la sortie n'a pas pu être validée contre le "
                        f"schéma {response_schema.__name__}."
                    )
                return response.parsed
            except Exception as exc:  # noqa: BLE001
                last_error = exc
                if attempt == max_retries - 1:
                    break
                wait_seconds = 2**attempt
                logger.warning(
                    "Appel Gemini échoué (tentative %d/%d) : %s — nouvelle tentative dans %ds",
                    attempt + 1, max_retries, exc, wait_seconds,
                )
                time.sleep(wait_seconds)

        raise RuntimeError(
            f"Échec de l'appel Gemini après {max_retries} tentatives : {last_error}"
        ) from last_error

    def generate_json_validated(
        self,
        system_instruction: str,
        prompt: str,
        response_model: Type[T],
        media_parts: list[types.Part] | None = None,
        max_retries: int = 4,
    ) -> T:
        """Valide localement un JSON Gemini quand le schema est trop complexe pour le SDK."""
        last_error: Exception | None = None
        retry_prompt = prompt
        for attempt in range(max_retries):
            try:
                contents: str | list[types.Part]
                if media_parts:
                    contents = [types.Part.from_text(text=retry_prompt), *media_parts]
                else:
                    contents = retry_prompt
                response = self.client.models.generate_content(
                    model=self.model_name,
                    contents=contents,
                    config=types.GenerateContentConfig(
                        system_instruction=system_instruction,
                        response_mime_type="application/json",
                    ),
                )
                if not response.text:
                    raise ValueError("Gemini a renvoyé une réponse JSON vide.")
                return response_model.model_validate(json.loads(response.text))
            except Exception as exc:  # noqa: BLE001
                last_error = exc
                if attempt == max_retries - 1:
                    break
                wait_seconds = 2**attempt
                logger.warning(
                    "Plan JSON Gemini invalide (tentative %d/%d) : %s; nouvel essai dans %ds",
                    attempt + 1, max_retries, exc, wait_seconds,
                )
                retry_prompt = (
                    f"{prompt}\n\nLa reponse precedente etait invalide : {str(exc)[:1500]}. "
                    "Retourne maintenant uniquement un JSON qui respecte exactement le contrat."
                )
                time.sleep(wait_seconds)

        raise RuntimeError(
            f"Echec de l'appel Gemini après {max_retries} tentatives : {last_error}"
        ) from last_error
