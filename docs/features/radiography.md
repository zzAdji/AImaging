# Fonctionnalité : Images radiographiques

## Objectif

Importer, visionner et analyser des radiographies thoraciques.

## Flux

1. Import d'une image ou d'un DICOM dans un examen.
2. Validation technique et tri opencxr (rejet si non-CXR/invalide).
3. Classification par l'ensemble de 5 modèles.
4. Visualisation + annotations + mesures.
5. Analyses anatomiques (CXAS, HybridGNet) et détection pathologies.

## Entrées

- Fichiers image (PNG/JPG) ou DICOM (`.dcm`).
- Examen radiographique (`modality: radiography`).

## Traitement

- Le client envoie l'image rendue au serveur via `/workspace/...`.
- Le serveur orchestre opencxr, l'ensemble, l'anatomie et le backend Neuro.

## Sorties

- Classification (probabilités par classe).
- Grad-CAM (overlay).
- Segmentation et landmarks anatomiques.
- Détection de pathologies.

## Fichiers principaux

- `client/src/App.tsx`, `state/WorkspaceProvider.tsx`, `components/CanvasViewport.tsx`
- `server/main.py` (routes /radiography, /workspace)
- `scripts/radiography/training/main_predict.py`

## Dépendances

- PyTorch/torchvision (classification), CXAS (anatomie), HybridGNet (landmarks),
  Microservice opencxr, backend Neuro.