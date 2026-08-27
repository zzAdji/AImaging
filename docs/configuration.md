# Configuration

Environnements, runtime, variables, ports, chemins.

## Runtimes

| Vérifié | Version minimale | Utilisation | Où |
|---|---|---|---|
| Python | 3.14 | serveur FastAPI principal | `server/` |
| Python | 3.12 | microservice opencxr (TensorFlow) | `scripts/opencxr/` (venv312) |
| Node | Vite 8 | client | `client/` |

## Ports

| Port | Service |
|---|---|
| 8000 | API FastAPI |
| 8011 | Microservice opencxr |
| 5173 | Client Vite |
| 5432 | PostgreSQL Supabase (géré) |

## Variables d'environnement

### Client (`client/.env`)

| Variable | Rôle |
|---|---|
| `VITE_SUPABASE_URL` | URL du projet Supabase. |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Clé anon (publiable). |
| `VITE_API_BASE_URL` | Base URL de l'API (défaut `http://localhost:8000`). |
| `VITE_DEV_AUTH_EMAIL` / `..._PASSWORD` | Compte USER A (tests live locaux). |
| `VITE_DEV_AUTH_SECOND_EMAIL` / `..._PASSWORD` | Compte USER B (tests live). |

Format : `VITE_SUPABASE_URL=https://...`, pas de guillemets.

### Serveur

| Variable | Rôle |
|---|---|
| `GEMINI_API_KEY` | Clé Google Gemini (requise pour rapports/agent). |
| `OPEN_CXR_URL` | URL du microservice opencxr (vide = local 8011). |
| `OPEN_CXR_DEFAULT_URL` | URL locale par défaut opencxr. |
| `NEURO_BACKEND_URL` | URL du backend Neuro (défaut Space HF). |
| `THREE_D_REMOTE_URL` | URL du backend 3D distant (vide = local CPU). |
| `CXAS_PATH` | Racine des poids CXAS (défaut `~/.cxas`). |
| `CXAS_MODEL_NAME` / `CXAS_DEVICE` | Modèle / device CXAS. |
| `DICOM_PSEUDONYM_KEY` | Graine de pseudonymisation (sinon aléatoire). |
| `NEURO_TIMEOUT` / `OPEN_CXR_TIMEOUT` | Timeouts des services distants. |

Aucun secret n'est commité.

## Checkpoints / modèles requis

| Chemin | Modèle |
|---|---|
| `models/chest_xray/densenet121_best.pt` | DenseNet121 |
| `models/chest_xray/resnet50_best.pt` | ResNet50 |
| `models/chest_xray/resnet101_best.pt` | ResNet101 |
| `models/chest_xray/efficientnet_b0_best.pt` | EfficientNet-B0 |
| `models/chest_xray/efficientnet_b2_best.pt` | EfficientNet-B2 |
| `~/.cxas` | Poids CXAS (automatique, ~250 Mo) |
| `.cxas` interne / `scripts/opencxr/.../model_weights/` | Poids opencxr (heart/lung seg, image sorter) |

Chemins configurables dans `server/config.py`.

## Services externes

- Supabase (Auth, DB, Storage).
- Google Gemini (LLM, transcription, agent).
- Microservice opencxr (local 8011, ou distant).
- Backend Neuro (Space Hugging Face).
- Backend 3D (distant optionnel).

## Chemins importants

- `client/src/lib/db/` : repositories Supabase.
- `server/` : API.
- `scripts/radiography/` : pipeline radiographie.
- `.runtime/` : config des backends distants persistée par le serveur.