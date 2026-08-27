# Fonctionnalité : Détection de pathologies (backend Neuro)

## Objectif

Détecter des pathologies thoraciques sur une image radiographique via le
backend Neuro distant, et afficher les heatmaps correspondantes.

## Architecture

Le backend « Neuro » (projet `CXR-Pathology_Analysis`) tourne à distance sur un
Space Hugging Face public. Il combine YOLOv8 (détection) + DenseNet-121
(heatmaps Grad-CAM, classes NIH). Aucun poids ni `ultralytics` requis
localement : simple HTTP via `pathology_service.py`.

## Flux

```
POST /workspace/exams/{id}/pathology/detect → pathologies + heatmaps
GET|PUT /workspace/pathology/backend        → état / configuration URL
```

## Configuration

- `NEURO_BACKEND_URL` (défaut : `https://sagarsarangi26-neuro.hf.space`).
- `NEURO_TIMEOUT` (défaut 120 s), `NEURO_HEALTH_TIMEOUT` (15 s) pour le cold
  start éventuel du Space.
- `PUT /workspace/pathology/backend` pour changer l'URL à chaud.

## Erreurs

- Backend joignable mais en échec : `502`.
- Backend indisponible : `503` (`PathologyUnavailableError`).

## Fichiers principaux

- `server/pathology_service.py`, `server/main.py`
- `client/src/lib/workspaceApi.ts` (`generateWorkspacePathology`)
- `client/src/components/ai/PathologyDetection.tsx`

## Limites

- Service public distant : dépendance à la disponibilité du Space HF.
- La détection est une aide, pas un diagnostic confirmé.