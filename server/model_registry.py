from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import List, Optional

from config import GeminiConfig, RadiographyServerConfig, validate_gemini_config

logger = logging.getLogger("server.model_registry")


@dataclass
class ModelRegistry:
    radiography_models: List = field(default_factory=list)
    radiography_device: object = None
    gemini_client: Optional[object] = None

    def load_radiography(self, config: RadiographyServerConfig) -> None:
        from scripts.radiography.training.main_predict import load_radiography_models
        from scripts.radiography.training.training.utils import resolve_device

        self.radiography_device = resolve_device(config.device)
        self.radiography_models = load_radiography_models(
            config.checkpoints, config.hidden_dims, config.dropout, config.device
        )
        logger.info(
            "Ensemble radiographie chargé : %s (device=%s)",
            [m.architecture for m in self.radiography_models], self.radiography_device,
        )

    def load_gemini(self, config: GeminiConfig) -> None:
        validate_gemini_config(config)
        from gemini_client import GeminiReportClient

        self.gemini_client = GeminiReportClient(api_key=config.api_key, model_name=config.model_name)
        logger.info("Client Gemini prêt (modèle=%s).", config.model_name)
