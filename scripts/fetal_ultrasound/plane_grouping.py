#!/usr/bin/env python3
"""Phase F — regroupe les images d'un examen par plan echographique predit.

Prend en entree un ExamResult deja produit par infer_folder.py (Phase D/E :
quality filtering -> plane classification), et produit une vue organisee
par plan plutot que par image :

- quelles images appartiennent a quel plan (statistiques par plan) ;
- quels plans, parmi les plans connus, sont totalement absents de cet
  examen (jamais supposer que les 41 plans sont presents) ;
- quelles images n'ont recu aucune classification de plan valide, et
  pourquoi (rejetees qualite, filtre indisponible, etc.) — a ne jamais
  confondre avec un plan absent.

Ce module est un module d'inference/logique propre au projet (pas un
wrapper autour du code DeepFetal), il vit donc a cote de deepfetal_adapter/
plutot que dedans.

Usage autonome (rejoue Phase F sur un exam JSON deja produit, sans
relancer l'inference) :
    python plane_grouping.py --input-exam-json outputs/patient_1_exam.json \\
        --class-indices data/fetal_ultrasound/class_indices_41.json \\
        --output-plane-groups-json outputs/patient_1_plane_groups.json
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Dict, Iterable, List

from deepfetal_adapter.paths import require_file
from deepfetal_adapter.schemas import ExamPlaneGrouping, ExamResult, ImageResult, PlaneGroup

# "neg" est la classe fourre-tout du classifieur de plans ("aucun plan
# reconnu"), pas un vrai plan anatomique qu'un examinateur recherche — elle
# est exclue du calcul des plans manquants (voir load_known_planes), mais
# reste visible comme groupe a part si des images y sont classees : c'est
# une information utile de controle qualite, distincte d'une image
# non-classifiee (voir _VALID_PLANE_STATUSES ci-dessous).
NEGATIVE_PLANE_LABEL = "neg"

# Statuts de PlaneResult.status consideres comme une classification de plan
# valide (donc a inclure dans le regroupement). "predicted" est le cas
# normal (image acceptee par le controle qualite puis classifiee).
# "predicted_without_quality_filter" ne provient que du mode --skip-quality
# d'infer_folder.py et n'est inclus que si explicitement demande, pour ne
# jamais melanger silencieusement des resultats non filtres qualite avec
# des resultats correctement filtres.
_DEFAULT_VALID_STATUSES = {"predicted"}
_UNFILTERED_STATUS = "predicted_without_quality_filter"


def load_known_planes(
    class_indices_path: Path, exclude: Iterable[str] = (NEGATIVE_PLANE_LABEL,)
) -> Dict[str, int]:
    """Charge le mapping nom -> id des plans connus depuis class_indices_41.json.

    Args:
        class_indices_path: Chemin du JSON {"0": "3DFace", "1": "3VV", ...}.
        exclude: Noms de classe a exclure de la liste des plans "attendus"
            pour le calcul des plans manquants. Par defaut, exclut "neg".

    Returns:
        Dict {nom_plan: id_plan}, sans les labels exclus.
    """
    raw = json.loads(class_indices_path.read_text(encoding="utf-8"))
    excluded = set(exclude)
    return {name: int(idx) for idx, name in raw.items() if name not in excluded}


def group_exam_by_plane(
    exam: ExamResult,
    known_planes: Dict[str, int],
    include_unfiltered_predictions: bool = False,
    min_plane_confidence: float | None = None,
) -> ExamPlaneGrouping:
    """Regroupe les images d'un examen par plan predit (Phase F).

    Args:
        exam: Resultat d'inference deja produit (quality + plane par image).
        known_planes: Mapping nom_plan -> id utilise pour calculer les plans
            absents (voir load_known_planes). Exclut typiquement "neg".
        include_unfiltered_predictions: Si True, inclut aussi les images
            classifiees en mode --skip-quality (plane.status ==
            "predicted_without_quality_filter") dans le regroupement. Par
            defaut (False), seules les images correctement filtrees par le
            controle qualite (plane.status == "predicted") sont regroupees
            — pour ne jamais faire croire qu'une image non filtree qualite
            a ete validee.
        min_plane_confidence: Si fourni (ex. 0.6), les images dont la
            confiance de classification de plan est strictement inferieure
            a ce seuil sont retirees de leur groupe et deplacees vers
            low_confidence_images plutot que traitees comme une assignation
            fiable. Consequence importante : un plan dont TOUTES les images
            tombent sous le seuil disparait de "groups" et redevient
            "manquant" s'il fait partie de known_planes — un plan qu'on ne
            peut confirmer avec confiance n'est pas considere comme observe.
            Une confidence manquante (None) est traitee comme sous le seuil
            (choix conservateur : on ne peut pas affirmer une confiance
            qu'on n'a pas). None (defaut) desactive ce filtrage — comportement
            identique a avant l'ajout de ce parametre.

    Returns:
        ExamPlaneGrouping avec les groupes observes, les plans absents,
        les images non classifiees et les images a confiance insuffisante.
    """
    valid_statuses = set(_DEFAULT_VALID_STATUSES)
    if include_unfiltered_predictions:
        valid_statuses.add(_UNFILTERED_STATUS)

    groups: Dict[str, PlaneGroup] = {}
    unclassified: List[ImageResult] = []
    low_confidence: List[ImageResult] = []

    for image in exam.images:
        plane = image.plane
        if plane is not None and plane.status in valid_statuses and plane.name is not None:
            if min_plane_confidence is not None and (
                plane.confidence is None or plane.confidence < min_plane_confidence
            ):
                low_confidence.append(image)
                continue
            group = groups.setdefault(
                plane.name, PlaneGroup(plane_name=plane.name, plane_id=plane.plane_id)
            )
            group.images.append(image)
        else:
            unclassified.append(image)

    missing_planes = sorted(set(known_planes) - set(groups))

    return ExamPlaneGrouping(
        exam_id=exam.exam_id,
        groups=groups,
        missing_planes=missing_planes,
        unclassified_images=unclassified,
        low_confidence_images=low_confidence,
    )


def load_exam_from_json(path: Path) -> ExamResult:
    """Recharge un ExamResult depuis un JSON produit par
    infer_folder.py --output-exam-json (ExamResult.to_structured_dict())."""
    data = json.loads(path.read_text(encoding="utf-8"))
    return ExamResult.from_structured_dict(data)


def write_plane_groups_json(path: Path, grouping: ExamPlaneGrouping) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(grouping.to_structured_dict(), ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def parse_args(argv=None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Regroupe par plan les images d'un examen deja inference (Phase F)."
    )
    parser.add_argument(
        "--input-exam-json", required=True, type=Path,
        help="Exam JSON produit par infer_folder.py --output-exam-json.",
    )
    parser.add_argument("--class-indices", required=True, type=Path, help="class_indices_41.json.")
    parser.add_argument("--output-plane-groups-json", required=True, type=Path)
    parser.add_argument(
        "--include-unfiltered-predictions", action="store_true",
        help="Inclut aussi les images classifiees via --skip-quality (non recommande par defaut).",
    )
    parser.add_argument(
        "--min-plane-confidence", type=float, default=None,
        help="Seuil de confiance minimal (0-1) pour qu'une image reste dans son groupe de plan. "
             "En dessous, l'image passe dans low_confidence_images. Desactive par defaut.",
    )
    return parser.parse_args(argv)


def main(argv=None) -> int:
    args = parse_args(argv)
    try:
        exam_json_path = require_file(args.input_exam_json, "Exam JSON d'entree")
        class_indices_path = require_file(args.class_indices, "class_indices_41.json")

        exam = load_exam_from_json(exam_json_path)
        known_planes = load_known_planes(class_indices_path)
        grouping = group_exam_by_plane(
            exam, known_planes,
            include_unfiltered_predictions=args.include_unfiltered_predictions,
            min_plane_confidence=args.min_plane_confidence,
        )
        write_plane_groups_json(args.output_plane_groups_json, grouping)

        summary = {
            "exam_id": grouping.exam_id,
            "planes_observed": grouping.planes_observed,
            "planes_known": len(known_planes),
            "planes_missing": len(grouping.missing_planes),
            "unclassified_images": len(grouping.unclassified_images),
            "low_confidence_images": len(grouping.low_confidence_images),
            "min_plane_confidence": args.min_plane_confidence,
            "output_plane_groups_json": str(args.output_plane_groups_json),
        }
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        return 0
    except Exception as exc:  # noqa: BLE001
        print(f"Erreur: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())