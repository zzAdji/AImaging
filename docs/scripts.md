# Scripts

Scripts Python hors serveur, sous `scripts/`. Le serveur les importe pour
l'inférence ; certains sont des outils autonomes d'analyse de données.

## Organisation

```
scripts/
├── radiography/       Pipeline radiographie (classification + anatomie)
│   ├── preprocessing/  Prétraitement de dataset
│   ├── training/       Entraînement + ensemble + Grad-CAM
│   ├── running/        Inférence externe (adapter)
│   └── anatomy/        Segmentation CXAS + mesures
├── opencxr/            Dépôt OpenCXR (microservice + algorithmes)
├── shared/
│   ├── llm/            Promotion, cohérence, rendu de rapports
│   └── analyzing/      Analyse et nettoyage de datasets
├── fetal_ultrasound/   Échographie - HORS PÉRIMÈTRE
└── three_d_maker/      3D - HORS PÉRIMÈTRE
```

## Radiography

### preprocessing
Prétraite un dataset d'images médicales (grayscale, resize, padding) de façon
déterministe et backbone-agnostique. Point d'entrée : `main.py`.

```bash
python main.py --input ./dataset_clean
```

Sorties : `dataset_processed/`, `reports/manifest.csv`, rapport HTML/JSON/CSV.

### training
Entraîne un modèle par run, évalue et assemble par soft voting.

```bash
python main_train.py --manifest ../preprocessing_output/reports/manifest.csv
python main_ensemble.py --manifest manifest.csv --checkpoints ... --output ensemble_results
```

Architectures : DenseNet121/169/201, ResNet50/101, EfficientNet-B0/B1/B2/B4,
VGG16/19, ConvNeXt-Tiny. Grad-CAM générée automatiquement.

### running
`radiography_adapter.py` : adaptation côté inférence (utilisé par le serveur
via `main_predict`). `main_external_eval.py` : évaluation externe.

### anatomy
Segmentation anatomique CXAS (159 classes PAXRay, UNet-ResNet50) + mesures CTR
et SCD. Point d'entrée : `service.py` (importé par le serveur). Installation :
`install_cxas.py` (patch lazy + poids ~250 Mo dans `~/.cxas`).

```bash
python -m scripts.radiography.anatomy.main_test --image data/test/image.jpg
```

## OpenCXR (microservice)

`scripts/opencxr/` contient le dépôt OpenCXR (algorithmes Image Sorter,
lung/heart segmentation, normalisation CXR) et un microservice FastAPI
(`microserver.py`) pour le serveur principal (le serveur 3.14 ne peut pas
charger TensorFlow). Démarrage : `run_micro.bat` (venv312, port 8011).

Endpoints du microservice : `GET /health`, `POST /sort`, `POST /standardize`.

Comportement fail-closed :

```
image invalide  → rejeté (REJECTED_INVALID_IMAGE)
non-CXR         → rejeté (REJECTED_NON_CXR)
CXR             → analyse
```

## Shared

- `shared/llm/prompt.py` : construction des prompts (reports radiographie).
- `shared/llm/coherence_check.py` : contrôle de cohérence des faits.
- `shared/llm/report_renderer.py` : rendu du texte de rapport.
- `shared/llm/report_schemas.py` : schémas Pydantic du rapport.
- `shared/analyzing/` : outil autonome d'audit/nettoyage de datasets
  (`main.py`, rapport PDF/CSV).

## Modèles

Les checkpoints radiographiques vivent dans `models/chest_xray/` (voir
`configuration.md`). Aucun poids binaire n'est inclus dans la documentation.