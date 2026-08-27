# Fonctionnalité : Grad-CAM

## Objectif

Visualiser les régions de l'image qui motivent la classification de l'ensemble.

## Flux

`/workspace/exams/{id}/gradcam` → `gradcam_service.generate_ensemble_gradcam`
→ overlay PNG transparent + région de pic.

## Traitement

- Génère une Grad-CAM pour chacun des 5 modèles de l'ensemble.
- Agrége et renvoie un overlay par image ainsi que les cartes par modèle.
- Sans Gemini ; dépend des checkpoints chargés.

## Sorties

- `heatmap_data_url` (overlay PNG).
- `per_model` : cartes individuelles.
- `peak_region` : coordonnées normalisées de la zone maximale.
- indépendant des toggles indépendants pathologies/heatmap côté UI.

## Fichiers principaux

- `server/gradcam_service.py`, `scripts/radiography/training/training/gradcam.py`
- `client/src/lib/workspaceApi.ts` (`generateWorkspaceGradcam`)

## Statut

VERIFIED. Nécessite les checkpoints radiographiques chargés.