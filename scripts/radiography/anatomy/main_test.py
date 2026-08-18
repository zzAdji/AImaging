"""CLI de validation de la branche CXAS sur des échantillons réels.

Usage :
  # Image unique (data/test fournit image.jpg, p.png, s.jpg)
  python scripts/radiography/anatomy/main_test.py --image data/test/image.jpg

  # Échantillon multi-classes (quotas par pathologie)
  python scripts/radiography/anatomy/main_test.py --sample-dir data/chest-xray \
      --sample-per-class 9 --seed 42

Sorties (par image, dans outputs/cxas/<image>/...) :
  images/original.png, overlays/overlay.png, overlays/montage.png,
  masks/<label>.png, measurements/results.json
Plus un agrégat outputs/cxas/results.csv et results.json.

Requiert l'environnement installé et vérifié par install_cxas.py ;
une CXAS manquante est signalée proprement, sans crash.
"""

from __future__ import annotations

import argparse
import csv
import json
import logging
import random
import sys
from pathlib import Path

from . import config
from .service import AnatomyResult, analyze_anatomy

logger = logging.getLogger("anatomy.main_test")

IMAGE_EXTS = {".jpg", ".jpeg", ".png"}
CLASS_DIRS = ("Normal", "Pneumonia", "Tuberculosis", "Emphysema")


def _arg_features(value: str) -> tuple[str, ...]:
    return tuple(f for f in value.split(",") if f.strip())


def _sample_images(sample_dir: Path, per_class: int, seed: int) -> list[Path]:
    selected: list[Path] = []
    for name in CLASS_DIRS:
        cls_dir = sample_dir / name
        candidates = sorted(
            p for p in cls_dir.glob("*") if p.suffix.lower() in IMAGE_EXTS
        )
        if not candidates:
            logger.warning("classe '%s' vide (aucune image %s)", name, IMAGE_EXTS)
            continue
        rng = random.Random(seed + CLASS_DIRS.index(name))
        selected.extend(rng.sample(candidates, min(per_class, len(candidates))))
    return selected


def _write_aggregate(
    output: Path, results: list[AnatomyResult], rows: list[dict]
) -> None:
    output.mkdir(parents=True, exist_ok=True)
    with (output / "results.csv").open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)
    summary = {
        "n_images": len(results),
        "n_ok": sum(1 for r in results if r.status == "ok"),
        "n_errors": sum(1 for r in results if r.status != "ok"),
        "results": [r.as_dict() for r in results],
    }
    with (output / "results.json").open("w", encoding="utf-8") as fh:
        json.dump(summary, fh, indent=2, ensure_ascii=False)
    print(f"Agrégat : {output / 'results.csv'} et {output / 'results.json'}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Validation CXAS sur images réelles (segmentations + "
                    "CTR/SCD).",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--image", type=Path, help="image unique à analyser")
    source.add_argument("--sample-dir", type=Path,
                        help="dossier multi-classes (quotas par classe)")
    parser.add_argument("--sample-per-class", type=int, default=9,
                        help="nb d'images par classe (échantillon)")
    parser.add_argument("--sample-seed", type=int, default=42)
    parser.add_argument("--features", type=_arg_features, default=config.DEFAULT_FEATURES,
                        help="virgules : CTR,SCD,area,perimeter,compactness,...")
    parser.add_argument("--pixel-spacing-mm", type=str, default=None, metavar="R,C",
                        help="PixelSpacing simulé (row,col) des DICOM — les "
                             "JPG n'en contiennent pas")
    parser.add_argument("--output", type=Path, default=None,
                        help="racine de sortie (défaut : outputs/cxas)")
    parser.add_argument("--no-montage", action="store_true",
                        help="omet les montages (plus rapide)")
    parser.add_argument("--no-save", action="store_true",
                        help="ne conserve que l'agrégat CSV/JSON")
    parser.add_argument("--limit", type=int, default=0, metavar="N",
                        help="s'arrête après N images traitées (débogage)")
    parser.add_argument("-q", "--quiet", action="store_true")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else
              logging.WARNING if args.quiet else logging.INFO,
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
    )

    output = args.output or (config.OUTPUT_ROOT / "validation")
    pixel_spacing = None
    if args.pixel_spacing_mm:
        try:
            pixel_spacing = tuple(float(x) for x in args.pixel_spacing_mm.split(","))
            if len(pixel_spacing) != 2:
                raise ValueError
        except ValueError:
            parser.error("--pixel-spacing-mm attend R,C (ex: 0.1688,0.1688)")

    images = [args.image] if args.image else _sample_images(
        args.sample_dir, args.sample_per_class, args.sample_seed
    )
    if args.limit:
        images = images[: args.limit]
    print(f"{len(images)} image(s) à analyser")

    results, rows = [], []
    for i, img in enumerate(images, 1):
        res = analyze_anatomy(
            img,
            features=args.features,
            pixel_spacing_mm=pixel_spacing,
            save_outputs=not args.no_save,
            output_dir=output if args.no_save else None,
            with_montage=not args.no_montage,
        )
        row = {
            "image": str(img),
            "status": res.status,
            "inference_time_ms": res.inference_time_ms or "",
            "CTR": res.measurements.get("Cardio-Thoracic Ratio", {}).get(
                "value", ""
            ),
            "SCD_px_512": res.measurements.get("Spine-Center Distance", {}).get(
                "value_px_512", ""
            ),
            "structures": len(res.segmentation.get("label_ids_available", [])),
            "error": (res.error or "")[:120],
        }
        rows.append(row)
        results.append(res)
        print(
            f"[{i}/{len(images)}] {img.name:<28} "
            f"statut={res.status:<5} temps={row['inference_time_ms']:<8} "
            f"CTR={row['CTR']:<6} SCD={row['SCD_px_512']} "
            f"structures={row['structures']}"
        )

        if res.status == "error":
            logger.warning("Échec %s : %s", img, res.error)

    _write_aggregate(output, results, rows)
    if args.sample_dir and results:
        ok = [r for r in results if r.status == "ok"]
        ctrs = [r.measurements.get("Cardio-Thoracic Ratio", {}).get("value")
                for r in ok]
        ctrs = [c for c in ctrs if c is not None]
        if ctrs:
            import statistics

            print(
                f"CTR moyen sur {len(ctrs)} images : "
                f"{statistics.mean(ctrs):.3f} "
                f"(min {min(ctrs):.3f}, max {max(ctrs):.3f})"
            )
    return 0 if not any(r.status != "ok" for r in results) else 1


if __name__ == "__main__":
    sys.exit(main())