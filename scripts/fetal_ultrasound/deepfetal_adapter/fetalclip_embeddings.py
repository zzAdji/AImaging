"""Extraction d'embeddings visuels via FetalCLIP (Phase G).

N'utilise que l'encodeur visuel (model.encode_image) — pas l'encodeur
texte, non necessaire pour l'extraction de features de l'Etape 6 de la
specification d'origine ("Image -> FetalCLIP Image Encoder -> Visual
Embedding", pas un usage zero-shot par prompts).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional, Tuple

import numpy as np
import torch
from PIL import Image

from .config import FetalCLIPConfig
from .fetalclip_model import load_fetalclip_model

logger = logging.getLogger("fetal_ultrasound.fetalclip")


@dataclass
class EmbeddingExtractionResult:
    image_id: str
    vector: Optional[np.ndarray]
    dimension: Optional[int]
    status: str  # "ok" | "load_error" | "inference_error"
    error: Optional[str] = None


class FetalCLIPEmbedder:
    """Charge FetalCLIP une seule fois, extrait des embeddings visuels pour
    autant d'images que necessaire (Phase G).

    Une image illisible/corrompue n'interrompt jamais un lot : elle est
    rapportee avec status="load_error" (ou "inference_error" si le forward
    pass echoue) et les autres images du lot continuent d'etre traitees —
    meme philosophie de resilience que le reste du pipeline (dataset
    analyzer, preprocessing radiographie).
    """

    def __init__(
        self,
        config: FetalCLIPConfig | None = None,
        device: str = "auto",
        freeze: bool = True,
    ) -> None:
        self.model, self.preprocess, self.device, self.embed_dim = load_fetalclip_model(
            config, device=device, freeze=freeze
        )
        self._autocast_enabled = self.device.type == "cuda"

    def _load_tensor(self, image_path: Path) -> torch.Tensor:
        with Image.open(image_path) as img:
            return self.preprocess(img.convert("RGB"))

    @torch.no_grad()
    def _run_batch(
        self, ids: List[str], tensors: List[torch.Tensor], normalize: bool
    ) -> List[EmbeddingExtractionResult]:
        batch = torch.stack(tensors).to(self.device)
        try:
            with torch.autocast(device_type=self.device.type, enabled=self._autocast_enabled):
                features = self.model.encode_image(batch)
            if normalize:
                features = features / features.norm(dim=-1, keepdim=True)
            features = features.float().cpu().numpy()
        except Exception as exc:  # noqa: BLE001
            logger.error("Echec d'inference FetalCLIP sur un lot de %d image(s) : %s", len(ids), exc)
            return [
                EmbeddingExtractionResult(image_id=i, vector=None, dimension=None,
                                           status="inference_error", error=str(exc))
                for i in ids
            ]
        return [
            EmbeddingExtractionResult(image_id=i, vector=v, dimension=int(v.shape[0]), status="ok")
            for i, v in zip(ids, features)
        ]

    def embed_batch(
        self,
        image_ids_and_paths: List[Tuple[str, Path]],
        batch_size: int = 8,
        normalize: bool = True,
    ) -> List[EmbeddingExtractionResult]:
        """Extrait les embeddings d'une liste (image_id, chemin), par lots de batch_size.

        Args:
            image_ids_and_paths: Paires (identifiant, chemin fichier).
            batch_size: Nombre d'images par forward pass.
            normalize: L2-normalise les embeddings (convention CLIP standard,
                utilisee par le Quick Start officiel de FetalCLIP). Un
                classifieur entraine en aval peut apprendre a compenser une
                echelle non normalisee, mais la normalisation reste le choix
                le plus sur et le plus comparable par defaut.

        Returns:
            Une liste dans le meme ordre que image_ids_and_paths.
        """
        results: List[EmbeddingExtractionResult] = []
        pending_ids: List[str] = []
        pending_tensors: List[torch.Tensor] = []

        for image_id, image_path in image_ids_and_paths:
            try:
                tensor = self._load_tensor(image_path)
            except Exception as exc:  # noqa: BLE001
                logger.warning("Image illisible, ignoree : %s (%s)", image_path, exc)
                results.append(
                    EmbeddingExtractionResult(image_id=image_id, vector=None, dimension=None,
                                               status="load_error", error=str(exc))
                )
                continue

            pending_ids.append(image_id)
            pending_tensors.append(tensor)
            if len(pending_tensors) >= batch_size:
                results.extend(self._run_batch(pending_ids, pending_tensors, normalize))
                pending_ids, pending_tensors = [], []

        if pending_tensors:
            results.extend(self._run_batch(pending_ids, pending_tensors, normalize))

        return results