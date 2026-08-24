-- ============================================================================
-- AIMAGING · Correction validation live (CORRECTION.md §5-§8)
-- 0006_storage_policies_owner.sql
--
-- Remplace les policies storage « chemin seul » par un contrôle principal
-- owner_id = auth.uid() (requis par le flux upsert : INSERT+UPDATE+SELECT),
-- complété pour INSERT par la cohérence métier du chemin
-- {user}/{workspace}/{examination}/... sans dépendre d'examination_images
-- (aucune dépendance circulaire : l'upload peut précéder/créer le record).
--
-- Idempotent : drop if exists des anciennes policies avant création.
-- Buckets toujours PRIVÉS ; aucun service_role ; RLS intacte.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Nettoyage des policies héritées de 0005 (noms RÉELS créés par 0005).
--
-- BUG CORRIGÉ ICI : les anciens DROP visaient des noms *_own_folder qui
-- n'ont jamais existé (0005 crée aimaging_medical_images_*, etc.).
-- Ces DROP ne supprimaient donc RIEN : les 12 policies de 0005 restaient
-- actives EN PLUS des 4 nouvelles policies de ce fichier. Or Postgres RLS
-- combine plusieurs policies permissives pour la même opération avec un OR
-- logique : il suffisait qu'UNE SEULE des deux générations de policies
-- autorise l'accès pour que la requête passe, quel que soit owner_id.
-- ----------------------------------------------------------------------------
drop policy if exists aimaging_medical_images_select on storage.objects;
drop policy if exists aimaging_medical_images_insert on storage.objects;
drop policy if exists aimaging_medical_images_update on storage.objects;
drop policy if exists aimaging_medical_images_delete on storage.objects;

drop policy if exists aimaging_analysis_artifacts_select on storage.objects;
drop policy if exists aimaging_analysis_artifacts_insert on storage.objects;
drop policy if exists aimaging_analysis_artifacts_update on storage.objects;
drop policy if exists aimaging_analysis_artifacts_delete on storage.objects;

drop policy if exists aimaging_reports_select on storage.objects;
drop policy if exists aimaging_reports_insert on storage.objects;
drop policy if exists aimaging_reports_update on storage.objects;
drop policy if exists aimaging_reports_delete on storage.objects;

-- Idempotence en cas de ré-exécution de ce fichier lui-même.
drop policy if exists storage_insert_own on storage.objects;
drop policy if exists storage_select_own on storage.objects;
drop policy if exists storage_update_own on storage.objects;
drop policy if exists storage_delete_own on storage.objects;

-- ----------------------------------------------------------------------------
-- INSERT : bucket correct + premier segment = auth.uid() + cohérence métier
-- workspaces/examinations (medical-images) ; pour analysis-artifacts et
-- reports, la profondeur supplémentaire (image/report) reste vérifiée par le
-- préfixe utilisateur et l'appartenance workspace/examination.
-- ----------------------------------------------------------------------------
create policy storage_insert_own on storage.objects
    for insert to authenticated
    with check (
        bucket_id in ('medical-images', 'analysis-artifacts', 'reports')
        and owner_id = auth.uid()
        and (storage.foldername(name))[1] = auth.uid()::text
        and exists (
            select 1
            from public.workspaces w
            join public.examinations e on e.workspace_id = w.id
            where w.owner_id = auth.uid()
              and w.id = (storage.foldername(name))[2]::uuid
              and e.id = (storage.foldername(name))[3]::uuid
        )
    );

-- ----------------------------------------------------------------------------
-- SELECT : propriétaire de l'objet (couvre le retour de métadonnées après
-- upsert et le téléchargement privé) ; défense en profondeur sur le segment 1.
-- ----------------------------------------------------------------------------
create policy storage_select_own on storage.objects
    for select to authenticated
    using (
        bucket_id in ('medical-images', 'analysis-artifacts', 'reports')
        and owner_id = auth.uid()
        and (storage.foldername(name))[1] = auth.uid()::text
    );

-- ----------------------------------------------------------------------------
-- UPDATE / DELETE : contrôle principal owner_id = auth.uid()
-- (condition nécessaire au fonctionnement de upsert:true, CORRECTION.md §7)
-- ----------------------------------------------------------------------------
create policy storage_update_own on storage.objects
    for update to authenticated
    using (
        bucket_id in ('medical-images', 'analysis-artifacts', 'reports')
        and owner_id = auth.uid()
    )
    with check (
        bucket_id in ('medical-images', 'analysis-artifacts', 'reports')
        and owner_id = auth.uid()
    );

create policy storage_delete_own on storage.objects
    for delete to authenticated
    using (
        bucket_id in ('medical-images', 'analysis-artifacts', 'reports')
        and owner_id = auth.uid()
    );