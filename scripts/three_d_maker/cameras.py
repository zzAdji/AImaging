"""Caméras et rayons (portage de graf/utils.py + run_nerf_helpers_mod.get_rays)."""

from __future__ import annotations

import math

import numpy as np
import torch


def polar_to_cartesian(r: float, theta: float, phi: float) -> np.ndarray:
    """Coordonnées sphériques → cartésiennes (angles en degrés).

    ``theta`` est l'azimut dans le plan x-y, ``phi`` l'élévation depuis +z.
    """
    theta_rad = math.radians(theta)
    phi_rad = math.radians(phi)
    return np.array([
        r * math.sin(phi_rad) * math.cos(theta_rad),
        r * math.sin(phi_rad) * math.sin(theta_rad),
        r * math.cos(phi_rad),
    ], dtype=np.float64)


def to_phi(theta: float) -> float:
    return 90.0 - theta


def to_theta(phi: float) -> float:
    return 90.0 - phi


def look_at(origin: np.ndarray, target: np.ndarray = np.zeros(3)) -> np.ndarray:
    """Pose caméra 4x4 au format GRAF : [R | loc].

    La rotation correspond aux colonnes [r, f, t] de look_at et la translation
    vaut la position caméra ``origin`` (jamais -R^T · origin) : c'est le format
    utilisé par sample_pose/get_render_poses dans GRAF (get_rays lit la
    position caméra dans c2w[:3, -1]).
    """
    origin = np.asarray(origin, dtype=np.float64)
    target = np.asarray(target, dtype=np.float64)
    t = origin - target
    t = t / (np.linalg.norm(t) + 1e-12)
    up = np.array([0.0, 0.0, 1.0])
    r = np.cross(up, t)
    r = r / (np.linalg.norm(r) + 1e-12)
    f = np.cross(t, r)
    f = f / (np.linalg.norm(f) + 1e-12)
    rt = np.pad(np.stack([r, f, t], axis=1), ((0, 1), (0, 1)), mode="constant")
    rt[:3, 3] = origin
    rt[3, 3] = 1.0
    return rt


def get_render_poses(
    radius: float,
    angle_range: tuple[float, float] = (0.0, 360.0),
    theta: float = 0.0,
    n: int = 40,
    swap_angles: bool = False,
) -> torch.Tensor:
    """Poses de rendu régulièrement espacées autour de l'axe z (port GRAF)."""
    poses = []
    for angle in np.linspace(angle_range[0], angle_range[1], n + 1)[:-1]:
        if swap_angles:
            location = polar_to_cartesian(radius, theta, angle)
        else:
            location = polar_to_cartesian(radius, angle, theta)
        poses.append(look_at(location))
    return torch.tensor(np.stack(poses).astype(np.float32))


def get_rays(
    height: int,
    width: int,
    focal: float,
    c2w: torch.Tensor,
    orthographic: bool = False,
) -> tuple[torch.Tensor, torch.Tensor]:
    """Rayons caméra (perspective par défaut), port de run_nerf_helpers_mod."""
    device = c2w.device
    if orthographic:
        i, j = torch.meshgrid(
            torch.arange(width, dtype=torch.float32, device=device),
            torch.arange(height, dtype=torch.float32, device=device),
            indexing="ij",
        )
        direction = torch.stack([(i - width * 0.5) / focal, -(j - height * 0.5) / focal, -torch.ones_like(i)], -1)
        rays_d = torch.broadcast_to(direction, (height, width, 3)).reshape(-1, 3)
        rays_o = torch.broadcast_to(c2w[:3, -1], (height, width, 3)).reshape(-1, 3)
    else:
        i, j = torch.meshgrid(
            torch.arange(width, dtype=torch.float32, device=device),
            torch.arange(height, dtype=torch.float32, device=device),
            indexing="ij",
        )
        dirs = torch.stack([(i - width * 0.5) / focal, -(j - height * 0.5) / focal, -torch.ones_like(i)], -1)
        rays_d = torch.sum(dirs[..., None, :] * c2w[:3, :3], -1)
        rays_o = torch.broadcast_to(c2w[:3, -1], rays_d.shape)
    # Les rayons restent non normalisés (comme dans run_nerf_helpers_mod) :
    # near/far sont exprimés dans cette paramétrisation lors de l'entraînement.
    return rays_o.reshape(-1, 3), rays_d.reshape(-1, 3)
