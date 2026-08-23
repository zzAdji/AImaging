-- ============================================================================
-- AIMAGING · Phase Database 2 · Fondation Supabase
-- 0002_core_tables.sql
--
-- Tables métier cœur : profiles → workspaces → examinations → examination_images.
-- L'ordre de création respecte les dépendances de clés étrangères
-- (aucune FK ne référence une table pas encore créée, FONDATION.md §5).
--
-- Règle absolue (FONDATION.md §10) : AUCUN binaire d'image en base.
-- Pas de data URL, pas de base64, pas de pixel buffer, pas de bytea.
-- Seul `examination_images.storage_path` pointe vers le bucket privé Storage.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- PROFILES (FONDATION.md §7)
--
-- L'email n'est PAS dupliqué : auth.users.email reste la source de vérité.
-- Tout champ email éventuel serait une copie informative d'affichage uniquement.
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
    id             uuid primary key references auth.users (id) on delete cascade,
    display_name   text,
    ui_preferences jsonb not null default '{}'::jsonb,
    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now()
);

-- Création automatique du profile à la création d'un utilisateur Supabase Auth.
-- Le trigger est posé dès maintenant mais le workflow de login frontend
-- reste hors périmètre de cette phase (FONDATION.md §7 / §19).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    insert into public.profiles (id)
    values (new.id)
    on conflict (id) do nothing;
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row
    execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- WORKSPACES (FONDATION.md §8)
-- ----------------------------------------------------------------------------
create table if not exists public.workspaces (
    id         uuid primary key default gen_random_uuid(),
    owner_id   uuid not null references public.profiles (id) on delete cascade,
    name       text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_workspaces_owner_id
    on public.workspaces (owner_id);

-- ----------------------------------------------------------------------------
-- EXAMINATIONS (FONDATION.md §9)
--
-- Une seule table partagée par toutes les modalités : PAS de
-- radiography_examinations ni de fetal_examinations séparées.
--
-- Modalité en text + CHECK nommé (et non ENUM PostgreSQL rigide) : ajouter une
-- modalité future se fera par une simple recréation de la contrainte.
-- `unknown` est accepté pour couvrir les données historiques sans modalité
-- canonique (cf. normalizeModalityId côté client).
-- ----------------------------------------------------------------------------
create table if not exists public.examinations (
    id             uuid primary key default gen_random_uuid(),
    workspace_id   uuid not null references public.workspaces (id) on delete cascade,
    legacy_id      text unique,
    name           text not null,
    modality       text not null,
    archived       boolean not null default false,
    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now(),
    last_opened_at timestamptz,
    constraint examinations_modality_check
        check (modality in ('radiography', 'fetal_ultrasound', 'unknown')),
    constraint examinations_name_not_empty_check
        check (length(trim(name)) > 0)
);

create index if not exists idx_examinations_workspace_id
    on public.examinations (workspace_id);
create index if not exists idx_examinations_workspace_last_opened
    on public.examinations (workspace_id, last_opened_at desc);

-- ----------------------------------------------------------------------------
-- EXAMINATION_IMAGES (FONDATION.md §10 / §11)
--
-- Les métadonnées DICOM variables (StudyInstanceUID, SeriesInstanceUID,
-- SOPInstanceUID, FrameOfReferenceUID, patientPseudonym pseudonymisé,
-- pixelSpacingMm, bodyPartExamined, viewPosition, rows, columns…) vivent dans
-- le JSONB `metadata`, conformément au comportement sécurisé déjà établi par
-- server/dicom_service.py : aucun identifiant patient brut n'est stocké comme
-- donnée métier relationnelle.
--
-- `storage_path` est NULL pendant la coexistence avec localStorage : l'image
-- peut rester locale tant que la migration progressive n'a pas eu lieu.
-- ----------------------------------------------------------------------------
create table if not exists public.examination_images (
    id             uuid primary key default gen_random_uuid(),
    examination_id uuid not null references public.examinations (id) on delete cascade,
    legacy_id      text unique,
    filename       text not null,
    storage_path   text,
    mime_type      text,
    width          integer,
    height         integer,
    sort_order     integer not null default 0,
    source_kind    text,
    metadata       jsonb not null default '{}'::jsonb,
    display_state  jsonb not null default '{}'::jsonb,
    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now(),
    constraint examination_images_source_kind_check
        check (source_kind in ('browser-image', 'dicom', 'unknown')),
    constraint examination_images_width_positive_check
        check (width is null or width > 0),
    constraint examination_images_height_positive_check
        check (height is null or height > 0),
    constraint examination_images_sort_order_non_negative_check
        check (sort_order >= 0)
);

create index if not exists idx_examination_images_exam_sort
    on public.examination_images (examination_id, sort_order);

-- ----------------------------------------------------------------------------
-- Triggers `updated_at` communs (FONDATION.md §17), fonction définie en 0001.
-- ----------------------------------------------------------------------------
create trigger set_updated_at_profiles
    before update on public.profiles
    for each row
    execute function public.set_updated_at();

create trigger set_updated_at_workspaces
    before update on public.workspaces
    for each row
    execute function public.set_updated_at();

create trigger set_updated_at_examinations
    before update on public.examinations
    for each row
    execute function public.set_updated_at();

create trigger set_updated_at_examination_images
    before update on public.examination_images
    for each row
    execute function public.set_updated_at();

