# AIMAGING — PHASE DATABASE
# MIGRATION VERS SUPABASE POSTGRESQL
#
# IMPORTANT :
# AImaging existe déjà.
# L'éditeur radiographie existe déjà.
# L'interface échographie existe déjà.
#
# Cette phase concerne UNIQUEMENT la conception et la mise en place
# de la couche de persistance.
#
# NE REFAIS PAS L'UI.
# NE REFAIS PAS L'ÉDITEUR.
# NE MODIFIE PAS LES PIPELINES IA.
# NE MODIFIE PAS CXAS.
# NE MODIFIE PAS HYBRIDGNET.
# NE MODIFIE PAS DEEPFETAL.
#
# Nous voulons introduire Supabase comme couche de données
# sans casser l'application existante.

==================================================
1. CONTEXTE
==================================================

AImaging est actuellement un éditeur médical Figma-like.

Il possède déjà :

- gestion des examens ;
- éditeur d'images ;
- radiographie ;
- échographie fœtale ;
- outils simples ;
- outils IA ;
- outils spécifiques à la modalité ;
- annotations ;
- mesures ;
- Grad-CAM ;
- CXAS ;
- HybridGNet ;
- rapports ;
- command bar ;
- DICOM.

L'état actuel utilise principalement :

- localStorage côté frontend ;
- WorkspaceStore en mémoire côté backend.

Nous voulons maintenant introduire :

SUPABASE
=
POSTGRESQL + STORAGE

Le but de cette phase est de construire une vraie couche de persistance.

==================================================
2. OBJECTIF
==================================================

La cible est :

React
   ↓
Data Access Layer
   ↓
Supabase
   ├── PostgreSQL
   └── Storage

Le frontend ne doit pas disperser des appels Supabase
partout dans les composants.

Créer une couche dédiée.

Par exemple :

client/src/lib/db/
ou
client/src/services/

avec :

workspaceRepository
examinationRepository
imageRepository
analysisRepository
measurementRepository
annotationRepository
reportRepository

Adapter les noms à l'architecture réelle.

==================================================
3. PREMIÈRE ÉTAPE — AUDIT
==================================================

Avant de modifier quoi que ce soit :

inspecte :

- lib/examinations.ts
- WorkspaceProvider
- WorkspaceStore backend
- workspaceApi.ts
- types du workspace
- persistence frontend
- callbacks onSave*
- gestion des examens
- stockage des images
- stockage des rapports
- annotations
- résultats IA.

Je veux savoir exactement :

où l'état est actuellement créé ;
où il est sauvegardé ;
où il est lu ;
où il est supprimé.

NE CODE PAS encore.

Présente d'abord le mapping :

CURRENT STORAGE
→ TARGET SUPABASE TABLE

==================================================
4. SCHÉMA SUPABASE
==================================================

Proposer un schéma PostgreSQL adapté au projet.

Tables minimales :

profiles
workspaces
examinations
examination_images
analysis_runs
classification_results
measurements
annotations
reports

Ajouter d'autres tables uniquement si nécessaire.

==================================================
5. RELATIONS
==================================================

Créer les relations :

profiles
  ↓
workspaces
  ↓
examinations
  ↓
examination_images

examinations
  ↓
analysis_runs

analysis_runs
  ├── classification_results
  └── measurements

examination_images
  └── annotations

examinations
  └── reports

Utiliser UUID pour les identifiants.

Créer :

- primary keys ;
- foreign keys ;
- indexes pertinents ;
- created_at ;
- updated_at.

==================================================
6. MODALITÉ
==================================================

Le champ :

examinations.modality

doit au minimum permettre :

radiography
fetal_ultrasound

Prévoir une architecture extensible.

NE crée pas de tables séparées :

radiography_examinations
fetal_examinations

Les deux utilisent la même table examination.

La spécialisation vient des résultats et outils de la modalité.

==================================================
7. IMAGES
==================================================

Ne stocker aucune grosse image directement dans PostgreSQL.

PostgreSQL garde :

id
examination_id
filename
storage_path
mime_type
width
height
sort_order
metadata

Les fichiers seront stockés dans Supabase Storage.

Préparer le modèle pour :

- PNG
- JPEG
- DICOM
- échographie
- radiographie.

==================================================
8. ANALYSIS RUNS
==================================================

Chaque exécution IA doit être traçable.

Table :

analysis_runs

avec :

id
examination_id
image_id
analysis_type
model_name
model_version
status
started_at
completed_at
error_message
metadata

analysis_type doit être extensible.

Exemples :

classification
gradcam
cxas
hybridgnet
quality
plane
fetalclip
anomaly
multimodal
report

==================================================
9. CLASSIFICATION RESULTS
==================================================

Créer une table séparée :

classification_results

avec :

id
analysis_run_id
class_name
probability

Cela permettra de stocker les résultats des 5 modèles et de
l'ensemble sans les mélanger.

==================================================
10. MESURES
==================================================

Créer :

measurements

avec :

id
analysis_run_id
image_id
type
value
unit
source
confidence
geometry
metadata

Exemples :

CTR
SCD
HeartWidth
HeartHeight
BPD
CRL
AC
FL
NT

IMPORTANT :

Ne suppose pas que toutes les mesures ont les mêmes unités.

Par exemple :

CTR
→ ratio

HeartWidth
→ px ou mm

BPD
→ mm

Le champ unit doit rester explicite.

geometry peut être JSONB.

==================================================
11. ANNOTATIONS
==================================================

Créer :

annotations

avec :

id
image_id
type
geometry
style
label
created_by
created_at
updated_at

geometry doit être JSONB.

Cela doit permettre :

rectangle
ellipse
line
arrow
freedraw
measure
angle
distance
text
polygon

Ne pas lier directement ces annotations à un modèle IA.

Utiliser created_by :

user
ai

ou une structure équivalente.

==================================================
12. RAPPORTS
==================================================

Créer :

reports

avec :

id
examination_id
type
status
content
structured_data
created_at
updated_at

content :

texte final.

structured_data :

JSONB contenant les données structurées ayant permis
de générer le rapport.

Cela est particulièrement important pour les rapports
d'échographie obstétricale.

Exemple :

{
  "fetus_1": {...},
  "fetus_2": {...},
  "biometry": {...},
  "placenta": {...},
  "amniotic_fluid": {...},
  "cervix": {...},
  "findings": [...],
  "conclusion": {...}
}

==================================================
13. JSONB
==================================================

Utiliser JSONB uniquement lorsque les structures sont réellement
variables.

Bons candidats :

metadata
geometry
structured_data
model_output

Ne transforme pas toutes les tables en gros blobs JSON.

Les données que l'application interrogera fréquemment doivent
rester dans des colonnes relationnelles normales.

==================================================
14. ROW LEVEL SECURITY
==================================================

Activer RLS sur toutes les tables exposées.

Préparer les policies afin qu'un utilisateur authentifié
ne puisse accéder qu'à ses workspaces et aux données qui
en dépendent.

Relation logique :

auth.uid()
 ↓
workspace.owner_id
 ↓
examination.workspace_id
 ↓
images / analyses / measurements / reports

Ne pas utiliser service_role dans le frontend.

La service_role doit rester backend uniquement.

==================================================
15. SUPABASE STORAGE
==================================================

Préparer les buckets nécessaires.

Proposer au minimum :

medical-images
analysis-artifacts
reports

Ne pas upload automatiquement les images existantes
pendant cette phase.

Créer uniquement :

- buckets ;
- structure ;
- policies ;
- fonctions d'accès.

Les chemins doivent être organisés.

Exemple :

medical-images/
  {user_id}/
    {workspace_id}/
      {examination_id}/
        images/

analysis-artifacts/
  {user_id}/
    {examination_id}/
      gradcam/
      segmentation/
      landmarks/

reports/
  {user_id}/
    {examination_id}/

==================================================
16. MIGRATIONS
==================================================

Ne crée pas uniquement les tables à la main dans le Dashboard.

Créer des migrations SQL versionnées.

Le repository doit permettre de reconstruire le schéma.

Prévoir :

supabase/
  migrations/
    ...

Ne jamais faire dépendre le projet d'une configuration manuelle
non documentée du Dashboard.

==================================================
17. TYPES
==================================================

Générer ou créer les types TypeScript correspondant au schéma.

Le frontend doit pouvoir manipuler :

Examination
ExaminationImage
AnalysisRun
ClassificationResult
Measurement
Annotation
Report

sans utiliser `any`.

==================================================
18. REPOSITORY LAYER
==================================================

Créer une couche d'accès aux données.

Exemples :

createExamination()
getExamination()
listExaminations()
updateExamination()
deleteExamination()

createImageRecord()
getImagesForExamination()

createAnalysisRun()
updateAnalysisRun()

saveMeasurement()
getMeasurements()

saveAnnotation()
deleteAnnotation()

createReport()
updateReport()
getReports()

Ne branche pas encore tous les composants UI sur ces fonctions.

On veut d'abord valider la couche.

==================================================
19. ENVIRONMENT VARIABLES
==================================================

Ajouter les variables nécessaires.

Pour le frontend :

VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY

Ne jamais mettre :

SUPABASE_SERVICE_ROLE_KEY

dans VITE_*.

La service role doit rester serveur uniquement.

Créer / mettre à jour :

.env.example

NE PAS écrire de vraies clés dans Git.

==================================================
20. TEST DE CONNEXION
==================================================

Créer un test minimal :

frontend
 ↓
Supabase
 ↓
create workspace
 ↓
read workspace
 ↓
delete workspace

Puis :

create examination
 ↓
read
 ↓
update
 ↓
delete

Ne pas encore migrer l'interface entière.

==================================================
21. COEXISTENCE AVEC LOCALSTORAGE
==================================================

IMPORTANT :

Ne supprime pas immédiatement localStorage.

Pendant cette phase :

Supabase = nouveau stockage cible

localStorage = fallback / ancien stockage

L'objectif est d'éviter de casser l'éditeur actuel.

Créer éventuellement une abstraction :

PersistenceProvider

ou

DataRepository

qui permettra plus tard de retirer progressivement localStorage.

==================================================
22. BACKEND FASTAPI
==================================================

Le backend FastAPI existe déjà.

Ne le réécris pas.

Prépare simplement une stratégie pour qu'il puisse accéder
à Supabase lorsque nécessaire.

Identifier les endroits où :

WorkspaceStore
devra plus tard être remplacé par la persistance Supabase.

Mais ne supprime pas WorkspaceStore pendant cette phase.

NE PAS migrer les workflows IA maintenant.

==================================================
23. MIGRATION PROGRESSIVE
==================================================

L'objectif global est :

PHASE ACTUELLE

Supabase installé
+
schéma
+
RLS
+
Storage
+
repositories
+
tests

Puis plus tard :

ExamsScreen
→ Supabase

Workspace persistence
→ Supabase

Annotations
→ Supabase

Reports
→ Supabase

AI results
→ Supabase

Images
→ Supabase Storage

==================================================
24. NON-RÉGRESSION
==================================================

Après l'installation de Supabase :

- backend toujours démarre ;
- frontend build toujours OK ;
- 80 tests backend doivent toujours passer ;
- radiographie inchangée ;
- échographie UI inchangée ;
- outils IA inchangés ;
- command bar inchangée.

Si un problème apparaît :

corriger uniquement ce qui concerne l'intégration Supabase.

==================================================
25. CE QUI EST HORS PÉRIMÈTRE
==================================================

NE PAS faire maintenant :

- authentification complète ;
- migration complète localStorage ;
- migration complète WorkspaceStore ;
- upload de toutes les images ;
- migration DICOM ;
- migration IA ;
- PostgreSQL pour les logs IA complets ;
- génération de rapport réelle ;
- intégration DeepFetal ;
- CXAS modifications ;
- refactoring massif.

Ces éléments viendront après.

==================================================
26. RAPPORT FINAL
==================================================

À la fin, fournir :

1. Schéma SQL final
2. Tables
3. Relations
4. Index
5. RLS policies
6. Storage buckets
7. Types TypeScript
8. Repository layer
9. Variables d'environnement
10. Tests réalisés
11. Compatibilité avec l'architecture existante
12. Migration restante
13. Risques

Créer une matrice :

| Élément | Supabase | Testé | Statut |
|---|---|---|---|
| PostgreSQL | ✓ | ✓ | READY |
| RLS | ✓ | ✓ | READY |
| Storage | ✓ | ✓ | READY |
| Workspaces | ✓ | ✓ | READY |
| Examinations | ✓ | ✓ | READY |
| Images metadata | ✓ | ✓ | READY |
| Analysis runs | ✓ | ✓ | READY |
| Measurements | ✓ | ✓ | READY |
| Annotations | ✓ | ✓ | READY |
| Reports | ✓ | ✓ | READY |

==================================================
RÈGLE FINALE — PHASE D'AUDIT AVANT IMPLÉMENTATION
==================================================

Cette première étape de la phase Database est une PHASE D'ANALYSE.

NE CRÉE AUCUNE TABLE.

NE CRÉE AUCUNE MIGRATION.

NE CRÉE AUCUNE POLICY.

NE MODIFIE AUCUN COMPOSANT DE L'UI.

NE MODIFIE PAS localStorage.

NE MODIFIE PAS WorkspaceStore.

NE MODIFIE PAS LES PIPELINES IA.

NE MODIFIE PAS L'API EXISTANTE.

NE MODIFIE AUCUN FICHIER DU PROJET.

Commence par inspecter complètement le repository.

Présente ensuite :

1. l'architecture actuelle de persistance ;
2. les données actuellement stockées dans localStorage ;
3. les données actuellement stockées dans WorkspaceStore ;
4. les données actuellement conservées uniquement en mémoire ;
5. les données qui doivent être persistées ;
6. le schéma PostgreSQL/Supabase proposé ;
7. toutes les relations entre les tables ;
8. les index recommandés ;
9. la stratégie RLS ;
10. la structure des buckets Storage ;
11. la stratégie de stockage des images et artefacts ;
12. la stratégie de migration progressive ;
13. les éventuels conflits avec l'architecture actuelle ;
14. les risques de migration.

Pour chaque proposition importante, indique le fichier actuel
qui sera concerné.

Exemple :

lib/examinations.ts
→ actuellement localStorage
→ future table examinations

WorkspaceStore
→ actuellement mémoire
→ future persistance Supabase

Après cette analyse, ARRÊTE-TOI.

N'implémente rien.

J'examinerai ton architecture proposée avant de te donner
l'autorisation de créer les migrations.