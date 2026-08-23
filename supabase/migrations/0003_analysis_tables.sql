-- ============================================================================
-- AIMAGING · Phase Database 2 · Fondation Supabase
-- 0003_analysis_tables.sql
--
-- Tables d'analyse : annotations → analysis_runs → classification_results /
-- measurements, puis reports.
--
-- Décision produit (FONDATION.md §2) : LA 3D EST HORS PÉRIMÈTRE.
-- Aucun analysis_type `reconstruction_3d`, aucune table ni colonne liée à
-- DeepScan3D / GRAF / volumes / frames 3D / jobs 3D distants. Le code 3D
-- existant peut rester dormant mais n'influence plus le schéma.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- ANNOTATIONS (FONDATION.md §12)
--
-- Formes du canvas radiographie/échographie. Pas de relation directe vers un
-- modèle IA ; `action_id` conserve la traçabilité d'une commande IA le cas
-- échéant. `geometry` contient x/y/w/h/points en pixels (cf. WorkspaceCanvasShape).
-- ----------------------------------------------------------------------------
create table if not exists public.annotations (
    id              uuid primary key default gen_random_uuid(),
    image_id        uuid not null references public.examination_images (id) on delete cascade,
    legacy_shape_id text unique,
    type            text not null,
    geometry        jsonb not null,
    style           jsonb,
    label           text,
    visible         boolean not null default true,
    created_by      text not null,
    action_id       text,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    constraint annotations_created_by_check check (created_by in ('user', 'ai')),
    constraint annotations_type_not_empty_check check (length(trim(type)) > 0)
);

create index if not exists idx_annotations_image_id
    on public.annotations (image_id);

-- ----------------------------------------------------------------------------
-- ANALYSIS_RUNS (FONDATION.md §13)
--
-- Une exécution d'analyse IA, attachée soit à une image, soit à tout un examen
-- (image_id NULL). Les types couvrent classification, gradcam, cxas,
-- hybridgnet, qualité/plan/fetalclip/anomalie fœtaux, opencxr, rapport.
-- reconstruction_3d est volontairement ABSENT (3D hors périmètre).
-- ----------------------------------------------------------------------------
create table if not exists public.analysis_runs (
    id             uuid primary key default gen_random_uuid(),
    examination_id uuid not null references public.examinations (id) on delete cascade,
    image_id       uuid references public.examination_images (id) on delete set null,
    analysis_type  text not null,
    model_name     text,
    model_version  text,
    status         text not null default 'pending',
    error_message  text,
    started_at     timestamptz,
    completed_at   timestamptz,
    metadata       jsonb not null default '{}'::jsonb,
    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now(),
    constraint analysis_runs_analysis_type_check check (analysis_type in (
        'classification',
        'gradcam',
        'cxas',
        'hybridgnet',
        'quality',
        'plane',
        'fetalclip',
        'anomaly',
        'multimodal',
        'opencxr_sort',
        'opencxr_standardize',
        'report'
    )),
    constraint analysis_runs_status_check
        check (status in ('pending', 'running', 'done', 'error', 'rejected'))
);

create index if not exists idx_analysis_runs_examination_id
    on public.analysis_runs (examination_id);
create index if not exists idx_analysis_runs_image_id
    on public.analysis_runs (image_id);
create index if not exists idx_analysis_runs_type_status
    on public.analysis_runs (analysis_type, status);

-- ----------------------------------------------------------------------------
-- CLASSIFICATION_RESULTS (FONDATION.md §14)
--
-- Probabilités par classe. `source = per_model` conserve la distinction
-- DenseNet121 / ResNet50 / ResNet101 / EfficientNet-B0 / EfficientNet-B2 ;
-- `source = ensemble` porte la probabilité agrégée. Table générique : aucune
-- spécialisation radiographie.
-- ----------------------------------------------------------------------------
create table if not exists public.classification_results (
    id                  uuid primary key default gen_random_uuid(),
    analysis_run_id     uuid not null references public.analysis_runs (id) on delete cascade,
    class_name          text not null,
    probability         numeric not null,
    source              text not null,
    model_architecture  text,
    created_at          timestamptz not null default now(),
    constraint classification_results_probability_range_check
        check (probability >= 0 and probability <= 1),
    constraint classification_results_source_check
        check (source in ('per_model', 'ensemble')),
    constraint classification_results_class_name_not_empty_check
        check (length(trim(class_name)) > 0)
);

create index if not exists idx_classification_results_run
    on public.classification_results (analysis_run_id);

-- ----------------------------------------------------------------------------
-- MEASUREMENTS (FONDATION.md §15)
--
-- Mesures posées (CTR, SCD, HeartWidth côté radio ; BPD, CRL, AC, FL, NT côté
-- fœtal…). L'unité est explicite et NON normalisée de force : ratio pour CTR,
-- px ou mm pour les distances, mm pour la biométrie.
-- `value` est NULLable : une mesure peut exister avant d'être renseignée
-- (saisie praticien). Contraintes ajoutées uniquement lorsqu'elles sont
-- scientifiquement sûres (plage de confiance 0..1).
--
-- Une mesure peut être liée à un run d'analyse IA (`analysis_run_id`), à une
-- annotation posée (`annotation_id`) ou seulement à l'image (`image_id` seul).
-- ----------------------------------------------------------------------------
create table if not exists public.measurements (
    id              uuid primary key default gen_random_uuid(),
    analysis_run_id uuid references public.analysis_runs (id) on delete set null,
    image_id        uuid not null references public.examination_images (id) on delete cascade,
    annotation_id   uuid references public.annotations (id) on delete set null,
    type            text not null,
    value           numeric,
    unit            text not null,
    source          text not null,
    confidence      numeric,
    geometry        jsonb,
    metadata        jsonb not null default '{}'::jsonb,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    constraint measurements_source_check check (source in ('user', 'ai')),
    constraint measurements_confidence_range_check
        check (confidence is null or (confidence >= 0 and confidence <= 1)),
    constraint measurements_type_not_empty_check check (length(trim(type)) > 0),
    constraint measurements_unit_not_empty_check check (length(trim(unit)) > 0)
);

create index if not exists idx_measurements_analysis_run
    on public.measurements (analysis_run_id);
create index if not exists idx_measurements_image_type
    on public.measurements (image_id, type);

-- ----------------------------------------------------------------------------
-- REPORTS (FONDATION.md §16)
--
-- Rapports générés puis édités/validés par le praticien.
-- `content` = texte libre rendu ; `structured_data` = données structurées JSONB
-- (indispensable pour le compte rendu obstétrical fœtal : sections, biométrie,
-- findings — un texte libre seul serait insuffisant).
-- `storage_path` pointe vers un export dans le bucket privé `reports`.
-- ----------------------------------------------------------------------------
create table if not exists public.reports (
    id              uuid primary key default gen_random_uuid(),
    examination_id  uuid not null references public.examinations (id) on delete cascade,
    type            text not null,
    status          text not null default 'draft',
    content         text,
    structured_data jsonb,
    storage_path    text,
    created_by      text not null default 'ai',
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    constraint reports_type_check check (type in ('radiography_ai', 'fetal_obstetric')),
    constraint reports_status_check
        check (status in ('draft', 'generated', 'needs_review', 'validated')),
    constraint reports_created_by_check check (created_by in ('user', 'ai'))
);

create index if not exists idx_reports_exam_updated
    on public.reports (examination_id, updated_at desc);

-- ----------------------------------------------------------------------------
-- Triggers `updated_at` communs (FONDATION.md §17).
-- classification_results n'a pas de colonne updated_at (§14) : pas de trigger.
-- ----------------------------------------------------------------------------
create trigger set_updated_at_annotations
    before update on public.annotations
    for each row
    execute function public.set_updated_at();

create trigger set_updated_at_analysis_runs
    before update on public.analysis_runs
    for each row
    execute function public.set_updated_at();

create trigger set_updated_at_measurements
    before update on public.measurements
    for each row
    execute function public.set_updated_at();

create trigger set_updated_at_reports
    before update on public.reports
    for each row
    execute function public.set_updated_at();

