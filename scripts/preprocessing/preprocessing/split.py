"""Séparation Train / Validation / Test — avant toute augmentation.

Deux stratégies, choisies automatiquement selon la disponibilité d'un
identifiant patient :

1. **Split au niveau patient** (recommandé, utilisé si
   `config.patient_id_csv` est fourni) : garantit qu'un même patient
   n'apparaît jamais simultanément dans deux splits différents.
2. **Split stratifié au niveau image** (fallback, utilisé par défaut tant
   qu'aucun identifiant patient n'est disponible) : préserve les
   proportions de classes dans chaque split, mais ne peut pas détecter un
   chevauchement patient — limitation documentée dans le rapport.

Pour un dataset combinant plusieurs sources (ex. NIH ChestX-ray14 +
Kaggle), le split officiel d'une source qui en fournit un (comme les
listes train_val_list.txt / test_list.txt de NIH) doit être respecté tel
quel plutôt que refondu avec les autres sources — ce module l'accepte en
pré-assignant `entry.split` avant l'appel si une telle information existe.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import List, Optional

import pandas as pd
from sklearn.model_selection import GroupShuffleSplit, train_test_split

from .config import PreprocessConfig
from .schemas import ImageEntry

logger = logging.getLogger("preprocessing.split")


def _load_patient_ids(entries: List[ImageEntry], patient_id_csv: Path) -> None:
    """Enrichit les entries avec un patient_id lu depuis un CSV externe.

    Le CSV attendu a deux colonnes : `filename` (nom de fichier, pas le
    chemin complet) et `patient_id`. Modifie `entries` en place.
    """
    try:
        mapping_df = pd.read_csv(patient_id_csv)
        mapping = dict(zip(mapping_df["filename"], mapping_df["patient_id"].astype(str)))
    except Exception as exc:  # noqa: BLE001
        logger.error(
            "Impossible de lire patient_id_csv (%s) : %s — fallback split image-level.",
            patient_id_csv, exc,
        )
        return

    matched = 0
    for entry in entries:
        pid = mapping.get(entry.source_path.name)
        if pid is not None:
            entry.patient_id = pid
            matched += 1
    logger.info(
        "%d/%d image(s) associée(s) à un patient_id via %s",
        matched, len(entries), patient_id_csv,
    )


def assign_splits(entries: List[ImageEntry], config: PreprocessConfig) -> List[ImageEntry]:
    """Assigne `entry.split` ("train"/"val"/"test") à chaque entrée réussie.

    Args:
        entries: Entrées déjà traitées (load_success=True uniquement pris
            en compte ; les échecs restent split=None).
        config: Configuration (ratios, seed, patient_id_csv éventuel).

    Returns:
        La même liste, avec `split` renseigné sur les entrées valides.
    """
    valid = [e for e in entries if e.load_success]
    if not valid:
        logger.warning("Aucune entrée valide à répartir en train/val/test.")
        return entries

    if config.patient_id_csv is not None:
        _load_patient_ids(valid, config.patient_id_csv)

    has_patient_ids = any(e.patient_id for e in valid)

    if has_patient_ids:
        _assign_splits_patient_level(valid, config)
    else:
        logger.warning(
            "Aucun patient_id disponible : split stratifié au niveau image. "
            "Un même patient pourrait apparaître dans plusieurs splits si "
            "vos sources contiennent plusieurs images par patient — "
            "limitation documentée dans le rapport."
        )
        _assign_splits_image_level(valid, config)

    return entries


def _assign_splits_image_level(valid: List[ImageEntry], config: PreprocessConfig) -> None:
    train_ratio, val_ratio, test_ratio = config.split_ratios
    labels = [e.class_name for e in valid]
    stratify = labels if config.stratify_split else None

    train_entries, rest_entries = train_test_split(
        valid,
        train_size=train_ratio,
        random_state=config.random_seed,
        stratify=stratify,
    )

    rest_labels = [e.class_name for e in rest_entries] if config.stratify_split else None
    relative_val = val_ratio / (val_ratio + test_ratio)
    val_entries, test_entries = train_test_split(
        rest_entries,
        train_size=relative_val,
        random_state=config.random_seed,
        stratify=rest_labels,
    )

    for e in train_entries:
        e.split = "train"
    for e in val_entries:
        e.split = "val"
    for e in test_entries:
        e.split = "test"


def _assign_splits_patient_level(valid: List[ImageEntry], config: PreprocessConfig) -> None:
    """Split par patient : toutes les images d'un même patient vont dans le
    même split. Stratification stricte par classe non garantie (un patient
    peut avoir plusieurs images de classes différentes), mais aucune fuite
    patient n'est possible.
    """
    train_ratio, val_ratio, test_ratio = config.split_ratios
    groups = [e.patient_id or f"__no_patient__{i}" for i, e in enumerate(valid)]

    splitter = GroupShuffleSplit(
        n_splits=1, train_size=train_ratio, random_state=config.random_seed
    )
    train_idx, rest_idx = next(splitter.split(valid, groups=groups))

    rest = [valid[i] for i in rest_idx]
    rest_groups = [groups[i] for i in rest_idx]
    relative_val = val_ratio / (val_ratio + test_ratio)
    splitter2 = GroupShuffleSplit(
        n_splits=1, train_size=relative_val, random_state=config.random_seed
    )
    val_idx, test_idx = next(splitter2.split(rest, groups=rest_groups))

    for i in train_idx:
        valid[i].split = "train"
    for i in val_idx:
        rest[i].split = "val"
    for i in test_idx:
        rest[i].split = "test"


def build_manifest(entries: List[ImageEntry]) -> pd.DataFrame:
    """Construit le DataFrame manifeste (une ligne par image traitée avec succès).

    Colonnes : path, class, patient_id, split. `patient_id` reste vide
    tant qu'aucune source ne le fournit — la colonne existe déjà pour
    éviter une migration de schéma le jour où elle devient disponible.
    """
    rows = [
        {
            "path": str(e.processed_path),
            "class": e.class_name,
            "patient_id": e.patient_id or "",
            "split": e.split or "",
        }
        for e in entries
        if e.load_success
    ]
    return pd.DataFrame(rows)
