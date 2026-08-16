"""Configuration du modèle DeepScan3D (GRAF) chargé dans models/3D_maker.

Les valeurs reproduisent configs/chest.yaml et configs/default.yaml du repo
DeepScan3D ; les dimensions des couches dérivent de l'analyse du checkpoint
(model_best.pt) et du MLP de run_nerf_helpers_mod.py.
"""

MODEL_CONFIG = {
    "data": {
        "imsize": 128,
        "white_bkgd": False,
        "orthographic": False,
    },
    "renderer": {
        "radius": (9.5, 10.5),
        "near": 7.5,
        "far": 12.5,
        "fov": 10.0,
    },
    "z_dist": {
        "type": "gauss",
        "dim": 256,
        "dim_appearance": 128,
    },
    "nerf": {
        "i_embed": 0,
        "multires": 10,
        "multires_views": 4,
        "use_viewdirs": True,
        "N_samples": 64,
        "N_importance": 0,
        "netdepth": 8,
        "netwidth": 256,
        "perturb": 1,
        "raw_noise_std": 1,
        "chunk": 65536,
        "netchunk": 131072,
        "white_bkgd": False,
        "ndc": False,
    },
    "training": {
        "lr_g": 5e-4,
        "optimizer": "rmsprop",
        "take_model_average": True,
        "model_average_beta": 0.999,
    },
    # Angles de la caméra : la radio d'entrée correspond à une vue frontale.
    # L'élévation doit être la valeur officielle de render_xray_G.py :
    #   vmin=0.32898992833716556 (~70°), vmax=0.45642212862617093 (~85°)
    #   to_theta(v) = arccos(1 - 2*v) * 180/pi  (cône depuis +z)
    #   theta_mean = (to_theta(vmin) + to_theta(vmax)) / 2 = 77.5°
    # Une pose hors de [70°, 85°] sort de la distribution d'entraînement du
    # GAN et bloque l'optimisation inverse (cf. configs/chest.yaml, knee.yaml).
    "reconstruction": {
        "img_size": 48,
        # Itérations d'optimisation inverse. 150 → fortement sous-entraîné/flou ;
        # l'officiel en use jusqu'à 5000 (GPU). Sur CPU seul, rester modeste.
        "n_iter": 600,
        "lr_z": 3e-4,
        "lr_g": 1e-4,
        # Poids du prior N(0,1) appliqué au code latent z : le garde proche de la
        # distribution d'entraînement pour un volume 3D cohérent sur toutes les vues.
        "z_prior_weight": 0.02,
        "elevation_deg": 77.5,
        "n_frames": 36,
        "frame_size": 64,
    },
    "voxel": {
        "resolution": 64,
        "cube_side": 4.0,
    },
}


def nerf_kwargs(nerf_config: dict, z_config: dict) -> dict:
    """Prépare les arguments de construction du MLP NeRF conditionnel."""
    return {
        "multires": nerf_config["multires"],
        "multires_views": nerf_config["multires_views"],
        "use_viewdirs": nerf_config["use_viewdirs"],
        "N_samples": nerf_config["N_samples"],
        "netdepth": nerf_config["netdepth"],
        "netwidth": nerf_config["netwidth"],
        "chunk": nerf_config["chunk"],
        "netchunk": nerf_config["netchunk"],
        "white_bkgd": nerf_config["white_bkgd"],
        "ndc": nerf_config["ndc"],
        "z_dim": z_config["dim"],
        "dim_appearance": z_config["dim_appearance"],
    }
