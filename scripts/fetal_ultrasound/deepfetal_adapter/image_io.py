"""Image discovery helpers for fetal ultrasound inference scripts."""

from __future__ import annotations

from pathlib import Path
from typing import Iterable, List


IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff"}


def is_image_file(path: Path) -> bool:
    return path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS


def iter_image_paths(root: Path, recursive: bool = True) -> Iterable[Path]:
    pattern = "**/*" if recursive else "*"
    for path in sorted(root.glob(pattern)):
        if is_image_file(path):
            yield path


def collect_image_paths(root: Path, recursive: bool = True) -> List[Path]:
    return list(iter_image_paths(root, recursive=recursive))

