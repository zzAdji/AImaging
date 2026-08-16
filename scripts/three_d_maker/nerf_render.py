"""Rendu volumétrique différenciable (portage de run_nerf_mod.py).

Seule la branche sans réseau fin (N_importance = 0) est portée : elle
correspond au checkpoint DeepScan3D. Les rayons sont plats (N_rays, 3) et
partagent un code latent ``features`` (B, z_dim) ; le forward du NeRF est
découpé par points (netchunk) pour borner la mémoire.
"""

from __future__ import annotations

import torch
import torch.nn.functional as F

from .network import NeRF


def raw2outputs(
    raw: torch.Tensor,
    z_vals: torch.Tensor,
    white_bkgd: bool = False,
) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
    """Convertit les sorties brutes du NeRF en RGB, profondeur et opacité."""
    rgb = torch.sigmoid(raw[..., :3])
    alpha = 1.0 - torch.exp(-F.relu(raw[..., 3]))
    weights = alpha * torch.cumprod(
        torch.cat([torch.ones((*alpha.shape[:-1], 1), device=raw.device), 1.0 - alpha + 1e-10], -1), -1
    )[..., :-1]
    rgb_map = torch.sum(weights[..., None] * rgb, -2)
    depth_map = torch.sum(weights * z_vals, -1)
    acc_map = torch.sum(weights, -1)
    if white_bkgd:
        rgb_map = rgb_map + (1.0 - acc_map[..., None])
    return rgb_map, depth_map, acc_map


def render_rays(
    ray_batch: torch.Tensor,
    network_fn: NeRF,
    *,
    near: float,
    far: float,
    n_samples: int,
    netchunk: int,
    perturb: float = 0.0,
    white_bkgd: bool = False,
    features: torch.Tensor | None = None,
) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
    """Rend un lot de rayons (N_rays, 11) en (RGB, depth, alpha).

    ``features`` : (N_rays, z_dim) partagé ; les échantillons sont passés au
    réseau par paquets de ``netchunk`` points.
    """
    rays_o, rays_d = ray_batch[..., 0:3], ray_batch[..., 3:6]
    device = ray_batch.device

    z_vals = torch.linspace(near, far, n_samples, device=device)
    z_vals = z_vals.expand(list(rays_o.shape[:-1]) + [n_samples])

    if perturb > 0.0:
        mid_points = 0.5 * (z_vals[..., 1:] + z_vals[..., :-1])
        upper = torch.cat([mid_points, z_vals[..., -1:]], -1)
        lower = torch.cat([z_vals[..., :1], mid_points], -1)
        z_vals = lower + (upper - lower) * torch.rand_like(z_vals)

    pts = rays_o[..., None, :] + rays_d[..., None, :] * z_vals[..., :, None]
    raw_chunks: list[torch.Tensor] = []
    for start in range(0, pts.shape[-2], netchunk):
        end = min(start + netchunk, pts.shape[-2])
        raw_chunks.append(network_fn(pts[..., start:end, :], viewdirs=rays_d, features=features))
    raw = torch.cat(raw_chunks, -2)
    return raw2outputs(raw, z_vals, white_bkgd)


def batchify_rays(
    rays_flat: torch.Tensor,
    chunk: int,
    network_fn: NeRF,
    **kwargs,
) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
    """Découpe les rayons en chunks et agrège les résultats."""
    rgb_maps: list[torch.Tensor] = []
    depth_maps: list[torch.Tensor] = []
    acc_maps: list[torch.Tensor] = []
    for start in range(0, rays_flat.shape[0], chunk):
        end = min(start + chunk, rays_flat.shape[0])
        chunk_features = kwargs["features"][start:end] if kwargs.get("features") is not None else None
        rgb_map, depth_map, acc_map = render_rays(
            rays_flat[start:end],
            network_fn,
            features=chunk_features,
            **{key: value for key, value in kwargs.items() if key != "features"},
        )
        rgb_maps.append(rgb_map)
        depth_maps.append(depth_map)
        acc_maps.append(acc_map)
    return torch.cat(rgb_maps, 0), torch.cat(depth_maps, 0), torch.cat(acc_maps, 0)


def render(
    height: int,
    width: int,
    focal: float,
    rays: torch.Tensor | None = None,
    c2w: torch.Tensor | None = None,
    near: float = 0.0,
    far: float = 1.0,
    white_bkgd: bool = False,
    features: torch.Tensor | None = None,
    **kwargs,
) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor, dict]:
    """Rend une image : renvoie (rgb_map, depth_map, acc_map, extras).

    ``rays`` : (2, N, 3) (origines + directions) ou None pour générer les
    rayons depuis ``c2w`` (4, 4). ``features`` : (B, z_dim), B = nombre de vues.
    """
    if c2w is not None and rays is None:
        from .cameras import get_rays

        rays_o, rays_d = get_rays(height, width, focal, c2w)
        rays = torch.stack([rays_o, rays_d], 0)
    rays_o, rays_d = rays[0], rays[1]
    rays_shape = list(rays_d.shape)
    batch_size = 1 if features is None else features.shape[0]
    n_rays = rays_shape[0] // batch_size

    rays_o_flat = torch.reshape(rays_o, [-1, 3])
    rays_d_flat = torch.reshape(rays_d, [-1, 3])
    rays_flat = torch.cat([rays_o_flat, rays_d_flat], -1)

    if features is not None:
        features = features.unsqueeze(1).expand(-1, n_rays, -1).reshape(-1, features.shape[-1])

    network_fn = kwargs["network_fn"]
    chunk = kwargs.get("chunk", 65536)

    rgb_map, depth_map, acc_map = batchify_rays(
        rays_flat,
        chunk,
        network_fn,
        near=near,
        far=far,
        n_samples=kwargs.get("N_samples", 64),
        netchunk=kwargs.get("netchunk", 131072),
        perturb=kwargs.get("perturb", 0.0),
        white_bkgd=white_bkgd,
        features=features,
    )
    return rgb_map, depth_map, acc_map, {}
