"""Structures de données partagées par l'ensemble du pipeline.

Centraliser ces modèles évite de faire circuler des dictionnaires non
typés entre les modules (metadata, quality_checker, duplicate_detector,
visualization, report) et donne à chaque consommateur un contrat unique
et explicite.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional


@dataclass
class ImageRecord:
    """Tout ce que le pipeline sait d'un fichier image donné.

    Attributes:
        path: Chemin absolu du fichier sur le disque.
        class_name: Nom du dossier parent, utilisé
            comme label de classe.
        is_corrupted: True si le fichier n'a pas pu être décodé du tout
            (fichier vide, extension invalide, image tronquée/illisible).
        corruption_reason: Raison lisible, renseignée uniquement si
            is_corrupted est True.
        width: Largeur en pixels. None si l'image n'a pas pu être ouverte.
        height: Hauteur en pixels. None si l'image n'a pas pu être ouverte.
        channels: Nombre de canaux (1 = niveaux de gris, 3 = RGB, 4 = RGBA).
        image_format: Format rapporté par Pillow.
        file_size_bytes: Taille du fichier sur le disque, en octets.
        sha256: Empreinte SHA-256 des octets bruts du fichier, utilisée
            pour la détection de doublons exacts.
        phash: Hash perceptuel, utilisé pour la
            détection de quasi-doublons.
        is_atypical: True si l'image a déclenché au moins une règle
            "image atypique".
        atypical_reasons: Liste des règles déclenchées.
    """

    path: Path
    class_name: str
    is_corrupted: bool = False
    corruption_reason: Optional[str] = None
    width: Optional[int] = None
    height: Optional[int] = None
    channels: Optional[int] = None
    image_format: Optional[str] = None
    file_size_bytes: Optional[int] = None
    sha256: Optional[str] = None
    phash: Optional[str] = None
    is_atypical: bool = False
    atypical_reasons: List[str] = field(default_factory=list)

    @property
    def resolution(self) -> Optional[int]:
        """Nombre total de pixels (largeur * hauteur), ou None si inconnu."""
        if self.width is None or self.height is None:
            return None
        return self.width * self.height


@dataclass
class DuplicateGroup:
    """Une paire d'images signalées comme doublon exact ou quasi-doublon."""

    original: Path
    duplicate: Path
    hamming_distance: int
    is_exact: bool = False


@dataclass
class ClassStatistics:
    """Statistiques agrégées pour une seule classe."""

    class_name: str
    count: int
    mean_width: float
    mean_height: float
    median_width: float
    median_height: float
    min_width: int
    max_width: int
    min_height: int
    max_height: int


@dataclass
class AnalysisReport:
    """Conteneur de haut niveau agrégeant l'intégralité des résultats d'un run."""

    dataset_path: Path
    records: List[ImageRecord] = field(default_factory=list)
    duplicate_groups: List[DuplicateGroup] = field(default_factory=list)
    class_statistics: List[ClassStatistics] = field(default_factory=list)
    class_counts: Dict[str, int] = field(default_factory=dict)
    format_counts: Dict[str, int] = field(default_factory=dict)
    is_imbalanced: bool = False
    imbalance_ratio: float = 0.0
    execution_time_seconds: float = 0.0
    generated_charts: Dict[str, Path] = field(default_factory=dict)

    @property
    def total_images(self) -> int:
        return len(self.records)

    @property
    def corrupted_records(self) -> List[ImageRecord]:
        return [r for r in self.records if r.is_corrupted]

    @property
    def atypical_records(self) -> List[ImageRecord]:
        return [r for r in self.records if r.is_atypical and not r.is_corrupted]

    @property
    def valid_records(self) -> List[ImageRecord]:
        return [r for r in self.records if not r.is_corrupted]
