"""Wrapper du générateur DeepScan3D : checkpoint → MLP NeRF prêt à rendre.

Le checkpoint (models/3D_maker/model_best.pt) contient un dict
{it, epoch_idx, fid_best, kid_best, discriminator, g_optimizer, d_optimizer,
generator, generator_test}. On charge de préférence ``generator_test`` (moyenne
exponentielle des poids, utilisée pour l'inférence dans render_xray_G.py).
"""

from __future__ import annotations

from pathlib import Path

import torch
import torch.nn as nn

from .cameras import get_rays
from .config import MODEL_CONFIG, nerf_kwargs
from .nerf_render import render
from .network import NeRF, get_embedder


def create_nerf(nerf_config: dict, z_config: dict) -> NeRF:
    """Construit le MLP NeRF conditionnel avec l'encodage positionnel interne."""
    embed_fn, input_ch = get_embedder(nerf_config["multires"], 3)
    embeddirs_fn, input_ch_views = get_embedder(nerf_config["multires_views"], 3)
    model = NeRF(
        d=nerf_config["netdepth"],
        w=nerf_config["netwidth"],
        input_ch=input_ch,
        input_ch_views=input_ch_views,
        output_ch=3,
        skips=(5,),
        use_viewdirs=nerf_config["use_viewdirs"],
        z_dim=z_config["dim"],
        dim_appearance=z_config["dim_appearance"],
        embed_fn=embed_fn,
        embeddirs_fn=embeddirs_fn,
    )
    return model


class GrafGenerator(nn.Module):
    """Générateur NeRF conditionnel : rendu d'une vue à partir d'un code latent z.

    Le module porte directement les poids du checkpoint (module_dict a été
    aplati à la sauvegarde : les clés ``pts_linears.*`` vivent ici au niveau
    racine).
    """

    def __init__(
        self,
        nerf_config: dict,
        z_config: dict,
        device: torch.device,
        renderer_config: dict | None = None,
    ):
        super().__init__()
        self.nerf = create_nerf(nerf_config, z_config).to(device)
        self.nerf_config = nerf_config
        self.z_config = z_config
        self.device = device
        renderer_config = renderer_config or MODEL_CONFIG["renderer"]
        self.render_kwargs = {
            "near": renderer_config["near"],
            "far": renderer_config["far"],
            "chunk": nerf_config["chunk"],
            "white_bkgd": nerf_config["white_bkgd"],
            "N_samples": nerf_config["N_samples"],
            "use_viewdirs": nerf_config["use_viewdirs"],
        }

    @property
    def dim_latent(self) -> int:
        return self.z_config["dim"]

    def render_pose(
        self,
        pose: torch.Tensor,
        features: torch.Tensor,
        height: int,
        width: int,
        focal: float,
    ) -> torch.Tensor:
        """Rend une vue (H, W, 3) en [0, 1] depuis une pose 4x4 et un code z."""
        pose = pose.to(self.device)
        rays_o, rays_d = get_rays(height, width, focal, pose)
        rays = torch.stack([rays_o, rays_d], 0)
        rgb_map, _depth_map, _acc_map, _extras = render(
            height,
            width,
            focal,
            rays=rays,
            features=features,
            network_fn=self.nerf,
            network_query_fn=None,
            **self.render_kwargs,
        )
        return rgb_map.reshape(height, width, 3)


def load_generator(checkpoint_path: Path, device: torch.device | None = None) -> GrafGenerator:
    """Charge le checkpoint DeepScan3D dans un GrafGenerator prêt à rendre."""
    if device is None:
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    generator = GrafGenerator(MODEL_CONFIG["nerf"], MODEL_CONFIG["z_dist"], device)
    checkpoint = torch.load(checkpoint_path, map_location=device, weights_only=False)
    state_dict = None
    for key in ("generator_test", "generator"):
        if key in checkpoint and isinstance(checkpoint[key], dict):
            state_dict = checkpoint[key]
            break
    if state_dict is None:
        raise RuntimeError(
            f"Checkpoint '{checkpoint_path}' invalide : ni 'generator_test' ni 'generator' n'y sont présents."
        )
    missing, unexpected = generator.nerf.load_state_dict(state_dict, strict=False)
    if unexpected:
        raise RuntimeError(f"Clés inattendues dans le checkpoint 3D : {sorted(unexpected)[:5]}...")
    if missing:
        raise RuntimeError(f"Paramètres manquants dans le checkpoint 3D : {sorted(missing)[:5]}...")
    generator.eval()
    return generator


def build_generator(
    nerf_config: dict | None = None,
    z_config: dict | None = None,
    device: torch.device | None = None,
) -> GrafGenerator:
    """Construit un générateur non initialisé (pratique pour la sérialisation)."""
    nerf_config = nerf_config or MODEL_CONFIG["nerf"]
    z_config = z_config or MODEL_CONFIG["z_dist"]
    if device is None:
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    return GrafGenerator(nerf_config, z_config, device)
