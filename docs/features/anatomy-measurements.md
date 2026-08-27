# Fonctionnalité : Anatomie et mesures

## Objectif

Extraire la segmentation anatomique (CXAS) et les landmarks (HybridGNet) d'une
radiographie, avec mesures et incertitude.

## Flow CXAS

`/workspace/exams/{id}/anatomy` → `anatomy_service` → `scripts/radiography/anatomy`
(Segmentation 159 classes PAXRay, UNet-ResNet50 officiel CXAS) → masques + CTR/SCD.

### CXAS

- Modèle : UNet-ResNet50 (CXAS), classes 159.
- Poids : téléchargés automatiquement dans `~/.cxas/weights/` (~250 Mo).
- Mesures : **CTR** (rapport cardiothoracique, sans dimension) et **SCD**
  (distance colonne-centre, en pixels sur la grille 512) + optionnellement
  area/perimeter/compactness/centroid.
- Chargement paresseux ; le serveur ne bloque pas au démarrage s'il manque.

### HybridGNet (landmarks)

`/workspace/exams/{id}/landmarks` → `chexmask_service` → `chexmask`
(LandmarkInference) → landmarks poumons/cœur + mesure incertitude.

- Input : image, `pixel_spacing_mm` optionnel, `custom_measures`, `n_samples`.
- Output : contours, mesures, incertitude, chemin.
- Moteur instancié une fois et partagé entre requêtes.

## Relation avec analysis_runs

Chaque analyse est persistée comme `AnalysisRun` (source CXAS/HybridGNet,
status, warnings, inference_time_ms). Les mesures vont dans `measurements`.
`/anatomy-analysis` combine les deux sources en un seul statut global.

## Unités

- CTR : sans dimension.
- SCD : pixels (grille 512), conversion métrique optionnelle non calibrée
  cliniquement (si `pixel_spacing_mm` fourni).

## Limites

- Entraînés sur radios thoraciques : jamais lancés sur une autre modalité.
- Conversions de pixel spacing non calibrées cliniquement (SCD en mm).
- `n_samples` contrôle l'estimation d'incertitude (pixels).

## Fichiers

- `server/anatomy_service.py`, `scripts/radiography/anatomy/`
- `server/chexmask_service.py`, `server/chexmask/`
- `client/src/components/ai/AnatomySegmentation.tsx`, `LandmarksMeasurements.tsx`