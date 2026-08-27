# API — Référence des endpoints

Serveur FastAPI : `http://localhost:8000`. `VITE_API_BASE_URL` configure le
point de base côté client.

## Tableau général

| Method | Endpoint | Purpose | Auth | Client |
|---|---|---|---|---|
| GET | `/health` | État du serveur (modèles, Gemini, opencxr) | non | non |
| POST | `/radiography/predict` | Prédiction de l'ensemble 5 modèles | non | oui |
| POST | `/radiography/report` | Rapport structuré + cohérence | non | oui |
| POST | `/dicom/parse` | Parsing + rendu PNG d'un DICOM | non | oui |
| POST | `/voice/transcribe` | Transcription vocale (Gemini) | non | oui |
| POST | `/workspace/exams` | Créer une session workspace | non | oui |
| PUT | `/workspace/exams/{id}` | Synchroniser un manifeste | non | oui |
| POST | `/workspace/exams/{id}/analyze` | Analyse/classification des images | non | oui |
| POST | `/workspace/exams/{id}/gradcam` | Grad-CAM de l'ensemble | non | oui |
| POST | `/workspace/exams/{id}/anatomy` | Segmentation CXAS | non | oui |
| POST | `/workspace/exams/{id}/landmarks` | Landmarks HybridGNet | non | oui |
| POST | `/workspace/exams/{id}/anatomy-analysis` | Anatomie complète (CXAS + HybridGNet) | non | oui |
| POST | `/workspace/exams/{id}/anatomy/regions` | Observations IA par région | non | oui |
| POST | `/workspace/exams/{id}/opencxr/sort` | Tri opencxr (PA/AP/Lat/notCXR) | non | oui |
| POST | `/workspace/exams/{id}/opencxr/standardize` | Normalisation opencxr | non | oui |
| GET | `/workspace/opencxr/backend` | État du backend opencxr | non | oui |
| PUT | `/workspace/opencxr/backend` | Configurer l'URL opencxr | non | oui |
| POST | `/workspace/exams/{id}/pathology/detect` | Détection pathologies (Neuro) | non | oui |
| GET/PUT | `/workspace/pathology/backend` | État/config backend Neuro | non | oui |
| POST | `/workspace/exams/{id}/3d` | Lancer une reconstruction 3D | non | oui |
| GET | `/workspace/exams/{id}/3d/jobs/{job}` | Statut d'un job 3D | non | oui |
| GET/PUT | `/workspace/3d/backend` | État/config backend 3D | non | oui |
| GET | `/workspace/commands/catalog` | Catalogue des commandes | non | oui |
| POST | `/workspace/exams/{id}/commands/parse` | Parser une commande explicite | non | oui |
| POST | `/workspace/exams/{id}/ai/plan` | Plan d'actions IA validé | non | oui |
| POST | `/workspace/exams/{id}/ai/turn` | Tour complet de l'agent (réponse + plan) | non | oui |
| POST | `/workspace/exams/{id}/actions/validate` | Valider un plan d'actions | non | oui |

## Détails par famille

### Radiographie

- **`POST /radiography/predict`** — reçoit une image (multipart), retourne la
  classification de l'ensemble. Indépendant de Gemini.
- **`POST /radiography/report`** — reçoit un résultat de prédiction + contexte
  patient, retourne le rapport structuré, le contrôle de cohérence et le texte
  final. Retourne `503` si Gemini absent.

### DICOM

- **`POST /dicom/parse`** — reçoit un `.dcm`, rend les frames en PNG (dont
  multi-frame), renvoie les métadonnées utiles. Le Patient ID/Name n'est jamais
  renvoyé en clair (pseudonyme temporaire).

### Workspace

- **`POST /workspace/exams`** — crée une session temporaire à partir d'un
  manifeste (images, métadonnées). Retourne `workspace_id` et protocole.
- **OpenCxR** : `/opencxr/sort` (classification) et `/opencxr/standardize`
  (normalisation) délèguent au microservice 8011 ; `503` si indisponible.
- **Pathologie** : `/pathology/detect` délègue au backend Neuro (Space HF).
- **Agent IA** : `/ai/plan` et `/ai/turn` utilisent Gemini et valident le plan
  via le protocole strict avant retour.

## Erreurs

- `404` : session/introuvable ; `422` : entrée invalide ; `503` : service
  externe indisponible ; `502` : backend externe en échec. Les erreurs sont
  exposées via `detail`.