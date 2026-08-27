# Fonctionnalité : Workspace & examens

## Objectif

Gérer les espaces de travail, les examens et les images, et orchestrer les
analyses dans une session éditable.

## Concept

Un **workspace** est une session temporaire côté serveur (`WorkspaceStore`, en
mémoire) à partir d'un **manifeste** (images, métadonnées, mesures). Les
examens/espaces persistés vivent dans Supabase côté client.

## Flux

```
Examen (Supabase) → Manifeste → POST /workspace/exams → workspace_id
→ analyses (analyze, gradcam, anatomy, landmarks, pathology, opencxr)
→ résultats persistés par run
```

## Entrées / sorties

- Entrées : manifeste (`WorkspaceManifest`), identifiants d'images, fichiers.
- Sorties : résultats d'analyse rattachés aux images, sessions.

## Fichiers principaux

Serveur :
- `server/main.py` (routes /workspace)
- `server/workspace_store.py`, `workspace_protocol.py`

Client :
- `state/WorkspaceProvider.tsx`, `lib/examinations.ts`
- `lib/db/examinationStore.ts`, `imageStore.ts`, `analysisRunService.ts`

## Persistance

- Sessions workspace : mémoire (temporaires, expirantes).
- Résultats : Supabase (`analysis_runs`, `measurements`, etc.).
- Le client réhydrate les résultats depuis Supabase à l'ouverture.