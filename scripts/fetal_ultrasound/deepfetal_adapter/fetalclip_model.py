"""Chargement du modele FetalCLIP (https://github.com/BioMedIA-MBZUAI/FetalCLIP),
un modele vision-langage base sur open_clip, fine-tune sur 210 035 images
d'echographie foetale (Maani et al., 2025, arXiv:2502.14807).

Reproduit exactement la procedure du "Quick Start" du depot officiel :
enregistrer FetalCLIP_config.json dans le registre interne d'open_clip
(open_clip.factory._MODEL_CONFIGS), puis appeler create_model_and_transforms
qui construit l'architecture ET charge les poids en un seul appel.

Verifie directement dans le code source d'open_clip (open_clip.factory.
load_state_dict) que le format de checkpoint {"epoch", "name", "state_dict"}
et le prefixe "module." (frequents pour un modele entraine sous
DataParallel/DDP) sont deja geres automatiquement — aucune logique de
deballage de checkpoint n'est donc necessaire ici.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Callable, Dict, Tuple

import torch

from .config import FetalCLIPConfig
from .paths import require_file

logger = logging.getLogger("fetal_ultrasound.fetalclip")


def resolve_device(device: str) -> torch.device:
    """Resout "auto"/"cpu"/"cuda" en torch.device reel, avec repli silencieux
    sur CPU si CUDA est demande mais indisponible (meme convention que le
    reste du projet — voir plane_model.resolve_device)."""
    if device == "cpu":
        return torch.device("cpu")
    if device == "cuda":
        if not torch.cuda.is_available():
            logger.warning("CUDA demande mais indisponible - bascule sur CPU.")
            return torch.device("cpu")
        return torch.device("cuda")
    return torch.device("cuda" if torch.cuda.is_available() else "cpu")


def _register_config(config: FetalCLIPConfig) -> Dict[str, Any]:
    """Enregistre FetalCLIP_config.json dans le registre interne d'open_clip.

    Reproduit exactement ce que fait le depot officiel FetalCLIP :
        open_clip.factory._MODEL_CONFIGS["FetalCLIP"] = config_fetalclip

    C'est une API privee d'open_clip (prefixe "_", pas garantie stable
    entre versions) — si elle disparait dans une version future
    d'open_clip_torch, on echoue avec un message explicite plutot que de
    se comporter silencieusement de facon incorrecte.

    Returns:
        Le contenu brut du fichier de config JSON (utilise ensuite pour
        recuperer embed_dim de maniere fiable, sans deviner un attribut
        sur l'objet modele).
    """
    import open_clip

    if not hasattr(open_clip.factory, "_MODEL_CONFIGS"):
        raise RuntimeError(
            "open_clip.factory._MODEL_CONFIGS est introuvable dans la version "
            "d'open_clip_torch installee. C'est l'API (privee) utilisee par le "
            "depot officiel FetalCLIP pour enregistrer sa configuration - "
            "verifiez la version installee (pip show open_clip_torch) contre "
            "celle recommandee par https://github.com/BioMedIA-MBZUAI/FetalCLIP."
        )

    config_path = require_file(config.config_path, "FetalCLIP_config.json")
    raw_config = json.loads(config_path.read_text(encoding="utf-8"))
    open_clip.factory._MODEL_CONFIGS[config.model_name] = raw_config
    return raw_config


def load_fetalclip_model(
    config: FetalCLIPConfig | None = None,
    device: str = "auto",
    freeze: bool = True,
) -> Tuple[torch.nn.Module, Callable, torch.device, int]:
    """Charge FetalCLIP (architecture + poids) et son preprocessing associe.

    Args:
        config: Chemins et parametres (voir FetalCLIPConfig). Par defaut,
            les chemins standards du projet (models/fetal_ultrasound/,
            data/fetal_ultrasound/).
        device: "auto" | "cpu" | "cuda".
        freeze: Si True (defaut), gele tous les parametres du modele
            (requires_grad=False) — approprie pour l'extraction
            d'embeddings (Phase G, aucun gradient necessaire ici) et pour
            un futur entrainement avec FetalCLIP gele (Phase 15, phase 1
            du fine-tuning progressif). Mettre a False seulement pour un
            entrainement qui doit degeler tout ou partie de FetalCLIP.

    Returns:
        (model, preprocess, device, embed_dim). Le preprocessing renvoye
        est EXACTEMENT celui fourni par open_clip pour ce modele (resize
        bicubique + center crop + normalisation CLIP standard) — pas de
        reimplementation manuelle, pour eviter tout ecart avec le
        preprocessing utilise a l'entrainement de FetalCLIP.
    """
    import open_clip

    config = config or FetalCLIPConfig()
    resolved_device = resolve_device(device)

    raw_config = _register_config(config)
    embed_dim = raw_config.get("embed_dim", config.embed_dim)

    weights_path = require_file(config.weights_path, "FetalCLIP_weights.pt")

    model, _preprocess_train, preprocess_test = open_clip.create_model_and_transforms(
        config.model_name, pretrained=str(weights_path)
    )
    model.eval()
    model.to(resolved_device)

    if freeze:
        for param in model.parameters():
            param.requires_grad = False
        logger.info("FetalCLIP gele (requires_grad=False sur tous les parametres).")
    else:
        logger.info("FetalCLIP charge sans gel (tous les parametres restent entrainables).")

    logger.info(
        "FetalCLIP charge depuis %s (device=%s, embed_dim=%s).",
        weights_path, resolved_device, embed_dim,
    )
    return model, preprocess_test, resolved_device, embed_dim