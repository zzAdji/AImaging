-- ============================================================================
-- AIMAGING · Phase Report Engine
-- 0007_report_engine.sql
--
-- OBJECTIFS
--   1. organizations
--   2. report_templates
--   3. extension de reports
--   4. bucket privé org-assets
--   5. RLS organizations / report_templates
--   6. policies Storage pour logos/signatures
--
-- COMPATIBILITÉ
--   - rapports existants conservés
--   - colonnes nouvelles de reports nullable lorsque nécessaire
--   - aucun bucket public
--   - aucune service_role côté frontend
--   - 3D définitivement hors périmètre
--
-- PRÉREQUIS
--   0001_extensions_and_helpers.sql
--   0002_core_tables.sql
--   0003_analysis_tables.sql
--   0004_rls.sql
--   0005_storage.sql
--   0006_storage_policies_owner.sql
-- ============================================================================


-- ============================================================================
-- 0. ORGANIZATIONS
-- ============================================================================
--
-- Un utilisateur possède au maximum une organisation dans cette version
-- du prototype.
--
-- owner_id → profiles.id → auth.users.id
-- ============================================================================

create table if not exists public.organizations (
    id uuid primary key default gen_random_uuid(),

    owner_id uuid not null unique
        references public.profiles(id)
        on delete cascade,

    name text not null,

    address text,
    phone text,
    email text,
    website text,
    department text,

    logo_path text,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint organizations_name_not_empty_check
        check (length(trim(name)) > 0)
);


-- ----------------------------------------------------------------------------
-- Index
-- ----------------------------------------------------------------------------

create index if not exists idx_organizations_owner
    on public.organizations(owner_id);


-- ----------------------------------------------------------------------------
-- Trigger updated_at
-- ----------------------------------------------------------------------------

drop trigger if exists set_updated_at_organizations
on public.organizations;

create trigger set_updated_at_organizations
    before update on public.organizations
    for each row
    execute function public.set_updated_at();


-- ============================================================================
-- 1. REPORT TEMPLATES
-- ============================================================================

create table if not exists public.report_templates (
    id uuid primary key default gen_random_uuid(),

    owner_id uuid not null
        references public.profiles(id)
        on delete cascade,

    organization_id uuid
        references public.organizations(id)
        on delete set null,

    name text not null,

    modality text not null,

    version integer not null default 1,

    is_default boolean not null default false,

    language text not null default 'fr',

    template_data jsonb not null default '{}'::jsonb,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint report_templates_modality_check
        check (
            modality in (
                'radiography',
                'fetal_ultrasound',
                'generic'
            )
        ),

    constraint report_templates_language_check
        check (
            language in ('fr', 'en')
        ),

    constraint report_templates_name_not_empty_check
        check (
            length(trim(name)) > 0
        ),

    constraint report_templates_version_positive_check
        check (
            version > 0
        )
);


-- ----------------------------------------------------------------------------
-- Index
-- ----------------------------------------------------------------------------

create index if not exists idx_report_templates_owner_modality
    on public.report_templates(owner_id, modality);


create index if not exists idx_report_templates_organization
    on public.report_templates(organization_id);


-- ----------------------------------------------------------------------------
-- Un seul template par défaut pour une modalité et un propriétaire
-- ----------------------------------------------------------------------------

create unique index if not exists uq_report_templates_default_per_modality
    on public.report_templates(owner_id, modality)
    where is_default = true;


-- ----------------------------------------------------------------------------
-- Trigger updated_at
-- ----------------------------------------------------------------------------

drop trigger if exists set_updated_at_report_templates
on public.report_templates;

create trigger set_updated_at_report_templates
    before update on public.report_templates
    for each row
    execute function public.set_updated_at();


-- ============================================================================
-- 2. REPORTS — EXTENSION DU MODÈLE EXISTANT
-- ============================================================================
--
-- Les colonnes sont ajoutées avec une stratégie rétrocompatible.
-- Les anciens rapports restent valides.
-- ============================================================================

alter table public.reports
    add column if not exists template_id uuid
        references public.report_templates(id)
        on delete set null;

alter table public.reports
    add column if not exists template_version integer;

alter table public.reports
    add column if not exists language text not null default 'fr';

alter table public.reports
    add column if not exists organization_id uuid
        references public.organizations(id)
        on delete set null;

alter table public.reports
    add column if not exists validated_at timestamptz;

alter table public.reports
    add column if not exists validated_by uuid
        references auth.users(id)
        on delete set null;

alter table public.reports
    add column if not exists signature_name text;

alter table public.reports
    add column if not exists signature_role text;

alter table public.reports
    add column if not exists signature_path text;


-- ----------------------------------------------------------------------------
-- Contraintes ajoutées sur les nouvelles colonnes
--
-- PostgreSQL ne permet pas toujours un ADD CONSTRAINT IF NOT EXISTS.
-- On ajoute donc les contraintes seulement si elles n'existent pas encore,
-- via un bloc DO.
-- ----------------------------------------------------------------------------

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'reports_language_check'
          and conrelid = 'public.reports'::regclass
    ) then
        alter table public.reports
            add constraint reports_language_check
            check (language in ('fr', 'en'));
    end if;
end
$$;


do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'reports_template_version_positive_check'
          and conrelid = 'public.reports'::regclass
    ) then
        alter table public.reports
            add constraint reports_template_version_positive_check
            check (
                template_version is null
                or template_version > 0
            );
    end if;
end
$$;


-- ----------------------------------------------------------------------------
-- Index
-- ----------------------------------------------------------------------------

create index if not exists idx_reports_template
    on public.reports(template_id);

create index if not exists idx_reports_organization
    on public.reports(organization_id);

create index if not exists idx_reports_validated_by
    on public.reports(validated_by);


-- ============================================================================
-- 3. RLS — ORGANIZATIONS
-- ============================================================================

alter table public.organizations
    enable row level security;


drop policy if exists organizations_select_own
on public.organizations;

create policy organizations_select_own
on public.organizations
for select
to authenticated
using (
    owner_id = auth.uid()
);


drop policy if exists organizations_insert_own
on public.organizations;

create policy organizations_insert_own
on public.organizations
for insert
to authenticated
with check (
    owner_id = auth.uid()
);


drop policy if exists organizations_update_own
on public.organizations;

create policy organizations_update_own
on public.organizations
for update
to authenticated
using (
    owner_id = auth.uid()
)
with check (
    owner_id = auth.uid()
);


drop policy if exists organizations_delete_own
on public.organizations;

create policy organizations_delete_own
on public.organizations
for delete
to authenticated
using (
    owner_id = auth.uid()
);


-- ============================================================================
-- 4. RLS — REPORT TEMPLATES
-- ============================================================================

alter table public.report_templates
    enable row level security;


-- ----------------------------------------------------------------------------
-- SELECT
-- ----------------------------------------------------------------------------

drop policy if exists report_templates_select_own
on public.report_templates;

create policy report_templates_select_own
on public.report_templates
for select
to authenticated
using (
    owner_id = auth.uid()
);


-- ----------------------------------------------------------------------------
-- INSERT
--
-- On vérifie :
--   - owner_id = utilisateur courant
--   - si organization_id existe, l'organisation doit appartenir
--     au même utilisateur
-- ----------------------------------------------------------------------------

drop policy if exists report_templates_insert_own
on public.report_templates;

create policy report_templates_insert_own
on public.report_templates
for insert
to authenticated
with check (
    owner_id = auth.uid()

    and (
        organization_id is null
        or exists (
            select 1
            from public.organizations o
            where o.id = organization_id
              and o.owner_id = auth.uid()
        )
    )
);


-- ----------------------------------------------------------------------------
-- UPDATE
-- ----------------------------------------------------------------------------

drop policy if exists report_templates_update_own
on public.report_templates;

create policy report_templates_update_own
on public.report_templates
for update
to authenticated
using (
    owner_id = auth.uid()
)
with check (
    owner_id = auth.uid()

    and (
        organization_id is null
        or exists (
            select 1
            from public.organizations o
            where o.id = organization_id
              and o.owner_id = auth.uid()
        )
    )
);


-- ----------------------------------------------------------------------------
-- DELETE
-- ----------------------------------------------------------------------------

drop policy if exists report_templates_delete_own
on public.report_templates;

create policy report_templates_delete_own
on public.report_templates
for delete
to authenticated
using (
    owner_id = auth.uid()
);


-- ============================================================================
-- 5. ORG-ASSETS STORAGE BUCKET
-- ============================================================================
--
-- Stockage :
--
-- org-assets/
--   {user_id}/
--      logo/
--         ...
--      signatures/
--         ...
--
-- Le bucket est PRIVÉ.
-- ============================================================================

insert into storage.buckets (
    id,
    name,
    public
)
values (
    'org-assets',
    'org-assets',
    false
)
on conflict (id)
do update
set public = false;


-- ============================================================================
-- 6. ORG-ASSETS — INSERT
-- ============================================================================
--
-- owner_id de storage.objects est TEXT.
-- auth.uid() est UUID.
-- On utilise donc auth.uid()::text.
-- ============================================================================

drop policy if exists org_assets_insert_own
on storage.objects;

create policy org_assets_insert_own
on storage.objects
for insert
to authenticated
with check (
    bucket_id = 'org-assets'

    and owner_id = auth.uid()::text

    and
    (storage.foldername(storage.objects.name))[1]
        = auth.uid()::text
);


-- ============================================================================
-- 7. ORG-ASSETS — SELECT
-- ============================================================================

drop policy if exists org_assets_select_own
on storage.objects;

create policy org_assets_select_own
on storage.objects
for select
to authenticated
using (
    bucket_id = 'org-assets'

    and owner_id = auth.uid()::text

    and
    (storage.foldername(storage.objects.name))[1]
        = auth.uid()::text
);


-- ============================================================================
-- 8. ORG-ASSETS — UPDATE
-- ============================================================================
--
-- Requis notamment pour les opérations utilisant upsert.
-- ============================================================================

drop policy if exists org_assets_update_own
on storage.objects;

create policy org_assets_update_own
on storage.objects
for update
to authenticated
using (
    bucket_id = 'org-assets'

    and owner_id = auth.uid()::text
)
with check (
    bucket_id = 'org-assets'

    and owner_id = auth.uid()::text
);


-- ============================================================================
-- 9. ORG-ASSETS — DELETE
-- ============================================================================

drop policy if exists org_assets_delete_own
on storage.objects;

create policy org_assets_delete_own
on storage.objects
for delete
to authenticated
using (
    bucket_id = 'org-assets'

    and owner_id = auth.uid()::text
);


-- ============================================================================
-- 10. VÉRIFICATION DES POLICIES
-- ============================================================================
--
-- Ces SELECT sont uniquement informatifs.
-- Ils permettent de vérifier après exécution que les policies existent.
-- ============================================================================

select
    schemaname,
    tablename,
    policyname,
    cmd,
    roles
from pg_policies
where (
        schemaname = 'public'
        and tablename in (
            'organizations',
            'report_templates'
        )
    )
    or (
        schemaname = 'storage'
        and tablename = 'objects'
        and policyname like 'org_assets_%'
    )
order by
    schemaname,
    tablename,
    policyname;