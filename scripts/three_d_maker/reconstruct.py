"""Reconstruction 3D à partir d'une radio : rendu, optimisation et voxélisation.

Pipeline fidèle à render_xray_G.py du repo DeepScan3D :
1. le code latent z et les poids du générateur sont optimisés (Adam) jusqu'à
   ce que la projection rendue ressemble à la radio d'entrée (MSE, espace [-1,1]) ;
2. les vues rotatives 360° sont rendues avec le générateur optimisé ;
3. le volume est échantillonné sur une grille (densité = alpha relu) pour la
   visualisation interactive côté client.
"""

from __future__ import annotations

import base64
import io
import math
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import BinaryIO, Callable, Sequence

import numpy as np
import torch
from PIL import Image

from .cameras import get_render_poses
from .config import MODEL_CONFIG
from .graf_model import GrafGenerator, load_generator

ProgressCallback = Callable[[float, str], None]


@dataclass
class ReconstructionResult:
    frames: list[dict] = field(default_factory=list)  # [{angle, data_url}]
    volume: dict = field(default_factory=dict)  # {nx, ny, nz, spacing, data_b64}
    loss_history: list[float] = field(default_factory=list)
    device: str = "cpu"
    elapsed_sec: float = 0.0


def _noop_progress(fraction: float, message: str) -> None:
    pass


def _build_perceptual_loss(device: torch.device):
    """Perte officielle render_xray_G.py (0.3*LPIPS + 0.1*MSE) si dispo.

    LPIPS exige les poids AlexNet (233 Mo, mis en cache par torch.hub). S'ils
    ne sont pas déjà présents, on retombe sur la MSE seule plutôt que de
    bloquer la reconstruction sur un téléchargement.
    """
    import torch.hub as hub

    cached = Path(hub.get_dir()) / "checkpoints" / "alexnet-owt-7be5be79.pth"
    if not cached.exists():
        return None
    try:
        import lpips

        net = lpips.LPIPS(net="alex", verbose=False).to(device).eval()
    except Exception:  # noqa: BLE001
        return None

    def loss_fn(rendered: torch.Tensor, target: torch.Tensor) -> torch.Tensor:
        return 0.3 * net(rendered, target) + 0.1 * torch.nn.functional.mse_loss(rendered, target)

    return loss_fn


def _mse_structural_loss(
    rendered: torch.Tensor,
    target: torch.Tensor,
    *,
    lap_weight: float = 0.25,
) -> torch.Tensor:
    """Remplacement légèrement structuré de la MSE quand LPIPS est absent.

    La MSE pure conduit à des reconstructions lissées (moyenne sur l'ambiguïté
    du problème inverse). On ajoute un terme de Laplacien (détecteur de bords,
    ~0 coût, sans dépendance) qui pénalise directement l'écart de structure
    entre le rendu et la cible, pour retrouver des contours nets.
    """
    import torch.nn.functional as F

    mse = F.mse_loss(rendered, target)
    laplacian = [[0, 1, 0], [1, -4, 1], [0, 1, 0]]
    # 1 canal de sortie, 3 canaux d'entrée (RGB) : le même Laplacien est appliqué
    # à chaque canal puis sommé, pour une sortie mono-canal.
    kernel = torch.tensor([[laplacian] * rendered.shape[1]], dtype=rendered.dtype, device=rendered.device)
    lap = F.conv2d(rendered, kernel, padding=1) - F.conv2d(target, kernel, padding=1)
    return mse + lap_weight * lap.square().mean()


def _focal_length(imsize: int, fov_deg: float) -> float:
    return (imsize / 2.0) / math.tan(math.radians(fov_deg) / 2.0)


def _load_target(image_source: BinaryIO | Path | bytes, img_size: int) -> torch.Tensor:
    """Radio → tenseur (1, 3, H, W) normalisé dans [-1, 1]."""
    if isinstance(image_source, (bytes, bytearray)):
        image_source = io.BytesIO(image_source)
    with Image.open(image_source) as img:
        gray = np.asarray(img.convert("L"), dtype=np.float32)
    gray = np.asarray(Image.fromarray(np.uint8(gray)).resize((img_size, img_size), Image.LANCZOS))
    tensor = torch.tensor(gray, dtype=torch.float32) / 127.5 - 1.0
    return tensor.unsqueeze(0).unsqueeze(0).expand(-1, 3, -1, -1).contiguous()


def _encode_frame(rgb_map: np.ndarray) -> str:
    """Vue (H, W, 3) en [0, 1] → data URL PNG."""
    frame = np.clip(np.uint8(rgb_map * 255.0), 0, 255)
    buffer = io.BytesIO()
    Image.fromarray(frame, mode="RGB").save(buffer, format="PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")


def _optimize(
    generator: GrafGenerator,
    features: torch.nn.Parameter,
    target: torch.Tensor,
    img_size: int,
    focal: float,
    pose: torch.Tensor,
    n_iter: int,
    lr_z: float,
    lr_g: float,
    progress: ProgressCallback,
    loss_fn=None,
    z_prior_weight: float = 0.0,
) -> list[float]:
    """Ajuste z + poids du générateur sur la radio cible.

    Perte = LPIPS+MSE (officiel) si disponible, sinon MSE + Laplacien. Un petit
    prior gaussien sur ``z`` (z_prior_weight) le garde proche de N(0,1) : le
    générateur y est entraîné, ce qui évite un ``z`` hors distribution qui ferait
    s'effondrer le volume 3D au-delà de la vue frontale optimisée.
    """
    pose = pose.to(generator.device)
    target = target.to(generator.device)
    optimizer = torch.optim.Adam(
        [
            {"params": generator.nerf.parameters(), "lr": lr_g},
            {"params": [features], "lr": lr_z},
        ]
    )
    loss_history: list[float] = []
    for step in range(n_iter):
        optimizer.zero_grad()
        rgb = generator.render_pose(pose, features, img_size, img_size, focal)
        rgb = rgb * 2.0 - 1.0  # [0,1] → [-1,1], espace d'entraînement
        rendered = rgb.permute(2, 0, 1).unsqueeze(0)  # (1, 3, H, W)
        if loss_fn is not None:
            loss = loss_fn(rendered, target)
        else:
            loss = _mse_structural_loss(rendered, target)
        if z_prior_weight > 0.0:
            loss = loss + z_prior_weight * features.square().mean()
        loss.backward()
        optimizer.step()
        loss_history.append(float(loss.detach()))
        if step % 50 == 0 or step == n_iter - 1:
            progress(0.05 + 0.75 * (step + 1) / n_iter, f"Optimisation : itération {step + 1}/{n_iter}")
    return loss_history


def _voxelize(
    generator: GrafGenerator,
    features: torch.Tensor,
    resolution: int,
    cube_side: float,
) -> bytes:
    """Densité (alpha relu, clampé 0..1) sur une grille cube 3D, en uint8 brut."""
    lin = np.linspace(-cube_side / 2.0, cube_side / 2.0, resolution, dtype=np.float32)
    grid = np.stack(np.meshgrid(lin, lin, lin, indexing="ij"), axis=-1).reshape(-1, 3)
    grid_tensor = torch.tensor(grid, device=generator.device)
    shape_latent = features[0, : features.shape[-1] - generator.nerf.dim_appearance]

    density = np.zeros((grid.shape[0],), dtype=np.float32)
    with torch.no_grad():
        for start in range(0, grid_tensor.shape[0], 16384):
            end = min(start + 16384, grid_tensor.shape[0])
            pts = grid_tensor[start:end]
            embedded = generator.nerf.embed_fn.embed(pts)
            shape_expanded = shape_latent.unsqueeze(0).expand(embedded.shape[0], -1)
            x = torch.cat([embedded, shape_expanded], -1)
            input_pts = x
            for i, layer in enumerate(generator.nerf.pts_linears):
                if i in generator.nerf.skips and i > 0:
                    x = torch.cat([x, input_pts], -1)
                x = torch.relu(layer(x))
            alpha_raw = generator.nerf.alpha_linear(x).squeeze(-1)
            density[start:end] = torch.clamp(torch.relu(alpha_raw), 0.0, 1.0).cpu().numpy()

    volume = np.uint8(np.round(density.reshape(resolution, resolution, resolution) * 255.0))
    return volume.tobytes()


def reconstruct_volume(
    image_source: BinaryIO | Path | bytes,
    checkpoint_path: Path,
    *,
    progress: ProgressCallback | None = None,
    device: str | None = None,
    n_iter: int | None = None,
    n_frames: int | None = None,
) -> ReconstructionResult:
    """Reconstruit le volume 3D depuis une radio et rend les vues rotatives.

    ``image_source`` : chemin, file-like ou octets d'une image 2D.
    Retourne les frames PNG encodées en data URL et le volume brut uint8.
    """
    started = time.perf_counter()
    progress = progress or _noop_progress
    config = MODEL_CONFIG
    reconstruction = config["reconstruction"]
    voxel = config["voxel"]
    renderer = config["renderer"]

    torch_device = torch.device(device if device in {"cpu", "cuda"} else ("cuda" if torch.cuda.is_available() else "cpu"))
    progress(0.02, "Chargement du générateur 3D…")
    generator = load_generator(checkpoint_path, torch_device)
    generator.eval()

    img_size = int(reconstruction["img_size"])
    focal = _focal_length(config["data"]["imsize"], renderer["fov"])
    progress(0.04, "Préparation de la radio…")
    target = _load_target(image_source, img_size)

    z = torch.randn(1, generator.dim_latent, device=torch_device, requires_grad=True)
    pose = get_render_poses(renderer["radius"][1], (0.0, 360.0), reconstruction["elevation_deg"], n=1)[0]

    loss_fn = _build_perceptual_loss(torch_device)
    loss_history = _optimize(
        generator,
        z,
        target,
        img_size,
        focal,
        pose,
        int(n_iter if n_iter is not None else reconstruction["n_iter"]),
        reconstruction["lr_z"],
        reconstruction["lr_g"],
        progress,
        loss_fn=loss_fn,
        z_prior_weight=reconstruction.get("z_prior_weight", 0.0),
    )

    progress(0.82, "Rendu des vues 3D…")
    frame_size = int(reconstruction["frame_size"])
    n_frames = int(n_frames if n_frames is not None else reconstruction["n_frames"])
    poses = get_render_poses(renderer["radius"][1], (0.0, 360.0), reconstruction["elevation_deg"], n=n_frames)
    frames: list[dict] = []
    with torch.no_grad():
        for index, frame_pose in enumerate(poses):
            rgb = generator.render_pose(frame_pose, z.detach(), frame_size, frame_size, focal)
            frames.append({
                "angle": int(round(360.0 * index / n_frames)),
                "data_url": _encode_frame(rgb.cpu().numpy()),
            })
            progress(0.82 + 0.13 * (index + 1) / n_frames, f"Rendu des vues : {index + 1}/{n_frames}")

    progress(0.96, "Construction du volume…")
    volume_bytes = _voxelize(generator, z.detach(), int(voxel["resolution"]), voxel["cube_side"])
    volume = {
        "nx": int(voxel["resolution"]),
        "ny": int(voxel["resolution"]),
        "nz": int(voxel["resolution"]),
        "spacing": float(voxel["cube_side"] / (voxel["resolution"] - 1)),
        "data_b64": base64.b64encode(volume_bytes).decode("ascii"),
    }

    progress(1.0, "Reconstruction terminée.")
    return ReconstructionResult(
        frames=frames,
        volume=volume,
        loss_history=loss_history,
        device=str(torch_device),
        elapsed_sec=time.perf_counter() - started,
    )
