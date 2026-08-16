"""MLP NeRF conditionnel (portage de run_nerf_helpers_mod.py).

Les noms de paramètres (pts_linears.*, views_linears.*, feature_linear,
alpha_linear, rgb_linear) correspondent exactement aux clés du checkpoint
DeepScan3D afin d'utiliser torch.load_state_dict sans réécriture.
"""

from __future__ import annotations

import torch
import torch.nn as nn
import torch.nn.functional as F


class Embedder:
    """Encodage positionnel (sin/cos à fréquences géométriques), port fidèle."""

    def __init__(self, input_dims: int = 3, num_freqs: int = 10, log_sampling: bool = True):
        self.input_dims = input_dims
        self.num_freqs = num_freqs
        self.embed_fns: list = []
        self.out_dim = 0
        self.create_embedding_fn(log_sampling)

    def create_embedding_fn(self, log_sampling: bool) -> None:
        embed_fns = [lambda x: x]
        out_dim = self.input_dims
        if log_sampling:
            freq_bands = 2.0 ** torch.linspace(0.0, self.num_freqs - 1, steps=self.num_freqs)
        else:
            freq_bands = torch.linspace(2.0 ** 0.0, 2.0 ** (self.num_freqs - 1), steps=self.num_freqs)
        for freq in freq_bands:
            for fn in (torch.sin, torch.cos):
                embed_fns.append(lambda x, fn=fn, freq=freq: fn(x * freq))
                out_dim += self.input_dims
        self.embed_fns = embed_fns
        self.out_dim = out_dim

    def embed(self, inputs: torch.Tensor) -> torch.Tensor:
        return torch.cat([fn(inputs) for fn in self.embed_fns], -1)


def get_embedder(multires: int, input_dims: int = 3) -> tuple[Embedder, int]:
    """Retourne l'encodeur positionnel et sa dimension de sortie."""
    return (
        Embedder(input_dims=input_dims, num_freqs=multires, log_sampling=True),
        input_dims + input_dims * 2 * multires,
    )


def _expand_like(tensor: torch.Tensor, target_shape: tuple[int, ...]) -> torch.Tensor:
    """Étend un tenseur (…, D) par rayon à la dimension point d'échantillonnage."""
    while tensor.dim() < len(target_shape):
        tensor = tensor.unsqueeze(-2)
    return tensor.expand(target_shape[:-1] + (tensor.shape[-1],))


class NeRF(nn.Module):
    """Générateur NeRF conditionnel GRAF (branche simple, sans réseau fin).

    Architecture : 8 couches de largeur 256 avec skip connection à la 6e
    (index 5, décalé par rapport au NeRF original : confirmé par les shapes du
    checkpoint), feature branch, tête alpha et tête RGB dépendante de la
    direction de vue et du code d'apparence.
    """

    def __init__(
        self,
        *,
        d: int = 8,
        w: int = 256,
        input_ch: int = 63,
        input_ch_views: int = 27,
        output_ch: int = 3,
        skips: tuple[int, ...] = (5,),
        use_viewdirs: bool = True,
        z_dim: int = 256,
        dim_appearance: int = 128,
        embed_fn: Embedder | None = None,
        embeddirs_fn: Embedder | None = None,
    ):
        super().__init__()
        self.d = d
        self.w = w
        self.input_ch = input_ch
        self.input_ch_views = input_ch_views
        self.skips = skips
        self.use_viewdirs = use_viewdirs
        self.z_dim = z_dim
        self.dim_appearance = dim_appearance
        self.embed_fn = embed_fn
        self.embeddirs_fn = embeddirs_fn

        # Couche d'entrée : coordonnée encodée + code latente de forme.
        self.pts_linears = nn.ModuleList([nn.Linear(input_ch + dim_appearance, w)])
        for i in range(d - 1):
            in_features = w + (input_ch + dim_appearance if (i + 1) in skips else 0)
            self.pts_linears.append(nn.Linear(in_features, w))
        # Branche vue : direction encodée + caractéristique + code d'apparence.
        self.views_linears = nn.ModuleList([nn.Linear(input_ch_views + w + dim_appearance, w // 2)])
        if use_viewdirs:
            self.feature_linear = nn.Linear(w, w)
            self.alpha_linear = nn.Linear(w, 1)
            self.rgb_linear = nn.Linear(w // 2, output_ch)
        else:
            self.output_linear = nn.Linear(w, output_ch)

    def forward(
        self,
        x: torch.Tensor,
        viewdirs: torch.Tensor | None = None,
        features: torch.Tensor | None = None,
    ) -> torch.Tensor:
        """x : (…, S, 3) positions ; features : (…, z_dim) code latent partagé.

        ``features`` et ``viewdirs`` peuvent être par rayon (…, D) : ils sont
        étendus à chaque point d'échantillonnage automatiquement.
        """
        if self.embed_fn is not None:
            x = self.embed_fn.embed(x)
        if features is not None:
            shape_flat = features[..., : features.shape[-1] - self.dim_appearance]
            shape_flat = _expand_like(shape_flat, x.shape)
            x = torch.cat([x, shape_flat], -1)

        input_pts = x
        for i, layer in enumerate(self.pts_linears):
            if i in self.skips and i > 0:
                x = torch.cat([x, input_pts], -1)
            x = layer(x)
            x = F.relu(x)

        if self.use_viewdirs:
            if viewdirs is None:
                rgb = torch.zeros_like(x[..., :3])
            else:
                if self.embeddirs_fn is not None:
                    viewdirs = self.embeddirs_fn.embed(viewdirs)
                if features is not None:
                    appearance_flat = features[..., features.shape[-1] - self.dim_appearance:]
                    viewdirs = torch.cat([viewdirs, appearance_flat], -1)
                viewdirs = _expand_like(viewdirs, x.shape)
                feature = self.feature_linear(x)
                feature = F.relu(feature)
                for view_layer in self.views_linears:
                    view = view_layer(torch.cat([feature, viewdirs], -1))
                    view = F.relu(view)
                rgb = torch.sigmoid(self.rgb_linear(view))
            alpha = self.alpha_linear(x)
            return torch.cat([rgb, alpha], -1)
        output = self.output_linear(x)
        return output
