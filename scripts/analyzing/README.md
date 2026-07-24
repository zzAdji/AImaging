# Dataset Analyzer & Cleaner

Pipeline d'audit et de nettoyage pour les datasets.

## Fonctionnalités

- Scan récursif de `Dataset/<Classe>/*.jpg`
- Détection des images corrompues, vides, ou d'extension invalide
- Détection des doublons exacts (SHA-256) et quasi-doublons (pHash + BK-tree, confirmés par SSIM)
- Extraction de métadonnées (dimensions, canaux, format, poids) → CSV
- Détection des images atypiques (trop petite/grande, noire/blanche, faible contraste) → `Review/`
- Vérification de l'équilibre entre classes
- Graphiques (histogrammes, camemberts, grilles d'échantillons)
- Rapport PDF professionnel + rapport CSV exhaustif
- Journalisation complète (`logs.txt`)
- Parallélisation (threads pour l'I/O, processus pour le calcul pixel)

## Installation

```bash
python -m venv .venv
source .venv/bin/activate  # Windows : .venv\Scripts\activate
pip install -r requirements.txt
```

Python 3.12 requis.

## Utilisation

Arborescence attendue :

```
ChestXray/
├── Normal/
├── Pneumonia/
└── Tuberculosis/
```

Analyse seule (dry-run, aucune modification du dataset) :

```bash
python main.py --dataset ./ChestXray
```

Analyse + déplacement réel des images corrompues/atypiques vers `Review/` :

```bash
python main.py --dataset ./ChestXray --clean
```

Analyse + déplacement des doublons également :

```bash
python main.py --dataset ./ChestXray --clean --remove-duplicates
```

Options utiles :

| Option | Description | Défaut |
|---|---|---|
| `--output` | Dossier de sortie des rapports | `<dataset>/../analysis_output` |
| `--workers` | Nombre de workers parallèles | nombre de cœurs CPU |
| `--min-width` / `--min-height` | Seuil "image trop petite" | 64 |
| `--max-width` / `--max-height` | Seuil "image trop grande" | 4096 |
| `--duplicate-threshold` | Distance de Hamming max. (pHash) | 5 |
| `--no-ssim` | Désactive la confirmation SSIM (plus rapide) | activée |
| `--imbalance-ratio` | Ratio classe majoritaire/minoritaire | 1.5 |
| `--verbose` | Logs niveau DEBUG | désactivé |

## Sorties générées

```
analysis_output/
├── dataset_report.csv       # une ligne par image, toutes les métadonnées
├── dataset_report.pdf       # rapport professionnel (résumé, graphiques, recommandations)
├── logs.txt                 # journal complet de l'exécution
├── charts/                  # PNG individuels (utilisés dans le PDF)
└── Review/                  # présent uniquement avec --clean
    ├── Corrupted/
    ├── Atypical/
    └── Duplicates/           # présent uniquement avec --remove-duplicates
```

## Architecture

```
dataset_analyzer/
├── __init__.py
├── config.py               # AnalyzerConfig - tous les seuils réglables
├── schemas.py               # ImageRecord, DuplicateGroup, ClassStatistics, AnalysisReport
├── utils.py                  # logging, SHA-256, scan récursif, timer
├── metadata.py                # extraction métadonnées + détection corruption (threads)
├── quality_checker.py          # détection images atypiques (processus)
├── duplicate_detector.py        # doublons exacts + quasi-doublons (BK-tree + SSIM)
├── analyzer.py                   # orchestrateur
├── visualization.py               # graphiques matplotlib
├── cleaner.py                      # déplacement non destructif vers Review/
└── report.py                        # export CSV + PDF (reportlab)
tests/
└── test_pipeline.py
main.py                               # CLI (argparse)
```

Lancer les tests :

```bash
python -m unittest discover -s tests
```

## Limites connues et pistes d'amélioration

- **DICOM non supporté** : les fichiers `.dcm` sont actuellement traités
  comme une extension invalide. Un support DICOM nécessiterait `pydicom`
  (non listé dans les bibliothèques autorisées).
- **Seuils noir/blanc/contraste** sont des valeurs par défaut génériques ;
  à recalibrer sur un échantillon réel du dataset avant un run `--clean`
  en production, pour éviter de signaler à tort des radios sombres mais légitimes.
- **Couverture de tests** limitée aux composants les plus critiques
  (BK-tree, détection de corruption, config) ; une suite plus large avec
  des images de test réelles serait recommandée avant intégration continue.
- **Pas de reprise sur erreur** pour les très longs scans : une exécution
  interrompue à 90 000/100 000 images repart de zéro. Un mécanisme de
  checkpoint (ex. état persisté en CSV incrémental) serait une amélioration
  naturelle pour les tout premiers runs sur des datasets massifs.
