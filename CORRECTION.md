# AIMAGING — CORRECTION DES TESTS LIVE RLS + STORAGE
#
# IMPORTANT :
# Ceci n'est PAS une nouvelle phase Database.
# C'est une correction de validation des phases précédentes.
#
# Les tests live ont maintenant révélé :
#
# ✅ AUTH
# ✅ profiles/workspaces CRUD
# ✅ annotations CRUD USER A
# ✅ analysis_runs CRUD USER A
#
# ❌ RLS UPDATE tests incorrectement formulés
# ❌ Storage upload/upsert
# ❌ Storage isolation delete USER B
# ❌ Reports export Storage
#
# NE PAS passer à une nouvelle phase tant que ces problèmes
# ne sont pas résolus.

==================================================
1. PROBLÈME RLS UPDATE — TESTS
==================================================

Les tests actuels supposent :

USER B UPDATE donnée USER A
→ error != null

Ceci est incorrect avec PostgreSQL RLS.

Une ligne non autorisée peut simplement être filtrée,
avec :

error = null
rows = 0

MISSION :

Modifier les tests live pour vérifier :

1. USER B tente UPDATE
2. la requête ne produit aucune modification
3. relecture par USER A
4. la donnée originale est inchangée

Pour annotations :

USER A :
visible = true

USER B :
UPDATE visible = false

Puis USER A :
SELECT

Résultat attendu :

visible = true

Même chose pour analysis_runs :

USER A :
status = running

USER B :
UPDATE status = done

Puis USER A :
SELECT

Résultat attendu :

status = running

IMPORTANT :

NE PAS affaiblir les RLS pour obtenir une erreur SQL.

==================================================
2. ANALYSER LES POLICIES STORAGE RÉELLES
==================================================

Avant toute modification, exécuter dans Supabase :

select
    policyname,
    cmd,
    roles,
    qual,
    with_check
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
order by policyname;

Présenter les policies réellement présentes.

NE PAS supposer que le repository local reflète exactement
les policies déjà appliquées dans Supabase.

Chercher notamment d'anciennes policies génériques.

==================================================
3. ANALYSER STORAGE.OBJECTS
==================================================

Vérifier :

select
    id,
    bucket_id,
    name,
    owner_id
from storage.objects
where bucket_id in (
    'medical-images',
    'analysis-artifacts',
    'reports'
)
order by created_at desc
limit 20;

Vérifier que les fichiers créés avec un utilisateur authentifié
possèdent bien owner_id.

Ne modifier aucune donnée existante manuellement.

==================================================
4. PROBLÈME UPLOAD / UPSERT
==================================================

Le test actuel utilise :

upload(path, file, { upsert: true })

Supabase indique qu'un upsert nécessite :
SELECT + INSERT + UPDATE sur storage.objects.

Le système doit donc être compatible avec cet usage.

MISSION :

Vérifier pourquoi l'UPDATE ou le SELECT policy bloque le nouvel objet.

==================================================
5. NOUVELLE STRATÉGIE STORAGE
==================================================

Utiliser :

owner_id = auth.uid()

comme contrôle principal pour les opérations
UPDATE et DELETE sur les objets Storage.

Pour SELECT :

autoriser uniquement les objets appartenant à l'utilisateur
ou dont le chemin appartient explicitement à son workspace/examen.

Pour INSERT :

vérifier :

1. bucket correct
2. premier segment = auth.uid()
3. workspace_id appartient à auth.uid()
4. examination_id appartient à ce workspace

IMPORTANT :

NE PAS exiger examination_images pour INSERT.

Le flux d'upload peut être :

create examination_image
+
upload storage
+
update storage_path

ou :

upload storage
+
create examination_image

selon ce que révèle le code réel.

Mais la policy INSERT ne doit pas créer de dépendance circulaire
impossible à satisfaire.

==================================================
6. MEDICAL-IMAGES
==================================================

Structure :

{user_id}/
{workspace_id}/
{examination_id}/
images/
{image_id}/
{filename}

INSERT :

- authenticated
- user_id = auth.uid()
- workspace appartient à auth.uid()
- examination appartient au workspace

SELECT :

- authenticated
- propriétaire / workspace autorisé

UPDATE :

- owner_id = auth.uid()

DELETE :

- owner_id = auth.uid()

Ne pas rendre le bucket public.

==================================================
7. ANALYSIS-ARTIFACTS
==================================================

Structure :

{user_id}/
{workspace_id}/
{examination_id}/
{image_id}/
{analysis_run_id}/
{artifact_type}/
{filename}

INSERT :

- user_id correct
- workspace correct
- examination correcte
- analysis_run correspondant

Mais UPDATE/DELETE :

principalement owner_id = auth.uid()

afin de permettre le fonctionnement de upsert.

==================================================
8. REPORTS
==================================================

Structure :

{user_id}/
{workspace_id}/
{examination_id}/
{report_id}/
exports/
{filename}

INSERT :

- user_id correct
- workspace correct
- examination correcte
- report correspondant

UPDATE/DELETE :

owner_id = auth.uid()

SELECT :

propriétaire + relation métier.

==================================================
9. SUPABASE STORAGE UPLOAD
==================================================

NE PAS changer les buckets en public.

NE PAS utiliser service_role.

NE PAS désactiver RLS.

Le test doit pouvoir fonctionner :

await storage
  .from("medical-images")
  .upload(path, file, {
      upsert: true
  });

Si upsert est réellement inutile dans le cas d'un nouvel upload,
il est possible d'utiliser :

upsert: false

mais seulement si cela reste compatible avec le repository
et la logique de remplacement actuelle.

NE PAS modifier ce comportement uniquement pour cacher un problème
de policy.

==================================================
10. STORAGE SELECT APRÈS INSERT
==================================================

Comme Supabase doit pouvoir retourner les métadonnées de l'objet
créé, vérifier que la SELECT policy autorise le nouvel objet.

Tester :

USER A
→ upload
→ upload response OK
→ download
→ delete

==================================================
11. TEST D'ISOLATION USER B
==================================================

USER A :

upload pathA

USER B :

download(pathA)

Résultat attendu :

échec / denied

USER B :

remove(pathA)

Résultat attendu :

denied

Important :

Ne pas utiliser seulement l'objet Storage localement.

Vérifier réellement l'état de Storage.

==================================================
12. REPORT EXPORT
==================================================

Le test report doit réussir :

create report DB
↓
upload JSON
↓
download JSON
↓
delete report

L'upload doit respecter la même logique Storage.

==================================================
13. TESTS RLS TABLES
==================================================

Pour UPDATE des ressources A par B :

NE PAS exiger `error != null`.

Tester :

update B
→ aucun changement effectif

Puis :

select A
→ valeur originale intacte.

À appliquer sur :

annotations
analysis_runs
reports

==================================================
14. TESTS FINAUX
==================================================

Exécuter exactement :

1. AUTH
2. annotations CRUD
3. analysis_runs CRUD
4. reports CRUD
5. images Storage
6. RLS annotation/measure
7. RLS analysis_runs
8. Storage isolation

Objectif :

8 / 8 PASS.

==================================================
15. NON-RÉGRESSION
==================================================

Après correction :

vitest
npm run build
pytest

Les 6 problèmes DICOM préexistants doivent rester
identifiés séparément.

==================================================
16. RAPPORT
==================================================

Produire :

- policies Storage avant ;
- cause exacte ;
- policies Storage après ;
- tests RLS avant/après ;
- tests Storage avant/après ;
- preuve que USER B ne peut pas accéder/supprimer
  les objets USER A ;
- éventuelles migrations SQL créées ;
- fichiers modifiés.

NE COMMENCE AUCUNE AUTRE PHASE.

ARRÊTE-TOI lorsque tous les tests live pertinents passent.