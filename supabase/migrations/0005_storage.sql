-- ============================================================================
-- AIMAGING · Phase Database 2 · Fondation Supabase
-- 0005_storage.sql
--
-- Buckets privés :
--   medical-images
--   analysis-artifacts
--   reports
--
-- Le chemin commence toujours par :
--   {user_id}/...
--
-- Les policies vérifient également l'appartenance au workspace/examen
-- lorsque cela est pertinent.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- BUCKETS
-- ----------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values
    ('medical-images', 'medical-images', false),
    ('analysis-artifacts', 'analysis-artifacts', false),
    ('reports', 'reports', false)
on conflict (id) do update
set public = false;


-- ============================================================================
-- MEDICAL IMAGES
--
-- Structure :
--
-- medical-images/
--   {user_id}/
--     {workspace_id}/
--       {examination_id}/
--         images/
--           {image_id}/
--             {filename}
-- ============================================================================


create policy aimaging_medical_images_select
on storage.objects
for select
to authenticated
using (
    bucket_id = 'medical-images'

    and (storage.foldername(name))[1] = auth.uid()::text

    and exists (
        select 1
        from public.workspaces w
        where w.id =
              nullif((storage.foldername(name))[2], '')::uuid
          and w.owner_id = auth.uid()
    )

    and exists (
        select 1
        from public.examinations e
        where e.id =
              nullif((storage.foldername(name))[3], '')::uuid
          and e.workspace_id =
              nullif((storage.foldername(name))[2], '')::uuid
    )

    and exists (
        select 1
        from public.examination_images ei
        where ei.id =
              nullif((storage.foldername(name))[5], '')::uuid
          and ei.examination_id =
              nullif((storage.foldername(name))[3], '')::uuid
    )
);


create policy aimaging_medical_images_insert
on storage.objects
for insert
to authenticated
with check (
    bucket_id = 'medical-images'

    and (storage.foldername(name))[1] = auth.uid()::text

    and exists (
        select 1
        from public.workspaces w
        where w.id =
              nullif((storage.foldername(name))[2], '')::uuid
          and w.owner_id = auth.uid()
    )

    and exists (
        select 1
        from public.examinations e
        where e.id =
              nullif((storage.foldername(name))[3], '')::uuid
          and e.workspace_id =
              nullif((storage.foldername(name))[2], '')::uuid
    )

    and exists (
        select 1
        from public.examination_images ei
        where ei.id =
              nullif((storage.foldername(name))[5], '')::uuid
          and ei.examination_id =
              nullif((storage.foldername(name))[3], '')::uuid
    )
);


create policy aimaging_medical_images_update
on storage.objects
for update
to authenticated
using (
    bucket_id = 'medical-images'

    and (storage.foldername(name))[1] = auth.uid()::text

    and exists (
        select 1
        from public.workspaces w
        where w.id =
              nullif((storage.foldername(name))[2], '')::uuid
          and w.owner_id = auth.uid()
    )

    and exists (
        select 1
        from public.examinations e
        where e.id =
              nullif((storage.foldername(name))[3], '')::uuid
          and e.workspace_id =
              nullif((storage.foldername(name))[2], '')::uuid
    )

    and exists (
        select 1
        from public.examination_images ei
        where ei.id =
              nullif((storage.foldername(name))[5], '')::uuid
          and ei.examination_id =
              nullif((storage.foldername(name))[3], '')::uuid
    )
)
with check (
    bucket_id = 'medical-images'

    and (storage.foldername(name))[1] = auth.uid()::text

    and exists (
        select 1
        from public.workspaces w
        where w.id =
              nullif((storage.foldername(name))[2], '')::uuid
          and w.owner_id = auth.uid()
    )

    and exists (
        select 1
        from public.examinations e
        where e.id =
              nullif((storage.foldername(name))[3], '')::uuid
          and e.workspace_id =
              nullif((storage.foldername(name))[2], '')::uuid
    )

    and exists (
        select 1
        from public.examination_images ei
        where ei.id =
              nullif((storage.foldername(name))[5], '')::uuid
          and ei.examination_id =
              nullif((storage.foldername(name))[3], '')::uuid
    )
);


create policy aimaging_medical_images_delete
on storage.objects
for delete
to authenticated
using (
    bucket_id = 'medical-images'

    and (storage.foldername(name))[1] = auth.uid()::text

    and exists (
        select 1
        from public.workspaces w
        where w.id =
              nullif((storage.foldername(name))[2], '')::uuid
          and w.owner_id = auth.uid()
    )

    and exists (
        select 1
        from public.examinations e
        where e.id =
              nullif((storage.foldername(name))[3], '')::uuid
          and e.workspace_id =
              nullif((storage.foldername(name))[2], '')::uuid
    )

    and exists (
        select 1
        from public.examination_images ei
        where ei.id =
              nullif((storage.foldername(name))[5], '')::uuid
          and ei.examination_id =
              nullif((storage.foldername(name))[3], '')::uuid
    )
);


-- ============================================================================
-- ANALYSIS ARTIFACTS
--
-- Structure :
--
-- analysis-artifacts/
--   {user_id}/
--     {workspace_id}/
--       {examination_id}/
--         {image_id}/
--           {analysis_run_id}/
--             gradcam/
--             segmentation/
--             landmarks/
--             standardized/
-- ============================================================================


create policy aimaging_analysis_artifacts_select
on storage.objects
for select
to authenticated
using (
    bucket_id = 'analysis-artifacts'

    and (storage.foldername(name))[1] = auth.uid()::text

    and exists (
        select 1
        from public.workspaces w
        where w.id =
              nullif((storage.foldername(name))[2], '')::uuid
          and w.owner_id = auth.uid()
    )

    and exists (
        select 1
        from public.examinations e
        where e.id =
              nullif((storage.foldername(name))[3], '')::uuid
          and e.workspace_id =
              nullif((storage.foldername(name))[2], '')::uuid
    )

    and exists (
        select 1
        from public.analysis_runs ar
        where ar.id =
              nullif((storage.foldername(name))[5], '')::uuid
          and ar.examination_id =
              nullif((storage.foldername(name))[3], '')::uuid
    )
);


create policy aimaging_analysis_artifacts_insert
on storage.objects
for insert
to authenticated
with check (
    bucket_id = 'analysis-artifacts'

    and (storage.foldername(name))[1] = auth.uid()::text

    and exists (
        select 1
        from public.workspaces w
        where w.id =
              nullif((storage.foldername(name))[2], '')::uuid
          and w.owner_id = auth.uid()
    )

    and exists (
        select 1
        from public.examinations e
        where e.id =
              nullif((storage.foldername(name))[3], '')::uuid
          and e.workspace_id =
              nullif((storage.foldername(name))[2], '')::uuid
    )

    and exists (
        select 1
        from public.analysis_runs ar
        where ar.id =
              nullif((storage.foldername(name))[5], '')::uuid
          and ar.examination_id =
              nullif((storage.foldername(name))[3], '')::uuid
    )
);


create policy aimaging_analysis_artifacts_update
on storage.objects
for update
to authenticated
using (
    bucket_id = 'analysis-artifacts'

    and (storage.foldername(name))[1] = auth.uid()::text

    and exists (
        select 1
        from public.workspaces w
        where w.id =
              nullif((storage.foldername(name))[2], '')::uuid
          and w.owner_id = auth.uid()
    )
)
with check (
    bucket_id = 'analysis-artifacts'

    and (storage.foldername(name))[1] = auth.uid()::text
);


create policy aimaging_analysis_artifacts_delete
on storage.objects
for delete
to authenticated
using (
    bucket_id = 'analysis-artifacts'

    and (storage.foldername(name))[1] = auth.uid()::text

    and exists (
        select 1
        from public.workspaces w
        where w.id =
              nullif((storage.foldername(name))[2], '')::uuid
          and w.owner_id = auth.uid()
    )
);


-- ============================================================================
-- REPORTS
--
-- Structure :
--
-- reports/
--   {user_id}/
--     {workspace_id}/
--       {examination_id}/
--         {report_id}/
--           exports/
-- ============================================================================


create policy aimaging_reports_select
on storage.objects
for select
to authenticated
using (
    bucket_id = 'reports'

    and (storage.foldername(name))[1] = auth.uid()::text

    and exists (
        select 1
        from public.workspaces w
        where w.id =
              nullif((storage.foldername(name))[2], '')::uuid
          and w.owner_id = auth.uid()
    )

    and exists (
        select 1
        from public.examinations e
        where e.id =
              nullif((storage.foldername(name))[3], '')::uuid
          and e.workspace_id =
              nullif((storage.foldername(name))[2], '')::uuid
    )

    and exists (
        select 1
        from public.reports r
        where r.id =
              nullif((storage.foldername(name))[4], '')::uuid
          and r.examination_id =
              nullif((storage.foldername(name))[3], '')::uuid
    )
);


create policy aimaging_reports_insert
on storage.objects
for insert
to authenticated
with check (
    bucket_id = 'reports'

    and (storage.foldername(name))[1] = auth.uid()::text

    and exists (
        select 1
        from public.workspaces w
        where w.id =
              nullif((storage.foldername(name))[2], '')::uuid
          and w.owner_id = auth.uid()
    )

    and exists (
        select 1
        from public.examinations e
        where e.id =
              nullif((storage.foldername(name))[3], '')::uuid
          and e.workspace_id =
              nullif((storage.foldername(name))[2], '')::uuid
    )

    and exists (
        select 1
        from public.reports r
        where r.id =
              nullif((storage.foldername(name))[4], '')::uuid
          and r.examination_id =
              nullif((storage.foldername(name))[3], '')::uuid
    )
);


create policy aimaging_reports_update
on storage.objects
for update
to authenticated
using (
    bucket_id = 'reports'

    and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
    bucket_id = 'reports'
    and (storage.foldername(name))[1] = auth.uid()::text
);


create policy aimaging_reports_delete
on storage.objects
for delete
to authenticated
using (
    bucket_id = 'reports'

    and (storage.foldername(name))[1] = auth.uid()::text

    and exists (
        select 1
        from public.workspaces w
        where w.id =
              nullif((storage.foldername(name))[2], '')::uuid
          and w.owner_id = auth.uid()
    )
);