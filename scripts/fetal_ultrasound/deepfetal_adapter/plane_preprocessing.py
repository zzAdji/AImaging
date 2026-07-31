"""Preprocessing used by DeepFetal's second/third-trimester plane classifier."""

from __future__ import annotations

import torch
from PIL import Image
from torchvision import transforms


IMAGENET_MEAN = [0.485, 0.456, 0.406]
IMAGENET_STD = [0.229, 0.224, 0.225]


def build_plane_transform(image_size: int = 224):
    return transforms.Compose(
        [
            transforms.Resize(int(image_size * 1.14)),
            transforms.CenterCrop(image_size),
            transforms.ToTensor(),
            transforms.Normalize(IMAGENET_MEAN, IMAGENET_STD),
        ]
    )


def load_plane_tensor(image_path, image_size: int = 224) -> torch.Tensor:
    transform = build_plane_transform(image_size)
    with Image.open(image_path) as image:
        tensor = transform(image.convert("RGB"))
    return tensor.unsqueeze(0).float()

