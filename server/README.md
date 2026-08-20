# Serveur — plateforme de diagnostic imagerie

## Démarrage

```bash
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Sous PowerShell, configure Gemini seulement si tu veux utiliser
`POST /radiography/report` :

```powershell
$env:GEMINI_API_KEY = "ta-clé-api"
```

Sans cette variable, le serveur démarre quand même : `GET /health` renvoie
`"status": "degraded"`, tandis que la prédiction radiographique reste
disponible. Le endpoint de génération de rapport renvoie alors `503`.

Vérifie `config.py` si l'emplacement de tes checkpoints diffère de
`models/chest_xray/*.pt` à la racine du projet.

## Endpoints

- `GET /health` — état du serveur (modèles chargés, Gemini prêt)
- `POST /radiography/predict` — upload une image, renvoie la prédiction
  de l'ensemble (aucune dépendance à Gemini, fonctionne dès que les
  checkpoints sont en place)
- `POST /radiography/report` — prend le résultat de `/predict` + un
  contexte patient, renvoie le rapport structuré (6 champs), le résultat
  du contrôle de cohérence, et le texte final rendu au format HGG

- `POST /dicom/parse` — reçoit un fichier `.dcm`/`.dicom`, rend ses pixels
  en PNG (y compris multi-frame) et renvoie les métadonnées utiles au viewer.
  Le Patient ID/Name n'est jamais renvoyé en clair : un pseudonyme temporaire
  sert uniquement aux contrôles de cohérence.
- `POST /workspace/exams/{id}/opencxr/sort` — classifie une radio
  (Frontal PA / AP / Lateral / notCXR) via le microservice opencxr
  (rotation, inversion, flip latéral + probabilités).
- `POST /workspace/exams/{id}/opencxr/standardize` — normalise une radio
  frontale via opencxr (intensités + crop poumons + resize carré), renvoie
  le PNG normalisé + les changements de taille.
- `GET|PUT /workspace/opencxr/backend` — état / configuration à chaud de
  l'URL du microservice opencxr (vide = désactivé).

- `POST /workspace/exams/{id}/gradcam` — calcule une Grad-CAM réelle de
  l'ensemble radiographique et la renvoie comme overlay PNG transparent.
- `POST /workspace/exams/{id}/ai/turn` — réponse Gemini et plan d'actions
  canvas validé. Les contrôles de cohérence DICOM sont joints au contexte et
  bloquent une comparaison inter-images incohérente.

## Microservice opencxr

opencxr (Image Sorter + normalisation CXR) exige TensorFlow, or le serveur
tourne en Python 3.14 et il n'existe pas de wheel `cp314` pour tensorflow.
L'inférence opencxr est donc déléguée à un microservice Python 3.12 séparé :

```
scripts\opencxr\run_micro.bat        # ou manuellement via uvicorn sur le venv312
```

Démarrage manuel (depuis `scripts/opencxr`) :

```
..\..\.venv312\Scripts\python.exe -m uvicorn microserver:app --host 127.0.0.1 --port 8011
```

Puis configurer l'URL côté serveur principal (sinon les endpoints renvoient 503) :
- variable d'environnement `OPEN_CXR_URL=http://127.0.0.1:8011`, **ou**
- `PUT /workspace/opencxr/backend` avec `{"remote_url": "http://127.0.0.1:8011"}`.

Le serveur principal démarre et fonctionne sans le microservice (mode dégradé).
`GET /health` expose `opencxr_ready`.
Le client déclenche automatiquement le tri + la normalisation de chaque image
CR/DX à l'ouverture d'un examen, en même temps que la classification (une fois
par examen, résultats persistés par image). Comme le client n'envoie que le PNG
rendu (pas le DICOM brut), `/standardize` accepte un champ optionnel
`pixel_spacing_mm` (`R,C`, ex. `0.1688,0.1688`) pour fournir le spacing normalisé ;
celui-ci a priorité sur le spacing lu du DICOM, s'il y en a un.

## Rappel important

Palier gratuit Gemini : les prompts peuvent être utilisés par Google pour
l'entraînement de ses modèles. Ne pas envoyer de données patient réelles
avant d'avoir tranché cette question pour la mise en production (voir
`config.py::GeminiConfig`).

## Prochaine étape

Les exemples few-shot dans `shared/llm/prompt.py` sont construits par
Claude à partir du style des 3 rapports HGG fournis — à faire valider par
un praticien avant tout usage réel.
