*Plan d’implémentation — Phase 4, module d’échographie fœtale

1. Synthèse de l’audit

Le dépôt contient déjà une grande partie des briques ML nécessaires, mais elles restent isolées sous forme de scripts. L’effort principal doit porter sur leur consolidation en services réutilisables, l’orchestration d’examens, l’API et l’intégration au workspace existant.

Architecture actuelle

Couche	Technologie	État
Frontend	React 19, TypeScript, Vite	Éditeur multi-image existant
Backend	FastAPI, Pydantic 2	API radiographique et workspace fonctionnels
ML	PyTorch, torchvision	Chargement radiographique déjà structuré
Workspace	Protocole serveur/client versionné 1.0	Actions strictement validées
Stockage frontend	localStorage	Examens et résultats conservés côté client
Tests backend	pytest	Suite radiographie/workspace existante
Tests frontend	Aucun framework configuré	Build et lint uniquement
État réel des composants échographiques

Module	Code existant	Checkpoint	Fonctionne seul	API	Statut
Quality filter	deepfetal_adapter/quality_inference.py	filter.pt, 3,2 Mo	Sous réserve d’ultralytics	Non	🟡 expérimental
Classification de plan	plane_inference.py, plane_model.py	plane_classifier.pth, 111 Mo	Oui avec PyTorch et DeepFetal	Non	🟡 expérimental
Mapping des plans	class_indices_41.json	Sans objet	Oui	Non	✅ disponible
Pipeline image unique	infer_single_image.py	Quality + plane	CLI seulement	Non	🟡 partiel
Pipeline dossier	infer_folder.py	Quality + plane	CLI seulement	Non	🟡 partiel
Grouping	plane_grouping.py	Sans checkpoint	Oui	Non	✅ logique disponible
Sélection d’images	Seulement dans le DeepFetal original	Sans checkpoint	Non intégré	Non	❌ à implémenter
FetalCLIP	fetalclip_model.py, fetalclip_embeddings.py	1,71 Go	Sous réserve d’open_clip	Non	🟡 expérimental
Anomalie	Aucun modèle validé trouvé	Aucun	Non	Non	❌ NOT_IMPLEMENTED
Multimodal	Pipeline DeepFetal orienté génération externe	Aucun modèle AImaging validé	Non	Non	❌ NOT_IMPLEMENTED
Workspace	Aucun contrat fœtal	Sans objet	Non	Non	❌ à intégrer
UI échographie	Examen “Ultrasound” créable, éditeur multi-image présent	Sans objet	Partiel	Non	🟡 infrastructure disponible
Tests fœtaux	Aucun	Sans objet	Non	Non	❌ à créer
2. Résultats techniques importants

2.1 Classification des 41 classes

Le mapping exact est déjà présent dans :

C:\Users\HP\Desktop\Projets\Stage-2026\hgg-ai-intership-project\data\fetal_ultrasound\class_indices_41.json

Il contient 40 plans ou vues et la classe négative neg. Il ne faudra jamais renommer ou réordonner ces classes.

Le classifieur utilise :

- architecture ConvNeXt Tiny issue de DeepFetal\deepfetal\model.py ;
- entrée RGB 224 × 224 ;
- resize à int(224 × 1,14), soit 255 pixels ;
- center crop 224 ;
- normalisation ImageNet ;
- softmax sur 41 classes ;
- device automatique CUDA/CPU.

L’adapter local reproduit correctement le preprocessing de DeepFetal\deepfetal\normal_classifier.py.

2.2 Quality filter

Le filtre est un classifieur Ultralytics chargé depuis filter.pt.

Configuration actuelle :

- seuil d’inférence Ultralytics : 0.5 ;
- seuil d’acceptation : 0.85 ;
- label rejeté : neg ;
- une image rejetée n’est pas envoyée au classifieur de plans.

Il faut cependant confirmer les noms réels des classes exposés par model.names au moyen d’un smoke test du checkpoint. La logique ne doit pas supposer implicitement que toute classe autre que neg est toujours positive sans vérifier le checkpoint.

2.3 FetalCLIP

L’adapter local suit le Quick Start officiel :

- architecture ViT-L/14 ;
- entrée 224 ;
- embedding de dimension 768 ;
- preprocessing fourni directement par open_clip ;
- extraction par model.encode_image() ;
- normalisation L2 ;
- traitement en lots ;
- modèle gelé ;
- aucune génération de rapport.

C’est le bon périmètre pour cette phase.

2.4 Sélection

Le dépôt local ne contient pas de vraie sélection AImaging. DeepFetal sélectionne jusqu’à deux images par plan, avec un seuil de confiance de plan de 0.30.

La règle proposée pour AImaging est déterministe :

1. exclure toute image rejetée par Quality ;
2. exclure neg des plans sélectionnables ;
3. exiger une confiance de plan minimale configurable, par défaut 0.30 ;
4. calculer :
selection_score = quality_score × plane_confidence
5. trier chaque groupe par :
   - selection_score décroissant ;
   - plane_confidence décroissant ;
   - identifiant d’image croissant pour départager ;
6. conserver au maximum deux images par plan ;
7. retourner la raison d’inclusion ou d’exclusion de chaque image.

Cette règle utilise uniquement des résultats réellement produits, favorise conjointement la qualité et la certitude du plan, et reste simple à tester. La diversité visuelle ne sera pas prétendue tant qu’une métrique validée n’existe pas.

2.5 Environnement ML

L’environnement Python 3.12 inspecté contient PyTorch et torchvision, mais pas :

- ultralytics ;
- open_clip.

Les requirements officiels de DeepFetal et FetalCLIP sont incompatibles entre eux sur plusieurs versions de PyTorch. Il ne faut donc surtout pas installer intégralement leurs requirements dans le serveur principal.

Le plan prévoit une dépendance minimale et maîtrisée :

- ultralytics pour le filtre ;
- open-clip-torch dans une version validée contre le checkpoint ;
- réutilisation du PyTorch déjà opérationnel ;
- aucun package DeepFetal multimodal lourd (ms-swift, vllm, etc.).

Un smoke test doit être effectué avec l’interpréteur réellement utilisé par le serveur. Si cet interpréteur ne supporte pas proprement ces deux dépendances, les mêmes services seront exposés par un microservice Python 3.12, sur le modèle d’OpenCXR. Il s’agit d’un point de décision technique avant l’implémentation de l’API.
3. Architecture cible proposée

Frontend React
    │
    ├── Examen radiographique ── outils simples / IA / radio
    │
    └── Examen fetal_ultrasound ─ outils simples / IA / écho
                    │
                    ▼
             FastAPI AImaging
                    │
        ┌───────────┴────────────┐
        │ fetal_service          │
        │                        │
        │ quality                │
        │ plane                  │
        │ grouping               │
        │ selection              │
        │ FetalCLIP              │
        │ anomaly interface      │
        │ multimodal interface   │
        └───────────┬────────────┘
                    ▼
        Réponse d’examen structurée
Les modèles seront chargés paresseusement et une seule fois par processus. Une erreur FetalCLIP ne devra pas invalider Quality, Plane, Grouping et Selection déjà calculés.
4. Plan d’implémentation détaillé

Étape 0 — Stabiliser l’audit et l’environnement

Actions

1. vérifier les métadonnées réelles de filter.pt :
   - type de tâche Ultralytics ;
   - noms et ordre des classes ;
   - format attendu ;
2. charger plane_classifier.pth sur CPU avec une image de test ;
3. vérifier que le mapping contient exactement les indices 0..40 ;
4. charger FetalCLIP et confirmer une sortie [N, 768] ;
5. mesurer approximativement la mémoire et le temps à froid ;
6. confirmer si les modèles peuvent tourner dans le processus FastAPI principal.

Contraintes Git

DeepFetal est actuellement un gitlink sans entrée .gitmodules exploitable. Son dépôt contient aussi une suppression locale de .gitignore et des __pycache__ non suivis.

L’implémentation devra :

- ne pas écraser ces modifications locales ;
- ne pas dépendre du clonage automatique du gitlink pour le fonctionnement futur ;
- ne réutiliser de DeepFetal que l’architecture ConvNeXt nécessaire ;
- documenter explicitement la provenance de cette architecture.

À terme, le meilleur choix est de déplacer l’architecture minimale nécessaire dans l’adapter AImaging, avec attribution de licence, afin que le classifieur ne dépende plus d’un gitlink cassé. Cette opération doit être ciblée : il ne faut pas copier tout DeepFetal.
Étape 1 — Créer le domaine fœtal backend

Fichiers proposés

Créer :

- server/fetal_schemas.py
- server/fetal_service.py
- server/fetal_pipeline.py
- server/fetal_selection.py
- server/fetal_interfaces.py

Modifier :

- server/config.py
- server/paths.py
- server/model_registry.py
- server/requirements.txt

Responsabilités

fetal_schemas.py

Définir des modèles Pydantic stricts pour :

- FetalQualityResult
- FetalPlaneCandidate
- FetalPlaneResult
- FetalImageAnalysis
- FetalPlaneGroup
- FetalSelectionResult
- FetalFeatureReference
- FetalStageStatus
- FetalExamAnalysis
- FetalAnomalyResult
- FetalMultimodalResult

Statuts normalisés :
ok
rejected
skipped
unavailable
error
not_implemented
fetal_service.py

Fournir les abstractions demandées :
fetal_quality_analyze(...)
fetal_plane_analyze(...)
fetalclip_encode(...)
Les modèles doivent être mis en cache et protégés contre des chargements concurrents.

fetal_pipeline.py

Fournir :
analyze_fetal_image(...)
analyze_fetal_exam(...)
Pipeline :
validation
→ quality
→ plane si quality acceptée
→ grouping
→ selection
→ FetalCLIP sur les images sélectionnées
→ anomaly NOT_IMPLEMENTED
→ multimodal NOT_IMPLEMENTED
fetal_interfaces.py

Implémenter explicitement :
fetal_anomaly_predict(...)
fetal_multimodal_interpret(...)
Ces fonctions ne produiront aucune prédiction médicale. Elles retourneront un résultat strict :
{
  "status": "not_implemented",
  "message": "Anomaly analysis not yet available."
}
Étape 2 — Unifier et fiabiliser les adapters existants

Fichiers concernés

Modifier :

- scripts/fetal_ultrasound/deepfetal_adapter/quality_inference.py
- scripts/fetal_ultrasound/deepfetal_adapter/plane_inference.py
- scripts/fetal_ultrasound/deepfetal_adapter/plane_model.py
- scripts/fetal_ultrasound/deepfetal_adapter/schemas.py
- scripts/fetal_ultrasound/deepfetal_adapter/fetalclip_embeddings.py

Éventuellement créer :

- scripts/fetal_ultrasound/deepfetal_adapter/convnext.py

Travail précis

- accepter une image PIL ou un chemin temporaire via une abstraction commune ;
- valider le type MIME et le décodage avant l’inférence ;
- empêcher les sorties NaN ou les probabilités non normalisées ;
- ajouter top_k au résultat du plan ;
- conserver toutes les probabilités dans l’ordre du mapping ;
- standardiser accepted, rejected, unavailable ;
- exposer les temps d’inférence par étape ;
- charger chaque modèle une seule fois ;
- corriger les divergences de convention de device entre Plane et FetalCLIP ;
- éviter de stocker le vecteur 768 dimensions dans le manifest ou localStorage.

Les scripts CLI existants devront appeler les nouveaux services, plutôt que conserver une seconde logique divergente.
Étape 3 — Implémenter Grouping et Selection

Fichiers

Conserver et adapter :

- scripts/fetal_ultrasound/plane_grouping.py

Créer :

- server/fetal_selection.py

Contrat de sortie

Chaque groupe contiendra :

- nom et identifiant du plan ;
- images candidates ;
- confiance moyenne ;
- images sélectionnées ;
- images exclues et raisons ;
- nombre total et nombre retenu.

Exemple :
{
  "plane": "4CH",
  "plane_id": 2,
  "candidates": ["img-1", "img-4", "img-9"],
  "selected": [
    {
      "image_id": "img-4",
      "quality_score": 0.94,
      "plane_confidence": 0.92,
      "selection_score": 0.8648,
      "rank": 1
    }
  ]
}
Les tests devront verrouiller le tri déterministe et l’exclusion de neg.
Étape 4 — Ajouter l’API fœtale

Organisation recommandée

Pour éviter d’agrandir davantage server/main.py, créer :

- server/fetal_router.py

Puis enregistrer son APIRouter dans server/main.py.

Endpoints

POST /fetal/quality

Multipart :

- image

Retour :

- statut ;
- score ;
- probabilités ;
- temps d’inférence.

POST /fetal/plane

Multipart :

- image

Retour :

- plan ;
- identifiant exact ;
- confiance ;
- probabilités ;
- top-k ;
- temps.

POST /fetal/analyze-image

Multipart :

- image
- image_id optionnel

Retour structuré Quality + Plane, avec Plane marquée skipped si Quality rejette l’image.

POST /fetal/analyze-exam

Multipart :

- exam_id
- image_ids[]
- images[]
- paramètres optionnels :
  - top_k_per_plane, défaut 2 ;
  - min_plane_confidence, défaut 0.30 ;
  - include_features, défaut vrai.

Validation :

- même nombre d’identifiants et de fichiers ;
- identifiants uniques ;
- limite de 256 images cohérente avec le manifest ;
- limite de taille par fichier ;
- formats JPEG, PNG et DICOM rendu ;
- rejet propre des fichiers vides ou illisibles.

DICOM

Le pipeline ML recevra des pixels RGB, pas un dataset DICOM brut :

- JPG/PNG : décodage direct ;
- DICOM frontend : réutiliser le PNG rendu par le client, comme le fait déjà OpenCXR ;
- DICOM direct vers les endpoints : utiliser dicom_service.py pour extraire/rendre les pixels avant l’inférence.

La réponse devra indiquer le canal de décodage utilisé.

Disponibilité

GET /health devra exposer séparément :

- fetal_quality_ready
- fetal_plane_ready
- fetalclip_ready
- device de chaque modèle
- erreurs de chargement éventuelles

FetalCLIP indisponible ne devra pas mettre le serveur entier hors service.
Étape 5 — Étendre le protocole workspace

Fichiers backend

Modifier :

- server/workspace_protocol.py
- server/workspace_commands.py
- server/workspace_agent_prompt.py
- server/workspace_agent.py
- server/main.py
- tests workspace associés

Modalité

Ajouter au manifest un champ explicite :
exam_modality: Literal["radiography", "fetal_ultrasound", "other"]
Ne pas se contenter de lire la modalité de la première image, car les JPG/PNG n’ont pas de métadonnées DICOM.

Le frontend normalisera :

- Radiography, CR, DX → radiography
- Ultrasound, US → fetal_ultrasound

Actions serveur

Ajouter uniquement les actions réelles :
fetal_quality
fetal_plane
fetal_analyze
fetal_analyze pourra cibler une image ou l’examen.

Ne pas ajouter :

- fetal_anomaly
- une action multimodale prétendument fonctionnelle ;
- de nouvelle action 3D.

Commandes explicites

Ajouter au catalogue :
@fetal_quality [image:<id>|all]
@fetal_plane [image:<id>|all]
@fetal_analyze [image:<id>|all]
Validation supplémentaire :

- ces commandes sont refusées si exam_modality != fetal_ultrasound ;
- les commandes radiographiques sont refusées sur une échographie ;
- une commande inconnue ou non implémentée reste rejetée côté serveur ;
- @fetal_anomaly doit explicitement être inconnue/refusée.

Protocole client

Modifier :

- client/src/lib/workspaceProtocol.ts
- client/src/lib/aiCommands.ts
- client/src/lib/aiCommandSyntax.ts
- client/src/lib/workspaceApi.ts
- client/src/state/WorkspaceProvider.tsx

Le client ne devra jamais exécuter une action non validée par le serveur.
Étape 6 — Faire évoluer le modèle d’examen frontend

Fichiers

Modifier :

- client/src/lib/examinations.ts
- client/src/state/workspace.ts
- client/src/state/WorkspaceProvider.tsx
- client/src/components/ExamsScreen.tsx

Types proposés

Ajouter à ExamImage :
fetal?: {
  quality?: FetalQualityResult;
  plane?: FetalPlaneResult;
  selection?: FetalSelectionInfo;
  features?: FetalFeatureInfo;
};
Ajouter à Examination :
modality: "radiography" | "fetal_ultrasound" | "other";
fetalAnalysis?: FetalExamAnalysisSummary;
Une migration légère devra normaliser les anciennes valeurs stockées dans localStorage, notamment "Radiography" et "Ultrasound".

Import

L’écran de création d’examen doit :

- accepter plusieurs JPG/PNG/DICOM ;
- conserver la modalité choisie pour les images sans métadonnées ;
- reconnaître automatiquement DICOM US comme échographie ;
- signaler un conflit entre la modalité choisie et la modalité DICOM ;
- ne jamais envoyer une échographie vers OpenCXR ou les modèles radiographiques.
Étape 7 — Adapter la toolbox à la modalité

Objectif

Conserver le même éditeur et la même structure visuelle. Aucun nouveau “AI mode” et aucune deuxième application.

Fichiers

Modifier :

- client/src/components/LeftToolbar.tsx
- client/src/components/ai/AiSidebarLeft.tsx
- client/src/components/RightPanel.tsx
- client/src/state/workspace.ts
- client/src/App.tsx

Créer éventuellement :

- client/src/lib/toolbox.ts
- client/src/components/fetal/FetalTools.tsx

Structure

toolbox.ts définira :
getToolboxForModality(modality)
Outils communs

- Move
- Hand
- Zoom
- Crop
- Rotate
- Brightness
- Contrast
- Annotation
- Measure
- Angle
- Distance
- Text

Outils IA échographie

- Analyze
- Plane detection
- AI selection
- AI features
- Report, seulement comme restitution structurée des résultats disponibles

Outils écho

- Quality
- Plane classification
- Plane grouping
- Selected views
- FetalCLIP
- Multimodal analysis affiché comme indisponible/expérimental, sans résultat fabriqué

Les outils radio, Grad-CAM radiographique, CXAS et HybridGNet ne seront pas affichés pour une échographie.

Le code 3D existant est hors périmètre : il ne sera ni réparé ni réexposé. Aucun nouvel outil fœtal ne devra y faire référence.
Étape 8 — Construire l’écran d’examen échographique

Composants proposés

Créer :

- client/src/components/fetal/FetalFilmstrip.tsx
- client/src/components/fetal/FetalResultsPanel.tsx
- client/src/components/fetal/FetalQualityCard.tsx
- client/src/components/fetal/FetalPlaneCard.tsx
- client/src/components/fetal/FetalGroupsCard.tsx
- client/src/components/fetal/FetalSelectionCard.tsx
- client/src/components/fetal/FetalFeaturesCard.tsx

Réutiliser le mécanisme existant imageIndex et l’ouverture multi-image dans App.tsx.

Filmstrip

Chaque miniature indiquera visuellement :

- état qualité ;
- plan prédit ;
- confiance du plan ;
- sélectionnée ou non ;
- erreur éventuelle.

Filtres disponibles :

- toutes les images ;
- acceptées ;
- rejetées ;
- sélectionnées ;
- par plan.

Un clic ouvre l’image dans le canvas existant.

Panneau de résultats

Pour l’image active :
QUALITY     Accepted — 94 %
PLANE       4CH — 92 %
SELECTION   Selected — rank 1
FEATURES    FetalCLIP — 768 dimensions
Les probabilités détaillées resteront dans une section secondaire repliable.

Pour l’examen :

- progression du pipeline ;
- groupes par plan ;
- nombre accepté/rejeté ;
- images sélectionnées ;
- étapes indisponibles.

Message obligatoire :
Anomaly analysis not yet available.
L’interface doit rester centrée sur le canvas, et non devenir un dashboard.
Étape 9 — Prévoir la persistance des résultats

Les résultats légers peuvent être stockés avec l’examen dans localStorage :

- scores ;
- plans ;
- groupes ;
- sélection ;
- dimensions et statut des embeddings.

Les éléments suivants ne doivent pas y être stockés :

- vecteurs FetalCLIP complets ;
- poids ;
- fichiers temporaires ;
- données patient non pseudonymisées.

Pour cette phase, embedding_path doit être compris comme une référence éphémère ou optionnelle. Si aucun stockage serveur durable n’est ajouté, retourner :
{
  "status": "ok",
  "embedding_shape": [768],
  "embedding_reference": null,
  "persistence": "not_persisted"
}
5. Plan de tests

5.1 Tests unitaires ML

Créer sous :

server/tests/fetal/

Fichiers proposés :

- test_fetal_quality.py
- test_fetal_plane.py
- test_fetal_grouping.py
- test_fetal_selection.py
- test_fetalclip.py
- test_fetal_pipeline.py
- test_fetal_api.py
- test_fetal_workspace.py

Quality

- image valide acceptée ;
- image rejetée ;
- fichier vide ;
- image corrompue ;
- dépendance ou checkpoint indisponible ;
- vérification du mapping réel des labels.

Plane

- mapping exactement égal aux 41 classes ;
- index 0..40 sans trou ;
- chargement du checkpoint ;
- probabilités de somme proche de 1 ;
- top-k ordonné ;
- cinq classes différentes via sorties de modèle contrôlées ;
- entrée invalide.

Multi-image

- regroupement de plusieurs plans ;
- image Quality rejetée non classifiée ;
- classe neg non sélectionnée ;
- faible confiance isolée ;
- top 2 par plan ;
- départage déterministe ;
- examen partiellement en erreur.

FetalCLIP

- chargement ;
- extraction d’un lot ;
- sortie 768 ;
- normalisation L2 ;
- image corrompue n’arrêtant pas le lot ;
- mode indisponible sans faire échouer le reste du pipeline.

Les tests standards utiliseront des doubles légers pour ne pas charger 1,7 Go à chaque exécution. Les vrais checkpoints seront couverts par des tests d’intégration marqués, exécutés explicitement.

5.2 Tests API

Avec TestClient :

- quatre endpoints minimum ;
- multipart correct ;
- longueurs image_ids/images incompatibles ;
- identifiants dupliqués ;
- formats invalides ;
- Quality rejetée ;
- réponse partielle si Features indisponible ;
- anomaly et multimodal en not_implemented.

5.3 Tests workspace

- commandes fœtales valides sur fetal_ultrasound ;
- commandes fœtales refusées sur radiographie ;
- commande radiographique refusée sur échographie ;
- cible image inconnue ;
- @fetal_anomaly rejetée ;
- action non implémentée rejetée par Pydantic ;
- synchronisation manifest serveur/client.

5.4 Frontend

Le projet ne possède pas encore de framework de tests frontend. Pour ne pas introduire arbitrairement une bibliothèque non utilisée, la première validation sera :
npm run lint
npm run build
Les fonctions pures — normalisation de modalité, toolbox et projection des résultats — seront isolées afin de pouvoir ajouter Vitest ultérieurement si ce choix est accepté.

Le scénario E2E sera d’abord documenté et exécutable manuellement :

1. créer un examen fetal_ultrasound ;
2. importer plusieurs JPG/PNG ;
3. ouvrir l’éditeur ;
4. lancer Analyze ;
5. vérifier Quality ;
6. vérifier Plane ;
7. naviguer par groupe ;
8. vérifier les vues sélectionnées ;
9. vérifier Features ;
10. vérifier le message d’anomalie indisponible.
6. Dataset de validation

Réutiliser d’abord les images présentes dans :

C:\Users\HP\Desktop\Projets\Stage-2026\hgg-ai-intership-project\DeepFetal\data\samples

Créer ensuite un jeu de test réduit et documenté, sans dupliquer massivement les données :

- 5 à 10 images acceptables ;
- plusieurs plans ;
- quelques images rejetables ou synthétiquement dégradées ;
- une image invalide.

Les grandes données et les poids resteront hors Git. Les tests devront sauter proprement les intégrations checkpoint si les fichiers ne sont pas présents.
7. Mesures de performance

Créer un script ciblé :

server/tests/fetal/benchmark_fetal_pipeline.py

Mesurer sur un lot réduit :

- chargement à froid ;
- Quality par image ;
- Plane par image ;
- FetalCLIP par image et par lot ;
- examen complet ;
- RAM avant/après ;
- VRAM si CUDA ;
- device et versions.

FetalCLIP étant un modèle de 1,7 Go, il devra :

- être chargé paresseusement ;
- traiter uniquement les images sélectionnées ;
- utiliser de petits lots configurables ;
- revenir à un statut unavailable en cas de mémoire insuffisante ;
- ne jamais bloquer Quality/Plane/Selection.
8. Documentation finale

Créer :

- docs/fetal_ultrasound_pipeline.md
- docs/fetal_ultrasound_api.md
- docs/fetal_ultrasound_status.md

Mettre à jour :

- server/README.md
- client/README.md
- éventuellement le README.md racine, actuellement trop minimal.

La documentation indiquera pour chaque fonction :
Fonction	Statut prévu fin de phase
Quality	🟡 expérimental, checkpoint réel
Plane classification	🟡 expérimental, checkpoint réel
Grouping	✅ implémenté
Selection	✅ implémenté et déterministe
FetalCLIP features	🟡 expérimental
Anomaly	❌ non implémenté
Multimodal	❌ non implémenté
Rapport médical fœtal	❌ non implémenté sans modèle validé
9. Ordre d’exécution recommandé

1. Smoke tests des trois checkpoints et décision d’environnement.
2. Schémas Pydantic et services Quality/Plane.
3. Pipeline image unique et trois premiers endpoints.
4. Grouping et Selection avec tests unitaires.
5. Pipeline examen et /fetal/analyze-exam.
6. FetalCLIP sur les seules images sélectionnées.
7. Interfaces explicites Anomaly/Multimodal NOT_IMPLEMENTED.
8. Extension du manifest et des actions workspace.
9. Normalisation des modalités frontend.
10. Toolbox conditionnée par modalité.
11. Filmstrip et cartes de résultats fœtaux.
12. Tests API/workspace et scénario E2E.
13. Mesures de performance.
14. Documentation et rapport final Phase 4.
15. Arrêt de la phase, sans lancer de chantier anomalie ou 3D.
10. Critères d’acceptation

La Phase 4 sera considérée terminée si :

- un examen échographique accepte plusieurs images ;
- une image rejetée par Quality ne poursuit pas automatiquement le pipeline ;
- les 41 classes exactes sont utilisées ;
- les images sont regroupées et sélectionnées selon une règle documentée ;
- FetalCLIP encode uniquement les vues sélectionnées ;
- les quatre endpoints demandés fonctionnent ;
- le workspace possède des actions fœtales validées côté serveur ;
- la toolbox change automatiquement selon la modalité ;
- les résultats sont visibles dans le même éditeur ;
- aucune prédiction d’anomalie n’est simulée ;
- aucune fonctionnalité 3D n’est ajoutée ou réexposée ;
- tous les tests backend passent ;
- les tests fœtaux passent ;
- le build et le lint frontend passent ;
- le rapport final contient la matrice statut/test/endpoint/UI/limitation.

Aucune modification n’a été réalisée durant cette analyse, conformément au mode Plan.