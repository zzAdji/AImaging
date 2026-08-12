from __future__ import annotations

import sys
from pathlib import Path

from config import (  # noqa: E402
    PROJECT_ROOT,
    RADIOGRAPHY_RUNNING_ROOT,
    RADIOGRAPHY_TRAINING_ROOT,
    SCRIPTS_ROOT,
    SHARED_LLM_ROOT,
)


def _add_to_path(path: Path, description: str) -> None:
    if not path.is_dir():
        raise FileNotFoundError(
            f"{description} introuvable : {path}. Vérifier config.py si l'arborescence "
            "du projet diffère de celle supposée."
        )
    path_str = str(path)
    if path_str not in sys.path:
        sys.path.insert(0, path_str)


def bootstrap_all() -> None:
    # Les modules de formation utilisent des imports qualifiés par `scripts.*`.
    # Uvicorn est lancé depuis `server/`, donc la racine du projet n'est pas
    # présente par défaut dans sys.path.
    _add_to_path(PROJECT_ROOT, "Racine du projet")
    _add_to_path(SHARED_LLM_ROOT, "Dossier shared/llm")
    _add_to_path(RADIOGRAPHY_RUNNING_ROOT, "Dossier running (radiographie)")
    _add_to_path(RADIOGRAPHY_TRAINING_ROOT, "Dossier training (radiographie)")
    _add_to_path(SCRIPTS_ROOT / "radiography", "Dossier radiography")
