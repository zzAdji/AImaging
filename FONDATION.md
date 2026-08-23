# AIMAGING — PHASE DATABASE 2
# IMPLÉMENTATION SUPABASE : SCHÉMA, MIGRATIONS, RLS, STORAGE ET DATA ACCESS LAYER
#
# IMPORTANT :
# Tu viens de terminer l'audit de persistance.
# Le rapport d'audit est désormais la base de travail.
#
# Cette phase autorise maintenant la CRÉATION de la fondation Supabase.
#
# MAIS :
# - ne migre pas encore l'UI ;
# - ne supprime pas localStorage ;
# - ne remplace pas WorkspaceStore ;
# - ne modifie aucun pipeline IA ;
# - ne modifie pas CXAS ;
# - ne modifie pas HybridGNet ;
# - ne modifie pas DeepFetal ;
# - ne modifie pas la logique radiographie ;
# - ne modifie pas la logique échographie ;
# - ne réintroduit jamais la 3D.
#
# Objectif :
# créer une couche de persistance Supabase propre et indépendante,
# prête à être utilisée ensuite progressivement par AImaging.

==================================================
1. SOURCE DE VÉRITÉ
==================================================

Utilise le rapport, que tu as donné plus haut, d'audit Phase Database / Étape 1 comme base.

Il a identifié notamment :

- localStorage "aimaging.examinations" comme stockage principal actuel ;
- aimaging.document ;
- WorkspaceStore mémoire ;
- FetalExamProvider uniquement en mémoire ;
- résultats IA actuellement imbriqués dans les examens ;
- absence de base de données ;
- absence de stockage serveur durable ;
- nécessité de séparer métadonnées SQL et fichiers lourds.

NE SUPPOSE PAS que l'audit est parfait :
vérifie les fichiers concernés avant d'implémenter.

==================================================
2. DÉCISION PRODUIT : 3D ABANDONNÉE
==================================================

LA 3D EST DÉFINITIVEMENT HORS PÉRIMÈTRE.

Ne créer aucune structure de base destinée à :

- DeepScan3D ;
- GRAF ;
- reconstruction_3d ;
- volume 3D ;
- frames 3D ;
- ThreeDResult ;
- remote 3D jobs.

Ne créer aucun bucket "reconstruction3d".

Le code 3D existant peut rester dormant pour le moment,
mais il ne doit plus influencer le nouveau schéma de données.

==================================================
3. PREMIÈRE RÈGLE : NE PAS BRANCHER L'UI
==================================================

Pendant cette phase :

localStorage reste fonctionnel.

WorkspaceStore reste fonctionnel.

FetalExamProvider reste fonctionnel.

L'application continue à fonctionner comme aujourd'hui.

Supabase est introduit en parallèle.

Aucun composant UI existant ne doit devenir dépendant de Supabase
pendant cette phase.

==================================================
4. STRUCTURE SUPABASE
==================================================

Créer dans le repository :

supabase/
    migrations/

et uniquement les fichiers nécessaires à la migration.

La création du schéma doit être entièrement reproductible
depuis les migrations.

NE PAS créer les tables manuellement uniquement depuis le Dashboard.

==================================================
5. ORDRE DES MIGRATIONS
==================================================

Utiliser plusieurs migrations plutôt qu'une migration monolithique.

Organisation recommandée :

0001_extensions_and_helpers.sql
0002_core_tables.sql
0003_analysis_tables.sql
0004_rls.sql
0005_storage.sql

Tu peux adapter les noms si nécessaire.

Respecter les dépendances SQL.

Par exemple :

profiles
↓
workspaces
↓
examinations
↓
examination_images
↓
annotations
↓
analysis_runs
↓
classification_results
↓
measurements
↓
reports

Tu peux modifier l'ordre si une meilleure organisation existe,
mais aucune foreign key ne doit référencer une table pas encore créée.

==================================================
6. EXTENSIONS
==================================================

Utiliser uniquement les extensions réellement nécessaires.

Pour les UUID, utiliser :

gen_random_uuid()

Ne pas installer d'extensions inutiles.

Si PostgreSQL/Supabase fournit déjà le nécessaire,
ne crée pas de dépendance supplémentaire.

==================================================
7. PROFILES
==================================================

Créer :

profiles

avec :

id uuid primary key references auth.users(id) on delete cascade
display_name text
ui_preferences jsonb not null default '{}'::jsonb
created_at timestamptz not null default now()
updated_at timestamptz not null default now()

IMPORTANT :

email n'est PAS la source de vérité.

Ne pas dupliquer inutilement auth.users.email.

Si un champ email est conservé pour affichage, il doit être explicitement
considéré comme une copie informative.

Créer le trigger permettant de créer un profile lorsque cela sera
nécessaire lors de l'activation de Supabase Auth.

NE PAS encore mettre en place tout le workflow de login frontend.

==================================================
8. WORKSPACES
==================================================

Créer :

workspaces

id uuid primary key default gen_random_uuid()
owner_id uuid not null references profiles(id) on delete cascade
name text not null
created_at timestamptz not null default now()
updated_at timestamptz not null default now()

Ajouter un index :

(owner_id)

==================================================
9. EXAMINATIONS
==================================================

Créer :

examinations

id uuid primary key default gen_random_uuid()
workspace_id uuid not null references workspaces(id) on delete cascade
legacy_id text unique
name text not null
modality text not null
archived boolean not null default false
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
last_opened_at timestamptz

La modalité doit accepter au minimum :

radiography
fetal_ultrasound

mais NE PAS utiliser un ENUM PostgreSQL rigide si cela complique
l'ajout futur d'une nouvelle modalité.

Utiliser plutôt :

text + CHECK

avec une architecture permettant une extension propre.

IMPORTANT :

Ne pas créer :

radiography_examinations
fetal_examinations

Les deux partagent examinations.

==================================================
10. EXAMINATION IMAGES
==================================================

Créer :

examination_images

id uuid primary key default gen_random_uuid()
examination_id uuid not null references examinations(id) on delete cascade
legacy_id text unique
filename text not null
storage_path text
mime_type text
width integer
height integer
sort_order integer not null default 0
source_kind text
metadata jsonb not null default '{}'::jsonb
display_state jsonb not null default '{}'::jsonb
created_at timestamptz not null default now()
updated_at timestamptz not null default now()

source_kind minimum :

browser-image
dicom
unknown

IMPORTANT :

AUCUN BINARY IMAGE DANS POSTGRESQL.

Ne stocker ni :

data URL
base64
pixel buffer
linear DICOM buffer

dans une colonne SQL.

Seul storage_path est conservé.

Pendant la coexistence avec localStorage,
storage_path peut être NULL.

==================================================
11. DICOM
==================================================

Les métadonnées DICOM variables peuvent être présentes dans :

metadata JSONB

Exemples :

StudyInstanceUID
SeriesInstanceUID
SOPInstanceUID
FrameOfReferenceUID
patientPseudonym
pixelSpacingMm
bodyPartExamined
viewPosition
rows
columns

IMPORTANT :

Ne stocker aucun identifiant patient brut comme donnée
métier si le système actuel les pseudonymise déjà.

Respecter le comportement sécurisé déjà établi dans dicom_service.py.

==================================================
12. ANNOTATIONS
==================================================

Créer :

annotations

id uuid primary key default gen_random_uuid()
image_id uuid not null references examination_images(id) on delete cascade
legacy_shape_id text unique
type text not null
geometry jsonb not null
style jsonb
label text
visible boolean not null default true
created_by text not null
action_id text
created_at timestamptz not null default now()
updated_at timestamptz not null default now()

created_by :

user
ai

Ne pas créer de relation directe vers un modèle IA.

Une annotation peut néanmoins conserver action_id
pour assurer la traçabilité d'une commande IA.

==================================================
13. ANALYSIS RUNS
==================================================

Créer :

analysis_runs

id uuid primary key default gen_random_uuid()
examination_id uuid not null references examinations(id) on delete cascade
image_id uuid references examination_images(id) on delete set null
analysis_type text not null
model_name text
model_version text
status text not null
error_message text
started_at timestamptz
completed_at timestamptz
metadata jsonb not null default '{}'::jsonb
created_at timestamptz not null default now()
updated_at timestamptz not null default now()

analysis_type doit pouvoir contenir :

classification
gradcam
cxas
hybridgnet
quality
plane
fetalclip
anomaly
multimodal
opencxr_sort
opencxr_standardize
report

NE PAS ajouter :

reconstruction_3d

status :

pending
running
done
error
rejected

L'analyse peut être attachée :

- à une image ;
- à tout un examen avec image_id NULL.

==================================================
14. CLASSIFICATION RESULTS
==================================================

Créer :

classification_results

id uuid primary key default gen_random_uuid()
analysis_run_id uuid not null references analysis_runs(id) on delete cascade
class_name text not null
probability numeric not null
source text not null
model_architecture text
created_at timestamptz not null default now()

source :

per_model
ensemble

Ajouter :

CHECK probability >= 0 AND probability <= 1

Conserver la distinction entre :

DenseNet121
ResNet50
ResNet101
EfficientNet-B0
EfficientNet-B2
ensemble

Ne pas faire une table spécifique à la radiographie.

==================================================
15. MEASUREMENTS
==================================================

Créer :

measurements

id uuid primary key default gen_random_uuid()
analysis_run_id uuid references analysis_runs(id) on delete set null
image_id uuid references examination_images(id) on delete cascade
annotation_id uuid references annotations(id) on delete set null
type text not null
value numeric
unit text not null
source text not null
confidence numeric
geometry jsonb
metadata jsonb not null default '{}'::jsonb
created_at timestamptz not null default now()
updated_at timestamptz not null default now()

source :

user
ai

IMPORTANT :

Ne pas forcer toutes les mesures dans la même unité.

Exemples :

CTR → ratio
SCD → px ou mm
HeartWidth → px ou mm
BPD → mm
CRL → mm
AC → mm
FL → mm
NT → mm

Les valeurs NULL doivent être autorisées si nécessaire
pour une mesure créée avant d'être renseignée.

Ajouter des contraintes uniquement lorsqu'elles sont
scientifiquement sûres.

==================================================
16. REPORTS
==================================================

Créer :

reports

id uuid primary key default gen_random_uuid()
examination_id uuid not null references examinations(id) on delete cascade
type text not null
status text not null
content text
structured_data jsonb
storage_path text
created_by text not null default 'ai'
created_at timestamptz not null default now()
updated_at timestamptz not null default now()

type :

radiography_ai
fetal_obstetric

status :

draft
generated
needs_review
validated

structured_data sera particulièrement important
pour l'échographie.

Ne stocker qu'un texte libre serait insuffisant.

==================================================
17. UPDATED_AT
==================================================

Créer une fonction/trigger commun pour maintenir updated_at.

Ne pas copier-coller le trigger dans chaque table.

Appliquer le trigger aux tables nécessitant updated_at.

==================================================
18. INDEX
==================================================

Créer les index utiles :

workspaces(owner_id)

examinations(workspace_id)

examinations(workspace_id, last_opened_at desc)

examination_images(examination_id, sort_order)

analysis_runs(examination_id)

analysis_runs(image_id)

analysis_runs(analysis_type, status)

classification_results(analysis_run_id)

measurements(analysis_run_id)

measurements(image_id, type)

annotations(image_id)

reports(examination_id, updated_at desc)

Ne créer aucune indexation JSONB avancée tant qu'une requête réelle
ne la justifie pas.

==================================================
19. RLS
==================================================

Activer RLS sur toutes les tables applicatives.

Mais attention :

L'authentification frontend n'est PAS encore implémentée.

Donc :

NE PAS essayer de rendre le frontend actuel dépendant
de ces policies immédiatement.

Créer néanmoins les policies correctes pour la cible finale.

Créer un helper de type :

public.owns_workspace(ws_id uuid)

avec :

security definer
stable
set search_path = ''

IMPORTANT :

Tous les objets doivent être référencés explicitement,
par exemple :

public.workspaces

et non simplement :

workspaces

dans une fonction avec search_path vide.

==================================================
20. POLICIES RLS
==================================================

Prévoir les policies pour :

profiles
workspaces
examinations
examination_images
annotations
analysis_runs
classification_results
measurements
reports

Principe :

auth.uid()
↓
profiles.id
↓
workspaces.owner_id
↓
données enfants

INSERT et UPDATE doivent comporter des WITH CHECK cohérents.

DELETE doit respecter la même appartenance.

Un utilisateur ne doit jamais pouvoir écrire une ressource
dans le workspace d'un autre utilisateur en envoyant
simplement un UUID arbitraire.

==================================================
21. STORAGE
==================================================

Créer trois buckets PRIVÉS :

medical-images
analysis-artifacts
reports

NE PAS créer de bucket 3D.

NE PAS créer :

reconstruction3d

Structure recommandée :

medical-images/
  {user_id}/
    {workspace_id}/
      {examination_id}/
        images/
          {image_id}/
            {filename}

analysis-artifacts/
  {user_id}/
    {workspace_id}/
      {examination_id}/
        {image_id}/
          {analysis_run_id}/
            gradcam/
            segmentation/
            landmarks/
            standardized/

reports/
  {user_id}/
    {workspace_id}/
      {examination_id}/
        {report_id}/
          exports/

Créer les buckets et les policies via migration SQL
ou via la méthode Supabase CLI appropriée.

NE PAS compter sur une configuration manuelle non versionnée
du Dashboard.

==================================================
22. STORAGE POLICIES
==================================================

Les buckets sont privés.

Les policies doivent vérifier le user_id présent dans le chemin.

Ne pas créer de bucket public.

Ne pas utiliser service_role côté client.

Prévoir l'accès futur via :

- authenticated user ;
- signed URLs lorsque nécessaire ;
- accès serveur lorsque nécessaire.

==================================================
23. TYPES TYPESCRIPT
==================================================

Ne pas utiliser `any`.

Créer les types Supabase correspondants.

Si Supabase CLI est disponible :

générer les types depuis la base.

Sinon créer des types temporaires documentés,
mais préférer les types générés.

Les types doivent couvrir :

Profile
Workspace
Examination
ExaminationImage
Annotation
AnalysisRun
ClassificationResult
Measurement
Report

==================================================
24. SUPABASE CLIENT
==================================================

Créer un seul client Supabase côté frontend.

Utiliser :

VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY

Ne jamais utiliser :

SUPABASE_SERVICE_ROLE_KEY

dans le frontend.

Créer un module dédié.

Exemple :

client/src/lib/db/supabaseClient.ts

Ne pas initialiser un client Supabase dans plusieurs composants.

==================================================
25. DATA ACCESS LAYER
==================================================

Créer les repositories sans encore les brancher à l'UI.

Exemples :

workspaceRepository
examinationRepository
imageRepository
annotationRepository
analysisRepository
measurementRepository
reportRepository

Créer des fonctions cohérentes :

create
get
list
update
delete

avec gestion explicite des erreurs.

IMPORTANT :

AUCUN catch {} silencieux.

Toute erreur doit être :

- retournée ;
- loggée proprement ;
- ou propagée.

==================================================
26. TESTS
==================================================

Créer des tests pour vérifier la fondation.

Minimum :

1. connexion Supabase ;
2. création workspace ;
3. lecture workspace ;
4. modification workspace ;
5. suppression workspace ;
6. création examen ;
7. création image metadata ;
8. création analysis_run ;
9. création classification_results ;
10. création measurement ;
11. création annotation ;
12. création report.

Tester également les contraintes importantes :

- foreign keys ;
- unique legacy_id ;
- probability 0..1 ;
- status valides ;
- modality ;
- RLS.

IMPORTANT :

Les tests RLS doivent inclure un scénario multi-utilisateur
dès que cela peut être réalisé proprement :

USER A
→ peut lire son workspace

USER B
→ ne peut pas lire le workspace de A

Ne contourne pas RLS avec service_role pour les tests
qui prétendent tester RLS.

==================================================
27. SEED DE DÉVELOPPEMENT
==================================================

Si utile, créer un seed minimal de développement.

Il doit être clairement identifié :

DEV ONLY

avec :

- un workspace ;
- un examen de test ;
- éventuellement une image metadata.

NE PAS injecter de véritables données médicales.

==================================================
28. COEXISTENCE ACTUELLE
==================================================

NE PAS modifier :

lib/examinations.ts
WorkspaceProvider
ExamsScreen
FetalExamProvider

pour les brancher à Supabase.

On construira d'abord la couche de données.

Le comportement actuel doit rester identique.

==================================================
29. BACKEND FASTAPI
==================================================

NE PAS migrer WorkspaceStore maintenant.

Créer seulement, si nécessaire, une abstraction/interface
permettant une migration future.

Exemple conceptuel :

WorkspacePersistence

avec :

MemoryWorkspacePersistence

future :

SupabaseWorkspacePersistence

Mais si cette abstraction n'apporte rien immédiatement,
ne l'implémente pas prématurément.

Ne touche pas aux endpoints IA.

==================================================
30. ENVIRONMENT
==================================================

Vérifier :

client/.env.example

et ajouter uniquement :

VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=

NE JAMAIS commit une vraie clé.

Vérifier également le .gitignore.

==================================================
31. BUILD ET NON-RÉGRESSION
==================================================

À la fin :

- tous les tests backend existants doivent passer ;
- npm run build doit passer ;
- frontend doit démarrer ;
- backend doit démarrer ;
- aucune fonctionnalité actuelle ne doit dépendre de Supabase.

La base peut exister même si l'application continue
à utiliser localStorage.

==================================================
32. LIVRABLES ATTENDUS
==================================================

À la fin de la phase :

supabase/
  migrations/

client/src/lib/db/
  supabaseClient.ts
  repositories/...

types générés ou documentés

.env.example mis à jour

tests de fondation

==================================================
33. RAPPORT FINAL
==================================================

Produire :

1. migrations créées ;
2. tables créées ;
3. relations ;
4. index ;
5. RLS ;
6. Storage ;
7. types ;
8. repositories ;
9. tests ;
10. résultats ;
11. problèmes rencontrés ;
12. ce qui reste volontairement non migré.

Créer cette matrice :

| Élément | Créé | Testé | UI branchée | Statut |
|---|---|---|---|---|
| PostgreSQL | ✓ | ✓ | Non | READY |
| RLS | ✓ | ✓ | Non | READY |
| Storage | ✓ | ✓ | Non | READY |
| Workspaces | ✓ | ✓ | Non | READY |
| Examinations | ✓ | ✓ | Non | READY |
| Images | ✓ | ✓ | Non | READY |
| Analysis runs | ✓ | ✓ | Non | READY |
| Measurements | ✓ | ✓ | Non | READY |
| Annotations | ✓ | ✓ | Non | READY |
| Reports | ✓ | ✓ | Non | READY |

==================================================
RÈGLE FINALE
==================================================

Cette phase crée uniquement la FONDATION SUPABASE.

Une fois terminée :

ARRÊTE-TOI.

Ne migre pas encore :

- ExamsScreen ;
- WorkspaceProvider ;
- FetalExamProvider ;
- localStorage ;
- WorkspaceStore ;
- DICOM ;
- analyses IA ;
- rapports ;
- authentification.

Nous validerons d'abord la qualité du schéma,
des RLS, du Storage et des repositories.

Puis une phase suivante effectuera la migration progressive
des fonctionnalités existantes.