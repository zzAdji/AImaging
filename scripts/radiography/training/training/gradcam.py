"""Grad-CAM 
Sert de vérification qualitative complémentaire à la grille avant/après
du module de prétraitement : là où celle-ci vérifie que le prétraitement
ne déforme pas l'image, Grad-CAM vérifie que le modèle regarde des
structures anatomiquement pertinentes plutôt que des artefacts.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import List, Optional, Tuple

import cv2
import numpy as np
import torch
import torch.nn as nn
from PIL import Image

logger = logging.getLogger("training.gradcam")


def get_default_target_layer(model: nn.Module, architecture: str) -> nn.Module:
    """Choisit la dernière couche convolutionnelle par défaut, par architecture.

    Toutes les architectures supportées sauf la famille ResNet exposent
    un attribut `.features` (DenseNet, EfficientNet, VGG, ConvNeXt) qui
    correspond exactement à la carte de caractéristiques juste avant le
    pooling global - c'est la cible standard pour Grad-CAM. ResNet expose
    `.layer4` à la place.
    """
    if architecture.startswith("resnet"):
        return model.layer4
    if hasattr(model, "features"):
        return model.features
    raise ValueError(
        f"Impossible de déterminer une couche cible par défaut pour '{architecture}'. "
        "Passez `target_layer` explicitement à GradCAM."
    )


class GradCAM:
    """Calcule une carte de chaleur Grad-CAM pour une image et une classe donnée.

    Le gradient de la couche cible est capturé via un hook posé
    directement sur le tenseur de sortie (`Tensor.register_hook`) plutôt
    que via `register_full_backward_hook` sur le module. C'est
    nécessaire pour rester compatible avec les architectures qui
    enchaînent des opérations in-place juste après la couche cible (ex.
    DenseNet : `F.relu(x, inplace=True)`), où un hook au niveau module
    provoque une erreur autograd ("view is being modified inplace").
    """

    def __init__(self, model: nn.Module, target_layer: nn.Module) -> None:
        self.model = model
        self._activations: Optional[torch.Tensor] = None
        self._gradients: Optional[torch.Tensor] = None
        self._forward_handle = target_layer.register_forward_hook(self._forward_hook)

    def _forward_hook(self, module, inputs, output) -> None:
        self._activations = output.detach()
        if output.requires_grad:
            output.register_hook(self._save_gradient)

    def _save_gradient(self, grad: torch.Tensor) -> None:
        self._gradients = grad.detach()

    def generate(
        self, input_tensor: torch.Tensor, class_idx: Optional[int] = None
    ) -> Tuple[np.ndarray, int]:
        """Calcule la carte Grad-CAM pour une image (batch de taille 1).

        Args:
            input_tensor: Tenseur (1, C, H, W), déjà normalisé, sur le
                même device que le modèle.
            class_idx: Classe cible. Si None, utilise la classe prédite
                par le modèle (comportement de Shahzad et al.).

        Returns:
            (carte_normalisee_0_1 de forme (h, w) à la résolution de la
            couche cible, index de la classe utilisée).
        """
        self.model.eval()
        input_tensor = input_tensor.clone().detach().requires_grad_(True)

        output = self.model(input_tensor)
        if class_idx is None:
            class_idx = int(output.argmax(dim=1).item())

        self.model.zero_grad()
        output[0, class_idx].backward()

        weights = self._gradients.mean(dim=(2, 3), keepdim=True)
        cam = torch.relu((weights * self._activations).sum(dim=1, keepdim=True))
        cam = cam.squeeze().cpu().numpy()

        if cam.max() > cam.min():
            cam = (cam - cam.min()) / (cam.max() - cam.min())
        else:
            cam = np.zeros_like(cam)
        return cam, class_idx

    def remove_hooks(self) -> None:
        self._forward_handle.remove()


def overlay_heatmap(original_rgb: np.ndarray, cam: np.ndarray, alpha: float = 0.4) -> np.ndarray:
    """Superpose une carte Grad-CAM (normalisée [0,1]) sur une image RGB uint8."""
    heatmap = cv2.resize(cam, (original_rgb.shape[1], original_rgb.shape[0]))
    heatmap_colored = cv2.applyColorMap(np.uint8(255 * heatmap), cv2.COLORMAP_JET)
    heatmap_colored = cv2.cvtColor(heatmap_colored, cv2.COLOR_BGR2RGB)
    overlay = (alpha * heatmap_colored + (1 - alpha) * original_rgb).astype(np.uint8)
    return overlay


def generate_gradcam_grid(
    model: nn.Module,
    architecture: str,
    samples: List[Tuple[Path, str]],
    eval_transform,
    input_size: Tuple[int, int],
    device: torch.device,
    output_path: Path,
    target_layer: Optional[nn.Module] = None,
) -> Path:
    """Génère une grille Grad-CAM pour un échantillon d'images (une par ligne).

    Args:
        model: Modèle déjà chargé (checkpoint restauré), en mode eval.
        architecture: Nom de l'architecture (pour choisir la couche cible
            par défaut si `target_layer` n'est pas fourni).
        samples: Liste de (chemin_image_prétraitée, classe_reelle).
        eval_transform: Transform torchvision (ToTensor + Normalize),
            cohérent avec celui utilisé à l'entraînement.
        input_size: (H, W) attendue par le modèle.
        device: Device sur lequel exécuter l'inférence.
        output_path: Chemin du PNG de sortie.
        target_layer: Couche cible explicite, sinon dérivée automatiquement.

    Returns:
        Le chemin du PNG écrit.
    """
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    layer = target_layer or get_default_target_layer(model, architecture)
    cam_tool = GradCAM(model, layer)

    fig, axes = plt.subplots(len(samples), 2, figsize=(6, 3 * len(samples)))
    if len(samples) == 1:
        axes = axes.reshape(1, 2)

    try:
        for row, (path, true_class) in enumerate(samples):
            with Image.open(path) as img:
                rgb_img = img.convert("RGB").resize((input_size[1], input_size[0]))
            original_array = np.array(rgb_img)

            tensor = eval_transform(rgb_img).unsqueeze(0).to(device)
            cam, pred_idx = cam_tool.generate(tensor)
            overlay = overlay_heatmap(original_array, cam)

            axes[row, 0].imshow(original_array)
            axes[row, 0].set_title(f"Original ({true_class})", fontsize=9)
            axes[row, 0].axis("off")

            axes[row, 1].imshow(overlay)
            axes[row, 1].set_title(f"Grad-CAM (prédit: classe {pred_idx})", fontsize=9)
            axes[row, 1].axis("off")
    finally:
        cam_tool.remove_hooks()

    output_path.parent.mkdir(parents=True, exist_ok=True)
    fig.suptitle(f"Grad-CAM - {architecture}")
    fig.tight_layout()
    fig.savefig(output_path, dpi=130, bbox_inches="tight")
    plt.close(fig)
    logger.info("Grille Grad-CAM écrite : %s", output_path)
    return output_path
