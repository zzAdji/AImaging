"""Reconstruction 3D à partir d'une radio unique (DeepScan3D / GRAF porté).

Portage minimal, auto-contenu et CPU-compatible du runtime GRAF
(https://github.com/sanchit1606/DeepScan3D-Single-X-ray-to-3D-CT-Reconstruction-using-Neural-Radiance-Fields-)
: le générateur NeRF conditionnel, le rendu volumétrique différenciable et la
reconstruction (ajustement du code latent + du générateur) sur une radio.

Ne dépend que de torch / numpy / Pillow — pas de LPIPS, ignite ou imageio.
"""

from .reconstruct import ReconstructionResult, reconstruct_volume
from .graf_model import build_generator, load_generator
from .config import MODEL_CONFIG

__all__ = [
    "MODEL_CONFIG",
    "ReconstructionResult",
    "build_generator",
    "load_generator",
    "reconstruct_volume",
]