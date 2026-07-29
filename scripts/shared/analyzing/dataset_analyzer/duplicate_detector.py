"""Détection de doublons exacts et de quasi-doublons, à grande échelle.

Stratégie en deux passes :

1. Doublons exacts - regroupement par SHA-256 du fichier brut, en O(n).
2. Quasi-doublons - hash perceptuel (imagehash.phash) indexé dans un
   BK-tree, qui exploite l'inégalité triangulaire de la distance de
   Hamming, permettant une recherche de voisinage en environ O(log n)
   par image au lieu d'une comparaison exhaustive O(n²).

Les quasi-doublons remontés par pHash peuvent inclure des faux positifs
(deux radios différentes mais visuellement proches). Une confirmation
optionnelle par SSIM (scikit-image) est donc appliquée, mais uniquement
sur les paires déjà pré-filtrées par le pHash. Ce qui reste peu coûteux
même à grande échelle.
"""

from __future__ import annotations

import logging
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Callable, Dict, FrozenSet, List, Optional, Tuple

import cv2
import imagehash
from PIL import Image
from skimage.metrics import structural_similarity as ssim
from tqdm import tqdm

from .config import AnalyzerConfig
from .schemas import DuplicateGroup, ImageRecord

logger = logging.getLogger("dataset_analyzer.duplicate_detector")


def _hamming(a: int, b: int) -> int:
    """Distance de Hamming entre deux hashes représentés comme des entiers."""
    return bin(a ^ b).count("1")


class _BKNode:
    """Nœud d'un BK-tree. `children` associe une distance à un enfant."""

    __slots__ = ("value", "children")

    def __init__(self, value: int) -> None:
        self.value = value
        self.children: Dict[int, "_BKNode"] = {}


class BKTree:
    """BK-tree générique sur une métrique de Hamming.

    Une recherche naïve de plus proches voisins parmi N hashes coûte
    O(N²) comparaisons, ce qui devient infaisable au-delà de quelques
    dizaines de milliers d'images. Un BK-tree exploite le fait que la
    distance de Hamming respecte l'inégalité triangulaire pour élaguer
    l'espace de recherche : une requête typique ne compare qu'un petit
    sous-ensemble des nœuds plutôt que la totalité de l'arbre.
    """

    def __init__(self, distance_fn: Callable[[int, int], int]) -> None:
        self._distance_fn = distance_fn
        self._root: Optional[_BKNode] = None

    def add(self, value: int) -> None:
        if self._root is None:
            self._root = _BKNode(value)
            return
        node = self._root
        while True:
            dist = self._distance_fn(value, node.value)
            child = node.children.get(dist)
            if child is None:
                node.children[dist] = _BKNode(value)
                return
            node = child

    def query(self, value: int, max_distance: int) -> List[Tuple[int, int]]:
        """Retourne [(valeur_indexée, distance)] pour tout nœud à distance <= max_distance."""
        if self._root is None:
            return []
        results: List[Tuple[int, int]] = []
        stack = [self._root]
        while stack:
            node = stack.pop()
            dist = self._distance_fn(value, node.value)
            if dist <= max_distance:
                results.append((node.value, dist))
            lo, hi = dist - max_distance, dist + max_distance
            for edge_dist, child in node.children.items():
                if lo <= edge_dist <= hi:
                    stack.append(child)
        return results


def _compute_phash_one(path: Path, hash_size: int) -> Tuple[Path, Optional[str]]:
    try:
        with Image.open(path) as img:
            h = imagehash.phash(img, hash_size=hash_size)
        return path, str(h)
    except Exception as exc:  # noqa: BLE001
        logger.warning("pHash impossible pour %s : %s", path, exc)
        return path, None


class DuplicateDetector:
    """Détecte les doublons exacts et quasi-doublons d'un lot d'images."""

    def __init__(self, config: AnalyzerConfig) -> None:
        self.config = config

    def find_exact_duplicates(self, records: List[ImageRecord]) -> List[DuplicateGroup]:
        """Regroupe les records partageant le même SHA-256."""
        buckets: Dict[str, List[ImageRecord]] = defaultdict(list)
        for r in records:
            if r.sha256:
                buckets[r.sha256].append(r)

        groups: List[DuplicateGroup] = []
        for recs in buckets.values():
            if len(recs) < 2:
                continue
            ordered = sorted(recs, key=lambda r: str(r.path))
            original, duplicates = ordered[0], ordered[1:]
            for dup in duplicates:
                groups.append(
                    DuplicateGroup(
                        original=original.path,
                        duplicate=dup.path,
                        hamming_distance=0,
                        is_exact=True,
                    )
                )
        logger.info("%d doublon(s) exact(s) détecté(s)", len(groups))
        return groups

    def compute_phashes(self, records: List[ImageRecord]) -> None:
        """Calcule et assigne le pHash de chaque record, en place, en parallèle."""
        by_path = {r.path: r for r in records}
        with ThreadPoolExecutor(max_workers=self.config.num_workers) as pool:
            futures = [
                pool.submit(_compute_phash_one, r.path, self.config.phash_size)
                for r in records
            ]
            for future in tqdm(
                as_completed(futures), total=len(futures), desc="Calcul des pHash"
            ):
                path, phash_value = future.result()
                if phash_value is not None:
                    by_path[path].phash = phash_value

    def find_near_duplicates(
        self, records: List[ImageRecord], exact_pairs: FrozenSet[FrozenSet[Path]]
    ) -> List[DuplicateGroup]:
        """Recherche de quasi-doublons par pHash, indexé dans un BK-tree.

        Args:
            records: Records dont `.phash` a déjà été calculé.
            exact_pairs: Paires déjà signalées comme doublons exacts, à
                ne pas reporter une seconde fois comme quasi-doublons.

        Returns:
            Liste de DuplicateGroup (is_exact=False sauf si le pHash est
            identique, auquel cas la distance de Hamming est 0).
        """
        tree = BKTree(_hamming)
        hash_to_records: Dict[int, List[ImageRecord]] = defaultdict(list)
        seen_pairs: set = set()
        groups: List[DuplicateGroup] = []

        threshold = self.config.duplicate_hamming_threshold

        for r in tqdm(records, desc="Recherche de quasi-doublons"):
            if r.phash is None:
                continue
            h = int(r.phash, 16)

            for candidate_hash, dist in tree.query(h, threshold):
                for other in hash_to_records[candidate_hash]:
                    if other.path == r.path:
                        continue
                    pair_key = frozenset((other.path, r.path))
                    if pair_key in exact_pairs or pair_key in seen_pairs:
                        continue
                    seen_pairs.add(pair_key)
                    original, duplicate = sorted([other.path, r.path], key=str)
                    groups.append(
                        DuplicateGroup(
                            original=original,
                            duplicate=duplicate,
                            hamming_distance=dist,
                            is_exact=(dist == 0),
                        )
                    )

            tree.add(h)
            hash_to_records[h].append(r)

        logger.info("%d quasi-doublon(s) candidat(s) (pré-SSIM)", len(groups))
        return groups

    def confirm_with_ssim(
        self, groups: List[DuplicateGroup], ssim_threshold: float
    ) -> List[DuplicateGroup]:
        """Re-vérifie les quasi-doublons candidats par SSIM, écarte les faux positifs.

        Le pHash est rapide mais peut produire des faux positifs pour des
        images qui partagent une structure globale similaire (cadrage,
        exposition) sans être visuellement quasi-identiques. Comme seule
        la liste déjà restreinte des candidats pHash est re-vérifiée (et
        non toutes les paires du dataset), le coût O(n²) du SSIM ne
        s'applique qu'à ce petit sous-ensemble, ce qui reste praticable
        même à 100 000+ images.
        """
        confirmed: List[DuplicateGroup] = []
        for g in tqdm(groups, desc="Confirmation SSIM"):
            if g.is_exact:
                confirmed.append(g)
                continue
            try:
                score = self._ssim_score(g.original, g.duplicate)
                if score >= ssim_threshold:
                    confirmed.append(g)
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "SSIM impossible pour %s / %s : %s", g.original, g.duplicate, exc
                )
                confirmed.append(g)
        logger.info("%d quasi-doublon(s) confirmé(s) après SSIM", len(confirmed))
        return confirmed

    @staticmethod
    def _ssim_score(path_a: Path, path_b: Path) -> float:
        img_a = cv2.imread(str(path_a), cv2.IMREAD_GRAYSCALE)
        img_b = cv2.imread(str(path_b), cv2.IMREAD_GRAYSCALE)
        if img_a is None or img_b is None:
            raise ValueError("image illisible via OpenCV")
        target_size = (
            min(img_a.shape[1], img_b.shape[1]),
            min(img_a.shape[0], img_b.shape[0]),
        )
        img_a = cv2.resize(img_a, target_size)
        img_b = cv2.resize(img_b, target_size)
        return float(ssim(img_a, img_b))

    def detect_all(self, records: List[ImageRecord]) -> List[DuplicateGroup]:
        """Exécute le pipeline complet de détection de doublons.

        Suppose que `compute_phashes` a déjà été appelé sur `records`.
        """
        exact_groups = self.find_exact_duplicates(records)
        exact_pairs = frozenset(
            frozenset((g.original, g.duplicate)) for g in exact_groups
        )

        near_groups = self.find_near_duplicates(records, exact_pairs)
        if self.config.enable_ssim_confirmation and near_groups:
            near_groups = self.confirm_with_ssim(near_groups, self.config.ssim_threshold)

        return exact_groups + near_groups
