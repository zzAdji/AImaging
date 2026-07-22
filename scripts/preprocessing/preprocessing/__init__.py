"""Pipeline de prétraitement d'images médicales pour l'entraînement Deep Learning.

Conçu pour la radiographie thoracique (Normal / Pneumonia / Tuberculosis)
mais délibérément générique : les classes sont détectées dynamiquement
depuis les noms de sous-dossiers, le backbone est configurable, et les
plages d'augmentation/contraste sont regroupées par "profil de modalité"
(voir config.MODALITY_PRESETS) plutôt que codées en dur — de façon à
pouvoir être réutilisé pour d'autres modalités (ex. échographie) sans
réécriture.

Ce package ne fait AUCUNE augmentation ni normalisation sur disque : il
matérialise uniquement le prétraitement déterministe (niveaux de gris,
resize+padding, contraste optionnel) dans dataset_processed/. La
normalisation, la réplication en 3 canaux et l'augmentation sont
appliquées à la volée au moment de l'entraînement (voir torch_dataset.py).
"""

__version__ = "1.0.0"
