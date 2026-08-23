"""Fondation Supabase — validation STATIQUE des migrations.

Ces tests ne requièrent NI base de données ni credentials : ils vérifient que
les fichiers `supabase/migrations/` définissent bien la fondation attendue par
FONDATION.md (tables, contraintes, index, RLS, Storage) et qu'aucune trace de
la 3D abandonnée ne s'y est glissée (FONDATION.md §2).

Les tests d'intégration réels (connexion, CRUD, RLS multi-utilisateur) vivent
dans `test_supabase_integration_live.py` et sont skippés sans credentials.
"""

from __future__ import annotations

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS_DIR = REPO_ROOT / "supabase" / "migrations"

MIGRATION_FILES = [
    "0001_extensions_and_helpers.sql",
    "0002_core_tables.sql",
    "0003_analysis_tables.sql",
    "0004_rls.sql",
    "0005_storage.sql",
]

EXPECTED_TABLES = [
    "profiles",
    "workspaces",
    "examinations",
    "examination_images",
    "annotations",
    "analysis_runs",
    "classification_results",
    "measurements",
    "reports",
]

# Tokens interdits : décision produit « 3D hors périmètre » (FONDATION.md §2).
FORBIDDEN_3D_TOKENS = [
    "reconstruction_3d",
    "reconstruction3d",
    "deepscan3d",
    "graf",
]


def _migration_text() -> str:
    return "\n".join(
        (MIGRATIONS_DIR / name).read_text(encoding="utf-8") for name in MIGRATION_FILES
    )


def _ddl_only() -> str:
    """Texte des migrations sans les commentaires `--`.

    Les vérifications portent sur le schéma réellement exécuté ; les
    commentaires pédagogiques ne doivent pas faire échouer les garde-fous
    (ils citent volontairement ce qui est interdit).
    """
    return "\n".join(
        line.split("--")[0]
        for line in _migration_text().splitlines()
    )



def _table_definition(table: str) -> str:
    text = _migration_text()
    match = re.search(
        rf"create table if not exists public\.{table}\s*\((.*?)\n\);",
        text,
        re.DOTALL,
    )
    assert match is not None, f"Table public.{table} introuvable dans les migrations."
    return match.group(1)


def test_migration_files_exist_in_order():
    for name in MIGRATION_FILES:
        path = MIGRATIONS_DIR / name
        assert path.is_file(), f"Migration manquante : {path}"
        assert path.read_text(encoding="utf-8").strip(), f"Migration vide : {path}"


def test_seed_dev_only_exists_and_is_flagged():
    seed = (REPO_ROOT / "supabase" / "seed.sql").read_text(encoding="utf-8")
    assert "DEV ONLY" in seed, "Le seed doit être explicitement marqué DEV ONLY."
    # Aucune donnée médicale réelle injectée.
    assert "PSEUDO" not in seed.replace("pseudonym", "").replace("pseudonymisé", "")


def test_all_nine_tables_are_created():
    text = _migration_text()
    for table in EXPECTED_TABLES:
        assert re.search(
            rf"create table if not exists public\.{table}\s*\(", text
        ), f"Table public.{table} absente des migrations."


def test_no_3d_artifacts_anywhere():
    ddl = _ddl_only().lower()
    for token in FORBIDDEN_3D_TOKENS:
        assert token not in ddl, (
            f"Token 3D interdit trouvé dans le schéma : '{token}' "
            "(FONDATION.md §2 : la 3D est définitivement hors périmètre)."
        )


def test_analysis_type_check_excludes_reconstruction():
    definition = _table_definition("analysis_runs")
    assert "'gradcam'" in definition and "'classification'" in definition
    assert "reconstruction_3d" not in definition.lower()


def test_foreign_key_chain_is_complete():
    ddl = _ddl_only()
    # profiles.id → auth.users.id (cascade).
    profiles_def = _table_definition("profiles")
    assert re.search(r"references\s+auth\.users\s*\(\s*id\s*\)\s+on delete cascade", profiles_def, re.IGNORECASE)
    # Chaîne applicative complète.
    workspaces_def = _table_definition("workspaces")
    assert re.search(r"references\s+public\.profiles\s*\(\s*id\s*\)", workspaces_def, re.IGNORECASE)
    examinations_def = _table_definition("examinations")
    assert re.search(r"references\s+public\.workspaces\s*\(\s*id\s*\)\s+on delete cascade", examinations_def, re.IGNORECASE)
    images_def = _table_definition("examination_images")
    assert re.search(r"references\s+public\.examinations\s*\(\s*id\s*\)\s+on delete cascade", images_def, re.IGNORECASE)
    # annotations.image_id → examination_images
    annotation_def = _table_definition("annotations")
    assert "references public.examination_images (id)" in annotation_def
    # analysis_runs → examinations + examination_images (set null)
    runs_def = _table_definition("analysis_runs")
    assert "references public.examinations (id)" in runs_def
    assert "references public.examination_images (id) on delete set null" in runs_def
    # classification_results → analysis_runs (cascade)
    results_def = _table_definition("classification_results")
    assert "references public.analysis_runs (id)" in results_def
    # measurements → trois parents possibles
    measurements_def = _table_definition("measurements")
    assert "references public.analysis_runs (id)" in measurements_def
    assert "references public.examination_images (id)" in measurements_def
    assert "references public.annotations (id)" in measurements_def
    # reports → examinations
    reports_def = _table_definition("reports")
    assert "references public.examinations (id)" in reports_def


def test_unique_legacy_ids_for_progressive_migration():
    for table in ("examinations", "examination_images", "annotations"):
        assert re.search(rf"legacy_\w+\s+text unique", _table_definition(table), re.IGNORECASE), (
            f"{table}.legacy_id doit être unique pour la migration progressive."
        )


def test_domain_constraints_are_present():
    # Modality : text + CHECK extensible, au minimum radiography/fetal_ultrasound.
    examinations_def = _table_definition("examinations")
    assert "'radiography'" in examinations_def and "'fetal_ultrasound'" in examinations_def
    assert "enum" not in examinations_def.lower()
    # Probability bornée 0..1 (FONDATION.md §14).
    results_def = _table_definition("classification_results")
    assert re.search(r"probability\s+numeric not null", results_def)
    assert "probability >= 0" in results_def and "probability <= 1" in results_def
    assert "'per_model'" in results_def and "'ensemble'" in results_def
    # Statuts d'analyse valides.
    runs_def = _table_definition("analysis_runs")
    for status in ("pending", "running", "done", "error", "rejected"):
        assert f"'{status}'" in runs_def
    # Rapports : types et statuts du workflow.
    reports_def = _table_definition("reports")
    for token in ("radiography_ai", "fetal_obstetric", "draft", "generated", "needs_review", "validated"):
        assert f"'{token}'" in reports_def


def test_recommended_indexes_exist():
    text = _migration_text().lower()
    expected_index_columns = [
        "workspaces (owner_id)",
        "examinations (workspace_id)",
        "examinations (workspace_id, last_opened_at desc)",
        "examination_images (examination_id, sort_order)",
        "analysis_runs (examination_id)",
        "analysis_runs (image_id)",
        "analysis_runs (analysis_type, status)",
        "classification_results (analysis_run_id)",
        "measurements (analysis_run_id)",
        "measurements (image_id, type)",
        "annotations (image_id)",
        "reports (examination_id, updated_at desc)",
    ]
    for columns in expected_index_columns:
        assert columns in text, f"Index recommandé absent : {columns}"


def test_rls_enabled_on_all_tables_and_helper_is_safe():
    rls_section = _migration_text().split("0004_rls.sql")[-1]
    for table in EXPECTED_TABLES:
        assert re.search(
            rf"alter table public\.{table}\s+enable row level security",
            rls_section,
        ), f"RLS non activée sur public.{table}."
    # Helper owns_workspace : security definer / stable / search_path vide.
    helper_match = re.search(
        r"create or replace function public\.owns_workspace.*?\$\$;",
        rls_section,
        re.DOTALL,
    )
    assert helper_match is not None, "Helper public.owns_workspace introuvable."
    helper = helper_match.group(0).lower()
    assert "security definer" in helper
    assert "stable" in helper
    assert "set search_path = ''" in helper
    # Référence explicite public.workspaces dans le corps du helper.
    assert "public.workspaces" in helper


def test_policies_cover_all_actions_for_every_table():
    rls_section = _migration_text().split("0004_rls.sql")[-1]
    policies = re.findall(r"create policy (\w+) on public\.(\w+)\s+for (\w+)", rls_section)
    covered = {(table, action) for _, table, action in policies}
    for table in EXPECTED_TABLES:
        for action in ("select", "insert", "update", "delete"):
            assert (table, action) in covered, f"Policy {action} manquante sur {table}."
    # Les INSERT doivent porter un WITH CHECK (jamais un USING seul).
    inserts_without_check = re.findall(
        r"create policy \w+ on public\.\w+\s+for insert to authenticated\s+using\b",
        rls_section,
    )
    assert not inserts_without_check, "Des policies INSERT utilisent USING au lieu de WITH CHECK."


def test_storage_buckets_private_and_policies_scoped():
    storage_section = _migration_text().split("0005_storage.sql")[-1]
    for bucket in ("medical-images", "analysis-artifacts", "reports"):
        assert f"('{bucket}', '{bucket}', false)" in storage_section, (
            f"Le bucket {bucket} doit être créé privé."
        )
    # Aucun bucket public créé.
    assert ", true)" not in storage_section
    # Policies Storage : rôle authenticated + premier segment = user_id.
    assert storage_section.count("to authenticated") >= 4
    assert "auth.uid()::text" in storage_section
    assert "(storage.foldername(name))[1]" in storage_section


def test_no_binary_image_storage_in_any_column():
    ddl = _ddl_only().lower()
    for token in ("bytea", "data_url", "base64"):
        assert token not in ddl, (
            "Aucun binaire d'image ne doit transiter par PostgreSQL "
            f"(token interdit trouvé : '{token}', FONDATION.md §10)."
        )


def test_updated_at_trigger_applied_exactly_once_per_table():
    text = _migration_text()
    triggers = re.findall(
        r"create trigger set_updated_at_\w+\s+before update on public\.(\w+)",
        text,
    )
    with_updated_at = [
        "profiles",
        "workspaces",
        "examinations",
        "examination_images",
        "annotations",
        "analysis_runs",
        "measurements",
        "reports",
    ]
    assert sorted(triggers) == sorted(with_updated_at), (
        "Chaque table avec updated_at doit avoir exactement un trigger commun."
    )
    # classification_results n'a volontairement pas de trigger (pas de colonne).
    assert "updated_at" not in _table_definition("classification_results")


