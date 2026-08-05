#!/usr/bin/env python3
"""Phase G — extrait les embeddings visuels FetalCLIP des images acceptees
d'un examen deja inference (Quality + Plane, Phase D/E/F).

Ne depend PAS du regroupement par plan (Phase F) : l'embedding visuel
d'une image est un signal utile independamment de la confiance de sa
classification de plan. Le seul filtre applique ici est
quality.accepted == True, conformement a l'Etape 6 de la specification
d'origine ("Pour chaque image acceptee : Image -> FetalCLIP -> Image
Embedding").

Les embeddings ne sont jamais ecrits dans le JSON (trop volumineux) :
chaque embedding est sauvegarde en .pt individuel, et seul son chemin +
sa dimension sont stockes dans l'exam JSON de sortie (champ
ImageResult.embedding, deja prevu par le schema depuis la Phase C).

Usage:
    python extract_embeddings.py \\
        --input-exam-json outputs/fetal_ultrasound/patient_1_exam.json \\
        --embeddings-dir outputs/fetal_ultrasound/embeddings \\
        --output-exam-json outputs/fetal_ultrasound/patient_1_exam_with_embeddings.json \\
        --device auto
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import torch
from tqdm import tqdm

from deepfetal_adapter.config import FetalCLIPConfig
from deepfetal_adapter.fetalclip_embeddings import FetalCLIPEmbedder
from deepfetal_adapter.paths import require_file
from deepfetal_adapter.schemas import EmbeddingResult
from plane_grouping import load_exam_from_json


def parse_args(argv=None) -> argparse.Namespace:
    defaults = FetalCLIPConfig()
    parser = argparse.ArgumentParser(
        description="Extrait les embeddings visuels FetalCLIP des images acceptees d'un examen (Phase G)."
    )
    parser.add_argument("--input-exam-json", required=True, type=Path)
    parser.add_argument(
        "--output-exam-json", required=True, type=Path,
        help="Exam JSON de sortie, identique a l'entree mais avec le champ embedding rempli.",
    )
    parser.add_argument(
        "--embeddings-dir", required=True, type=Path,
        help="Dossier racine ou sont ecrits les .pt individuels (un sous-dossier par exam_id).",
    )
    parser.add_argument("--fetalclip-config", type=Path, default=defaults.config_path)
    parser.add_argument("--fetalclip-weights", type=Path, default=defaults.weights_path)
    parser.add_argument("--model-name", default=defaults.model_name)
    parser.add_argument("--device", default="auto", choices=["auto", "cpu", "cuda"])
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument(
        "--no-normalize", action="store_true",
        help="Desactive la L2-normalisation des embeddings (activee par defaut, convention CLIP).",
    )
    parser.add_argument(
        "--no-freeze", action="store_true",
        help="Ne gele pas FetalCLIP. Sans effet sur l'extraction elle-meme (aucun gradient "
             "calcule ici de toute facon) — utile seulement pour verifier le comportement "
             "avant un futur entrainement qui degele FetalCLIP.",
    )
    return parser.parse_args(argv)


def main(argv=None) -> int:
    args = parse_args(argv)
    try:
        exam_json_path = require_file(args.input_exam_json, "Exam JSON d'entree")
        exam = load_exam_from_json(exam_json_path)

        accepted_images = [image for image in exam.images if image.quality.accepted]
        if not accepted_images:
            print("Aucune image acceptee (quality.accepted=True) dans cet examen.", file=sys.stderr)
            return 1

        config = FetalCLIPConfig(
            weights_path=args.fetalclip_weights,
            config_path=args.fetalclip_config,
            model_name=args.model_name,
        )
        embedder = FetalCLIPEmbedder(config, device=args.device, freeze=not args.no_freeze)

        image_ids_and_paths = [(image.image_id, Path(image.path)) for image in accepted_images]
        results = embedder.embed_batch(
            image_ids_and_paths, batch_size=args.batch_size, normalize=not args.no_normalize
        )
        results_by_id = {r.image_id: r for r in results}

        exam_embeddings_dir = args.embeddings_dir / exam.exam_id
        exam_embeddings_dir.mkdir(parents=True, exist_ok=True)

        ok_count, failed_count = 0, 0
        for image in tqdm(accepted_images, desc="Sauvegarde embeddings", unit="image"):
            result = results_by_id.get(image.image_id)
            if result is None or result.status != "ok":
                reason = result.status if result else "not_processed"
                image.embedding = EmbeddingResult(status=f"failed:{reason}")
                failed_count += 1
                continue

            embedding_path = exam_embeddings_dir / f"{image.image_id}.pt"
            torch.save(torch.from_numpy(result.vector), embedding_path)
            image.embedding = EmbeddingResult(
                path=str(embedding_path),
                dimension=result.dimension,
                model_name=args.model_name,
                status="computed",
            )
            ok_count += 1

        args.output_exam_json.parent.mkdir(parents=True, exist_ok=True)
        args.output_exam_json.write_text(
            json.dumps(exam.to_structured_dict(), ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )

        summary = {
            "exam_id": exam.exam_id,
            "images_accepted": len(accepted_images),
            "embeddings_computed": ok_count,
            "embeddings_failed": failed_count,
            "embeddings_dir": str(exam_embeddings_dir),
            "output_exam_json": str(args.output_exam_json),
        }
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        return 0
    except Exception as exc:  # noqa: BLE001
        print(f"Erreur: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())