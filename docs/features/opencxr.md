# Fonctionnalité : OpenCXR (tri & normalisation)

## Objectif

Classer une radiographie (Frontal PA / AP / Lateral / notCXR) et normaliser une
radio frontale, via le microservice opencxr.

## Architecture

opencxr requiert TensorFlow, absent en wheel pour le Python 3.14 du serveur
principal. L'inférence est déléguée à un microservice Python 3.12 (venv312) sur
le port 8011, rejoint par HTTP via `sorter_service.py`.

## Flux

```
POST /workspace/exams/{id}/opencxr/sort        → tri (PA/AP/Lat/notCXR)
POST /workspace/exams/{id}/opencxr/standardize → normalisation (intensités + crop + resize)
GET|PUT /workspace/opencxr/backend             → état / configuration URL
```

## Comportement fail-closed

```
image invalide → REJECTED_INVALID_IMAGE (rejeté, aucune analyse)
non-CXR        → REJECTED_NON_CXR        (rejeté, aucune analyse)
CXR            → analyse (sort + standardize)
```

Si le microservice est indisponible (pas d'URL / injoignable), les endpoints
renvoient `503` ; le serveur principal reste opérationnel (mode dégradé).

## Standardisation

- Intensités via normalisation par bandes d'énergie (PCI Philipsen et al.).
- Crop optionnel à la boîte englobante des poumons.
- Resize carré (1024 par défaut), préservation du ratio + padding.
- `pixel_spacing_mm` optionnel pour la calibration métrique (priorité sur le
  DICOM si fourni).

## Configuration

- `OPEN_CXR_URL` (variable) ou `PUT /workspace/opencxr/backend`.
- URL persistée dans `.runtime/opencxr_remote.json`.
- `run_micro.bat` lance le microservice (venv312).

## Fichiers principaux

- `server/sorter_service.py`, `server/main.py`
- `scripts/opencxr/microserver.py`, `run_micro.bat`, `sort_contract.py`
- `client/src/lib/workspaceApi.ts`

## Limites

- Dépendance microservice TensorFlow.
- Le client n'envoie que le PNG rendu (pas le DICOM brut) au `/standardize`.