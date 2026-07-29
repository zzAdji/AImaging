"""Registre backbone-agnostique.

Associe un nom d'architecture aux poids pré-entraînés torchvision et à la
recette de prétraitement officielle qu'ils attendent (taille d'entrée,
moyenne/écart-type de normalisation). Plutôt que de recopier ces valeurs
à la main pour chaque backbone - source d'erreurs et non extensible -
ce module s'appuie sur l'API `torchvision.models`, qui expose pour
chaque jeu de poids la transformation exacte utilisée lors de
l'entraînement original (`weights.transforms()`).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Callable, Optional, Tuple

import torchvision.models as tv_models

logger = logging.getLogger("preprocessing.model_registry")

SUPPORTED_ARCHITECTURES = {
    "densenet121": "DenseNet121_Weights",
    "densenet169": "DenseNet169_Weights",
    "densenet201": "DenseNet201_Weights",
    "efficientnet_b0": "EfficientNet_B0_Weights",
    "efficientnet_b1": "EfficientNet_B1_Weights",
    "efficientnet_b2": "EfficientNet_B2_Weights",
    "efficientnet_b4": "EfficientNet_B4_Weights",
    "resnet18": "ResNet18_Weights",
    "resnet50": "ResNet50_Weights",
    "resnet101": "ResNet101_Weights",
    "vgg16": "VGG16_Weights",
    "vgg19": "VGG19_Weights",
    "convnext_tiny": "ConvNeXt_Tiny_Weights",
}

_IMAGENET_MEAN: Tuple[float, float, float] = (0.485, 0.456, 0.406)
_IMAGENET_STD: Tuple[float, float, float] = (0.229, 0.224, 0.225)


@dataclass
class BackboneSpec:
    """Ce que le pipeline a besoin de savoir d'un backbone donné.

    Attributes:
        architecture: Nom reconnu (clé de SUPPORTED_ARCHITECTURES, ou nom
            libre si non reconnu - un fallback ImageNet générique s'applique).
        input_size: (H, W) attendue en entrée du modèle.
        mean: Moyenne de normalisation par canal (ordre RGB).
        std: Écart-type de normalisation par canal (ordre RGB).
        source: "pretrained_weights" | "imagenet_fallback".
        weights_transform: Callable torchvision officiel si pretrained=True
            et architecture reconnue, None sinon.
    """

    architecture: str
    input_size: Tuple[int, int]
    mean: Tuple[float, ...]
    std: Tuple[float, ...]
    source: str
    weights_transform: Optional[Callable] = None


def get_backbone_spec(
    architecture: str, pretrained: bool, fallback_size: Tuple[int, int]
) -> BackboneSpec:
    """Résout la spec de prétraitement attendue par un backbone donné.

    Args:
        architecture: Nom du backbone (voir SUPPORTED_ARCHITECTURES).
        pretrained: Si True, interroge torchvision pour la recette exacte
            utilisée lors du pré-entraînement (taille + normalisation).
        fallback_size: Taille utilisée si pretrained=False ou si
            l'architecture est inconnue de torchvision.

    Returns:
        BackboneSpec entièrement renseignée. Ne lève jamais d'exception :
        toute architecture inconnue ou toute erreur de résolution retombe
        sur les statistiques ImageNet génériques avec un avertissement loggé.
    """
    if architecture not in SUPPORTED_ARCHITECTURES:
        logger.warning(
            "Architecture '%s' non répertoriée dans model_registry - "
            "utilisation des valeurs ImageNet génériques (taille %s). "
            "Ajoutez-la à SUPPORTED_ARCHITECTURES pour une résolution automatique.",
            architecture, fallback_size,
        )
        return BackboneSpec(architecture, fallback_size, _IMAGENET_MEAN, _IMAGENET_STD, "imagenet_fallback")

    if not pretrained:
        return BackboneSpec(architecture, fallback_size, _IMAGENET_MEAN, _IMAGENET_STD, "imagenet_fallback")

    weights_enum_name = SUPPORTED_ARCHITECTURES[architecture]
    try:
        weights_enum = getattr(tv_models, weights_enum_name)
        weights = weights_enum.DEFAULT
        transform = weights.transforms()

        crop_size = getattr(transform, "crop_size", None) or getattr(transform, "resize_size", None)
        if isinstance(crop_size, (list, tuple)) and crop_size:
            side = int(crop_size[0])
            input_size = (side, side)
        else:
            input_size = fallback_size

        mean = tuple(getattr(transform, "mean", _IMAGENET_MEAN))
        std = tuple(getattr(transform, "std", _IMAGENET_STD))

        return BackboneSpec(
            architecture=architecture,
            input_size=input_size,
            mean=mean,
            std=std,
            source="pretrained_weights",
            weights_transform=transform,
        )
    except Exception as exc:  # noqa: BLE001 - robustesse : ne bloque jamais le pipeline
        logger.warning(
            "Impossible de dériver la spec pré-entraînée pour '%s' (%s) - "
            "fallback ImageNet générique.", architecture, exc,
        )
        return BackboneSpec(architecture, fallback_size, _IMAGENET_MEAN, _IMAGENET_STD, "imagenet_fallback")
