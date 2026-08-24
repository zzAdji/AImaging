# AIMAGING — PHASE DATABASE 9
# FINALISATION DE LA PERSISTANCE ET DU WORKSPACE BACKEND
#
# OBJECTIF :
# finaliser l'architecture de persistance AImaging maintenant que :
#
# - Supabase PostgreSQL existe ;
# - Supabase Storage existe ;
# - les examens sont persistants ;
# - les images sont dans Storage ;
# - annotations/mesures sont persistantes ;
# - analysis_runs sont persistants ;
# - classification_results sont persistants ;
# - rapports sont persistants ;
# - Supabase Auth est actif ;
# - RLS est en place.
#
# Cette phase doit maintenant :
#
# 1. exécuter les tests Supabase réels ;
# 2. identifier exactement ce qui reste dans localStorage ;
# 3. supprimer progressivement uniquement ce qui est devenu redondant ;
# 4. décider et implémenter une vraie stratégie de persistance
#    du WorkspaceStore backend ;
# 5. conserver un cache local uniquement lorsqu'il a une vraie
#    raison technique d'exister.
#
# IMPORTANT :
# NE PAS ajouter de nouvelle fonctionnalité IA.
# NE PAS implémenter l'anomaly detection.
# NE PAS poursuivre DeepFetal multimodal.
# NE PAS implémenter PACS.
# NE PAS implémenter RAG.
# NE PAS déployer en production.
# NE PAS réintroduire la 3D.
#
# La 3D est définitivement abandonnée.

==================================================
1. ÉTAT ACTUEL
==================================================

Les phases précédentes ont mis en place :

SUPABASE DATABASE

profiles
workspaces
examinations
examination_images
annotations
measurements
analysis_runs
classification_results
reports

SUPABASE STORAGE

medical-images
analysis-artifacts
reports

SUPABASE AUTH

auth.users
profiles
auth.uid()

FRONTEND

- Editor
- Radiography
- Fetal Ultrasound UI
- Annotations
- Measurements
- AI Workspace
- Reports

Le système possède encore certains mécanismes locaux :

- localStorage legacy ;
- cache d'examens ;
- document local ;
- récents ;
- préférences ;
- quelques résultats runtime ;
- WorkspaceStore mémoire côté backend.

==================================================
2. PHASE 9A — TESTS LIVE OBLIGATOIRES
==================================================

AVANT toute suppression ou migration :

vérifier que les credentials Supabase de développement
sont réellement configurés.

Créer/valider :

USER A
USER B

Puis exécuter réellement :

AUTH

A login
B login
logout
session restore

DATABASE

workspace CRUD
examination CRUD
image metadata
annotation CRUD
measurement CRUD
analysis run CRUD
classification results
report CRUD

STORAGE

medical-images
analysis-artifacts
reports

RLS

USER A
→ voit uniquement A

USER B
→ voit uniquement B

TESTER :

SELECT
INSERT
UPDATE
DELETE

Ne jamais utiliser service_role pour valider le comportement RLS.

Si les tests live échouent :

ARRÊTER la migration.

Corriger la sécurité avant de supprimer le stockage local.

==================================================
3. PHASE 9B — AUDIT COMPLET DU LOCALSTORAGE
==================================================

Inventorier toutes les clés restantes.

Chercher :

localStorage
sessionStorage
IndexedDB

Créer une matrice :

| Clé | Contenu | Source de vérité | Peut être supprimée ? | Justification |
|---|---|---|---|---|

Inclure notamment :

aimaging.examinations
aimaging.document
aimaging.prefs
aimaging.shapeStyle
aimaging.cardOrder
aimaging.aiCommands
aimaging.recentFiles
IndexedDB aimaging-fs
autres clés découvertes

NE SUPPRIME RIEN avant cette analyse.

==================================================
4. CLASSIFICATION DU STOCKAGE LOCAL
==================================================

Pour chaque donnée locale, décider :

A. PERSISTANCE MÉTIER
→ doit être dans Supabase

B. CACHE
→ peut rester localement

C. PRÉFÉRENCE UI
→ peut rester localement

D. DONNÉE TEMPORAIRE
→ ne doit pas être persistée

Exemples :

Examens
→ Supabase

Images
→ Storage

Annotations
→ Supabase

Measurements
→ Supabase

AI results
→ Supabase

Reports
→ Supabase

Undo/redo
→ local

Clipboard
→ local

Theme
→ local

UI preferences
→ local

Recent files
→ local/cache

==================================================
5. AIMAGING.EXAMINATIONS
==================================================

Après validation que Supabase contient bien les examens :

NE PLUS considérer :

aimaging.examinations

comme source de vérité.

Il peut rester temporairement comme backup de migration.

Créer une migration :

legacy localStorage
→ Supabase

puis :

Supabase
→ application

Le fallback ne doit être utilisé que :

- hors ligne ;
- erreur Supabase ;
- migration legacy.

Il ne doit pas masquer silencieusement une panne.

==================================================
6. CACHE EXAMENS
==================================================

Le cache local doit être séparé du stockage métier.

Par exemple :

Supabase
= source

local cache
= performance/fallback

Le cache doit être invalide lorsque :

- changement utilisateur ;
- modification d'un examen distant ;
- logout ;
- suppression d'un examen.

Ne pas conserver des données sensibles
d'un utilisateur dans le cache d'un autre.

==================================================
7. AIMAGING.DOCUMENT
==================================================

Analyser précisément :

aimaging.document

Ce document est aujourd'hui une deuxième représentation
de l'état de l'éditeur.

Identifier ce qui est désormais redondant avec :

examination_images
annotations
measurements

et ce qui doit rester runtime.

Objectif :

NE PAS supprimer brutalement.

Migrer seulement les données qui ont une équivalence
claire dans Supabase.

Exemple :

shapes
→ annotations

measurement
→ measurements

display settings
→ runtime/local preferences selon pertinence

Les buffers de pixels et états de rendu
restent temporaires.

==================================================
8. PRÉFÉRENCES
==================================================

Conserver localement si ce sont réellement des préférences :

aimaging.prefs
aimaging.shapeStyle
aimaging.cardOrder
aimaging.theme
aimaging.aiCommands

Ne pas migrer inutilement ces données vers PostgreSQL.

Si les préférences sont déjà prévues dans :

profiles.ui_preferences

il est possible de les migrer plus tard,
mais ce n'est PAS obligatoire dans cette phase.

==================================================
9. RECENT FILES / INDEXEDDB
==================================================

Conserver les récents comme cache local.

Mais :

ne jamais conserver un gros data URL
comme source principale d'une image.

Les récents doivent référencer :

examination_id
image_id
storage_path
filename

lorsque disponibles.

==================================================
10. AUDIT WORKSPACE STORE
==================================================

Analyser maintenant :

server/workspace_store.py

et toutes les routes qui l'utilisent.

Identifier exactement les données suivantes :

manifest
turns
audit
active_image
images
canvas state
agent history
temporary execution state

Classer :

A. doit être persistant
B. doit rester runtime
C. doit être dérivé de Supabase
D. peut être supprimé

NE REMPLACE PAS LE WORKSPACE STORE
AVANT CETTE ANALYSE.

==================================================
11. OBJECTIF DU WORKSPACE STORE
==================================================

Le WorkspaceStore ne doit PAS devenir
une deuxième base de données parallèle.

Supabase doit être la source de vérité des données métier.

WorkspaceStore doit idéalement devenir :

SESSION RUNTIME

et non :

DATABASE

Il peut conserver temporairement :

- active image ;
- active tool ;
- AI transaction ;
- conversation en cours ;
- état d'exécution ;
- progression ;
- contexte agent ;
- données temporaires nécessaires au calcul.

Il ne doit pas dupliquer inutilement :

- examinations ;
- images ;
- annotations ;
- measurements ;
- analysis runs ;
- reports.

==================================================
12. NOUVELLE ABSTRACTION SI NÉCESSAIRE
==================================================

Si l'audit montre qu'un remplacement est nécessaire :

créer une abstraction :

WorkspaceRuntime

ou équivalent.

Elle doit séparer :

PERSISTED STATE
vs
RUNTIME STATE

Exemple :

Persisted
- examination
- image metadata
- annotations
- measurements
- analyses
- reports

Runtime
- activeImage
- tool
- selection
- AI thought
- loading
- undo/redo
- transient transaction

NE PAS transformer tous les deux en une seule structure.

==================================================
13. ROUTES BACKEND
==================================================

Auditer les routes workspace existantes.

Certaines routes utilisent encore le WorkspaceStore
uniquement comme contexte.

Modifier les routes uniquement si nécessaire.

Objectif :

route reçoit :
examination_id
image_id

puis récupère les données persistantes depuis Supabase
si nécessaire.

Ne pas faire de gros refactoring de main.py
sans nécessité.

==================================================
14. AGENT IA
==================================================

Le contexte envoyé à l'agent doit être basé prioritairement
sur les données persistées pertinentes :

- image ;
- analysis runs ;
- measurements ;
- annotations ;
- report.

Le WorkspaceStore peut conserver le contexte temporaire
de la conversation.

Il ne doit pas devenir la source de vérité des données médicales.

==================================================
15. MIGRATION SAFE
==================================================

Avant toute suppression de localStorage :

1. sauvegarde/export JSON ;
2. vérifier présence Supabase ;
3. vérifier nombre d'examens ;
4. vérifier nombre d'images ;
5. vérifier annotations ;
6. vérifier mesures ;
7. vérifier analyses ;
8. vérifier rapports.

Créer un rapport de comparaison :

LOCAL COUNT
vs
SUPABASE COUNT

et vérifier les écarts.

NE SUPPRIME PAS une donnée locale
si sa contrepartie Supabase n'est pas confirmée.

==================================================
16. PHASE DE NETTOYAGE
==================================================

Une fois les vérifications terminées :

supprimer progressivement :

aimaging.examinations
si devenu totalement redondant

anciens blobs document
si migrés

anciens data URLs
si non utilisés

Mais conserver :

prefs
theme
recent files
undo/redo
clipboard

selon classification.

Ne pas supprimer des clés juste parce qu'elles contiennent
"aimaging".

==================================================
17. LOCAL-FIRST / OFFLINE
==================================================

AImaging n'a pas besoin d'être complètement offline-first
dans cette phase.

Priorité :

ONLINE
→ Supabase

OFFLINE
→ cache local si disponible

Mais l'utilisateur doit voir l'état réel :

Saved
Syncing
Offline
Sync error

Ne jamais afficher "Saved" si la donnée n'est pas persistée.

==================================================
18. WORKSPACE STORE — MIGRATION
==================================================

Si l'audit confirme que WorkspaceStore ne contient plus
que des données runtime :

simplifier le store.

Il doit devenir :

in-memory runtime state

et non persistance métier.

Si certaines données doivent rester persistantes côté backend :

proposer précisément leur destination Supabase
avant modification.

NE PAS créer une deuxième base backend.

==================================================
19. TESTS
==================================================

Créer/mettre à jour des tests :

AUTH
DB
STORAGE
RLS

mais aussi :

1. reload application
2. examination persists
3. image persists
4. annotations persist
5. measurements persist
6. AI results persist
7. report persists
8. user switching
9. logout/login
10. cache invalidation
11. offline fallback
12. Workspace runtime reset

==================================================
20. TEST CRITIQUE — RELOAD
==================================================

Tester :

USER A login
↓
open examination
↓
annotate
↓
measure
↓
analyze
↓
generate report
↓
logout
↓
login
↓
reopen examination

Tout doit être retrouvé depuis Supabase.

Le résultat attendu :

images
annotations
measurements
AI results
report

sont toujours présents.

Le runtime :

active tool
undo/redo
AI thought
selection

peut être perdu.

C'est normal.

==================================================
21. TEST CRITIQUE — USER SWITCH
==================================================

USER A
↓
logout

USER B
↓
login

USER B ne doit voir :

- examens A ;
- images A ;
- annotations A ;
- analyses A ;
- reports A.

Aucune donnée locale ne doit fuiter.

==================================================
22. PERFORMANCE
==================================================

Ne pas charger toute la base au démarrage.

Charger :

workspace
↓
liste examens

Puis :

examen sélectionné
↓
images

Puis :

image sélectionnée
↓
annotations
measurements
analyses
reports

Éviter les requêtes inutiles.

==================================================
23. NON-RÉGRESSION
==================================================

À la fin :

- npm run build ;
- tous les tests frontend ;
- backend pytest ;
- tests Supabase live ;
- tests RLS ;
- tests Storage.

Vérifier :

Radiography
Fetal ultrasound UI
DICOM
Annotations
Measurements
AI Workspace
Reports

==================================================
24. NETTOYAGE 3D
==================================================

La 3D étant définitivement abandonnée :

NE PAS conserver de nouvelle référence
dans la nouvelle architecture.

Cette phase peut identifier et supprimer
les références mortes si et seulement si
cela ne touche aucun workflow actuel.

Ne pas passer du temps à reconstruire ou réparer la 3D.

==================================================
25. RAPPORT FINAL
==================================================

Produire :

1. état Supabase live ;
2. inventaire localStorage avant/après ;
3. données conservées localement ;
4. données migrées ;
5. données supprimées ;
6. WorkspaceStore final ;
7. architecture persisted/runtime ;
8. tests ;
9. performances ;
10. régressions éventuelles ;
11. dette restante ;
12. recommandation prochaine phase.

Matrice :

| Donnée | Avant | Après | Source de vérité |
|---|---|---|---|
| Examinations | local + DB | DB | Supabase |
| Images | local + Storage | Storage | Supabase |
| Annotations | local + DB | DB | Supabase |
| Measurements | local + DB | DB | Supabase |
| AI Runs | local + DB | DB | Supabase |
| Reports | local + DB | DB | Supabase |
| Undo/Redo | mémoire | mémoire | Local |
| Clipboard | mémoire | mémoire | Local |
| Theme | local | local | Local |
| Recent files | local | local/cache | Local |
| AI runtime | mémoire | mémoire | Local |
| Workspace runtime | mémoire + duplications | mémoire | Backend |

==================================================
RÈGLE FINALE
==================================================

Cette phase doit être considérée comme une PHASE DE CONSOLIDATION.

NE PAS ajouter une nouvelle modalité.

NE PAS ajouter une nouvelle IA.

NE PAS commencer DeepFetal anomaly.

NE PAS commencer RAG.

NE PAS commencer PACS.

NE PAS commencer production deployment.

Lorsque la persistance est consolidée :

ARRÊTE-TOI.

Présente le rapport final Phase Database 9.