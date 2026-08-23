-- ============================================================================
-- AIMAGING · Phase Database 2 · Fondation Supabase
-- 0004_rls.sql
--
-- Row Level Security sur les 9 tables applicatives.
--
-- Principe (FONDATION.md §19/§20) :
--   auth.uid() → profiles.id → workspaces.owner_id → données enfants
--
-- IMPORTANT : l'authentification frontend n'est PAS encore implémentée.
-- Ces policies décrivent la cible finale ; aucun composant UI existant ne doit
-- devenir dépendant de Supabase pendant cette phase.
--
-- Toutes les policies sont `to authenticated` : la clé anon seule ne donne
-- accès à rien. INSERT/UPDATE portent un WITH CHECK cohérent ; DELETE respecte
-- la même appartenance. Un utilisateur ne peut jamais écrire dans le workspace
-- d'un autre en envoyant un UUID arbitraire.
-- ============================================================================

alter table public.profiles              enable row level security;
alter table public.workspaces            enable row level security;
alter table public.examinations          enable row level security;
alter table public.examination_images    enable row level security;
alter table public.annotations           enable row level security;
alter table public.analysis_runs         enable row level security;
alter table public.classification_results enable row level security;
alter table public.measurements          enable row level security;
alter table public.reports               enable row level security;

-- ----------------------------------------------------------------------------
-- Helper d'appartenance (FONDATION.md §19)
--
-- security definer + search_path vide : la fonction contourne RLS sur
-- workspaces pour répondre « cet espace m'appartient-il ? » sans récursion de
-- policies. Tous les objets sont référencés explicitement via `public.`
-- car le search_path est volontairement vide.
-- ----------------------------------------------------------------------------
create or replace function public.owns_workspace(ws_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
        from public.workspaces w
        where w.id = ws_id
          and w.owner_id = auth.uid()
    );
$$;

-- ----------------------------------------------------------------------------
-- PROFILES
-- ----------------------------------------------------------------------------
create policy profiles_select_own on public.profiles
    for select to authenticated
    using (id = auth.uid());

create policy profiles_insert_own on public.profiles
    for insert to authenticated
    with check (id = auth.uid());

create policy profiles_update_own on public.profiles
    for update to authenticated
    using (id = auth.uid())
    with check (id = auth.uid());

create policy profiles_delete_own on public.profiles
    for delete to authenticated
    using (id = auth.uid());

-- ----------------------------------------------------------------------------
-- WORKSPACES
-- ----------------------------------------------------------------------------
create policy workspaces_select_own on public.workspaces
    for select to authenticated
    using (owner_id = auth.uid());

create policy workspaces_insert_own on public.workspaces
    for insert to authenticated
    with check (owner_id = auth.uid());

create policy workspaces_update_own on public.workspaces
    for update to authenticated
    using (owner_id = auth.uid())
    with check (owner_id = auth.uid());

create policy workspaces_delete_own on public.workspaces
    for delete to authenticated
    using (owner_id = auth.uid());

-- ----------------------------------------------------------------------------
-- EXAMINATIONS — appartenance via owns_workspace(workspace_id)
-- ----------------------------------------------------------------------------
create policy examinations_select_own on public.examinations
    for select to authenticated
    using (public.owns_workspace(workspace_id));

create policy examinations_insert_own on public.examinations
    for insert to authenticated
    with check (public.owns_workspace(workspace_id));

create policy examinations_update_own on public.examinations
    for update to authenticated
    using (public.owns_workspace(workspace_id))
    with check (public.owns_workspace(workspace_id));

create policy examinations_delete_own on public.examinations
    for delete to authenticated
    using (public.owns_workspace(workspace_id));

-- ----------------------------------------------------------------------------
-- EXAMINATION_IMAGES — appartenance via l'examen parent
-- ----------------------------------------------------------------------------
create policy examination_images_select_own on public.examination_images
    for select to authenticated
    using (
        exists (
            select 1 from public.examinations e
            where e.id = examination_id
              and public.owns_workspace(e.workspace_id)
        )
    );

create policy examination_images_insert_own on public.examination_images
    for insert to authenticated
    with check (
        exists (
            select 1 from public.examinations e
            where e.id = examination_id
              and public.owns_workspace(e.workspace_id)
        )
    );

create policy examination_images_update_own on public.examination_images
    for update to authenticated
    using (
        exists (
            select 1 from public.examinations e
            where e.id = examination_id
              and public.owns_workspace(e.workspace_id)
        )
    )
    with check (
        exists (
            select 1 from public.examinations e
            where e.id = examination_id
              and public.owns_workspace(e.workspace_id)
        )
    );

create policy examination_images_delete_own on public.examination_images
    for delete to authenticated
    using (
        exists (
            select 1 from public.examinations e
            where e.id = examination_id
              and public.owns_workspace(e.workspace_id)
        )
    );

-- ----------------------------------------------------------------------------
-- ANNOTATIONS — appartenance via image → examen → workspace
-- ----------------------------------------------------------------------------
create policy annotations_select_own on public.annotations
    for select to authenticated
    using (
        exists (
            select 1
            from public.examination_images i
            join public.examinations e on e.id = i.examination_id
            where i.id = image_id
              and public.owns_workspace(e.workspace_id)
        )
    );

create policy annotations_insert_own on public.annotations
    for insert to authenticated
    with check (
        exists (
            select 1
            from public.examination_images i
            join public.examinations e on e.id = i.examination_id
            where i.id = image_id
              and public.owns_workspace(e.workspace_id)
        )
    );

create policy annotations_update_own on public.annotations
    for update to authenticated
    using (
        exists (
            select 1
            from public.examination_images i
            join public.examinations e on e.id = i.examination_id
            where i.id = image_id
              and public.owns_workspace(e.workspace_id)
        )
    )
    with check (
        exists (
            select 1
            from public.examination_images i
            join public.examinations e on e.id = i.examination_id
            where i.id = image_id
              and public.owns_workspace(e.workspace_id)
        )
    );

create policy annotations_delete_own on public.annotations
    for delete to authenticated
    using (
        exists (
            select 1
            from public.examination_images i
            join public.examinations e on e.id = i.examination_id
            where i.id = image_id
              and public.owns_workspace(e.workspace_id)
        )
    );

-- ----------------------------------------------------------------------------
-- ANALYSIS_RUNS — appartenance via l'examen parent
-- ----------------------------------------------------------------------------
create policy analysis_runs_select_own on public.analysis_runs
    for select to authenticated
    using (public.owns_workspace(workspace_id));

create policy analysis_runs_insert_own on public.analysis_runs
    for insert to authenticated
    with check (public.owns_workspace(workspace_id));

create policy analysis_runs_update_own on public.analysis_runs
    for update to authenticated
    using (public.owns_workspace(workspace_id))
    with check (public.owns_workspace(workspace_id));

create policy analysis_runs_delete_own on public.analysis_runs
    for delete to authenticated
    using (public.owns_workspace(workspace_id));

-- ----------------------------------------------------------------------------
-- CLASSIFICATION_RESULTS — appartenance via analysis_run → examen → workspace
-- ----------------------------------------------------------------------------
create policy classification_results_select_own on public.classification_results
    for select to authenticated
    using (
        exists (
            select 1
            from public.analysis_runs ar
            where ar.id = analysis_run_id
              and public.owns_workspace(ar.workspace_id)
        )
    );

create policy classification_results_insert_own on public.classification_results
    for insert to authenticated
    with check (
        exists (
            select 1
            from public.analysis_runs ar
            where ar.id = analysis_run_id
              and public.owns_workspace(ar.workspace_id)
        )
    );

create policy classification_results_update_own on public.classification_results
    for update to authenticated
    using (
        exists (
            select 1
            from public.analysis_runs ar
            where ar.id = analysis_run_id
              and public.owns_workspace(ar.workspace_id)
        )
    )
    with check (
        exists (
            select 1
            from public.analysis_runs ar
            where ar.id = analysis_run_id
              and public.owns_workspace(ar.workspace_id)
        )
    );

create policy classification_results_delete_own on public.classification_results
    for delete to authenticated
    using (
        exists (
            select 1
            from public.analysis_runs ar
            where ar.id = analysis_run_id
              and public.owns_workspace(ar.workspace_id)
        )
    );

-- ----------------------------------------------------------------------------
-- MEASUREMENTS — appartenance par N'IMPORTE QUEL chemin parent détenu
-- (image, run d'analyse ou annotation).
--
-- WITH CHECK : au moins un chemin doit appartenir à l'utilisateur — il est
-- impossible de créer une mesure rattachée aux données d'un autre utilisateur,
-- ni une mesure orpheline (sans aucun parent) via l'API PostgREST.
-- ----------------------------------------------------------------------------
create policy measurements_select_own on public.measurements
    for select to authenticated
    using (
        exists (
            select 1
            from public.examination_images i
            join public.examinations e on e.id = i.examination_id
            where i.id = image_id
              and public.owns_workspace(e.workspace_id)
        )
        or exists (
            select 1 from public.analysis_runs ar
            where ar.id = analysis_run_id
              and public.owns_workspace(ar.workspace_id)
        )
    );

create policy measurements_insert_own on public.measurements
    for insert to authenticated
    with check (
        exists (
            select 1
            from public.examination_images i
            join public.examinations e on e.id = i.examination_id
            where i.id = image_id
              and public.owns_workspace(e.workspace_id)
        )
    );

create policy measurements_update_own on public.measurements
    for update to authenticated
    using (
        exists (
            select 1
            from public.examination_images i
            join public.examinations e on e.id = i.examination_id
            where i.id = image_id
              and public.owns_workspace(e.workspace_id)
        )
    )
    with check (
        exists (
            select 1
            from public.examination_images i
            join public.examinations e on e.id = i.examination_id
            where i.id = image_id
              and public.owns_workspace(e.workspace_id)
        )
    );

create policy measurements_delete_own on public.measurements
    for delete to authenticated
    using (
        exists (
            select 1
            from public.examination_images i
            join public.examinations e on e.id = i.examination_id
            where i.id = image_id
              and public.owns_workspace(e.workspace_id)
        )
    );

-- ----------------------------------------------------------------------------
-- REPORTS — appartenance via l'examen parent
-- ----------------------------------------------------------------------------
create policy reports_select_own on public.reports
    for select to authenticated
    using (public.owns_workspace(workspace_id));

create policy reports_insert_own on public.reports
    for insert to authenticated
    with check (public.owns_workspace(workspace_id));

create policy reports_update_own on public.reports
    for update to authenticated
    using (public.owns_workspace(workspace_id))
    with check (public.owns_workspace(workspace_id));

create policy reports_delete_own on public.reports
    for delete to authenticated
    using (public.owns_workspace(workspace_id));



