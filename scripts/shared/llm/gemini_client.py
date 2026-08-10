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
    """Appelle Gemini avec une sortie structuree forcee (response_schema),
    avec retry a backoff exponentiel sur erreur transitoire (429, timeouts).
    """

    def __init__(self, api_key: str, model_name: str = "gemini-2.5-flash"):
        self.client = genai.Client(api_key=api_key)
        self.model_name = model_name

    def generate_structured(
        self,
        system_instruction: str,
        prompt: str,
        response_schema: Type[T],
        max_retries: int = 4,
    ) -> T:
        """
        Args:
            system_instruction: Instructions generales (role, contraintes,
                ex. "ne jamais formuler un diagnostic autre que celui fourni").
            prompt: Le contenu specifique a cette generation (exemples
                few-shot + faits de la prediction courante).
            response_schema: Classe Pydantic decrivant la sortie attendue
                (ex. RadiologyReportFields) — Gemini est contraint de
                produire un JSON conforme a ce schema.
            max_retries: Nombre de tentatives avant abandon.

        Returns:
            Une instance de response_schema, deja validee.

        Raises:
            RuntimeError: si toutes les tentatives echouent.
        """
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
                        "Gemini a repondu mais la sortie n'a pas pu etre validee contre le "
                        f"schema {response_schema.__name__} (response.parsed est None)."
                    )
                return response.parsed
            except Exception as exc:  # noqa: BLE001
                last_error = exc
                wait_seconds = 2 ** attempt
                logger.warning(
                    "Appel Gemini echoue (tentative %d/%d) : %s — nouvelle tentative dans %ds",
                    attempt + 1, max_retries, exc, wait_seconds,
                )
                if attempt < max_retries - 1:
                    time.sleep(wait_seconds)

        raise RuntimeError(
            f"Echec de l'appel Gemini apres {max_retries} tentatives : {last_error}"
        ) from last_error