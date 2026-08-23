-- ============================================================================
-- AIMAGING · Phase Database 2 · Fondation Supabase
-- supabase/seed.sql
--
-- ██████  DEV ONLY — NE JAMAIS UTILISER EN PRODUCTION  ██████
--
-- Seed minimal de développement (FONDATION.md §27) : un workspace, un examen
-- de test, une metadata d'image de test. AUCUNE donnée médicale réelle.
--
-- Le seed ne crée PAS d'utilisateur auth.users lui-même (insertion directe dans
-- auth.users étant dépendante de la version GoTrue). Il s'attache au premier
-- utilisateur existant et s'applique une seule fois par utilisateur.
-- Exécuté automatiquement par `supabase db reset`.
-- ============================================================================

do $$
declare
    dev_user_id        uuid;
    dev_workspace_id   uuid;
    dev_examination_id uuid;
begin
    select u.id into dev_user_id
    from auth.users u
    order by u.created_at
    limit 1;

    if dev_user_id is null then
        raise notice 'SEED DEV ONLY ignore : aucun utilisateur dans auth.users.';
        return;
    end if;

    if exists (
        select 1 from public.workspaces w
        where w.owner_id = dev_user_id and w.name = 'DEV - Espace de test'
    ) then
        raise notice 'SEED DEV ONLY deja applique pour cet utilisateur.';
        return;
    end if;

    insert into public.workspaces (owner_id, name)
    values (dev_user_id, 'DEV - Espace de test')
    returning id into dev_workspace_id;

    insert into public.examinations (workspace_id, legacy_id, name, modality)
    values (dev_workspace_id, 'dev-exam-0001', 'DEV - Examen de test', 'radiography')
    returning id into dev_examination_id;

    insert into public.examination_images (
        examination_id, legacy_id, filename, sort_order, source_kind
    )
    values (
        dev_examination_id, 'dev-image-0001', 'dev-image.png', 0, 'browser-image'
    );

    raise notice 'SEED DEV ONLY applique : workspace % / examen %.',
        dev_workspace_id, dev_examination_id;
end;
$$;
