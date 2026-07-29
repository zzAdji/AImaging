#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
from pathlib import Path

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff", ".webp"}


def build_csv_from_folder(root_dir: Path, output_csv: Path, absolute_paths: bool = False) -> None:
    root_dir = root_dir.resolve()
    rows = []

    for path in sorted(root_dir.rglob("*")):
        if not path.is_file():
            continue
        if path.suffix.lower() not in IMAGE_EXTS:
            continue

        label = path.parent.name

        file_path = path.resolve() if absolute_paths else path.relative_to(root_dir)
        rows.append({
            "filepath": str(file_path),
            "label": label,
        })

    output_csv.parent.mkdir(parents=True, exist_ok=True)
    with output_csv.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["filepath", "label"])
        writer.writeheader()
        writer.writerows(rows)

    print(f"CSV généré : {output_csv}")
    print(f"Nombre d'images trouvées : {len(rows)}")


def main():
    parser = argparse.ArgumentParser(
        description="Transforme un dossier d'images organisé par sous-dossiers de classes en CSV."
    )
    parser.add_argument("--root-dir", type=Path, required=True, help="Dossier racine du dataset")
    parser.add_argument("--output", type=Path, required=True, help="Chemin du CSV de sortie")
    parser.add_argument(
        "--absolute-paths",
        action="store_true",
        help="Écrit les chemins absolus au lieu des chemins relatifs",
    )

    args = parser.parse_args()
    build_csv_from_folder(args.root_dir, args.output, absolute_paths=args.absolute_paths)


if __name__ == "__main__":
    main()