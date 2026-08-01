"""Stable result objects for fetal ultrasound exam-level inference."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List


@dataclass
class QualityResult:
    score: float | None
    prediction: str
    probabilities: Dict[str, float] = field(default_factory=dict)
    available: bool = True
    reason: str | None = None

    @property
    def accepted(self) -> bool:
        return self.prediction == "accepted"

    def to_flat_dict(self) -> Dict[str, Any]:
        output = {
            "quality_score": self.score,
            "quality_prediction": self.prediction,
            "quality_probabilities": self.probabilities,
        }
        if not self.available:
            output["quality_available"] = False
            output["quality_unavailable_reason"] = self.reason
        return output

    def to_structured_dict(self) -> Dict[str, Any]:
        return {
            "score": self.score,
            "prediction": self.prediction,
            "accepted": self.accepted,
            "probabilities": self.probabilities,
            "available": self.available,
            "reason": self.reason,
        }

    @classmethod
    def from_structured_dict(cls, data: Dict[str, Any]) -> "QualityResult":
        """Reconstruit un QualityResult depuis to_structured_dict(). Le champ
        "accepted" est ignoré : c'est une propriété dérivée de "prediction",
        pas un champ du constructeur."""
        return cls(
            score=data.get("score"),
            prediction=data["prediction"],
            probabilities=data.get("probabilities", {}),
            available=data.get("available", True),
            reason=data.get("reason"),
        )


@dataclass
class PlaneResult:
    name: str | None
    confidence: float | None
    probabilities: Dict[str, float] = field(default_factory=dict)
    plane_id: int | None = None
    status: str = "predicted"

    def to_flat_dict(self) -> Dict[str, Any]:
        return {
            "plane_id": self.plane_id,
            "plane_prediction": self.name,
            "plane_confidence": self.confidence,
            "plane_status": self.status,
            "plane_probabilities": self.probabilities,
        }

    def to_structured_dict(self) -> Dict[str, Any]:
        return {
            "id": self.plane_id,
            "name": self.name,
            "confidence": self.confidence,
            "probabilities": self.probabilities,
            "status": self.status,
        }

    @classmethod
    def from_structured_dict(cls, data: Dict[str, Any]) -> "PlaneResult":
        """Reconstruit un PlaneResult depuis to_structured_dict(). Attention :
        la clé sérialisée est "id" alors que le champ du dataclass est
        "plane_id" (voir to_structured_dict ci-dessus)."""
        return cls(
            name=data.get("name"),
            confidence=data.get("confidence"),
            probabilities=data.get("probabilities", {}),
            plane_id=data.get("id"),
            status=data.get("status", "predicted"),
        )


@dataclass
class EmbeddingResult:
    path: str | None = None
    dimension: int | None = None
    model_name: str | None = None
    status: str = "not_computed"

    def to_structured_dict(self) -> Dict[str, Any]:
        return {
            "path": self.path,
            "dimension": self.dimension,
            "model_name": self.model_name,
            "status": self.status,
        }

    @classmethod
    def from_structured_dict(cls, data: Dict[str, Any]) -> "EmbeddingResult":
        return cls(
            path=data.get("path"),
            dimension=data.get("dimension"),
            model_name=data.get("model_name"),
            status=data.get("status", "not_computed"),
        )


@dataclass
class ImageResult:
    image_id: str
    path: str
    relative_path: str
    quality: QualityResult
    plane: PlaneResult | None = None
    embedding: EmbeddingResult = field(default_factory=EmbeddingResult)

    def to_flat_dict(self) -> Dict[str, Any]:
        output = {
            "image": self.path,
            "relative_path": self.relative_path,
            **self.quality.to_flat_dict(),
        }
        if self.plane is not None:
            output.update(self.plane.to_flat_dict())
        else:
            output.update(
                {
                    "plane_prediction": None,
                    "plane_confidence": None,
                    "plane_probabilities": {},
                }
            )
        return output

    def to_structured_dict(self) -> Dict[str, Any]:
        return {
            "image_id": self.image_id,
            "path": self.path,
            "relative_path": self.relative_path,
            "quality": self.quality.to_structured_dict(),
            "plane": self.plane.to_structured_dict() if self.plane else None,
            "embedding": self.embedding.to_structured_dict(),
        }

    @classmethod
    def from_structured_dict(cls, data: Dict[str, Any]) -> "ImageResult":
        plane_data = data.get("plane")
        embedding_data = data.get("embedding")
        return cls(
            image_id=data["image_id"],
            path=data["path"],
            relative_path=data["relative_path"],
            quality=QualityResult.from_structured_dict(data["quality"]),
            plane=PlaneResult.from_structured_dict(plane_data) if plane_data else None,
            embedding=EmbeddingResult.from_structured_dict(embedding_data) if embedding_data else EmbeddingResult(),
        )


@dataclass
class ExamResult:
    exam_id: str
    exam_path: str
    images: List[ImageResult] = field(default_factory=list)

    @property
    def images_total(self) -> int:
        return len(self.images)

    @property
    def images_accepted(self) -> int:
        return sum(1 for image in self.images if image.quality.accepted)

    @property
    def images_rejected(self) -> int:
        return sum(1 for image in self.images if image.quality.prediction == "rejected")

    def to_flat_records(self) -> List[Dict[str, Any]]:
        return [image.to_flat_dict() for image in self.images]

    def to_structured_dict(self) -> Dict[str, Any]:
        return {
            "exam_id": self.exam_id,
            "exam_path": self.exam_path,
            "quality": {
                "images_total": self.images_total,
                "images_accepted": self.images_accepted,
                "images_rejected": self.images_rejected,
            },
            "images": [image.to_structured_dict() for image in self.images],
        }

    @classmethod
    def from_structured_dict(cls, data: Dict[str, Any]) -> "ExamResult":
        """Reconstruit un ExamResult depuis to_structured_dict(). Le bloc
        "quality" (images_total/accepted/rejected) est ignoré : ce sont des
        propriétés dérivées de la liste d'images, pas des champs du
        constructeur."""
        return cls(
            exam_id=data["exam_id"],
            exam_path=data["exam_path"],
            images=[ImageResult.from_structured_dict(item) for item in data.get("images", [])],
        )


@dataclass
class PlaneGroup:
    """Un plan anatomique et les images de l'examen qui y ont été classées.

    N'inclut que des images dont la classification de plan est valide (voir
    plane_grouping.group_exam_by_plane pour la définition exacte de "valide").
    """

    plane_name: str
    plane_id: int | None
    images: List[ImageResult] = field(default_factory=list)

    @property
    def image_count(self) -> int:
        return len(self.images)

    @property
    def mean_confidence(self) -> float | None:
        confidences = [
            image.plane.confidence
            for image in self.images
            if image.plane is not None and image.plane.confidence is not None
        ]
        return sum(confidences) / len(confidences) if confidences else None

    def to_structured_dict(self) -> Dict[str, Any]:
        return {
            "plane_name": self.plane_name,
            "plane_id": self.plane_id,
            "image_count": self.image_count,
            "mean_confidence": self.mean_confidence,
            "image_ids": [image.image_id for image in self.images],
        }


@dataclass
class ExamPlaneGrouping:
    """Résultat du regroupement des images d'un examen par plan prédit (Phase F).

    Attributes:
        groups: Un PlaneGroup par plan effectivement observé ET jugé fiable
            (voir low_confidence_images) dans l'examen — clé = nom du plan.
        missing_planes: Plans connus (voir plane_grouping.load_known_planes)
            n'ayant aucune image fiable dans cet examen. Un plan dont toutes
            les images sont sous le seuil de confiance est considéré comme
            manquant, pas comme observé.
        unclassified_images: Images sans classification de plan valide
            (qualité rejetée, filtre qualité indisponible, ou explicitement
            ignorées) — à ne jamais confondre avec un plan "absent".
        low_confidence_images: Images ayant reçu une classification de plan
            valide, mais dont la confiance est sous le seuil configuré
            (voir group_exam_by_plane min_plane_confidence) — à ne jamais
            confondre avec unclassified_images : ici, une prédiction existe,
            elle est simplement jugée peu fiable pour être exploitée telle quelle.
    """

    exam_id: str
    groups: Dict[str, PlaneGroup] = field(default_factory=dict)
    missing_planes: List[str] = field(default_factory=list)
    unclassified_images: List[ImageResult] = field(default_factory=list)
    low_confidence_images: List[ImageResult] = field(default_factory=list)

    @property
    def planes_observed(self) -> int:
        return len(self.groups)

    def to_structured_dict(self) -> Dict[str, Any]:
        return {
            "exam_id": self.exam_id,
            "planes_observed": self.planes_observed,
            "planes_missing": len(self.missing_planes),
            "missing_planes": sorted(self.missing_planes),
            "unclassified_images_count": len(self.unclassified_images),
            "unclassified_images": [
                {
                    "image_id": image.image_id,
                    "quality_prediction": image.quality.prediction,
                    "plane_status": image.plane.status if image.plane is not None else "no_plane_attempted",
                }
                for image in self.unclassified_images
            ],
            "low_confidence_images_count": len(self.low_confidence_images),
            "low_confidence_images": [
                {
                    "image_id": image.image_id,
                    "tentative_plane": image.plane.name if image.plane is not None else None,
                    "confidence": image.plane.confidence if image.plane is not None else None,
                }
                for image in self.low_confidence_images
            ],
            "groups": {name: group.to_structured_dict() for name, group in sorted(self.groups.items())},
        }


def image_id_from_path(image_path: Path) -> str:
    return image_path.stem


def exam_id_from_path(exam_path: Path) -> str:
    return exam_path.resolve().name