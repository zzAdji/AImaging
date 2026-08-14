# Rapport d'avancement — Plateforme HGG AI d'imagerie médicale

| | |
|---|---|
| **Projet** | `hgg-ai-intership-project` — SaaS de diagnostic assisté par IA (deep learning) pour l'Hôpital Général de Garoua (HGG) |
| **Date du rapport** | 13 août 2026 |
| **Branche Git** | `main` |
| **Commits** | 15 (du 22/07/2026 au 13/08/2026) |
| **Version de protocole** | `workspace_protocol` v1.0 |
| **Volumétrie code** | Serveur ≈ 2 100 lignes Python · Client ≈ 11 600 lignes TypeScript/TSX |

---

## 1. Contexte et objectifs

Le projet consiste en la conception d'une **plateforme SaaS de diagnostic assisté par IA**, développée dans le cadre d'un stage pour l'Hôpital Général de Garoua (HGG). La solution conjugue :

- un **moteur de deep learning** : classification radiographique (thorax) par ensemble de modèles et analyse d'échographie fœtale (FetalCLIP / DeepFetal) ;
- un **backend FastAPI** (Python 3.14, Pydantic v2) exposant prédiction, rapports structurés, lecture DICOM réelle, Grad-CAM et un agent conversationnel Gemini ;
- un **client web** (Vite + React 19 + TypeScript) reproduisant un poste de travail d'imagerie (workspace canvas, annotations, mesures, calques, fenêtrage, panneaux IA) ;
- un **protocole d'actions IA versionné et validé** permettant d'exécuter des plans structurés de manière transactionnelle, sans approbation humaine superflue, conformément aux exigences de la phase 4.

### Objectifs stratégiques
1. Fournir un assistant d'imagerie réel, fiable et explicable (pas de données fictives en front).
2. Garantir la **sécurité et l'éthique médicale** : pseudonymisation stricte des patients, aucune clé API dans le navigateur, traçabilité et annulation complète des actions IA, limites cliniques explicites.
3. Assurer la **cohérence multi-images** d'un examen (contrôles DICOM déterministes) et une **exécution transactionnelle** des plans IA.
4. Traiter de **vrais DICOM** avec **fenêtrage/niveau natif** sur les pixels bruts (valeurs HU).

---

## 2. Synthèse exécutive

| Domaine | Statut | Remarque |
|---|---|---|
| Modèles ML (ensemble radiographie, échographie fœtale) | ✅ Opérationnel | Checkpoints présents, chargés au démarrage |
| Prédiction / rapports / cohérence (back) | ✅ Opérationnel | Dépendance Gemini pour les rapports uniquement |
| Lecture DICOM réelle + fenêtrage natif | ✅ Réalisé (arbre de travail) | Non encore commité |
| Grad-CAM réelle (overlay transparent) | ✅ Opérationnel | Ensemble moyenné, géométrie source |
| Protocole d'actions & validation strictes | ✅ Opérationnel | Pydantic `StrictModel`, ordre + cibles vérifiés |
| Commandes `@` et planificateur Gemini | ✅ Opérationnel | Commande déterministe + agent LLM |
| Analyse automatique à l'ouverture | ✅ Opérationnel | Avec progression par image |
| Moteur transactionnel multi-images (Ctrl+Z global) | ✅ Réalisé (arbre de travail) | Non encore commité |
| Tests serveur | ⚠️ Partiel | 5/7 passent ; 2 échecs à corriger |
| Tests de bout en bout (Gemini + vrais DICOM) | 🔴 À faire | Non couverts actuellement |

> **Point d'attention documentaire** : `CONTEXTE.md` et `PHASE.md` indiquent que trois points restent à finaliser (exécution transactionnelle multi-images, fenêtrage natif, tests de bout en bout). **L'exécution transactionnelle et le fenêtrage natif sont désormais implémentés** dans l'arbre de travail ; ces documents sont à mettre à jour, et le travail en cours doit être **commité** (voir section 6).

---

## 3. Architecture du système

```
┌────────────────────────────────────────────────────────────────────────────┐
│  CLIENT — Vite + React 19 + TypeScript (client/src)                        │
│  · Workspace/état par image (state/WorkspaceProvider.tsx, workspace.ts)    │
│  · Canvas interactif (CanvasViewport, ShapesLayer, gestes W/L natifs)      │
│  · Panneaux IA, barre de commandes @, éditeur de rapport                   │
│  · Moteur transactionnel multi-images (lib/aiTransaction.ts + App.tsx)     │
│  · Rendu DICOM natif (lib/dicomRenderer.ts, LinearImageBuffer)             │
└───────────────▲─────────────────────────────────────────────▲──────────────┘
                │ REST (JSON / multipart)                       │ FormData
┌───────────────┴─────────────────────────────────────────────┴──────────────┐
│  BACKEND — FastAPI + Pydantic v2 + Python 3.14 (server/)                    │
│  · main.py (endpoints), config.py, paths.py (bootstrap sys.path)            │
│  · workspace_protocol.py  — contrat d'actions versionné (StrictModel)       │
│  · workspace_agent.py / workspace_agent_prompt.py — planificateur Gemini    │
│  · workspace_commands.py — commandes @ déterministes                        │
│  · workspace_store.py — sessions temporaires en mémoire                     │
│  · dicom_service.py — lecture DICOM (+ buffer linéaire rescale)             │
│  · gradcam_service.py — Grad-CAM d'ensemble                                 │
│  · gemini_client.py / model_registry.py                                     │
└───────────────┬────────────────────────────────────────────────────────────┘
                │ torch / op
┌───────────────┴────────────────────────────────────────────────────────────┐
│  MODÈLES & SCRIPTS (models/, scripts/)                                      │
│  · Ensemble radiographie thorax : densenet121, resnet50/101, efficientnet   │
│    b0/b2 (5 checkpoints)                                                    │
│  · Échographie fœtale : FetalCLIP / DeepFetal (sous-dépôt), plane_grouping  │
│  · notebooks/ : design-model.ipynb, utils.ipynb                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

La **confidentialité des DICOM est préservée de bout en bout** : le serveur ne transmet jamais les fichiers bruts ni les identifiants patient à Gemini ; seuls un rendu PNG, les pixels rescaleés et des métadonnées pseudonymisées sont exploités.

---

## 4. État d'avancement détaillé par module

### 4.1 Modèles et traitement (research / ML)

- **Radiographie thoracique (ensembliste)** — ensemble de 5 architectures (DenseNet121, ResNet50, ResNet101, EfficientNet-B0, EfficientNet-B2) sur checkpoints `models/chest_xray/*_best.pt`. Chargés par `ModelRegistry` au démarrage sur device auto. Pipeline `scripts/radiography/{preprocessing,running,training}` incluant `main_predict`, `radiography_adapter` (extraits de faits), `report_schemas`, `report_renderer`, `prompt`, `coherence_check`.
- **Échographie fœtale** — pipeline `scripts/fetal_ultrasound/` : extraction d'embeddings FetalCLIP, inférence image unique / dossier, groupement de plans (`plane_grouping.py`), adaptateurs DeepFetal & FetalCLIP, module `exam/` (quality, soft_voting, trainer, xai, report). Checkpoints dans `models/fetal_ultrasound/`. Les dépôts `DeepFetal` et `FetalCLIP` sont référencés (DeepFetal reste un dépôt imbriqué non enregistré comme sous-module Git — voir 6.4).

### 4.2 Backend FastAPI

| Endpoint | Rôle | Statut |
|---|---|---|
| `GET /health` | État serveur (modèles chargés, Gemini prêt) | ✅ |
| `POST /radiography/predict` | Prédiction ensemble (sans Gemini) | ✅ |
| `POST /radiography/report` | Rapport structuré (6 champs) + cohérence + texte HGG | ✅ |
| `POST /dicom/parse` | Lecture DICOM réelle → PNG + métadonnées + buffer linéaire | ✅ |
| `POST /workspace/exams` / `PUT …/{id}` | Création / mise à jour de session temporaire | ✅ |
| `POST …/analyze` | Classification multi-images d'un examen (CR/DX) | ✅ |
| `POST …/gradcam` | Grad-CAM réelle d'ensemble (overlay RGBA) | ✅ |

---

## 5. Validation et qualité

### 5.1 Client — TypeScript

- Commande exécutée : `tsc -b` (TypeScript ~6.0) dans `client/`.
- **Résultat : réussite (code 0), aucune erreur** sur l'ensemble du code (état non commité inclus).

### 5.2 Serveur — Tests pytest

- Environnement : Python 3.14 (`C:\Python314`), pytest 9.1.1 installé sur `Z:\hgg-tools\pytestlib` (disque C: saturé), variables d'env requises (`PYTHONPATH`, `TEMP/TMP` sur Z:, `OPENBLAS_NUM_THREADS=1`, `OMP_NUM_THREADS=1`).
- Suite actuelle : `server/tests/test_dicom_service.py` — **7 tests, 5 passent, 2 échouent**.

| Test | Résultat |
|---|---|
| Lecture monochrome : métadonnées + buffer linéaire | ❌ Échec (voir 6.1) |
| Buffer linéaire : Rescale Slope/Intercept | ✅ |
| MONOCHROME1 fournit le buffer linéaire | ✅ |
| DICOM couleur : buffer linéaire désactivé | ❌ Échec (voir 6.1) |
| Repli buffer trop grand (`MAX_LINEAR_PIXELS`) | ✅ |
| Fichiers vides / non-DICOM → erreur lisible | ✅ |
| DICOM JPEG compressé | ⏭️ Skip si codec absent |

### 5.3 Hygiène Git

- 15 commits sur `main` (du 22/07 au 13/08/2026), historique clair et cohérent (une fonctionnalité par commit).
- **Travail en cours non commité** : 13 fichiers modifiés (+579 / −1411, dont suppression de `R.md`), 5 fichiers non suivis (`CONTEXTE.md`, `PHASE.md`, `client/src/lib/aiTransaction.ts`, `client/src/lib/dicomRenderer.ts`, `server/tests/`).

---

## 6. Problèmes identifiés et dette technique

### 6.1 Échecs de tests (causes racines)

1. **`test_parse_monochrome_metadata_and_linear_buffer`** — le test attend `patient_pseudonym == "PSEUDO-001"`, or le service **pseudonymise volontairement** (SHA-256 + clé aléatoire par défaut → `Patient-<hash12>`). Le comportement du service est correct ; **c'est l'assertion du test qui est obsolète**. Corrections possibles : fixer `DICOM_PSEUDONYM_KEY` dans `conftest.py` et asserter la valeur attendue, ou vérifier seulement le préfixe `Patient-`.
2. **`test_rgb_dicom_disables_linear_buffer`** — la génération de la fixture RGB provoque une `AttributeError` **dans pydicom** (`pixels/common.py`), probablement liée au contenu de la fixture (PlanarConfiguration / shape 3D). La fixture (`make_rgb_dicom_bytes` dans `conftest.py`) doit être corrigée (p. ex. définir `PlanarConfiguration`) ; à confirmer avec un vrai DICOM couleur.

---

## 7. Prochaines étapes (ordre recommandé)

1. **Corriger les deux tests serveur** (fix de `conftest.py` / assertions) et repasser `pytest` à 7/7.
2. **Committer l'avancement en cours** : moteur transactionnel, fenêtrage natif DICOM, tests, puis mettre à jour `CONTEXTE.md`/`PHASE.md` et supprimer `R.md`.
3. **Ajouter les tests unitaires serveur manquants** : protocole (validation/ordre/limites), commandes `@`, compilation d'agent, endpoints API (TestClient), et un test d'intégration Gemini `skipif` sans clé.
4. **Tests de bout en bout** : un jeu de vrais DICOM (CR/DX compressés et non compressés, monochrome + couleur), vérification du rendu fenêtré natif, d'un plan multi-images et de l'annulation globale.
5. **Côté client** : lancer `eslint` et ajouter des tests sur le moteur transactionnel (`aiTransaction.ts`) et `dicomRenderer.ts`.
6. **Décisions produit** : validation des exemples de rapports par un praticien ; validation des données réellement envoyables à Gemini (palier gratuit) ; scénario de mise en production (auth, persistance, nettoyage des sessions temporaires, quotas images/LLM).

---

## 8. Risques et recommandations

| Risque | Niveau | Recommandation |
|---|---|---|
| Échecs de tests non traités (2/7) | 🟠 Moyen | Corriger fixtures et assertions avant d'étendre la suite |
| Aucune validation E2E avec Gemini et DICOM réels | 🟠 Moyen | Campagne E2E dédiée ; clé Gemini dédiée, données synthétiques puis réelles |
| Disque C: saturé → perte possible de worktree/env | 🟠 Moyen | Sauvegardes régulières, redirection systématique sur Z:, commits fréquents |
| Confiance clinique : rapports LLM, mesures non calibrées, limite CR/DX du classifieur | 🔴 Élevé | Garder les garde-fous existants (cohérence déterministe, disclaimer, limites explicites) et faire valider les rapports par un praticien |
| `DeepFetal` hors contrôle Git propre | 🟡 Faible | Résoudre le statut sous-module / ignorer proprement |
| Données patient envoyées à Gemini (palier gratuit) | 🔴 Élevé | Ne jamais envoyer de données réelles avant décision formelle ; pseudonymisation déjà en place |

---

## 9. Conclusion

Le projet a convergé vers une **plateforme fonctionnelle de bout en bout** : modèles radiographiques ensemblistes, lecture DICOM réelle avec fenêtrage natif sur valeurs HU, agent Gemini structuré et validé, commandes `@`, Grad-CAM réelle, analyse automatique multi-images, cohérence d'examen déterministe et exécution transactionnelle avec annulation globale. Le code client **compile**, le serveur expose l'ensemble des contrats attendus et la couche de tests commence à se matérialiser.

Il reste principalement à : **réparer deux tests**, **committer l'avancement en cours**, **étoffer la couverture** (unitaires + E2E avec vrais DICOM et Gemini), et **trancher les décisions produit/sécurité** avant toute utilisation clinique.

---

*Document généré par analyse statique du dépôt le 13/08/2026. Vérifications exécutées : `tsc -b` (client), `pytest` (serveur, env Z:), inspection Git et revue des modules serveur/client.*
### 6.2 Documentation obsolète

- `CONTEXTE.md` et `PHASE.md` (non commités) décrivent l'exécution transactionnelle et le fenêtrage natif comme *à faire*, alors qu'ils sont **implémentés** dans l'arbre de travail. À mettre à jour pour refléter l'état réel.

### 6.3 Manques de couverture

- **Tests de bout en bout** (Gemini + vrais DICOM cliniques, y compris compressés JPEG/JPEG-LS) : prévus mais absents de la suite actuelle.
- Pas de tests unitaires sur `workspace_protocol`, `workspace_commands`, `workspace_agent`, les endpoints API ni le moteur transactionnel client.
- Pas de lint exécuté lors de cette revue (aucune garantie `eslint`).
- Le contexte visuel envoyé à Gemini (captures canvas) et la gestion `needs_visual_context` multi-tours restent à valider en conditions réelles.

### 6.4 Défauts d'organisation du dépôt

- `DeepFetal` est un **dépôt Git imbriqué** mais **non enregistré dans `.gitmodules`** : `git status` le signale en « modified content » et `git submodule status` échoue. À décider : l'enregistrer comme vrai sous-module, ou l'ajouter à `.gitignore`.
- `scripts/radiography/training` contient des dépendances tierces apparemment installées localement (bokeh, dask, colorama…), ce qui pollue la navigation ; un `requirements` propre et un `.gitignore` dédié seraient utiles.
- `R.md` (ancien document de progression, 1 334 lignes) supprimé dans l'arbre de travail — à committer consciemment si la suppression est volontaire.

### 6.5 Contraintes d'environnement

- **Disque C: saturé** (0 Go libres) : toute écriture volumineuse doit passer par `Z:` ; pytest et `TEMP` sont redirigés vers `Z:\hgg-tools`.
- Le serveur importe torch/OpenBLAS avec des threads limités à 1 pour rester dans la RAM disponible.

| `POST …/commands/parse` | Commande `@` → plan structuré | ✅ |
| `POST …/ai/plan` | Instruction libre → tour Gemini → plan validé | ✅ |
| `POST …/actions/validate` | Validation d'un plan contre le manifeste | ✅ |

**Points saillants du back :**
- Démarrage **résilient** : radiographie et Gemini chargés dans des blocs `try/except` ; le serveur reste disponible en mode `degraded` sans clé Gemini (seuls les rapports renvoient `503`).
- **Protocole strict** (`workspace_protocol.py`) : `StrictModel` (`extra="forbid"`), type d'action discriminé (`WorkspaceAction`), validation d'ordre strictement croissant unique, `validate_plan_against_manifest` rejetant toute cible/forme/coordonnée invalide.
- **Pseudonymisation** : `PatientID`/`PatientName` hachés (SHA-256 + clé `DICOM_PSEUDONYM_KEY`), jamais transmis en clair ; UID d'étude/série/SOP/frame exclus du contexte envoyé à Gemini.

### 4.3 Lecture DICOM et fenêtrage/niveau natif (nouveau, non commité)

Le troisième objectif restant est **réalisé** dans l'arbre de travail :

- **Serveur** (`dicom_service.py`) : ajout d'un **buffer linéaire** — pixels rescaleés (RescaleSlope/Intercept appliqués) encodés en uint16 little-endian (`linear_data_url`, `linear_min/max`, `linear_scale`) exposés dans `DicomFrame` et l'endpoint `/dicom/parse`. Seuil `MAX_LINEAR_PIXELS = 12 000 000` ; au-delà (ou pour DICOM couleur), repli dégradé (buffer `null`). Contraintes `MAX_DICOM_BYTES`, `MAX_RENDERED_FRAMES=64`, `MAX_FRAME_PIXELS`.
- **Client** : `lib/dicom.ts` (`LinearImageBuffer`), import dans `examinations.ts` (une image workspace par frame, inversion MONOCHROME1), et **`lib/dicomRenderer.ts`** qui peint le fenêtrage dans le repère physique `raw = min + u16·scale` (`paintLinearFrame`, `linearToDataUrl`).
- **Câblage** : le provider calcule `renderSrc` via `linearToDataUrl` ; `CanvasViewport` superpose un `<LinearCanvas>` qui **remplace la prévisualisation CSS** tant qu'un buffer linéaire est présent (image source en `opacity:0`, filtre CSS désactivé) ; l'export utilise le rendu natif. Le geste W/L, les luminosité/contraste, l'inversion et les presets HU (`WL_PRESETS_HU`) restent fonctionnels.

### 4.4 Agent IA, commandes et exécution transactionnelle

- **Deux modes d'entrée** : instruction libre (interprétée par Gemini via `workspace_agent_prompt.py`) et commandes explicites `@` (`workspace_commands.py`, catalogue `@analyze / @predict / @gradcam / @wl / @brightness / @contrast / @invert / @annotation / @measure / @layer / @report / @help`), avec auto-complétion côté client (`FloatingCommandBar`, `aiCommandSyntax.ts`).
- **Sécurité d'exécution** : le plan Gemini est compilé en actions techniques (`compile_agent_proposal`), puis validé contre le manifeste ; **une seule action invalide fait rejeter tout le lot** (aucune exécution partielle). Le client prévalide et exécute dans l'ordre strict.
- **Moteur transactionnel multi-images (nouveau, non commité)** : `lib/aiTransaction.ts` (snapshots par image) ; `App.tsx` orchestre `executePlanAcrossImages` (capture, exécution image par image, **rollback complet** sur échec), tient une pile de transactions et expose l'**annulation globale** via `Ctrl+Z` et un bouton sidebar (`AiSidebarRight`). `WorkspaceProvider.executeAiActionPlan` applique les types d'actions supportés dans une seule entrée d'historique.
- **Analyse automatique à l'ouverture** : déclenchée une fois par examen, ignore les images non CR/DX, gère la progression par image et une erreur d'image n'empêche pas les autres.
- **Cohérence d'examen** : contrôles DICOM déterministes (Study UID, patient, modalité, Frame of Reference, Pixel Spacing, doublons) qui **bloquent la comparaison inter-images** en cas d'incohérence de niveau `error`.

### 4.5 Interface utilisateur

Client React couvrant : pages **Login / Examen / Éditeur**, `MobileShell` (adaptation responsive), toolbar d'outils (formes, mesures, fenêtrage), panneaux IA (`AiSidebarLeft/Right`, disclaimer, timeline, command bar, éditeur de rapport `ReportEditor`), couches/calques, métadonnées et barre de statut. Le typecheck TypeScript **passe sans erreur** (voir 5.1).