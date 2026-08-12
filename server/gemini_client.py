from __future__ import annotations

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
