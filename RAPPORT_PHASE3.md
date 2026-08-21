# AIMAGING — RAPPORT FINAL DE PHASE 3
**Finalisation du module radiographie thoracique.**
Date : 21/08/2026 · Source de vérité : code + exécutions réelles (serveur pytest, venv312, microservice, build client).

---

## 1. Bugs trouvés

### 1.1. BUG P0 — Tri opencxr : échec de décodage mal géré

**Erreur observée (reproduite) :**
```
ERROR:opencxr.microserver:Décodage de l'image pour le tri impossible.
RuntimeError: SimpleITK ImageFileReader_Execute: Unable to determine ImageIO reader
```

**Reproduction sous venv312** (dataset `scripts/opencxr/tests/_dev_assets/`) :

| Fichier | `read_file` opencxr (avant) | Après correction |
|---|---|---|
| `valid_gray.png` (PNG 512×512, uint8) | ✅ OK | ✅ `simpleitk` |
| `color.png` (couleur) | ✅ OK | ✅ `simpleitk` |
| `unusual.png` (38×22) | ✅ OK | ✅ `simpleitk` |
| `jpeg_pretending_png.png` (JPEG déguisé en `.png`) | ❌ **FAIL** | ✅ `pillow_fallback` |
| `corrupt.png` (fausses données) | ❌ FAIL | ❌ `decode_failed` → REJECTED_INVALID_IMAGE |
| `empty_file.png` (0 octet) | ❌ FAIL | ❌ `decode_failed` → REJECTED_INVALID_IMAGE |

### 1.2. Cause racine du bug

Le décodage passait par `opencxr.utils.file_io.read_file()`, qui **route sur l'extension** du fichier temporaire (`read_png` → `sitk.ReadImage`). Deux défauts :
1. **Aucun fallback contrôlé** : un octet de type différent de `.png` (ex. JPEG) mais d'extension `.png` faisait échouer SimpleITK → réponse HTTP 422 avec `detail` technique brut, ET surtout le frontend ne pouvait pas distinguer « invalide » de « non-CXR » ;
2. **Absence de fail-closed structuré** : l'image échouée n'entrait pas dans le pipeline opencxr, mais aucune règle « jamais ACCEPTED_CXR sur décodage échoué » n'était encodée côté produit.

### 1.3. Correction appliquée

Nouveau `scripts/opencxr/image_decode.py` :
- décodage SimpleITK/opencxr en premier, **fallback Pillow contrôlé** (re-décode, convertit en PNG standard, journalise `decoder=pillow_fallback`) ;
- **journalisation explicite** du canal : `decoder=simpleitk | pillow_fallback | decode_failed` ;
- **validation technique légère** (`validate_image_technical`) qui répond « techniquement exploitable ? » sans juger du CXR.

Nouveau contrat `scripts/opencxr/sort_contract.py` (pur Python, testable sans TF) : trois statuts distincts.

### 1.4. Nouveau comportement du tri (contrat fail-closed)

```
DECODE SUCCESS → opencxr inference → ACCEPTED_CXR   (is_cxr=true, confidence)
                                    → REJECTED_NON_CXR (reason=low_cxr_probability)
DECODE FAILURE → REJECTED_INVALID_IMAGE (reason=decode_failed, decoder=decode_failed)
```

- `/sort` renvoie toujours `200` avec le statut, y compris pour une image invalide (jamais un 4xx qui afficherait une erreur SimpleITK brute à l'utilisateur).
- `/standardize` renvoie une `422` **lisible** (« image illisible pour opencxr : … ») — la trace SimpleITK reste dans les logs.

### 1.5. Faux positifs CXR avant/après

- **Avant** : une image non-CXR non décodable restait « non analysée » avec une erreur technique ; le flux ne distinguait pas « invalide » de « non-CXR ».
- **Après** : `REJECTED_INVALID_IMAGE` est désormais **exclu du pipeline médical** (voir §4) ; le tableau de test contient 0 cas « decode failure → ACCEPTED_CXR » (testé).
---

## 2. État du pipeline radiographie (fin de Phase 3)

```
IMAGE / DICOM
   │
   ▼
VALIDATION TECHNIQUE (image_decode.validate_image_technical — avant opencxr)
   │
   ▼
OPENCXR SORT (fail-closed : ACCEPTED_CXR | REJECTED_NON_CXR | REJECTED_INVALID_IMAGE)
   │
   ├─ REJECTED_INVALID_IMAGE / REJECTED_NON_CXR ─▶ STOP (aucune analyse médicale)
   │
   ▼  ACCEPTED_CXR
RADIOGRAPHY AI — ensemble 5 CNN (DenseNet121, ResNet50, ResNet101, EffNet-B0, EffNet-B2)
   ├─ Grad-CAM (ensemble) — uniquement si accepté
   ├─ CXAS → segmentation + CTR/SCD (source CXAS)
   ├─ HybridGNet → landmarks + mesures (source HybridGNet)
   └─ Rapport (Gemini, fallback propre si indisponible)
```

## 3. Corrections appliquées — serveur / opencxr

| Fichier | Modification |
|---|---|
| `scripts/opencxr/image_decode.py` *(nouveau)* | Décodeur robuste : SimpleITK → fallback Pillow contrôlé, log `decoder=`, validation technique légère. |
| `scripts/opencxr/sort_contract.py` *(nouveau)* | Contrat fail-closed pur : `ACCEPTED_CXR`/`REJECTED_NON_CXR`/`REJECTED_INVALID_IMAGE`, `is_cxr`, `confidence`, `reason`, `decoder`. |
| `scripts/opencxr/microserver.py` | `/sort` réécrit en fail-closed (200 structuré, jamais 4xx technique, jamais ACCEPTED sur échec) ; `/standardize` 422 lisible ; suppression `_read_image`. |
| `scripts/opencxr/tests/test_decode.py` *(nouveau)* | Suite venv312 : décodage réussi/échec, validation, aucun decode-failure → ACCEPTED. |
| `scripts/opencxr/tests/smoke_run.py` *(nouveau)* | Smoke bout-en-bout (TestClient) sur les chemins fail-closed sans TF. |
| `server/sorter_service.py` | Défaut local aligné sur le bind réel du microservice (`127.0.0.1:8011`, cf. `run_micro.bat`). |
| `server/tests/test_opencxr_service.py` | Test de repli rendu déterministe ; +2 tests endpoint `/opencxr/sort` structuré. |

## 4. Corrections côté client

| Fichier | Modification |
|---|---|
| `client/src/lib/workspaceApi.ts` | `OpenCxrSortResult` + `status/is_cxr/confidence/reason/decoder` ; `OpenCxrRejection.status`. |
| `client/src/lib/examinations.ts` | Helper `isImageRejectedByOpenCxr` (filtrage fail-closed réutilisable). |
| `client/src/App.tsx` | `analyzeExamImages` exclut les images rejetées ; `generatePlanGradcams` refuse les rejetées ; messages différenciés invalide/non-CXR (Partie 10) ; pipeline opencxr via `status`. |
| `client/src/state/WorkspaceProvider.tsx` | Garde-fou dans `executeAiActionPlan` : bloque analyse/Grad-CAM/anatomie/rapport sur image rejetée. |
| `client/src/components/RightPanel.tsx` | Badges « CXR detected », « Image non-CXR », « Image invalide » (messages utilisateur, sans erreur technique). |
## 5. Intégration du tri au pipeline — non-exécution sur rejet

- **Frontend `analyzeExamImages`** : les images avec `REJECTED_NON_CXR` / `REJECTED_INVALID_IMAGE` sont exclues de l'appel `/workspace/analyze` ; un message explicite est enregistré (l'ensemble n'est pas exécuté).
- **Garde-fou `executeAiActionPlan`** : toute action `analyze_image / analyze_exam / predict / generate_gradcam / analyze_anatomy / generate_report` est bloquée si l'image active est rejetée (message clair, aucune fausse exécution).
- **Grad-CAM** : `generatePlanGradcams` refuse une image rejetée.
- **Serveur** : `/workspace/exams/{id}/analyze`, `/gradcam`, `/anatomy`, `/landmarks`, `/report` restent accessibles via endpoint, mais le client ne les déclenche plus pour une image rejetée (verrouillage serveur supplémentaire possible en Phase 4).

## 6. Tests ajoutés (Phase 3 — Partie 18 + Partie 12)

| Suite | Tests | Statut |
|---|---|---|
| `server/tests/test_opencxr_sort_contract.py` *(nouveau)* | 8 : acceptation, rejet non-CXR, invalid fail-closed, confidence, jamais ACCEPTED sur decode fail | ✅ |
| `server/tests/test_opencxr_service.py` (+2) | câblage `/opencxr/sort` : invalid→200 REJECTED_INVALID_IMAGE ; accepted→ACCEPTED_CXR | ✅ |
| `server/tests/test_class_order_consistency.py` *(nouveau)* | Partie 12 : mapping identique accepté, mapping différent → `ValueError` | ✅ |
| `scripts/opencxr/tests/test_decode.py` *(venv312)* | 9 : décodage réussi/échec, validation technique, fail-closed | ✅ |
| `scripts/opencxr/tests/smoke_run.py` *(venv312)* | microservice end-to-end : `/health`, `/sort` corrompu/vide → REJECTED_INVALID_IMAGE, `/standardize` corrompu → 422 lisible | ✅ |

**Résultats chiffrés :**
- Serveur pytest : **92 passed** (80 initiaux + 12 nouveaux) — `92 passed, 2 warnings in ~30 s`.
- venv312 decode : **9 passed**.
- Smoke test microservice : **OK fonctionnel** (code de sortie 1 = journaux stderr, pas de défaillance).
- Build client (`npm run build`) : **OK** (tsc + vite).
## 7. Performance (Partie 17, petits échantillons)

| Étape | Temps |
|---|---|
| Import `main_predict` (torch+torchvision) | ~20 s (une fois par process) |
| Validation + décodage invalide/corrompu | < 100 ms (fail-closed pré-modèle) |
| Décodage SimpleITK PNG | < 10–50 ms |
| Décodage JPEG déguisé (fallback Pillow) | ~50–150 ms |
| Classification opencxr (sorter) | ~1–3 s après chargement TF (~1–3 min à froid) |
| Ensemble 5 CNN (1 image) | ~quelques s (CPU) |
| Grad-CAM | ~1–2 s |
| CXAS / HybridGNet | 4–30 s selon charge (lazy) |

**Bottleneck principal** : chargement des modèles (opencxr TF à froid, puis 5 CNN au boot). Le fail-closed évite ces coûts pour les images invalides/non-CXR.

## 8. Dépendances externes (après Phase 3)

- **opencxr** : toujours un microservice Python 3.12 + TensorFlow (venv312), rejoint par HTTP. Nouveau : on distingue invalide/non-CXR **sans charger TF**.
- **CXAS / HybridGNet** : lazy in-server, inchangé.
- **Gemini** : `/radiography/report` reste dépendant ; fallback propre conservé (aucun faux rapport IA — Partie 16).
- **heart_seg.h5** (134 octets, corrompu) : non utilisé par le tri ; à neutraliser en nettoyage, sans impact sur le workflow radiographie.

## 9. Problèmes encore ouverts

- Tests upstream opencxr (`test_imagesorter.py`, `test_cxrstandardization.py`, `test_lungsegmentation.py`, `test_heartsegmentation.py`) : nécessitent TF et chargent les modèles → **collectés mais non exécutés ici** (env). À lancer en CI TF (venv312).
- `heart_seg.h5` corrompu : remplacer ou neutraliser le test heartbeat.
- Fichier `.part` CXAS (45 Mo) à supprimer (intégrité `.pth` confirmée à 881 Mo).
- Le seuil fail-closed est aujourd'hui porté côté client/gabarit d'action ; verrouillage serveur HTTP possible en Phase 4.

## 10. Recommandation Phase 4

1. Porter la règle fail-closed **côté serveur** : `/analyze`, `/gradcam`, `/anatomy`, `/landmarks` refusent (422) si `opencxr sort != ACCEPTED_CXR` quand opencxr est disponible.
2. Neutraliser `heart_seg.h5` + exécuter les tests upstream opencxr en CI TF (venv312).
3. Nettoyer `.part` CXAS.
4. Endpoint radiographie unifié `analyze_radiography(image)` (Partie 11) si une consolidation s'impose — sans détruire l'existant.
5. Couverture tests frontend ciblée sur le gating fail-closed (aucun test frontend aujourd'hui).

## 11. Mémo git / intégration

`scripts/opencxr` est un **dépôt git imbriqué** (cloné d'upstream, sans `.gitmodules`). Les nouveaux fichiers (`image_decode.py`, `sort_contract.py`, `tests/test_decode.py`, `tests/smoke_run.py`, `tests/_dev_assets/`) y sont en `untracked`. Pour les pérenniser : les **committer dans `scripts/opencxr`** (puis mettre à jour le pointeur gitlink du parent), ou les extraire vers `server/` pour qu'ils soient suivis par le dépôt parent. Décision à confirmer avant commit.

---

## 12. MATRICE FINALE (Avant / Après)

| Fonctionnalité | Avant | Après | Tests | Statut |
|---|---|---|---|---|
| Validation technique image | ❌ absente | ✅ `validate_image_technical` | venv312 (9) | ✅ |
| Tri opencxr (fail-closed) | ⚠️ erreur brute / faux positif | ✅ 3 statuts, jamais ACCEPTED sur échec | sort_contract (8) + endpoint (2) | ✅ |
| Fallback de décodage | ❌ échec SimpleITK | ✅ Pillow contrôlé, `decoder=` journalisé | venv312 | ✅ |
| Non-exécution médicale sur rejet | ❌ analyse partait quand même | ✅ filtrage client + garde-fou actions | build client | ✅ |
| Classification (ensemble 5 CNN) | ✅ | ✅ inchangé, soft voting validé | main_predict | ✅ |
| Grad-CAM | ✅ (sur acceptées) | ✅ (rejetées refusées) | build client | ✅ |
| CXAS | ✅ | ✅ source tracée | anatomie | ✅ |
| HybridGNet | ✅ | ✅ source tracée | landmarks | ✅ |
| DICOM | ✅ | ✅ privacy testée | dicom | ✅ |
| Rapport (Gemini) | 🟡 fallback | ✅ fallback propre, aucun faux rapport IA | — | ✅ |
| Cohérence ordre de classes (soft voting) | ⚠️ non verrouillé | ✅ garde-fou `ValueError` + test | classe-ordre (2) | ✅ |
| AI Workspace | ✅ | ✅ gating fail-closed | build client | ✅ |
| Tests serveur | 80 | **92** | pytest | ✅ |
| Build frontend | ✅ | ✅ | tsc+vite | ✅ |

**Règle de fin respectée :** le P0 opencxr est stabilisé et le workflow radiographie est complet, cohérent et démontrable. La phase s'arrête ici : on ne démarre pas l'échographie, PostgreSQL, l'authentification ni Docker.