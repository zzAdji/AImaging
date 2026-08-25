"""Moteur d'abstraction autour de la bibliothèque CXAS.

Seul module du paquet qui importe ``cxas``, et uniquement à la demande
(première analyse effective). Le serveur de classification peut donc
démarrer sans que CXAS soit installé.

Point d'entrée fidèle à l'API officielle vérifiée :
``CXAS(model_name, gpus)`` puis ``server.process_file(...)`` et
``server.extractor.extract(...)``.
"""

from __future__ import annotations

import logging
import threading
from pathlib import Path

from . import config

logger = logging.getLogger("anatomy.cxas_engine")


class CxasUnavailableError(RuntimeError):
    """CXAS (ou ses poids) n'est pas disponible sur la machine.

    Message porteur : indique comment remédier (`install_cxas.py`).
    """


_engine_lock = threading.Lock()
_cxas_instance = None


def is_available() -> bool:
    """CXAS est-il importable ? (n'instancie pas le modèle)."""
    try:
        import cxas  # noqa: F401

        return True
    except Exception:
        return False


def _make_cxas():
    """Importe ``cxas`` et instancie le pipeline (téléchargement des
    poids au premier appel). À n'appeler que sous ``_engine_lock``."""
    import os

    os.environ["CXAS_NO_WELCOME"] = config.CXAS_NO_WELCOME
    os.environ["CXAS_PATH"] = config.CXAS_PATH

    try:
        import cxas
        from cxas import CXAS
    except Exception as exc:  # pragma: no cover - dépend de l'installation
        raise CxasUnavailableError(
            "La bibliothèque CXAS n'est pas installée (ou est "
            "incompatible avec cet environnement). Exécuter :\n"
            "  python scripts/radiography/anatomy/install_cxas.py\n"
            f"Détail : {exc!r}"
        ) from exc

    try:
        engine = CXAS(config.CXAS_MODEL_NAME, config.CXAS_DEVICE)
    except Exception as exc:
        raise CxasUnavailableError(
            "CXAS importé mais le pipeline n'a pas pu être instancié "
            f"(poids non téléchargés ?). Détail : {exc!r}"
        ) from exc

    logger.info(
        "CXAS prêt : modèle=%s device=%s poids=%s",
        config.CXAS_MODEL_NAME,
        config.CXAS_DEVICE,
        config.CXAS_PATH,
    )
    return engine


def get_cxas():
    """Retourne l'instance unique ``CXAS`` (chargement paresseux)."""
    global _cxas_instance
    if _cxas_instance is None:
        with _engine_lock:
            if _cxas_instance is None:
                _cxas_instance = _make_cxas()
    return _cxas_instance


def is_loaded() -> bool:
    """L'instance CXAS (pipeline + poids) est-elle déjà en mémoire ?"""
    return _cxas_instance is not None


def shutdown():
    """Libère l'instance CXAS (utile en fin de CLI)."""
    global _cxas_instance
    _cxas_instance = None


def path_to_native_input(image_path: Path) -> tuple[Path, bool]:
    """Vérifie que ``image_path`` est lisible par CXAS.

    CXAS ne supporte que .jpg/.png/.dcm : les autres formats
    (.jpeg, .bmp, ...) sont convertis en .png temporaire. Retourne
    ``(chemin, cleaned)`` où ``cleaned`` indique un fichier temporaire
    à supprimer ensuite.
    """
    image_path = Path(image_path)
    if not image_path.exists():
        raise FileNotFoundError(f"Image introuvable : {image_path}")

    ext = image_path.suffix.lower()
    if ext in config.CXAS_NATIVE_EXTENSIONS:
        return image_path, False

    from PIL import Image

    out = image_path.with_suffix(".png")
    if out.exists():  # évite d'écraser une vraie image
        out = image_path.parent / f"{image_path.stem}_cxas_tmp.png"
    with Image.open(image_path) as img:
        img.convert("RGB").save(out, "PNG")
    logger.debug("Conversion %s -> %s (format non natif CXAS)", image_path, out)
    return out, True