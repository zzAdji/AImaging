"""Modèle HybridGNet (encoder CNN residual + décodeur graphe ChebConv).

Code vendorié depuis https://github.com/mcosarinsky/CheXmask-U (licence MIT),
fichiers ``HybridGNet/models/HybridGNet2IGSC.py`` et
``HybridGNet/models/modelUtils.py``. La classe HF ``HybridGNetHF``
(dépendance ``huggingface_hub``) a été retirée : nous chargeons
directement ``Hybrid`` depuis le checkpoint local.
"""

from __future__ import annotations

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch_geometric.nn.conv import MessagePassing
from torch_geometric.nn.conv.cheb_conv import ChebConv

from chexmask.graph import genMatrixesLungsHeart, scipy_to_torch_sparse

try:  # torchvision.ops.roi_align requis par SkipBlock
    import torchvision
    from torchvision.ops import roi_align
except Exception:  # pragma: no cover - explicité dans is_available()
    roi_align = None


class Pool(MessagePassing):
    """Pooling COMA (https://github.com/pixelite1201/pytorch_coma)."""

    def __init__(self):
        super(Pool, self).__init__(flow="source_to_target")

    def forward(self, x, pool_mat, dtype=None):
        pool_mat = pool_mat.transpose(0, 1)
        out = self.propagate(
            edge_index=pool_mat._indices(), x=x, norm=pool_mat._values(), size=pool_mat.size()
        )
        return out

    def message(self, x_j, norm):
        return norm.view(1, -1, 1) * x_j


class residualBlock(nn.Module):
    """Bloc résiduel (BN, ReLU, conv3x3)² + skip 1x1."""

    def __init__(self, in_channels, out_channels, stride=1):
        super(residualBlock, self).__init__()

        self.skip = nn.Sequential()

        if stride != 1 or in_channels != out_channels:
            self.skip = nn.Sequential(
                nn.Conv2d(in_channels=in_channels, out_channels=out_channels, kernel_size=1, stride=stride, bias=False),
                nn.BatchNorm2d(out_channels, track_running_stats=False),
            )
        else:
            self.skip = None

        self.block = nn.Sequential(
            nn.BatchNorm2d(in_channels, track_running_stats=False),
            nn.ReLU(inplace=True),
            nn.Conv2d(in_channels, out_channels, 3, padding=1),
            nn.BatchNorm2d(out_channels, track_running_stats=False),
            nn.ReLU(inplace=True),
            nn.Conv2d(out_channels, out_channels, 3, padding=1),
        )

    def forward(self, x):
        identity = x
        out = self.block(x)
        if self.skip is not None:
            identity = self.skip(x)
        out = out + identity
        return F.relu(out)


class EncoderConv(nn.Module):
    """Encoder CNN : 6 blocs résiduels jusqu'à 128 canaux, latents 64."""

    def __init__(self, latents=64, hw=32):
        super(EncoderConv, self).__init__()

        self.latents = latents
        self.c = 4
        self.size = self.c * np.array([2, 4, 8, 16, 32], dtype=np.intc)  # [8,16,32,64,128]

        self.maxpool = nn.MaxPool2d(2)

        self.dconv_down1 = residualBlock(1, self.size[0])
        self.dconv_down2 = residualBlock(self.size[0], self.size[1])
        self.dconv_down3 = residualBlock(self.size[1], self.size[2])
        self.dconv_down4 = residualBlock(self.size[2], self.size[3])
        self.dconv_down5 = residualBlock(self.size[3], self.size[4])
        self.dconv_down6 = residualBlock(self.size[4], self.size[4])

        self.fc_mu = nn.Linear(in_features=self.size[4] * hw * hw, out_features=self.latents)
        self.fc_logvar = nn.Linear(in_features=self.size[4] * hw * hw, out_features=self.latents)

    def forward(self, x):
        x = self.dconv_down1(x)
        x = self.maxpool(x)

        x = self.dconv_down2(x)
        x = self.maxpool(x)

        conv3 = self.dconv_down3(x)
        x = self.maxpool(conv3)

        conv4 = self.dconv_down4(x)
        x = self.maxpool(conv4)

        conv5 = self.dconv_down5(x)
        x = self.maxpool(conv5)

        conv6 = self.dconv_down6(x)

        x = conv6.view(conv6.size(0), -1)
        return self.fc_mu(x), self.fc_logvar(x), conv6, conv5


class SkipBlock(nn.Module):
    """Projection positions → ROIAlign du feature map de l'encodeur."""

    def __init__(self, in_filters, window):
        super(SkipBlock, self).__init__()
        self.window = window
        self.graphConv_pre = ChebConv(in_filters, 2, 1, bias=False)

    def lookup(self, pos, layer, salida=(1, 1)):
        B = pos.shape[0]
        N = pos.shape[1]
        F = layer.shape[1]
        h = layer.shape[-1]

        pos = pos * h

        _x1 = (self.window[0] // 2) * 1.0
        _x2 = (self.window[0] // 2 + 1) * 1.0
        _y1 = (self.window[1] // 2) * 1.0
        _y2 = (self.window[1] // 2 + 1) * 1.0

        boxes = []
        for batch in range(0, B):
            x1 = pos[batch, :, 0].reshape(-1, 1) - _x1
            x2 = pos[batch, :, 0].reshape(-1, 1) + _x2
            y1 = pos[batch, :, 1].reshape(-1, 1) - _y1
            y2 = pos[batch, :, 1].reshape(-1, 1) + _y2
            aux = torch.cat([x1, y1, x2, y2], axis=1)
            boxes.append(aux)

        skip = roi_align(layer, boxes, output_size=salida, aligned=True)
        return skip.view([B, N, -1])

    def forward(self, x, adj, conv_layer):
        pos = self.graphConv_pre(x, adj)
        skip = self.lookup(pos, conv_layer)
        return torch.cat((x, skip, pos), axis=2), pos


class Hybrid(nn.Module):
    """Modèle complet : encode → latents → décode par ChebConv + skip."""

    def __init__(self, config, downsample_matrices, upsample_matrices, adjacency_matrices):
        super(Hybrid, self).__init__()

        self.config = config
        hw = config["inputsize"] // 32
        self.z = config["latents"]
        self.encoder = EncoderConv(latents=self.z, hw=hw)
        self.eval_sampling = config["eval_sampling"]

        self.downsample_matrices = downsample_matrices
        self.upsample_matrices = upsample_matrices
        self.adjacency_matrices = adjacency_matrices
        self.kld_weight = 1e-5

        n_nodes = config["n_nodes"]
        self.filters = config["filters"]
        self.K = 6
        self.window = (3, 3)

        outshape = self.filters[-1] * n_nodes[-1]
        self.dec_lin = torch.nn.Linear(self.z, outshape)

        self.normalization2u = torch.nn.InstanceNorm1d(self.filters[1])
        self.normalization3u = torch.nn.InstanceNorm1d(self.filters[2])
        self.normalization4u = torch.nn.InstanceNorm1d(self.filters[3])
        self.normalization5u = torch.nn.InstanceNorm1d(self.filters[4])
        self.normalization6u = torch.nn.InstanceNorm1d(self.filters[5])

        outsize1 = self.encoder.size[4]
        outsize2 = self.encoder.size[4]

        self.graphConv_up6 = ChebConv(self.filters[6], self.filters[5], self.K)
        self.graphConv_up5 = ChebConv(self.filters[5], self.filters[4], self.K)

        self.SC_1 = SkipBlock(self.filters[4], self.window)

        self.graphConv_up4 = ChebConv(self.filters[4] + outsize1 + 2, self.filters[3], self.K)
        self.graphConv_up3 = ChebConv(self.filters[3], self.filters[2], self.K)

        self.SC_2 = SkipBlock(self.filters[2], self.window)

        self.graphConv_up2 = ChebConv(self.filters[2] + outsize2 + 2, self.filters[1], self.K)
        self.graphConv_up1 = ChebConv(self.filters[1], self.filters[0], 1, bias=False)

        self.pool = Pool()

        self.reset_parameters()

    def reset_parameters(self):
        torch.nn.init.normal_(self.dec_lin.weight, 0, 0.1)

    def sampling(self, mu, log_var):
        std = torch.exp(0.5 * log_var)
        eps = torch.randn_like(std)
        return eps.mul(std).add_(mu)

    def encode(self, x):
        mu, log_var, conv6, conv5 = self.encoder(x)
        return mu, log_var, conv6, conv5

    def decode(self, z, conv6, conv5):
        x = self.dec_lin(z)
        x = F.relu(x)
        x = x.reshape(x.shape[0], -1, self.filters[-1])

        x = self.graphConv_up6(x, self.adjacency_matrices[5]._indices())
        x = self.normalization6u(x)
        x = F.relu(x)

        x = self.graphConv_up5(x, self.adjacency_matrices[4]._indices())
        x = self.normalization5u(x)
        x = F.relu(x)

        x, pos1 = self.SC_1(x, self.adjacency_matrices[3]._indices(), conv6)

        x = self.graphConv_up4(x, self.adjacency_matrices[3]._indices())
        x = self.normalization4u(x)
        x = F.relu(x)

        x = self.pool(x, self.upsample_matrices[0])

        x = self.graphConv_up3(x, self.adjacency_matrices[2]._indices())
        x = self.normalization3u(x)
        x = F.relu(x)

        x, pos2 = self.SC_2(x, self.adjacency_matrices[1]._indices(), conv5)

        x = self.graphConv_up2(x, self.adjacency_matrices[1]._indices())
        x = self.normalization2u(x)
        x = F.relu(x)

        x = self.graphConv_up1(x, self.adjacency_matrices[0]._indices())
        return x, pos1, pos2

    def forward(self, x):
        self.mu, self.log_var, conv6, conv5 = self.encode(x)

        if self.training or self.eval_sampling:
            z = self.sampling(self.mu, self.log_var)
        else:
            z = self.mu

        return self.decode(z, conv6, conv5)


def build_model(device: str = "cpu") -> tuple[Hybrid, list, list, list]:
    """Construit le modèle ``Hybrid`` (config v1_skip) avec ses matrices.

    Retourne (modèle, A_t, D_t, U_t) prêts à l'inférence.
    """
    import scipy.sparse as sp

    A, AD, D, U = genMatrixesLungsHeart()
    N1 = A.shape[0]
    N2 = AD.shape[0]

    A = sp.csc_matrix(A).tocoo()
    AD = sp.csc_matrix(AD).tocoo()
    D = sp.csc_matrix(D).tocoo()
    U = sp.csc_matrix(U).tocoo()

    D_ = [D.copy()]
    U_ = [U.copy()]
    A_ = [A.copy(), A.copy(), A.copy(), AD.copy(), AD.copy(), AD.copy()]

    config = {
        "n_nodes": [N1, N1, N1, N2, N2, N2],
        "latents": 64,
        "inputsize": 1024,
        "K": 6,
        "filters": [2, 32, 32, 32, 16, 16, 16],
        "skip_features": 32,
        "eval_sampling": True,
    }

    A_t = [scipy_to_torch_sparse(x).to(device) for x in A_]
    D_t = [scipy_to_torch_sparse(x).to(device) for x in D_]
    U_t = [scipy_to_torch_sparse(x).to(device) for x in U_]

    model = Hybrid(config, D_t, U_t, A_t).to(device)
    return model, A_t, D_t, U_t