# Pipeline de prétraitement — imagerie médicale

Pipeline de prétraitement déterministe, reproductible et backbone-agnostique,
préparant un dataset d'images médicales nettoyé (`dataset_clean/`) pour
l'entraînement d'un modèle de Deep Learning (`dataset_processed/`).

**Ce pipeline ne fait aucune augmentation ni normalisation sur disque.**
Ces étapes sont appliquées à la volée au moment de l'entraînement (voir
`torch_dataset.py`), pour rester réversibles, économes en stockage, et
statistiquement correctes (une image normalisée mean/std n'est plus un
PNG affichable sans perte).

## Séparation stricte des données

```
dataset_clean/       ← jamais modifié
dataset_processed/    ← grayscale, resize+padding, contraste optionnel (déterministe)
reports/manifest.csv   ← assignation train/val/test (ne duplique pas les fichiers)
[à l'entraînement]      ← canal x3, normalisation, augmentation — appliqués en mémoire
```

## Conçu pour être réutilisé au-delà de la radiographie thoracique

- **Backbone générique** : `--architecture` accepte n'importe quel backbone
  torchvision supporté (DenseNet121/169/201, EfficientNet-B0/B1/B2,
  ResNet18/50, ConvNeXt-Tiny). La taille d'entrée et la normalisation sont
  dérivées automatiquement des poids pré-entraînés officiels
  (`model_registry.py`) — changer de modèle ne demande aucune modification de code.
- **Profils de modalité** (`--modality chest_xray` / `ultrasound`) :
  regroupent les plages d'augmentation et l'activation du contraste par
  type d'imagerie plutôt que codées en dur. Le profil `ultrasound` est
  fourni à titre indicatif seulement — à recalibrer une fois un vrai
  dataset échographique disponible (bruit de speckle, cône de scan et
  artefacts d'interface très différents d'une radiographie).
- **Classes détectées dynamiquement** depuis les noms de sous-dossiers,
  jamais codées en dur.

## Installation

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Python 3.12 requis. `torch`/`torchvision` sont volumineux à installer — prévoir du temps/bande passante.

## Utilisation

```bash
# Prétraitement de base, backbone par défaut (DenseNet121)
python main.py --input ./dataset_clean

# Avec un autre backbone (taille d'entrée dérivée automatiquement : 240x240 pour B1)
python main.py --input ./dataset_clean --architecture efficientnet_b1

# Avec CLAHE activé (désactivé par défaut) pour un A/B documenté
python main.py --input ./dataset_clean --enable-enhancement --enhancement-method clahe

# Avec split au niveau patient (CSV: colonnes filename,patient_id)
python main.py --input ./dataset_clean --patient-id-csv ./patient_ids.csv
```

Options principales :

| Option | Description | Défaut |
|---|---|---|
| `--architecture` | Backbone cible | `densenet121` |
| `--no-pretrained` | Ignore les poids pré-entraînés (stats ImageNet génériques) | pretrained activé |
| `--modality` | `chest_xray` \| `ultrasound` | `chest_xray` |
| `--split-ratios` | TRAIN VAL TEST (doit sommer à 1.0) | `0.70 0.15 0.15` |
| `--patient-id-csv` | CSV (filename, patient_id) pour split patient-level | aucun (fallback image-level) |
| `--enable-enhancement` | Active CLAHE/hist_eq/gamma | désactivé |
| `--workers` | Workers parallèles | nombre de cœurs CPU |
| `--seed` | Graine de reproductibilité | 42 |

## Sorties générées

```
dataset_processed/<Classe>/*.png    # grayscale, resize+padding, lossless
reports/
├── manifest.csv                     # path, class, patient_id, split
├── preprocessing_report.csv          # détail par image (dimensions, erreurs...)
├── preprocessing_report.json          # résumé du run
├── preprocessing_report.html           # rapport de synthèse
├── preprocessing_logs.txt               # journal complet
└── visualizations/
    └── before_after_<Classe>.png         # grille de vérification visuelle
```

## Utilisation en entraînement (PyTorch)

```python
import pandas as pd
from preprocessing.config import PreprocessConfig, ModelConfig
from preprocessing.normalization import resolve_normalization
from preprocessing.torch_dataset import build_dataloaders

config = PreprocessConfig(
    input_dir="./dataset_clean",
    model=ModelConfig(architecture="densenet121", num_classes=3),
)
manifest = pd.read_csv(config.manifest_path)
normalization = resolve_normalization(config.model)
loaders = build_dataloaders(manifest, normalization, config, batch_size=32)

for images, labels in loaders["train"]:
    ...  # images: (B, 3, H, W), déjà normalisées, augmentées à la volée
```

Le split `train` utilise un `WeightedRandomSampler` (rééquilibrage des
classes sans suppression de données ni duplication de fichiers) ; `val`
et `test` n'ont ni sampler pondéré ni augmentation.

## Décisions techniques (résumé — voir l'analyse complète dans la conversation)

- **Grayscale 1 canal sur disque, 3 canaux à la volée** : évite de tripler
  le stockage pour des pixels identiques.
- **Resize + padding (letterbox), pas de resize direct** : évite de
  déformer les proportions anatomiques sur les sources dont le ratio
  d'aspect diffère du carré cible.
- **CLAHE désactivé par défaut** : la littérature est partagée sur son
  intérêt en radiographie thoracique ; activé uniquement pour un A/B documenté.
- **Flip vertical jamais appliqué** (`vertical_flip_prob=0.0`, non
  atteignable par défaut) : aucune correspondance anatomique réelle pour
  une radiographie thoracique.
- **Split avant toute augmentation, au niveau patient si disponible** :
  évite la fuite de données. Fallback stratifié au niveau image sinon,
  avec limitation documentée dans le rapport.

## Tests

```bash
python -m unittest discover -s tests
```

## Limites connues

- Le profil `ultrasound` est un point de départ, pas une solution
  validée — recalibrer une fois un dataset réel disponible (spéculairement,
  ajouter un module de crop du cône de scan / suppression des annotations
  d'interface serait la première étape naturelle pour cette modalité).
- Pas de support DICOM natif (formats supportés : JPG, JPEG, PNG).
- Les statistiques `dataset_computed` (mean/std réels du dataset) sont
  calculées à titre informatif dans le rapport mais ne remplacent pas la
  normalisation ImageNet par défaut, sauf décision explicite documentée.
