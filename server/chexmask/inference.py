"""Inférence HybridGNet : landmarks poumons + cœur avec incertitude.

Pipeline repris de ``HybridGNet/inferenceWithSampling.py`` (CheXmask-U,
licence MIT) : encode une fois, puis N échantillons latents décodés en
batch → moyenne et écart-type **par nœud** (coordonnées 1024×1024).
"""

from __future__ import annotations

import logging
from pathlib import Path

import cv2
import numpy as np
import torch

from chexmask.graph import ORGAN_SLICES
from chexmask.model import build_model

logger = logging.getLogger("server.chexmask.inference")

INPUT_SIZE = 1024
DEFAULT_WEIGHTS = Path(__file__).resolve().parents[2] / "models" / "cheXmask" / "hybridgnet_v1_skip.pt"


class CheXmaskUnavailableError(RuntimeError):
    """torch, torch_geometric ou les poids du modèle sont indisponibles."""


class LandmarkInference:
    """Instance du modèle : matrice + poids chargés au premier appel.

    Le serveur garde une instance unique (voir ``chexmask_service.get_engine``)
    et la réutilise entre les requêtes : le coût ``build_model`` + ``torch.load``
    n'est payé qu'une fois, idéalement au démarrage via ``preload()``.
    """

    def __init__(self, weights_path: Path = DEFAULT_WEIGHTS, n_samples: int = 50):
        self.weights_path = Path(weights_path)
        self.n_samples = n_samples
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self._model = None

    # ------------------------------------------------------------------ #
    @property
    def model(self):
        if self._model is None:
            self._load()
        return self._model

    @property
    def is_loaded(self) -> bool:
        """Les poids sont-ils déjà en mémoire ?"""
        return self._model is not None

    def _load(self):
        if not self.weights_path.exists():
            raise CheXmaskUnavailableError(
                f"Poids HybridGNet introuvables : {self.weights_path}"
            )
        model, _a, _d, _u = build_model(self.device)
        state = torch.load(self.weights_path, map_location=self.device)
        if next(iter(state.keys())).startswith("model."):
            state = {k[len("model.") :]: v for k, v in state.items()}
        model.load_state_dict(state)
        model.eval()
        self._model = model
        logger.info("HybridGNet chargé (%s) depuis %s", self.device, self.weights_path)

    def preprocess(self, image_bgr: np.ndarray) -> torch.Tensor:
        """Gris → float /255 → tenseur (1,1,1024,1024)."""
        if image_bgr.ndim == 3:
            image = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
        else:
            image = image_bgr
        image = cv2.resize(image, (INPUT_SIZE, INPUT_SIZE), interpolation=cv2.INTER_LINEAR)
        image = image.astype(np.float32) / 255.0
        return torch.from_numpy(image).unsqueeze(0).unsqueeze(0).to(self.device).float()

    @torch.no_grad()
    def predict_landmarks(self, image_bgr: np.ndarray, n_samples: int | None = None) -> dict:
        """Prédit les 120 nœuds (px, py) + incertitude par nœud.

        ``n_samples`` peut surcharger la valeur du constructeur : le moteur
        étant partagé entre requêtes, chacune choisit son nombre d'échantillons.

        Retourne un dict {nodes, mean_x, mean_y, std_x, std_y} où chaque
        tableau a 120 lignes, en coordonnées pixels de l'image 1024×1024.
        """
        samples = self.n_samples if n_samples is None else max(1, int(n_samples))
        model = self.model
        data = self.preprocess(image_bgr)

        mu, log_var, conv6, conv5 = model.encode(data)

        zs = [model.sampling(mu, log_var) for _ in range(samples)]
        z_exp = torch.stack(zs, dim=0)
        batch_size = z_exp.shape[0]

        conv6_exp = conv6.repeat(batch_size, 1, 1, 1)
        conv5_exp = conv5.repeat(batch_size, 1, 1, 1)

        batch_output, _, _ = model.decode(z_exp, conv6_exp, conv5_exp)
        batch_output = batch_output.cpu().numpy().reshape(samples, -1, 2) * INPUT_SIZE

        means = np.mean(batch_output, axis=0)
        stds = np.std(batch_output, axis=0)

        return {
            "nodes": np.arange(means.shape[0], dtype=int).tolist(),
            "mean_x": means[:, 0],
            "mean_y": means[:, 1],
            "std_x": stds[:, 0],
            "std_y": stds[:, 1],
        }

    def organ_points(self, result: dict, organ: str) -> np.ndarray:
        """Coordonnées (x, y) des nœuds d'un organe, shape (N, 2)."""
        idx = list(ORGAN_SLICES[organ])
        return np.stack([result["mean_x"][idx], result["mean_y"][idx]], axis=1)