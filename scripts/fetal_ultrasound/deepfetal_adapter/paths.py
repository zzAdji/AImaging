"""Path helpers shared by fetal ultrasound CLIs."""

from __future__ import annotations

import sys
from pathlib import Path


def require_file(path: Path, description: str) -> Path:
    path = path.expanduser().resolve()
    if not path.is_file():
        raise FileNotFoundError(f"{description} introuvable: {path}")
    return path


def require_dir(path: Path, description: str) -> Path:
    path = path.expanduser().resolve()
    if not path.is_dir():
        raise FileNotFoundError(f"{description} introuvable: {path}")
    return path


def add_deepfetal_to_path(deepfetal_root: Path) -> Path:
    root = require_dir(deepfetal_root, "Dossier DeepFetal")
    root_str = str(root)
    if root_str not in sys.path:
        sys.path.insert(0, root_str)
    return root

