## Objective
- Terminer l'architecture agentique du workspace : mémoire conversationnelle + audit serveur + contexte CXAS dans le tour Gemini + suppression du fallback mock client (fait, `tsc`/`eslint`/pytest verts).
- Durcir les validations des actions Gemini (tolérance aux formats hors contrat) après l'échec `create_shape` sur `points: [[x,y],...]` (fait, 43 tests verts).
- Livrer le plan de handoff pour la **carte anatomique liée à la sonde** (`AnatomyMapCard`) avec fond `anatomy_map.png`, régions interactives et texte IA par région + image canvas jointe au LLM (fait).
- Reprendre **opencxr** (réseau stable) : clonage fait, reste : venv Python 3.12, poids LFS, implémentation du sorter + standardisation côté serveur.

## Important Details
- **opencxr** : URL correcte = `https://github.com/DIAGNijmegen/opencxr` (Radboud, Apache-2.0 ; `ieee8023/opencxr` n'existe pas — « Repository not found »). Clone `--depth 1` avec LFS a expiré (5 min) → re-clone `GIT_LFS_SKIP_SMUDGE=1` OK (39 fichiers) dans `scripts\opencxr`.
- Poids LFS encore sous forme de **pointeurs 0 o** : `opencxr\algorithms\model_weights\{heart_seg.h5, image_sorter.hdf5, lung_seg.h5}`. Tailles connues : `image_sorter.hdf5` 188,4 Mo, `lung_seg.h5` 240,1 Mo, `heart_seg.h5` 475 Mo (inutile).
- `setup.py` opencxr : wget, tensorflow, SimpleITK, keras, pydicom, pypng, scikit-image, scikit-build, numpy. README : Image Sorter identifie Frontal PA / Frontal AP / Lateral / Other + rotation (90/180/270) + inversion.
- Disque : C: 11 Go libres (OK), Z: 0,5 Go (quasi pleine) → tout installer sur C:. Python 3.12 présent : `C:\Users\HP\AppData\Local\Programs\Python\Python312\python.exe` (3.12.6 ; pas de tensorflow/keras/h5py ; pas de wheels TF sur Python 3.14).
- Tests serveur : `PYTHONPATH=Z:\hgg-tools\pytestlib python -m pytest tests/ -q` ; import conftest en direct (`from conftest import ...`, jamais `tests.conftest` — shadowé par site-packages) ; `AgentIntent` vit dans `workspace_agent.py`, pas `workspace_protocol.py`.
- Retenir : ne jamais nommer une variable locale comme une fonction importée (`conversation_context` → `UnboundLocalError` ; fix = `conversation_memory`).
- Encodages UTF-8 uniquement — ne pas utiliser `Set-Content -Encoding` sur les sources accentuées.
- Plan handoff : ne pas toucher `AnatomySegmentation.tsx`/`lib/anatomy.ts` (carte CXAS intacte) ; la carte sonde actuelle = SVG `SILHOUETTE_AP` + `THORAX_ZONES` (10 zones, fractions, rendues en `<ellipse>` = « cercles moches »), rendue dans `AiSidebarRight.tsx` l.117.
- Le LLM des régions reçoit la **capture canvas** (réutiliser `captureCanvasContext` App.tsx l.115, `_decode_canvas_data_url`/`_build_visual_parts` main.py l.~755/771) **en plus** des mesures CXAS.

## Work State
### Completed
- **Mock client supprimé** : `WorkspaceProvider.tsx` — imports purgés (`amendReportText, mockDiagnostics, mockReport, parseAiCommand, type AiCommandAction, type RegionFrac`), helpers `fracToPx`/`pxDiag`/`thoughtSteps` retirés, `runAiCommand` échoue proprement sans résolveur (« Aucun espace de travail actif… »), fermeture du `useCallback` rétablie (erreur TS) ; `aiCommands.ts` réduit à `AI_PROMPTS` (consommé par `AiSidebarLeft.tsx`). `tsc -b` + `eslint .` OK (4 warnings préexistants CanvasViewport).
- **Serveur** : `agent_context.py` créé (`WorkspaceAnatomyContext`, `compact_anatomy_context`, `conversation_context`) ; `main.py` importe depuis ce module.
- **Tests** : `test_workspace_store.py` (7) + `test_agent_context.py` (9) créés ; corrections imports `conftest`/`AgentIntent` ; fix `UnboundLocalError` (`conversation_memory`). 29/29 verts.
- **Tolérance `PixelPoint`** : paires `[x,y]` acceptées (`_accept_pair_list` mode before) + prompt `create_shape` avec exemple `measure` explicite (points = objets `{"x":…,"y":…}`, jamais de listes). 32/32.
- **Audit complet de tolérance** (`workspace_protocol.py` + `workspace_agent.py`) : `CanvasShape`/`ShapeStyle`/`PixelRegion` `extra="ignore"` ; alias types (`measurement→measure`, `circle→ellipse`, `freehand→freedraw`, `text_box→text`…) ; couleurs nommées/hex court/fonts normalisées ; fractions opacité 0..1→%, `"75%"`→75, `set_window_level` clamplé, alias layers (`grad-cam→gradcam`…), alias `notify` (`success→info`, `critical→error`) ; `_as_number` NaN→défaut ; `reason`/`assistant_message`/`detail` vides→défauts ; alias sources evidence (`cxas→anatomy`) ; dédup `target_visual_image_ids`. 43/43 verts.
- **Plan handoff réécrit** : `_handoff-anatomy\plan_carte_interactive_v2.md` cible `AnatomyMapCard` (sonde) : fond `anatomy_map.png` + régions polygonales ; `anatomyMap.ts` (`ANATOMY_REGIONS`, `regionHitTest`, `regionAtImage`) ; endpoint `POST /workspace/exams/{workspace_id}/anatomy/regions` acceptant `canvas_data_url` + anatomy + régions ; instructions LLM exactes §7 (lecture visuelle région par région + croisement données CXAS, règle 7 si image absente) ; état store `anatomyRegionTexts`/`loadAnatomyRegionTexts` ; tests `test_anatomy_regions.py` prévus.
- **opencxr (microservice)** : venv `.venv312` créé (Python 3.12.6, TF 2.21, keras 3.15) ;
  poids LFS tirés (`image_sorter.hdf5` 197 Mo, `lung_seg.h5` 251 Mo) ; probe kéras
  OK (charge `image_sorter.hdf5` ET `lung_seg.h5`, inférences valides) ;
  `scripts/opencxr/microserver.py` (FastAPI : `/health`, `/sort`, `/standardize`,
  sérialisation numpy-safe, `pixel_spacing_mm` optionnel) + `run_micro.bat` ;
  `server/sorter_service.py` (pont HTTP, URL persistée `.runtime/opencxr_remote.json`,
  `is_available()`/`probe_remote_backend()`/`sort_image`/`standardize_image`) ;
  `config.py::OpenCxrServerConfig` (`OPEN_CXR_URL`) ; endpoints serveur
  `POST .../opencxr/sort`, `POST .../opencxr/standardize`,
  `GET|PUT /workspace/opencxr/backend`, `opencxr_ready` dans `/health` ;
  `tests/test_opencxr_service.py` (9, mock http sans TF, incl. `pixel_spacing_mm`).
- **opencxr câblé côté front** : au chargement de l'espace de travail, en même
  temps que la classification (`analyzeExamImages("all")`), l'effet auto opencxr
  (App.tsx, garde `autoOpenCxrStartedFor`) trie + normalise chaque image CR/DX
  (`Promise.all`, `sortWorkspaceImageOpenCxr` / `standardizeWorkspaceImageOpenCxr`),
  persiste `ExamImage.cxrSort`/`cxrStandardize` (`saveOpenCxr`), et expose l'image
  active via `w.cxrResult` (Provider) ; affichage dans `RightPanel` (`OpenCxrSection` :
  badge Type/Rotation/Inversion/Flip + aperçu normalisé) ; le client envoie le PNG
  rendu + `pixel_spacing_mm` (force l'extension `.png`). 52 tests serveur verts,
  `tsc -b` + `eslint` verts.
- **Bug DICOM corrigé** (`CanvasViewport.tsx`) : `LinearCanvas` était en flux
  normal au lieu de `absolute inset-0` → pour un DICOM (`img` en `opacity:0`), le
  rendu fenêtré se plaçait *sous* le wrapper vide (container sélectionnable, image
  en dessous). Corrigé, cohérent avec les overlays Grad-CAM/Anatomie.

### Active
- Next : smoke test complet `/standardize` via le microservice (chargement `lung_seg` +
  normalisation dépasse le cap 30 s du shell, mais modèle déjà validé) ; optionnel :
  bouton « trier / normaliser » manuel + badge par vignette d'image.

### Blocked
- Réseau : stable (clone OK). Seul point de vigilance : Z: quasi pleine (0,5 Go) — rester sur C:.

## Next Move
1. Créer le venv 3.12 (ex. `C:\Users\HP\Desktop\Projets\Stage-2026\hgg-ai-intership-project\.venv312` via `C:\Users\HP\AppData\Local\Programs\Python\Python312\python.exe -m venv`) puis installer `tensorflow`/`tensorflow-cpu`, `keras`, `h5py`, `scipy`, `SimpleITK`, `opencv-python` (adapter `numpy<2` selon la version TF retenue).
2. Télécharger les poids LFS (~430 Mo) : `git lfs pull --include "opencxr/algorithms/model_weights/image_sorter.hdf5,opencxr/algorithms/model_weights/lung_seg.h5"` dans `scripts\opencxr` (ou via le launcher opencxr), puis vérifier les tailles.
3. Probe : importer `image_sorter` + `standardization` opencxr dans le venv pour valider versions Keras/TF.
4. Implémenter `server/sorter_service.py` (lazy import paresseux calqué sur `anatomy_service.py`, `is_available()`) + endpoints tri/standardisation dans `main.py` + chemins poids dans `config.py` ; tests pytest.
5. `tsc -b` + `eslint .` si le client est touché ; redémarrer uvicorn.

## Relevant Files
- `scripts\opencxr\` : repo DIAGNijmegen/opencxr cloné (poids LFS à tirer) ; `opencxr\algorithms\model_weights\{image_sorter.hdf5, lung_seg.h5}` ; `setup.py` (reqs).
- `C:\Users\HP\AppData\Local\Programs\Python\Python312\python.exe` : base du venv opencxr.
- `models\` : dossier existant (`3D_maker`, `chest_xray`, `fetal_ultrasound`) — destination possible des poids.
- `server\anatomy_service.py` : modèle à copier pour `sorter_service.py`.
- `server\main.py` : `_decode_canvas_data_url()` l.~755, `_build_visual_parts()` l.~771 (handoff) ; endpoint `/anatomy/regions` à ajouter plus tard.
- `server\agent_context.py`, `server\workspace_store.py`, `server\workspace_agent_prompt.py` : modules purgés/tolérants, réutilisables.
- `server\tests\` : `test_workspace_store.py`, `test_agent_context.py`, `test_workspace_agent.py` — 43 verts ; à étendre pour opencxr + `test_anatomy_regions.py`.
- `_handoff-anatomy\plan_carte_interactive_v2.md` : plan prêt pour une autre IA (carte anatomique v2, sonde, prompt LLM exact avec capture canvas).
- `client\src\components\ai\AnatomyMap.tsx` : carte sonde à remplacer (selon le plan handoff).
- `client\src\App.tsx` : `captureCanvasContext` l.115 (réutilisable pour `/anatomy/regions`).
- `client\src\state\WorkspaceProvider.tsx` + `client\src\state\workspace.ts` : fallback mock retiré ; `anatomyRegionTexts`/`loadAnatomyRegionTexts` à ajouter (handoff).
- `client\src\lib\aiCommands.ts` : réduit à `AI_PROMPTS`.