# AIMAGING — AUDIT TECHNIQUE PHASE 1
**Document d'audit produit à partir du code réel (source de vérité = repository).**
Date : 20/08/2026 · Aucun fichier du projet n'a été modifié.

Méthode de validation : chaque fonctionnalité a été vérifiée dans les fichiers, et le serveur a été
importé (28 routes) et les **66 tests serveur passent**. Les dépendances externes (Gemini, CXAS,
opencxr) ont été sondées côté environnement.

---

## 1. EXECUTIVE SUMMARY

Le projet est une plateforme web SAAS d'aide au diagnostic par imagerie (Radiographie / Échographie),
composée d'un backend **FastAPI (Python 3.14)** + un microservice **opencxr séparé (Python 3.12, venv312,
TensorFlow)** + un frontend **React 19 / Vite / Tailwind 4 (Figma-like editor)**.

**Ce qui est réellement fonctionnel (démontré ou testé) :**
- Classification radiographique par **ensemble de 5 CNN** (soft voting), endpoints `/radiography/predict`.
- **Grad-CAM d'ensemble** réelle (`/workspace/exams/{id}/gradcam`).
- **Éditeur image bureau-style** très complet (canaux, formes, annotations, mesures, fenêtrage, crop, export).
- **Lecture DICOM réelle** (`/dicom/parse`) avec pseudonymisation patient, multi-frame, fenêtrage natif.
- **Agent conversationnel Gemini** + **protocole de workspace versionné** (manifeste + validation stricte des actions),
  planification `/ai/plan`, tour `/ai/turn`, analyse anatomique par région `/anatomy/regions`.
- **Mécanique de rapport radiologique** structurée (6 champs) + contrôle de cohérence + rendu format HGG (`/radiography/report`).
- Suite de tests serveur : **66 tests, tous verts**. L'ensemble du code serveur s'importe sans erreur.

**Ce qui est partiel / dépend de services externes :**
- **CXAS** (segmentation 159 classes + CTR/SCD) : code réel + weights (840 Mo) présents, mais import externe `cxas` (lazy) ;
  un fichier `.part` (45 Mo) suggère un téléchargement interrompu → vérifier l'intégrité du `.pth`.
- **HybridGNet** (landmarks/mesures) : package `server/chexmask` + poids (70 Mo) présents, `torch_geometric` installé ;
  fonctionnel mais cache en mémoire, en lazy.
- **opencxr** (Image Sorter + Standardisation) : nécessite le microservice Python 3.12 (`run_micro.bat`) ; sans lui → 503.
- **3D (DeepScan3D/GRAF)** : pipeline serveur complet (job async local CPU ou remote), mais **désactivé côté client**
  (`THREE_D_FEATURE_ENABLED = false` dans `client/src/lib/examinations.ts`).

**Ce qui est mocké / simulé :**
- **Authentification** : écran de login 100 % client (aucun contrôle serveur, aucun mot de passe vérifié) — `LoginScreen.tsx`.
- **Entrée vocale** de la command bar : transcription **simulée** (`FloatingCommandBar.tsx`).
- Toute fonctionnalité Gemini sans `GEMINI_API_KEY` : retourne un tour de repli (dégradé).

**Ce qui est cassé / manquant :**
- **Pipeline échographie « examen » multimodal (DeepFetal/FetalCLIP)** : le package `scripts/fetal_ultrasound/exam/`
  ne contient **que des `.pyc` compilés sans source `.py`** (ensemble, exam_builder, exam_encoder, fusion, report, xai…).
  Les sources sont absentes → workflow non exécutable. `fetalclip_adapter/` est vide. Les CLIs single-image existent mais
  ne sont **pas exposés via l'API** (aucun endpoint échographie dans `main.py`).
- `generate_report` dans l'exécution d'actions du workspace : **non branché** côté client.
- Modèle `heart_seg.h5` d'opencxr : **134 octets (vide/corrompu)**.

---

## 2. REPOSITORY MAP

| Chemin | Rôle | Statut |
|---|---|---|
| `server/` | Backend FastAPI principal (Python 3.14) | ✅ actif, imports OK, 66 tests verts |
| `server/chexmask/` | Inférence HybridGNet (landmarks + mesures) | 🟡 partiel (lazy, torch_geometric) |
| `client/` | Frontend React 19 + Vite (éditeur Figma-like) | ✅ complet (45 sources) |
| `scripts/radiography/training/` | Entraînement des 5 CNN + inférence/prediction | ✅ complet |
| `scripts/radiography/preprocessing/` | Prétraitement (grayscale, resize+padding, split…) | ✅ complet |
| `scripts/radiography/anatomy/` | Segmentation CXAS + mesures CTR/SCD | 🟡 externe `cxas` + weights |
| `scripts/radiography/running/` | Adapter prédiction → rapports (radiography_adapter) | ✅ |
| `scripts/shared/llm/` | Rapport LLM structuré + cohérence + renderer | 🟡 dépend Gemini |
| `scripts/shared/analyzing/` | Outils d'analyse de dataset (CLI) | 🟠 expérimental |
| `scripts/three_d_maker/` | Reconstruction 3D DeepScan3D/GRAF | 🟡 serveur OK, client off |
| `scripts/opencxr/` | Microservice TF (sorter + standardisation) + `microserver.py` | 🟡 nécessite venv312 lancé |
| `scripts/fetal_ultrasound/` (+ `exam/`, `fetalclip_adapter/`) | Échographie DeepFetal/FetalCLIP | 🔴 sources `exam` manquantes |
| `models/` | Checkpoints (.pt/.pth) — **gitignorés** mais présents sur disque | ✅ présents |
| `DeepFetal/`, `FetalCLIP/`, `DeepScan3D/`, `kaggle/` | Dépôts de référence + notebooks Kaggle (gitignorés) | 🟠 références |
| `data/` | `chest-xray/` (4 classes), `fetal_ultrasound/`, `test/` | 🟡 données radio présentes |
| `notebooks/` | notebooks radiographie (design-model, utils) | 🟠 |
| `docs/` | cahier des charges (docx), littérature PDF, images | 📄 |
| `_handoff-anatomy/` | plan carte interactive (context) | 📄 |
| `outputs/` | artefacts dataset + ensemble (gitignoré) | 📄 |

**Modèles présents sur disque (tailles réelles, non commités au git) :**
`models/chest_xray/`: densenet121_best.pt (30 Mo), resnet50_best.pt (98 Mo), resnet101_best.pt (175 Mo),
efficientnet_b0_best.pt (19 Mo), efficientnet_b2_best.pt (34 Mo) · `models/3D_maker/model_best.pt` (15 Mo) ·
`models/cheXmask/hybridgnet_v1_skip.pt` (70 Mo) · `models/fetal_ultrasound/`: plane_classifier.pth (111 Mo),
filter.pt (3 Mo), FetalCLIP_weights.pt (1,7 Go).
Dataset `data/chest-xray/` : Emphysema 2 547, Normal 4 539, Pneumonia 5 398, Tuberculosis 3 169 (≈ 15 653 images).
---

## 3. FRONTEND AUDIT

**Stack** : React 19.2, TypeScript 6, Vite 8, Tailwind 4, framer-motion, lucide-react, three (volume 3D).
Point d'entrée : `client/src/main.tsx` → `App.tsx` (1 822 lignes).

**Écrans / composants réels :**
| Fichier | Rôle | Statut |
|---|---|---|
| `App.tsx` | Orchestration : menu, onglets, modales, raccourcis, moteur d'actions IA | ✅ |
| `components/LoginScreen.tsx` | Login | 🔵 mock (aucun backend) |
| `components/ExamsScreen.tsx` | Écran liste d'examens (CRUD, import, archive, export rapport) | ✅ |
| `components/CanvasViewport.tsx` (2 086 l.) | Éditeur : déplacement zoom, outils, sélection, crop, fenêtrage | ✅ |
| `components/ShapesLayer.tsx` | Rendu & édition des formes | ✅ |
| `components/RightPanel.tsx` | Panneau latéral (sections) | ✅ |
| `components/TitleBar.tsx`, `StatusBar.tsx`, `LeftToolbar.tsx` | chrome | ✅ |
| `components/MobileShell.tsx` | version mobile | ✅ |
| `components/Dialogs.tsx` | À propos / doc / histogramme / infos / raccourcis | ✅ |
| `components/ai/AiSidebarLeft.tsx` | Panneau IA / personnalisation modèle | ✅ |
| `components/ai/AiSidebarRight.tsx` | Affichage réponse / provenance | ✅ |
| `components/ai/FloatingCommandBar.tsx` | Barre de commandes IA | ✅ (voix simulée) |
| `components/ai/AnatomySegmentation.tsx`, `AnatomyMap.tsx`, `LandmarksMeasurements.tsx` | Résultats CXAS / landmarks | ✅ (dépend backend) |
| `components/ai/VolumeViewer.tsx` | Visualisation 3D (frames + volume interactif) | 🟡 off côté client |
| `components/ai/ReportEditor.tsx` | Éditeur de rapport | ✅ UI |
| `components/ai/ModeSwitch.tsx` | Bascule Normal Mode / AI Mode | ✅ |

**Lib (communication) :** `lib/workspaceApi.ts` (client HTTP), `lib/workspaceProtocol.ts` (manifeste client),
`lib/dicom.ts` + `dicomRenderer.ts` (DICOM), `lib/examinations.ts` (persistance), `lib/exportImage.ts`,
`lib/aiTransaction.ts`, `lib/aiCommandSyntax.ts`, `lib/aiCommands.ts`, `lib/anatomyMap.ts`.

**Constats :** UI très riche (outils : move, hand, zoom, rectangle, ellipse, arrow, line, freedraw, measure,
angle, distance, annotation, text, crop, windowlevel, brightness, contrast, magic wand, AI selection, gradcam, probe).

---

## 4. BACKEND AUDIT

**Serveur principal : `server/main.py` (1 410 lignes).** FastAPI, CORS restreint à `localhost:5173`.
`lifespan` (§158-178) :
- charge l'ensemble radiographie (`registry.load_radiography`, `ModelRegistry.load_radiography` → `load_radiography_models`, 5 checkpoints) ;
- charge le client Gemini (`ModelRegistry.load_gemini` → `GeminiReportClient`) si `GEMINI_API_KEY` défini ; sinon `startup_errors` ;
- `GET /health` (`main.py:1395`) expose l'état : `radiography_models_loaded`, `gemini_ready`, `anatomy_ready`, `opencxr_ready`, `startup_errors`.

**Modèles réellement chargés au démarrage :** seulement les 5 CNN radiographie (dans `main.py:163-168`).
**Chargés à la demande (lazy) :** CXAS (première `/anatomy`), HybridGNet (`/landmarks`), DeepScan3D (`/3d`),
opencxr (via microservice), Gemini (`/radiography/report`, `/ai/*`).

**`server/paths.py`** : `bootstrap_all()` ajoute au `sys.path` : racine projet, `shared/llm`, radiographie
`running/training`, `scripts/radiography`, `scripts` (obligatoire pour `import scripts.*` et `three_d_maker`).

**Structures clés :** `WorkspaceStore` (en mémoire → perdu à chaque redémarrage), `WorkspaceProtocol`
(contrat versionné), `WorkspaceAgent` (orchestration), `AgentTurnResponse`.

---

## 5. API MAP (28 routes, confirmées à l'import)

| Méthode & route | Fichier ligne | Rôle | Dépendance externe |
|---|---|---|---|
| `POST /workspace/exams` | main.py:415 | crée une session workspace (manifeste) | — |
| `PUT /workspace/exams/{id}` | main.py:428 | synchronise le manifeste | — |
| `POST /workspace/exams/{id}/actions/validate` | main.py:443 | valide un plan d'actions | — |
| `POST /workspace/exams/{id}/analyze` | main.py:452 | analyse des images (classification) | ensemble |
| `POST /workspace/exams/{id}/gradcam` | main.py:512 | Grad-CAM ensemble | ensemble + gradcam |
| `POST /workspace/exams/{id}/3d` | main.py:561 | lance reconstr. 3D (202 + job) | three_d |
| `POST /workspace/exams/{id}/anatomy` | main.py:607 | segmentation CXAS + mesures | external `cxas` |
| `POST /workspace/exams/{id}/landmarks` | main.py:665 | landmarks poumons/cœur | hybridgnet |
| `POST /workspace/exams/{id}/opencxr/sort` | main.py:757 | tri opencxr | microservice |
| `POST /workspace/exams/{id}/opencxr/standardize` | main.py:787 | normalisation CXR | microservice |
| `GET/PUT /workspace/opencxr/backend` | main.py:843/854 | état / config opencxr | — |
| `GET /workspace/exams/{id}/3d/jobs/{job}` | main.py:868 | status job 3D | — |
| `GET/PUT /workspace/3d/backend` | main.py:889/900 | état / config 3D remote | — |
| `POST /dicom/parse` | main.py:914 | import DICOM (PNG + metadata) | pydicom |
| `GET /workspace/commands/catalog` | main.py:967 | catalogue commandes @ | — |
| `POST /workspace/exams/{id}/commands/parse` | main.py:972 | analyse @commande déterministe | — |
| `POST /workspace/exams/{id}/ai/plan` | main.py:988 | planifie instruction libre (Gemini) | Gemini |
| `POST /workspace/exams/{id}/ai/turn` | main.py:1092 | tour agent (réponse + actions validées) | Gemini |
| `POST /workspace/exams/{id}/anatomy/regions` | main.py:1248 | description par région (Gemini + CXAS) | Gemini |
| `POST /radiography/predict` | main.py:1318 | classification ensemble | ensemble |
| `POST /radiography/report` | main.py:1358 | rapport structuré + cohérence | Gemini |
| `GET /health` | main.py:1395 | état du serveur | — |

**Aucun endpoint échographie fœtale n'est exposé** (le pipeline fetal n'est pas branché à l'API).
`import main` → `len(main.app.routes) == 28` confirmé.
---

## 6. RADIOGRAPHY PIPELINE

**Chemin d'exécution réel :**
1. `/radiography/predict` (`main.py:1318`) → écrit le fichier téléversé en tempfile → `predict_with_loaded_models`
   (`scripts/radiography/training/main_predict.py:115`) → softmax par modèle + moyenne (`soft voting`).
2. Chargement : `ModelRegistry.load_radiography` → `load_radiography_models` (`main_predict.py:87`) → `training/ensemble.load_model_from_checkpoint`
   (reconstruit le backbone torchvision + tête MLP, `hidden_dims=(512,128,32)`, dropout 0.2).
3. Prétraitement : `preprocess_for_model` (grayscale + `resize_with_padding` + normalisation par modèle native).
4. Classe prédite par l'ensemble ≡ moy. softmax. `model_builder.py` gère ResNet/DenseNet/EfficientNet/VGG/ConvNeXt (fc ou classifier).

**Modèles réellement chargés (5) :** DenseNet-121, ResNet-50, ResNet-101, EfficientNet-B0, EfficientNet-B2 —
tous présents sur disque. **Classes du jeu de données** : Normal / Pneumonia / Emphysema / Tuberculosis
(4 classes, cf. `data/chest-xray/`).

**Statut : ✅ VERIFIED.**

### Rapport radiologique
`POST /radiography/report` (`main.py:1358`) utilise `facts_from_predict_result` (running/radiography_adapter.py),
`build_prompt` + `SYSTEM_INSTRUCTION` (shared/llm/prompt.py), `GeminiReportClient.generate_structured`
(`gemini_client.py`) avec sortie `RadiologyReportFields` (6 champs pydantic strict), puis `check_coherence`
(vérifie que la classe/confiance du texte correspondent aux faits bruts) et `render_report_text` (format HGG).
**Sans `GEMINI_API_KEY` → 503.**
Statut : 🟡 PARTIAL (dépend de Gemini).

---

## 7. GRAD-CAM

`server/gradcam_service.py` → `generate_ensemble_gradcam` :
- par modèle : `GradCAM.generate(tensor, target_class)` (`training/gradcam.py`), couche cible via `get_default_target_layer` ;
- moyenne des cartes → normalisation → PNG transparent + `peak_region` (plus grande composante connectée) ;
- projetée dans la géométrie source (reproduit resize+padding de `preprocess_for_model`).
Endpoint `/gradcam` (main.py:512). Dépend de `Pillow`, `cv2`, `numpy`.
**Statut : ✅ VERIFIED** (implémentation réelle, aucune simulation).

---

## 8. CXAS / ANATOMY / MEASUREMENTS

- **CXAS** : `scripts/radiography/anatomy/` (service.py orchestrateur, cxas_engine.py loader lazy, segmentation.py,
  measurements.py, install_cxas.py, visualization.py). Endpoint `/anatomy` (`main.py:607`). 159 classes, CTR + SCD,
  conversion px-512 → mm si `pixel_spacing_mm`. **Sondage env :** `cxas` importable (True), weights 840 Mo présents
  à `~/.cxas/.cxas/weights/UNet_ResNet50_default.pth`. ⚠️ un fichier `.part` (45 Mo) traîne → un premier appel pourrait
  ré-initier un téléchargement → **vérifier l'intégrité du `.pth`**.
  → **Statut : 🟡 PARTIAL** (dépend lib externe + poids, lazy, risque `.part`).

- **Mesures CTR/SCD** : `measurements.py` → `extract_measurements` via l'extracteur officiel CXAS.
  Sérialise masques (option `mask_max_side=512`), overlay composite officiel.

- **HybridGNet landmarks** : `server/chexmask/inference.py` (encode→N échantillons latents→moyenne/écart-type
  par nœud, 120 nœuds, coordonnées 1024²), `chexmask/model.py`, `measurements.py` (CTR, SCD, lignes, incertitude).
  Endpoint `/landmarks` (main.py:665). `torch_geometric` **installé** (sondé True), poids 70 Mo présents.
  → **Statut : 🟡 PARTIAL** (fonctionnel mais lazy, CPU-only, sans garantie clinique).
---

## 9. DICOM

`server/dicom_service.py` + endpoint `/dicom/parse` (main.py:914) :
- `pydicom.dcmread(BytesIO(...), force=True)` + `dataset.pixel_array` ;
- **Pseudonymisation** : `_PSEUDONYM_KEY` (SHA-256 déterministe) ; `patient_pseudonym = Patient-<digest12>`.
  Le **Patient ID/Name brut n'est JAMAIS renvoyé**.
- Rendu PNG (monochrome + couleur), multi-frame (jusqu'à 64 frames), **buffer linéaire uint16** (`linear_data_url`)
  pour fenêtrage natif, métadonnées (PixelSpacing, UID étude/série/SOP…). Le **DICOM brut n'est pas stocké côté
  client** ni transmis à Gemini.
- Tests dédiés : `tests/test_dicom_service.py` (mono, couleur RGB, JPEG compressé) → **vert**.

**Statut : ✅ VERIFIED** (lecture réelle, sécurisée, testée).

---

## 10. FETAL ULTRASOUND

**Ce qui existe (réel) :**
- adaptateurs single-image : `scripts/fetal_ultrasound/deepfetal_adapter/` — `plane_inference.py` (classifieur 41 plans),
  `quality_inference.py` (filtre qualité), `fetalclip_model.py` + `fetalclip_embeddings.py` (FetalCLIP vision-language).
- CLIs : `infer_single_image.py`, `infer_folder.py`, `plane_grouping.py`, `extract_embeddings.py`.
- Poids présents : `plane_classifier.pth` (111 Mo), `filter.pt` (3 Mo), `FetalCLIP_weights.pt` (1,7 Go).

**Ce qui est MANQUANT / CASSÉ :**
- Le package `scripts/fetal_ultrasound/exam/` (pipeline DeepFetal « examen » : aggregation, classifier, ensemble,
  evaluator, exam_builder, exam_encoder, fusion, models, model_factory, plane_embedding, plane_grouping, quality,
  report, soft_voting, trainer, xai) **ne contient que des `.pyc` compilés dans `__pycache__/`, sans aucun `.py`** →
  workflow examen **inexécutable**.
- `fetalclip_adapter/` est **vide**.
- **Aucun endpoint HTTP** n'expose l'échographie (rien dans `main.py`) ; pas de multimodal branché.
- `scripts/fetal_ultrasound/tests/` : **aucun test** (vide).

**Statut : 🟠 EXPERIMENTAL (CLIs isolées) / ⚠️ BROKEN (intégration examen) / ❌ MISSING (API, multimodal).**

---

## 11. MULTIMODAL AGENT

`server/workspace_agent.py` + `workspace_agent_prompt.py` + `agent_context.py`.
- **Tour agent** (main.py:1092) : construit un prompt avec manifeste (sans pixels, sans identifiants DICOM privés),
  prédictions, contexte CXAS compacté, contexte visuel (`_build_visual_parts`), mémoire conversationnelle.
- **Sortie** : `AgentProposal` (intent, message, evidence, limitations, needs_visual_context, actions, warnings, clarif),
  puis `compile_agent_proposal` → `ActionPlan` strict validé (`validate_plan_against_manifest`). Actions :
  analyze/predict/generate_gradcam, show, create/update/delete shape, wl/brightness/contrast/invert,
  layer visibility/opacity, zoom, generate_report, notify, etc.
- **Anti-hallucination** : coordonnées clampées aux bornes image, cibles inconnues rejetées, cohérence DICOM
  (étude/patient/modalité/FrameOfReference), le tout côté **serveur**.
- **Commande explicite** `POST /commands/parse` : analyseur déterministe de `@analyze`, `@predict`, `@gradcam`, `@3d`,
  `@wl`, `@brightness`, `@contrast`, `@invert`, `@annotation`, `@measure`, `@layer`, `@report`.

**Dépendance :** Gemini (`GEMINI_API_KEY`). Sans clé → `fallback_agent_turn` (message exploitable, pas d'action).
**Statut : 🟡 PARTIAL** (mécanique complète serveur + client ; dépend d'un service externe).

---

## 12. WORKSPACE PROTOCOL

`server/workspace_protocol.py` (655 l.) — **contrat versionné `1.0`**, `StrictModel(extra=forbid)`,
validation de l'`ActionPlan` (ordres, cibles, bornes), `PixelRegion/Point/ShapeStyle` (normalise couleurs hex/nom), etc.
`inspect_manifest_consistency` (cohérence DICOM).  
`client/src/lib/workspaceProtocol.ts` construit le manifeste et les captures annotées (PNG base64, envoyées séparément si besoin).

**Statut : ✅ VERIFIED** (concordance serveur/client, validation stricte avant exécution navigateur).
---

## 13. PERSISTENCE

| Donnée | Emplacement | Survit au redémarrage |
|---|---|---|
| Sessions workspace (`WorkspaceStore`) | **En mémoire** (`server/workspace_store.py`) | ❌ perdues |
| Examens | `localStorage` `aimaging.examinations` | ✅ navigateur |
| Document en cours | `localStorage` `aimaging.document` (auto-save debounce) | ✅ navigateur |
| Préférences / style / thème / session login / prompts | `localStorage` | ✅ navigateur |
| Fichiers récents | `localStorage` (`lib/recent.ts`) | ✅ navigateur |
| Config 3D / opencxr remote | `.runtime/*.json` sur disque | ✅ serveur |

**Aucune base de données.** Le serveur persiste seulement `.runtime/*.json`. Les images/DICOM ne sont pas écrits sur
disque serveur (tempfile supprimés). Le DICOM brut n'est jamais stocké côté client.

---

## 14. AUTHENTICATION

**AUCUNE.** Pas d'endpoint d'auth serveur, pas de middleware. `LoginScreen.tsx` vérifie seulement des champs non vides,
puis écrit `aimaging.session = { email }` en localStorage. **Mot de passe jamais validé ni envoyé.**
→ **❌ MISSING / 🔵 MOCKED** (à refaire pour toute mise en production).

---

## 15. TESTING

| Suite | Localisation | Statut |
|---|---|---|
| Serveur principal | `server/tests/` (7 fichiers) | ✅ **66 tests, tous passent** (exécuté ~15 s) |
| opencxr | `tests/opencxr/tests/` | 🟡 collectés (7), non exécutés ; `heart_seg` vide |
| Fetal | `scripts/fetal_ultrasound/tests/` | ❌ aucun test |
| Training radiographie | notebooks | 🟠 non automatisé |
| Client | — | ❌ aucun test unitaire |

**Risque :** seul le serveur est couvert ; le client, les CLIs fetal/training et opencxr restent non vérifiés.
---

## 16. CONFIGURATION

| Variable | But | Fichier |
|---|---|---|
| `GEMINI_API_KEY` | requise (report & agent) | server/config.py |
| `THREE_D_REMOTE_URL` | backend 3D distant (sinon local CPU) | server/three_d_service.py |
| `OPEN_CXR_URL` / `OPEN_CXR_DEFAULT_URL` | microservice opencxr (défaut 127.0.0.1:8011) | server/sorter_service.py |
| `CXAS_MODEL_NAME/DEVICE/PATH` | CXAS (CPU, `~/.cxas`) | server/config.py , anatomy/config.py |
| `DICOM_PSEUDONYM_KEY` | pseudonymisation (déterministe) | server/dicom_service.py |
| `VITE_API_BASE_URL` | URL backend (défaut :8000) | client/src/lib/*.ts |

Le serveur démarre **sans** Gemini / CXAS / opencxr / 3D (mode dégradé) ; `/health` reflète l'état.

---

## 17. PERFORMANCE

- Boot : chargement **bloquant** des 5 CNN (≈ 350 Mo) dans `lifespan` → démarrage possiblement long.
- CXAS chargé lazy au 1er `/anatomy` (≈ 840 Mo de poids, RAM).
- 3D CPU très lente (task thread + job polling) ; désactivée côté client.
- opencxr : 1er appel paie import TF + poids (mitigé par `_preload_models` au boot du microservice).
- DICOM : buffer linéaire jusqu'à ~12 M pixels (dégradé au-delà).
- Pas de scaling (sessions mémoire), pas de cache HTTP, Gemini appelé sync dans endpoint async.

---

## 18. UX AUDIT

- Éditeur complet et soigné (shortcuts, history Ctrl+Z, calques, crop/export, mode mobile, Normal/AI mode).
- Libellés UI mixte **FR/EN** (ex. menus anglais, toasts français).
- Mic de la command bar : transcription **simulée**.
- Pas de gestion multi-utilisateur / tableau de bord. Login factice.

---

## 19. END-TO-END WORKFLOWS

**✅ exécutables :**
1. Ouvrir radio → `analyze` (classification 5-CNN) : ✅ (checkpoints présents, tests).
2. Grad-CAM : `/gradcam`. ✅
3. DICOM → viewer fenêtré natif : `/dicom/parse`. ✅
4. Agent conversationnel sur canvas : `/ai/turn` → `executeAiActionPlan`. ✅ (si Gemini)
5. Rapport `/radiography/report` (structuré + cohérence + rendu). ✅ (si Gemini)

**⚠️ incomplets / cassés :**
6. Anatomy CXAS : endpoint OK mais bloqué par lib/poids/`.part`.
7. Landmarks HybridGNet : endpoint OK, UX ad-hoc.
8. **3D : serveur OK mais client désactivée** (`THREE_D_FEATURE_ENABLED=false`).
9. **Rapport workspace** : `generate_report` → « backend pas encore relié » (WorkspaceProvider.tsx:1364).
10. **Échographie examen/multimodal** : ❌ source manquante.
11. **Authentification** : ❌.

---

## 20. DEAD CODE / TECHNICAL DEBT

- `client/src/lib/aiCommands.ts` (14 l.) ; `aiCommandSyntax.ts` utilisé seul par FloatingCommandBar.
- Actions `generate_report` / `replace_report` : acceptées au protocole mais **non exécutées** côté client.
- `THREE_D_FEATURE_ENABLED=false` → gros code 3D serveur inutilisé côté UI.
- `heart_seg.h5` (134 octets) : poids opencxr corrompu → test `test_heart` à risque.
- Fichier `.part` (45 Mo) de CXAS → reliquat téléchargement.
- `fetal_ultrasound/exam/*.pyc` sans `.py` → source perdue.
- `scripts/shared/analyzing/.venv/` embarqué dans le repo.
- Pas de tests client / fetal / opencxr / training → surfaces non couvertes.
---

## 21. FINAL STATUS MATRIX

| Fonctionnalité | Statut | Preuve | Dépendance | Bloquant | Priorité |
|---|---|---|---|---|---|
| Ensemble radiographie (5 CNN) | ✅ VERIFIED | main.py:163, main_predict.py:87, weights disque | torch/torchvision | — | — |
| Classification endpoint | ✅ VERIFIED | /radiography/predict (main.py:1318) | ensemble | — | P0 |
| Grad-CAM ensemble | ✅ VERIFIED | gradcam_service.py, main.py:512 | ensemble | — | P0 |
| Rapport radiologique structuré | 🟡 PARTIAL | /radiography/report (main.py:1358) | Gemini | GEMINI_API_KEY | P0* |
| Contrôle de cohérence rapport | ✅ VERIFIED | shared/llm/coherence_check.py | — | — | P0* |
| DICOM (parse, fenêtrage, pseudonyme) | ✅ VERIFIED | dicom_service.py, tests | pydicom | — | P0 |
| Viewer / éditeur Figma-like | ✅ VERIFIED | CanvasViewport/ShapesLayer | — | — | P0 |
| Normal Mode / AI Mode | ✅ VERIFIED | ModeSwitch.tsx | — | — | P0 |
| Command bar (texte) | ✅ VERIFIED | FloatingCommandBar.tsx | backend IA | — | P0 |
| Command bar (voix) | 🔵 MOCKED | FloatingCommandBar.tsx:59 « simulated transcription » | — | — | P3 |
| Agent multimodal (workspace) | 🟡 PARTIAL | workspace_agent.py, /ai/turn | Gemini | GEMINI_API_KEY | P1 |
| Protocole workspace | ✅ VERIFIED | workspace_protocol.py, tests | — | — | P1 |
| Anatomy CXAS (159 classes, CTR/SCD) | 🟡 PARTIAL | anatomy_service.py + scripts/radiography/anatomy | cxas + weights | intégrité .pth / .part | P1 |
| Landmarks HybridGNet | 🟡 PARTIAL | chexmask_service.py + inference.py | torch_geometric | — | P1 |
| opencxr (sorter + standardisation) | 🟡 PARTIAL | microserver.py (venv312) + sorter_service.py | TF venv312 | microservice up | P1 |
| Cohérence étude DICOM | ✅ VERIFIED | inspect_manifest_consistency + tests | — | — | P2 |
| 3D DeepScan3D/GRAF | 🟡 PARTIAL | three_d_service.py + three_d_maker | CPU/remote | flag client OFF | P1/P2 |
| Échographie : quality + plane (CLI) | 🟠 EXPERIMENTAL | infer_single_image.py | DeepFetal/FetalCLIP | — | P2 |
| Échographie : pipeline examen multimodal | ❌ MISSING | exam/ n'a que .pyc | — | source perdue | P2 |
| Échographie : endpoint API | ❌ MISSING | aucun dans main.py | — | — | P2 |
| FetalCLIP embeddings (CLI) | 🟠 EXPERIMENTAL | fetalclip_embeddings.py | open_clip | — | P2 |
| Gestion des examens (CRUD, archive, export) | ✅ VERIFIED | ExamsScreen.tsx + examinations.ts | — | — | P2 |
| Persistance (localStorage + mémoire) | 🟡 PARTIAL | examinations.ts + workspace_store.py | — | — | P2 |
| Authentification | 🔵 MOCKED / ❌ | LoginScreen.tsx (aucun backend) | — | — | P2 |
| Tests serveur | ✅ VERIFIED | 66 passed | — | — | P1 |
| Tests client / fetal / opencxr | ❌ MISSING | — | — | — | P3 |

*P0 seulement après décision sur l'usage des données patient avec Gemini (palier gratuit → entraînement possible).
Sans clé, le produit reste dégradé mais fonctionnel.
---

## 22. PRIORITIZED ROADMAP

**P0 — boucler le workflow principal (démonstration complète) :**
1. Vérifier/rétablir les poids CXAS (supprimer `.part`, tester `~/.cxas/.cxas/weights/UNet_ResNet50_default.pth`).
2. Exécuter la suite opencxr (lancer `run_micro.bat` / venv312) ; réparer `heart_seg.h5` ou retirer le test rouge.
3. Script de lancement unique (serveur + microservice + client) + vérification `/health` complet.
4. Brancher le « report workspace » : relier `generate_report` à `/radiography/report` dans `executeAiActionPlan` (cas radio).
5. Décision Apollo/Gemini sur les données patient (paliers API) avant usage réel.

**P1 — éviter une démo fragilisée :**
6. Réactiver proprement la 3D : mettre `THREE_D_FEATURE_ENABLED=true` **seulement** après évaluation de la qualité
   des frames rendues ; sinon garder la vue « volume » en attente.
7. Un flux cohérent Anatomy/Landmarks dans l'éditeur (une seule action, pas de tunnels ad-hoc `landmarks-{id}`).
8. Sauvegarde de sessions/audit : `WorkspaceStore` mémoire → SQLite/Redis + persistance des manifests.

**P2 — robustesse & cohérence :**
9. Reconstruire les sources du pipeline `fetal_ultrasound/exam` (à défaut : documenter l'échographie hors scope).
10. Exposer un endpoint HTTP échographie minimal (quality → plane → embeddings FetalCLIP).
11. Authentification réelle (sessions serveur sécurisées, RBAC minimal).
12. Couvrir par des tests : client + CLIs fetal + opencxr (quand TF dispo).

**P3 — amélioration / production :**
13. Transcription vocale réelle (Web Speech API).
14. Caches d'inférence LRU (CXAS, HybridGNet) + préchargement parallèle.
15. Nettoyage repo : venv embarqué, `aiCommands.ts`, `replace_report`, `.part`.
16. Observabilité : logs structurés, audit persistant des actions IA.
---

## 23. PROPOSED TARGET ARCHITECTURE

Préserver les briques fonctionnelles : radio (5 CNN + Grad-CAM + CXAS + HybridGNet + DICOM),
échographie (quality/plane/FetalCLIP), produit (éditeur, Normal/AI, command bar, mesures, rapports).

```
┌───────────────  Client (React 19, Vite) ───────────────┐
│  ExamsScreen → WorkspaceProvider → CanvasViewport       │
│  Normal Mode / AI Mode · Command bar · Report editor    │
│  lib/workspaceApi (JSON) · dicom.ts (DICOM)             │
└──────────────┬──────────────────────────────────────────┘
               ▼  REST/JSON (localhost:8000, CORS)
┌─────────────── FastAPI (Python 3.14) ──────────────────┐
│ GET /health · /radiography/predict|report · /dicom/parse│
│ /workspace/...(exams, analyze, gradcam, anatomy,        │
│   landmarks, ai/turn, ai/plan, commands/parse, 3d)      │
│ ModelRegistry (5 CNN, lazy CXAS/HybridGNet, Gemini)     │
│ WorkspaceStore (→ SQLite recommandé) · Protocole v1.0   │
└───────┬──────────────┬───────────────┬───────────────────┘
        ▼             ▼                ▼
 ┌───────────┐  ┌─────────────────┐  ┌──────────────────┐
 │ microsvc  │  │ CXAS            │  │ 3D remote (opt)   │
 │ opencxr   │  │ (~/.cxas/*.pth  │  │ Kaggle/tunnel GPU │
 │ TF 3.12   │  │  840 Mo)        │  └──────────────────┘
 │ port 8011 │  └─────────────────┘
 └───────────┘   + HybridGNet (lazy in-server)
```

Recommandations cibles : conserver `scripts/radiography` et `server/chexmask` ; **restaurer le module
`scripts/fetal_ultrasound/exam`** ; persistance simple (SQLite) pour sessions/audit ; secrets par variables
d'environnement (déjà en place) ; CI (pytest + collect opencxr + typecheck client).

---

**Fin de l'audit Phase 1 — aucune modification du code n'a été effectuée.**