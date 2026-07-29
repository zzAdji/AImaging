"""Construction du modèle : backbone pré-entraîné + tête de classification
personnalisée, remplaçant le classifieur original.

Chaque famille d'architecture torchvision expose son classifieur final
sous un nom et une structure différents (model.fc pour ResNet,
model.classifier pour DenseNet/EfficientNet/VGG/ConvNeXt, parfois un
nn.Linear direct, parfois un nn.Sequential se terminant par un
nn.Linear). Ce module centralise cette hétérogénéité pour que le reste du
code (trainer, ensemble, gradcam) manipule un nn.Module standard sans se
soucier de l'architecture sous-jacente.
"""

from __future__ import annotations

import logging
from typing import Tuple

import torch.nn as nn
import torchvision.models as tv_models

logger = logging.getLogger("training.model_builder")


_CLASSIFIER_ATTR = {
    "resnet18": "fc", "resnet50": "fc", "resnet101": "fc",
    "densenet121": "classifier", "densenet169": "classifier", "densenet201": "classifier",
    "efficientnet_b0": "classifier", "efficientnet_b1": "classifier",
    "efficientnet_b2": "classifier", "efficientnet_b4": "classifier",
    "vgg16": "classifier", "vgg19": "classifier",
    "convnext_tiny": "classifier",
}

_WEIGHTS_ENUM = {
    "resnet18": "ResNet18_Weights", "resnet50": "ResNet50_Weights", "resnet101": "ResNet101_Weights",
    "densenet121": "DenseNet121_Weights", "densenet169": "DenseNet169_Weights", "densenet201": "DenseNet201_Weights",
    "efficientnet_b0": "EfficientNet_B0_Weights", "efficientnet_b1": "EfficientNet_B1_Weights",
    "efficientnet_b2": "EfficientNet_B2_Weights", "efficientnet_b4": "EfficientNet_B4_Weights",
    "vgg16": "VGG16_Weights", "vgg19": "VGG19_Weights",
    "convnext_tiny": "ConvNeXt_Tiny_Weights",
}


def _get_in_features(model: nn.Module, attr_name: str) -> int:
    """Trouve la dimension d'entrée réelle du classifieur, qu'il soit un
    simple nn.Linear (ResNet, DenseNet) ou un nn.Sequential (EfficientNet,
    VGG, ConvNeXt)."""

    module = getattr(model, attr_name)
    if isinstance(module, nn.Linear):
        return module.in_features
    if isinstance(module, nn.Sequential):
        for layer in module:
            if isinstance(layer, nn.Linear):
                return layer.in_features
    raise ValueError(f"Impossible de déterminer in_features pour {attr_name}={module}")


def _needs_explicit_flatten(model: nn.Module, attr_name: str) -> bool:
    """Détecte si le classifieur original aplatissait lui-même son entrée
    (cas de ConvNeXt : Sequential(LayerNorm2d, Flatten, Linear)), par
    opposition aux architectures où l'aplatissement est déjà fait avant
    l'appel au classifieur (ResNet, DenseNet, EfficientNet, VGG). Si
    c'est le cas, notre tête de remplacement doit réinsérer ce Flatten
    explicitement, sous peine de recevoir un tenseur 4D (B, C, 1, 1) là
    où nn.Linear attend un tenseur 2D (B, C)."""
    module = getattr(model, attr_name)
    return isinstance(module, nn.Sequential) and any(
        isinstance(layer, nn.Flatten) for layer in module
    )


def build_mlp_head(
    in_features: int, hidden_dims: Tuple[int, ...], num_classes: int, dropout: float
) -> nn.Sequential:
    """Construit la tête MLP : in_features -> hidden_dims... -> num_classes.

    Structure par défaut (hidden_dims=(512,128,32)) équivalente à celle
    décrite dans Shahzad et al. 2025 : Linear -> Dropout -> ReLU répété,
    puis une dernière couche linéaire vers num_classes.
    """
    layers = []
    prev_dim = in_features
    for hidden_dim in hidden_dims:
        layers += [nn.Linear(prev_dim, hidden_dim), nn.Dropout(dropout), nn.ReLU()]
        prev_dim = hidden_dim
    layers.append(nn.Linear(prev_dim, num_classes))
    return nn.Sequential(*layers)


def build_model(
    architecture: str,
    pretrained: bool,
    num_classes: int,
    hidden_dims: Tuple[int, ...],
    dropout: float,
    freeze_backbone: bool,
) -> nn.Module:
    """Instancie un backbone torchvision et remplace son classifieur.

    Args:
        architecture: Nom reconnu.
        pretrained: Utilise les poids ImageNet pré-entraînés si True.
        num_classes: Taille de la sortie finale.
        hidden_dims: Tailles des couches cachées de la tête MLP.
        dropout: Taux de dropout de la tête MLP.
        freeze_backbone: Si True, gèle tous les paramètres sauf ceux de
            la tête de classification.

    Returns:
        nn.Module prêt à l'entraînement, avec sa tête de classification
        remplacée par la structure décrite par `hidden_dims`.
    """
    if architecture not in _CLASSIFIER_ATTR:
        raise ValueError(
            f"Architecture '{architecture}' non supportée. "
            f"Options : {sorted(_CLASSIFIER_ATTR)}"
        )

    constructor = getattr(tv_models, architecture)
    weights = None
    if pretrained:
        weights_enum = getattr(tv_models, _WEIGHTS_ENUM[architecture])
        weights = weights_enum.DEFAULT
    model = constructor(weights=weights)

    attr_name = _CLASSIFIER_ATTR[architecture]
    in_features = _get_in_features(model, attr_name)
    new_head = build_mlp_head(in_features, hidden_dims, num_classes, dropout)
    if _needs_explicit_flatten(model, attr_name):
        new_head = nn.Sequential(nn.Flatten(1), new_head)
    setattr(model, attr_name, new_head)

    if freeze_backbone:
        for name, param in model.named_parameters():
            param.requires_grad = name.startswith(attr_name)
        logger.info(
            "Backbone gelé pour '%s' - seule la tête '%s' est entraînée.",
            architecture, attr_name,
        )
    else:
        logger.info("Fine-tuning complet activé pour '%s'.", architecture)

    return model


def get_classifier_attr(architecture: str) -> str:
    """Nom de l'attribut du classifieur pour une architecture donnée.
    """
    if architecture not in _CLASSIFIER_ATTR:
        raise ValueError(f"Architecture '{architecture}' non supportée.")
    return _CLASSIFIER_ATTR[architecture]
