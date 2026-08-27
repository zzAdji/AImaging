# AImaging

Plateforme SaaS d'analyse d'images médicales par deep learning pour l'Hôpital
Général de Garoua (HGG). Le périmètre actif couvre la radiographie thoracique.

## Ce que fait le logiciel

AImaging assiste le diagnostic d'imagerie thoracique :

- import et visualisation d'images (PNG/JPG/DICOM) ;
- classification par un ensemble de 5 modèles ;
- Grad-CAM (interprétabilité) ;
- segmentation anatomique (CXAS) et landmarks (HybridGNet) avec mesures ;
- détection de pathologies via un backend Neuro distant ;
- génération et édition de rapports (LLM), export PDF ;
- assistant IA en langage naturel pilotant le workspace.

## Architecture

```
        Client ── HTTP ──> Server ──> scripts/ (inférence)
          │                    │
          └────── Supabase <───┘
```

Trois composants :

- `client/` : application React + TypeScript + Vite.
- `server/` : API FastAPI (port 8000).
- `scripts/` : inférence, prétraitement, entraînement.

Détails : [Architecture](docs/architecture.md).

## Technologies

- Frontend : React 19, TypeScript, Vite, Tailwind, Three.js.
- Backend : FastAPI, Pydantic, Uvicorn.
- IA : PyTorch / torchvision (classification, anatomie), TensorFlow (opencxr,
  via microservice), Gemini (rapports, agent).
- Persistance : Supabase (PostgreSQL, Auth, Storage).

## Fonctionnalités principales

| Domaine | Documents |
|---|---|
| Radiographie | [features/radiography.md](docs/features/radiography.md) |
| DICOM | [features/dicom.md](docs/features/dicom.md) |
| Classification + Grad-CAM | [features/gradcam.md](docs/features/gradcam.md) |
| Anatomie & mesures | [features/anatomy-measurements.md](docs/features/anatomy-measurements.md) |
| OpenCXR | [features/opencxr.md](docs/features/opencxr.md) |
| Pathologies | [features/pathology.md](docs/features/pathology.md) |
| Rapports | [features/reports.md](docs/features/reports.md) |
| Agent IA | [features/ai-agent.md](docs/features/ai-agent.md) |
| Authentification / RLS | [features/authentication.md](docs/features/authentication.md), [features/security-rls.md](docs/features/security-rls.md) |

## Installation

Le démarrage se fait via `start_dev.ps1` (3 processus dans des fenêtres
PowerShell séparées) :

```powershell
powershell -ExecutionPolicy Bypass -File start_dev.ps1
```

Sans microservice opencxr : `start_dev.ps1 -NoOpenCxr`.

Prérequis :

- Python 3.14 (serveur) et Python 3.12 (venv pour opencxr).
- Node + npm (client).
- Checkpoints radiographiques dans `models/chest_xray/`.
- Variables d'environnement (voir [Configuration](docs/configuration.md)).

Détail des environnements : [docs/configuration.md](docs/configuration.md).

## Démarrage manuel

```bash
# API (port 8000)
cd server && pip install -r requirements.txt && uvicorn main:app --port 8000

# Client (port 5173)
cd client && npm install && npm run dev

# Microservice opencxr (optionnel, port 8011)
cd scripts/opencxr && run_micro.bat
```

## Commandes

| Scope | Commande |
|---|---|
| Client | `npm run dev`, `npm run build`, `npm run test`, `npm run lint` |
| Server | `uvicorn main:app --port 8000`, `pytest` |
| Scripts | voir [docs/scripts.md](docs/scripts.md) |

## Structure du dépôt

```
client/        React + Vite
server/        FastAPI
scripts/       IA (radiographie, opencxr, shared)
models/        checkpoints (chest_xray)
supabase/      migrations, RLS
data/          données (hors Git)
docs/          documentation
outputs/       sorties de runs
```

## Documentation

Voir [docs/README.md](docs/README.md) pour le sommaire complet, puis :
[architecture](docs/architecture.md), [client](docs/client.md),
[server](docs/server.md), [scripts](docs/scripts.md), [api](docs/api.md),
[data-model](docs/data-model.md), [workflows](docs/workflows.md),
[configuration](docs/configuration.md).

## Hors périmètre actuel

- Échographie fœtale : présente dans le dépôt, non documentée ici.
- 3D : abandonnée.
- Ce contenu n'est pas présenté comme une fonctionnalité active.

