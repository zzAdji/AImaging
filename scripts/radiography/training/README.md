# Module d'entraînement, d'évaluation et d'ensembling

Entraîne, évalue et assemble des modèles de classification d'images
médicales (radiographies thoraciques ou toute autre modalité prétraitée
par le package `preprocessing` livré à l'étape précédente).

Un seul modèle est entraîné par run (`main_train.py`). Lancer ce script
une fois par architecture souhaitée produit les checkpoints nécessaires
à `main_ensemble.py` pour le soft voting - **aucune réécriture de code
n'est nécessaire pour passer d'un modèle unique à un ensemble.**

## Installation

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Placez ce dossier `training/` au même niveau que `preprocessing/` (livré
à l'étape précédente) :

```
mon_projet/
├── preprocessing/
└── training/
```

Si votre structure diffère, passez `--preprocessing-path /chemin/vers/preprocessing`
à `main_train.py` / `main_ensemble.py`.

## Entraîner un modèle

```bash
python main_train.py --manifest ../preprocessing_output/reports/manifest.csv
```

Options principales :

| Option | Description | Défaut |
|---|---|---|
| `--architecture` | Backbone (voir liste ci-dessous) | `densenet121` |
| `--no-freeze-backbone` | Fine-tuning complet au lieu de geler le backbone | backbone gelé |
| `--no-pretrained` | Ignore les poids ImageNet | pretrained activé |
| `--num-epochs` | Nombre max d'époques | 30 |
| `--early-stopping-patience` | Époques sans amélioration avant arrêt | 3 |
| `--use-weighted-loss` | Loss pondérée au lieu du sampler pondéré | sampler pondéré |
| `--device` | `auto` \| `cpu` \| `cuda` | `auto` |
| `--gradcam-samples-per-class` | Images Grad-CAM générées par classe | 2 |

**Architectures supportées** : `resnet18`, `resnet50`, `resnet101`,
`densenet121`, `densenet169`, `densenet201`, `efficientnet_b0/b1/b2/b4`,
`vgg16`, `vgg19`, `convnext_tiny`. La taille d'entrée et la normalisation
sont dérivées automatiquement des poids pré-entraînés torchvision.

**Backbone gelé par défaut** (`freeze_backbone=True`) : seule la tête de
classification s'entraîne - nettement plus rapide, recommandé sur CPU ou
tant que la disponibilité d'un GPU n'est pas confirmée. Passez
`--no-freeze-backbone` pour un fine-tuning complet une fois que
l'entraînement de la tête seule donne des résultats satisfaisants.

### Sorties générées

```
training_runs/<architecture>/
├── <architecture>_best.pt          # checkpoint auto-suffisant (poids + métadonnées)
├── gradcam/gradcam_grid.png          # vérification qualitative (où regarde le modèle)
└── reports/
    ├── training_history.csv            # loss/accuracy par époque
    ├── training_report.json             # résumé + métriques test
    ├── training_report.html               # rapport de synthèse
    ├── training_curves.png                 # loss/accuracy train vs val
    ├── confusion_matrix.png
    ├── roc_curves.png
    └── pr_curves.png
```

Le checkpoint est **auto-suffisant** : architecture, mapping de classes,
taille d'entrée et statistiques de normalisation y sont stockés, donc pas
besoin de les redonner manuellement pour le recharger.

## Construire l'ensemble (soft voting)

Une fois plusieurs modèles entraînés :

```bash
python main_train.py --manifest manifest.csv --architecture densenet121
python main_train.py --manifest manifest.csv --architecture resnet50
python main_train.py --manifest manifest.csv --architecture efficientnet_b0
python main_train.py --manifest manifest.csv --architecture efficientnet_b4
python main_train.py --manifest manifest.csv --architecture resnet101

python main_ensemble.py --manifest manifest.csv \
    --checkpoints training_runs/densenet121/densenet121_best.pt \
                  training_runs/resnet50/resnet50_best.pt \
                  training_runs/efficientnet_b0/efficientnet_b0_best.pt \
                  training_runs/efficientnet_b4/efficientnet_b4_best.pt \
                  training_runs/resnet101/resnet101_best.pt \
    --output ensemble_results
```

Reproduit l'architecture d'ensemble de Shahzad et al. 2025 (5 modèles,
soft voting) - voir `ensemble_results/comparison_report.html` pour le
tableau comparatif individuel vs ensemble.

Chaque modèle peut avoir sa propre taille d'entrée (ex. EfficientNet-B4
en 380×380 contre 224×224 pour les autres) - le ré-échantillonnage est
géré automatiquement par modèle, sans action de votre part.

## Interprétabilité (Grad-CAM)

Générée automatiquement à la fin de chaque `main_train.py` (voir
`gradcam/gradcam_grid.png`). Peut aussi être appelée indépendamment sur
un checkpoint déjà entraîné :

```python
from training.ensemble import load_model_from_checkpoint
from training.gradcam import generate_gradcam_grid
from preprocessing.augmentation import build_eval_transforms

model, class_to_idx, input_size = load_model_from_checkpoint(
    Path("training_runs/densenet121/densenet121_best.pt"), hidden_dims=(512,128,32), dropout=0.2, device=device
)
eval_transform = build_eval_transforms(mean, std)
generate_gradcam_grid(model, "densenet121", samples, eval_transform, input_size, device, Path("gradcam.png"))
```

## Décisions techniques (résumé)

- **Backbone gelé par défaut** : compromis raisonnable tant que la
  disponibilité GPU n'est pas confirmée ; réglable en une option.
- **Rééquilibrage : sampler pondéré par défaut, pas cumulé avec une loss
  pondérée** - les deux mécanismes corrigent le même problème ;
  `TrainConfig` lève une erreur explicite si les deux sont activés en
  même temps.
- **Tête de classification personnalisée** (`in_features -> 512 -> 128 ->
  32 -> num_classes`, Dropout + ReLU entre chaque couche) - reproduit la
  structure décrite dans Shahzad et al. 2025.
- **Grad-CAM via hook sur tenseur, pas sur module** - nécessaire pour
  rester compatible avec les architectures utilisant des opérations
  in-place (DenseNet), qui cassent `register_full_backward_hook`.
- **Checkpoints auto-suffisants** : architecture, mapping de classes,
  taille d'entrée et normalisation stockés avec les poids - pas de
  configuration manuelle à resynchroniser au moment du chargement.
- **Toujours rapporter les métriques sur le split test isolé**, jamais
  seulement train/val - contrairement à l'un des deux articles de
  référence qui définit un split test sans jamais en rapporter les métriques.

## Tests

```bash
python -m unittest discover -s tests
```

Couvre notamment la construction du modèle pour les 12 architectures
(le point le plus fragile vu l'hétérogénéité des classifieurs
torchvision) et Grad-CAM avec backbone gelé (régression réelle détectée
lors du développement - voir `test_gradcam_works_with_frozen_backbone`).

## Limites connues

- Pas de mixed-precision (AMP) - à ajouter si l'entraînement sur GPU
  devient un goulot d'étranglement.
- Pas de reprise depuis un checkpoint interrompu (checkpointing
  uniquement du meilleur modèle, pas d'état d'optimiseur intermédiaire).
- Le ré-échantillonnage entre tailles d'entrée différentes dans
  l'ensemble (`F.interpolate`) est une approximation raisonnable mais pas
  strictement identique à un pipeline de prétraitement dédié par modèle.
