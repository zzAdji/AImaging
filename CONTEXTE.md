## Objective
- Finaliser les 3 points restants de l'intégration serveur/clients déjà largement avancée : exécution transactionnelle multi-images des plans d'actions IA, tests de bout en bout (Gemini + vrais DICOM, y compris compressés), et fenêtrage/niveau DICOM natif sur pixels bruts (remplace la prévisualisation CSS actuelle).

## Important Details
- Projet : `C:\Users\HP\Desktop\Projets\Stage-2026\hgg-ai-intership-project` (racine git).
- Client : Vite + React 19 + TypeScript ~6.0 dans `client/src`. Serveur : FastAPI + Pydantic v2 + Python 3.14 (`C:\Python314\python.exe` par défaut).
- Contrat versionné : `server/workspace_protocol.py` — `PROTOCOL_VERSION = "1.0"`, `StrictModel` (extra="forbid"), `ActionPlan`, `CanvasShape` (`created_by: "user"|"ai"`, `action_id`), `validate_plan_against_manifest`, `inspect_manifest_consistency`, `ActionValidationResult`, `WorkspaceConsistencyIssue`.
- `server/dicom_service.py` : lecture DICOM réelle via pydicom, rendu PNG, pseudonymisation, `_PSEUDONYM_KEY` (env `DICOM_PSEUDONYM_KEY`), `DicomMetadata`, `DicomFrame`, constantes `MAX_DICOM_BYTES`, `MAX_RENDERED_FRAMES = 64`, `MAX_FRAME_PIXELS = 20_000_000`, et `MAX_LINEAR_PIXELS = 12_000_000` (vient d'être ajouté pour le buffer linéaire).
- Fenêtrage actuel = approximation CSS : `wlToCssFilter` / `buildImageFilter` dans `client/src/state/workspace.ts` ; geste W/L dans `CanvasViewport.tsx` (~l.725-740, `gesture.current = {kind:"adjust", tool:"windowlevel"|"brightness"|"contrast", startWl, ...}` ; l.946 `w.setWl(...)` ; l.1156 `imgFilter = buildImageFilter(...)` ; l.1659 affichage W/L).
- `RightPanel.tsx` (ImageSection) : reset W/L à `{window:255, level:127.5}`, inputs `window-input` / `level-input`, presets (l.107, 192-212).
- `client/src/lib/dicom.ts` : adapter API `/dicom/parse` (FormData), `parseDicomFile`, `ParsedDicomMetadata`, `ParsedDicomFrame` (`image_data_url`), `ParsedDicomImport` ; API base `http://localhost:8000`.
- `client/src/lib/examinations.ts` : `ExamImage`, `ExamImageState` (`src, shapes, wl, brightness, contrast, inverted, rotation, flipH, flipV`), `ExamImageMetadata`, `GradCamResult`, `readImportedImageFiles`.
- `client/src/state/WorkspaceProvider.tsx` : état par image unique effectivement chargée ; `pushHistory`/`commit` ; commentaire "The shell will route multi-image plans to the appropriate image in the next integration step" (~l.903-905) — c'est le point à finaliser.
- `client/src/App.tsx` : clavier Ctrl+Z → `w.undo()` (branche mod+z, l.552-555) ; le Shell orchestre les pages login/exams/editor et le câblage par image.
- `client/src/lib/workspaceApi.ts` : `createWorkspaceExam`, `syncWorkspaceExam`, `validateActionPlan`, `parseExplicitCommand` ; `client/src/components/ai/FloatingCommandBar.tsx` + `aiCommandSyntax.ts` = saisie `@`, suggestions/auto-complétion.
- Commandes `@` côté serveur : `server/workspace_commands.py` (`COMMAND_CATALOG`, `parse_explicit_command`, `CommandError`) ; `server/workspace_agent.py` + `workspace_agent_prompt.py` = planificateur Gemini ; `server/gradcam_service.py` = Grad-CAM réelle (`training.gradcam.GradCAM`).
- Aucun test n'existe dans le repo (pas de pytest installé sur C:).
- Contraintes machine : **C: = 0 Go libres** (173,9 Go utilisés), Z: a 5,6 Go libres. Toute grosse écriture disque doit aller sur Z:.
- pytest contourné : installé dans `Z:\hgg-tools\pytestlib` (pytest 9.1.1) ; nécessaire : `$env:PYTHONPATH="Z:\hgg-tools\pytestlib"`, `$env:TEMP="Z:\hgg-tools\tmp"`, `$env:TMP="Z:\hgg-tools\tmp"`, `$env:OPENBLAS_NUM_THREADS="1"`, `$env:OMP_NUM_THREADS="1"`.
- Vérifié : avec ces variables, `import main` depuis `server/` réussit ("server main import OK") ; sans elles, erreur OpenBLAS mémoire.
- Modèles serveur : `models/chest_xray/{densenet121,resnet50,resnet101,efficientnet_b0,efficientnet_b2}_best.pt` ; Gemini : clé via env `GEMINI_API_KEY`, modèle `gemini-3.6-flash` (`server/config.py`).
- Git : branche `main`, working tree propre sauf sous-module `DeepFetal` (contenu modifié/non suivi) ; derniers commits : Grad-CAM + workspace agent, rapport + coherence checks.

## Work State
### Completed
- Exploration complète du code client et serveur (état, protocole, API, canvas, panneaux IA, commandes `@`).
- Résolution de l'installation pytest (disque C: plein) : installé sur `Z:\hgg-tools\pytestlib`, vérifié fonctionnel + import du serveur OK avec les variables d'env ci-dessus.
- Todo créé (7 items) : buffer linéaire serveur → types client → rendu W/L natif → moteur transactionnel + états par image → intégration Shell (annulation globale Ctrl+Z, journal, bouton annuler) → tests pytest serveur (DICOM réel/compressé, protocole, commandes, API, E2E Gemini) → vérifs (typecheck, lint, tests).

### Active
- Tâche 1 en cours : buffer linéaire DICOM dans `server/dicom_service.py` — seule la constante `MAX_LINEAR_PIXELS = 12_000_000` a été ajoutée pour l'instant (si dépassée → repli CSS dégradé).

### Blocked
- Aucun blocage ; contraintes machine à respecter : C: plein (0 Go), ne rien écrire de volumineux sur C:, TEMP/TMP sur Z:, threads OpenBLAS/OMP limités à 1 pour importer `main.py`.

## Next Move
1. Poursuivre `server/dicom_service.py` : ajouter le buffer linéaire (pixels bruts après RescaleSlope/Intercept, sous forme de tableau typé + min/max réels + `data_url`/base64 ou JSON) dans les `DicomFrame`, et un paramètre d'API (ex. `include_linear`) ; gérer le dépassement de `MAX_LINEAR_PIXELS` (retourner `linear: null`).
2. Examiner le handler `/dicom/parse` dans `server/main.py` pour exposer le nouveau champ, puis adapter `client/src/lib/dicom.ts` (`ParsedDicomFrame`) et l'import dans `client/src/lib/examinations.ts`.
3. Ajouter le module de rendu W/L natif client (codage du buffer linéaire en canvas, remplacement de `buildImageFilter` pour DICOM), câbler le provider + `CanvasViewport` + `RightPanel` + `exportImage.ts`.
4. Créer le moteur transactionnel client (`aiTransaction.ts` : snapshot par image, exécution ordonnée, rollback sur échec, historique unique) et l'intégrer dans `App.tsx`/`WorkspaceProvider.tsx` (annulation globale Ctrl+Z).
5. Écrire les tests pytest serveur (utiliser l'env Z: ci-dessus), y compris génération de DICOM compressés (JPEG/JPEG-LS via pydicom) et un test d'intégration Gemini marqué skip si `GEMINI_API_KEY` absente.
6. Lancer `tsc -b` / lint côté client et `pytest` côté serveur.

## Relevant Files
- `server/dicom_service.py` : lecture DICOM + futur buffer linéaire (constant déjà ajoutée).
- `server/main.py` : endpoints FastAPI (`/dicom/parse`, `/workspace/exams/...`, gradcam, commands/parse) ; `server/workspace_protocol.py` : contrat des actions ; `server/workspace_commands.py`, `server/workspace_agent.py`, `server/workspace_agent_prompt.py`, `server/workspace_store.py`, `server/config.py`.
- `client/src/lib/dicom.ts`, `lib/examinations.ts`, `lib/workspaceProtocol.ts`, `lib/workspaceApi.ts`, `lib/exportImage.ts`, `lib/aiCommandSyntax.ts`, `lib/aiCommands.ts` (exécuteur fictif restant utilisé par le provider).
- `client/src/state/workspace.ts`, `state/WorkspaceProvider.tsx` ; `client/src/App.tsx` (Shell, Ctrl+Z) ; `client/src/components/CanvasViewport.tsx` (gestes W/L, filtre CSS) ; `client/src/components/RightPanel.tsx` (contrôles W/L) ; `components/ai/*` (panneaux IA, FloatingCommandBar).
- `Z:\hgg-tools\pytestlib` : pytest 9.1.1 (non sur C:).