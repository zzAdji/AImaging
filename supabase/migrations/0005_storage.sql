-- ============================================================================
-- AIMAGING · Phase Database 2 · Fondation Supabase
-- 0005_storage.sql
--
-- Buckets PRIVÉS de Supabase Storage (FONDATION.md §21/§22) :
--   medical-images      → fichiers images sources des examens
--   analysis-artifacts  → heatmaps Grad-CAM, segmentations, landmarks, PNG
--                         standardisés opencxr (PAS de reconstruction 3D :
--                         la 3D est hors périmètre, FONDATION.md §2)
--   reports             → exports de rapports
--
-- Créés et versionnés via migration SQL : aucune configuration manuelle
-- non versionnée depuis le Dashboard.
--
-- Arborescence cible (premier segment = user_id, utilisé par les policies) :
--   medical-images/{user_id}/{workspace_id}/{examination_id}/images/{image_id}/{filename}
--   analysis-artifacts/{user_id}/{workspace_id}/{examination_id}/{image_id}/{analysis_run_id}/
--       gradcam/ | segmentation/ | landmarks/ | standardized/
--   reports/{user_id}/{workspace_id}/{examination_id}/{report_id}/exports/
-- ============================================================================

insert into storage.buckets (id, name, public)
values
    ('medical-images', 'medical-images', false),
    ('analysis-artifacts', 'analysis-artifacts', false),
    ('reports', 'reports', false)
on conflict (id) do update set public = excluded.public;

-- ----------------------------------------------------------------------------
-- Policies Storage : l'utilisateur n'accède qu'aux objets dont le premier
-- segment du chemin est son propre user_id. Buckets privés, accès réservé au
-- rôle `authenticated` ; jamais service_role côté client.
-- L'accès applicatif passera par signed URLs ou par le serveur si nécessaire.
-- ----------------------------------------------------------------------------
create policy aimaging_storage_select_own_folder
    on storage.objects for select to authenticated
    using (
        bucket_id in ('medical-images', 'analysis-artifacts', 'reports')
        and (storage.foldername(name))[1] = auth.uid()::text
    );

create policy aimaging_storage_insert_own_folder
    on storage.objects for insert to authenticated
    with check (
        bucket_id in ('medical-images', 'analysis-artifacts', 'reports')
        and (storage.foldername(name))[1] = auth.uid()::text
    );

create policy aimaging_storage_update_own_folder
    on storage.objects for update to authenticated
    using (
        bucket_id in ('medical-images', 'analysis-artifacts', 'reports')
        and (storage.foldername(name))[1] = auth.uid()::text
    )
    with check (
        bucket_id in ('medical-images', 'analysis-artifacts', 'reports')
        and (storage.foldername(name))[1] = auth.uid()::text
    );

create policy aimaging_storage_delete_own_folder
    on storage.objects for delete to authenticated
    using (
        bucket_id in ('medical-images', 'analysis-artifacts', 'reports')
        and (storage.foldername(name))[1] = auth.uid()::text
    );
