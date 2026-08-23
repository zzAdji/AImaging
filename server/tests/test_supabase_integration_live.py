"""Fondation Supabase — tests d'INTÉGRATION réels (FONDATION.md §26).

Exécutés uniquement lorsque des credentials de test sont fournis :

    AIMAGING_TEST_SUPABASE_URL       URL du projet Supabase de test
    AIMAGING_TEST_SUPABASE_ANON_KEY  clé publishable (anon) du projet

Sans ces variables (ou sans httpx), tous les tests sont SKIPPÉS : la suite
reste verte en local, conformément à FONDATION.md §31.

Règles respectées :
- la clé anon est utilisée, JAMAIS service_role ;
- les scénarios RLS passent par deux utilisateurs authentifiés réels
  (USER A / USER B) via l'API Auth : B ne doit ni lire ni écrire dans A ;
- aucune donnée médicale réelle n'est créée.
"""

from __future__ import annotations

import os
import uuid

import pytest

try:
    import httpx
except ImportError:  # pragma: no cover - httpx absent de certaines venv
    httpx = None  # type: ignore[assignment]

SUPABASE_URL = os.environ.get("AIMAGING_TEST_SUPABASE_URL", "").rstrip("/")
SUPABASE_ANON_KEY = os.environ.get("AIMAGING_TEST_SUPABASE_ANON_KEY", "")
TEST_PASSWORD = "Aimaging-Foundation-Test-2026!"

pytestmark = [
    pytest.mark.skipif(
        not SUPABASE_URL or not SUPABASE_ANON_KEY,
        reason="Credentials Supabase de test absentes "
        "(AIMAGING_TEST_SUPABASE_URL / AIMAGING_TEST_SUPABASE_ANON_KEY).",
    ),
    pytest.mark.skipif(httpx is None, reason="httpx indisponible dans cette environnement."),
]


def _signup(email: str) -> str:
    """Crée (ou connecte) un utilisateur de test et retourne son JWT."""
    response = httpx.post(
        f"{SUPABASE_URL}/auth/v1/signup",
        headers={"apikey": SUPABASE_ANON_KEY, "Content-Type": "application/json"},
        json={"email": email, "password": TEST_PASSWORD},
        timeout=30,
    )
    if response.status_code >= 400:
        pytest.skip(f"Signup indisponible sur ce projet ({response.status_code}) : {response.text[:200]}")
    payload = response.json()
    token = payload.get("access_token")
    if not token:
        pytest.skip("Signup sans session immédiate (confirmation email activée) : test non exécutable.")
    return token


def _rest_headers(token: str) -> dict:
    return {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }


def _post(token: str, table: str, values: dict) -> httpx.Response:
    return httpx.post(
        f"{SUPABASE_URL}/rest/v1/{table}",
        headers=_rest_headers(token),
        json=values,
        timeout=30,
    )


def _get(token: str, table: str, query: str) -> httpx.Response:
    return httpx.get(
        f"{SUPABASE_URL}/rest/v1/{table}",
        headers={**_rest_headers(token), "Accept": "application/json"},
        params={"select": "*", **_parse_query(query)},
        timeout=30,
    )


def _parse_query(query: str) -> dict:
    out: dict[str, str] = {}
    for part in query.split("&"):
        key, _, value = part.partition("=")
        out[key] = value
    return out


def _delete(token: str, table: str, query: str) -> None:
    httpx.delete(
        f"{SUPABASE_URL}/rest/v1/{table}",
        headers=_rest_headers(token),
        params=_parse_query(query),
        timeout=30,
    )


@pytest.fixture(scope="module")
def user_a() -> str:
    return _signup(f"aimaging-a-{uuid.uuid4().hex[:10]}@example.test")


@pytest.fixture(scope="module")
def user_b() -> str:
    return _signup(f"aimaging-b-{uuid.uuid4().hex[:10]}@example.test")


@pytest.fixture(scope="module")
def workspace_id(user_a: str) -> str:
    """Workspace de USER A ; nettoyage en cascade à la fin du module."""
    response = _post(user_a, "workspaces", {"name": "TEST - Foundation workspace"})
    assert response.status_code == 201, response.text
    created = response.json()
    if isinstance(created, list):
        created = created[0]
    return created["id"]


def _create_examination(token: str, workspace: str) -> str:
    response = _post(
        token,
        "examinations",
        {
            "workspace_id": workspace,
            "legacy_id": f"live-{uuid.uuid4().hex[:10]}",
            "name": "TEST - Examen",
            "modality": "radiography",
        },
    )
    assert response.status_code == 201, response.text
    created = response.json()
    if isinstance(created, list):
        created = created[0]
    return created["id"]


@pytest.fixture(scope="module")
def examination_id(user_a: str, workspace_id: str) -> str:
    return _create_examination(user_a, workspace_id)


# ---------------------------------------------------------------------------
# 1. Connexion Supabase (FONDATION.md §26.1)
# ---------------------------------------------------------------------------


def test_connection_reaches_rest_root(user_a: str):
    response = httpx.get(
        f"{SUPABASE_URL}/rest/v1/",
        headers={"apikey": SUPABASE_ANON_KEY, "Authorization": f"Bearer {user_a}"},
        timeout=30,
    )
    assert response.status_code in (200, 204)


# ---------------------------------------------------------------------------
# §26.2-5 : lecture / modification / suppression du workspace
# ---------------------------------------------------------------------------


def test_workspace_read_update_delete(user_a: str):
    create_response = _post(user_a, "workspaces", {"name": "TEST - CRUD complet"})
    assert create_response.status_code == 201, create_response.text
    ws = create_response.json()
    if isinstance(ws, list):
        ws = ws[0]

    read = _get(user_a, "workspaces", f"id=eq.{ws['id']}")
    rows = read.json()
    assert len(rows) == 1 and rows[0]["name"] == "TEST - CRUD complet"

    update = httpx.patch(
        f"{SUPABASE_URL}/rest/v1/workspaces",
        headers=_rest_headers(user_a),
        params={"id": f"eq.{ws['id']}"},
        json={"name": "TEST - CRUD renommé"},
        timeout=30,
    )
    assert update.status_code == 200, update.text
    updated = update.json()
    if isinstance(updated, list):
        updated = updated[0]
    assert updated["name"] == "TEST - CRUD renommé"

    delete = httpx.delete(
        f"{SUPABASE_URL}/rest/v1/workspaces",
        headers=_rest_headers(user_a),
        params={"id": f"eq.{ws['id']}"},
        timeout=30,
    )
    assert delete.status_code in (200, 204)


# ---------------------------------------------------------------------------
# §26.6-12 : examen → image → analysis_run → classifications → mesure →
# annotation → rapport
# ---------------------------------------------------------------------------


def test_full_foundation_chain(user_a: str, workspace_id: str, examination_id: str):
    # Image metadata (§26.7) — storage_path NULL pendant la coexistence.
    image_response = _post(
        user_a,
        "examination_images",
        {
            "examination_id": examination_id,
            "filename": "test-image.png",
            "width": 512,
            "height": 512,
            "sort_order": 0,
            "source_kind": "browser-image",
        },
    )
    assert image_response.status_code == 201, image_response.text
    image = image_response.json()
    if isinstance(image, list):
        image = image[0]

    # Analysis run (§26.8).
    run_response = _post(
        user_a,
        "analysis_runs",
        {
            "examination_id": examination_id,
            "image_id": image["id"],
            "analysis_type": "classification",
            "status": "running",
            "model_name": "ensemble-radiography",
        },
    )
    assert run_response.status_code == 201, run_response.text
    run = run_response.json()
    if isinstance(run, list):
        run = run[0]

    # Classification results (§26.9) : per_model + ensemble, probabilité 0..1.
    for values in (
        {"analysis_run_id": run["id"], "class_name": "Normal", "probability": 0.72, "source": "per_model", "model_architecture": "DenseNet121"},
        {"analysis_run_id": run["id"], "class_name": "Pneumonia-Bacterial", "probability": 0.11, "source": "ensemble"},
    ):
        result_response = _post(user_a, "classification_results", values)
        assert result_response.status_code == 201, result_response.text

    # Measurement (§26.10) : valeur nullable, unité explicite, source user.
    measurement_response = _post(
        user_a,
        "measurements",
        {"image_id": image["id"], "type": "CTR", "value": None, "unit": "ratio", "source": "user"},
    )
    assert measurement_response.status_code == 201, measurement_response.text

    # Annotation (§26.11).
    annotation_response = _post(
        user_a,
        "annotations",
        {
            "image_id": image["id"],
            "type": "rectangle",
            "geometry": {"x": 10, "y": 20, "w": 30, "h": 40},
            "created_by": "user",
            "label": "zone d'interet",
        },
    )
    assert annotation_response.status_code == 201, annotation_response.text

    # Report (§26.12).
    report_response = _post(
        user_a,
        "reports",
        {"examination_id": examination_id, "type": "radiography_ai", "status": "generated", "content": "Compte rendu de test."},
    )
    assert report_response.status_code == 201, report_response.text


def test_constraint_probability_out_of_range_is_rejected(user_a: str, workspace_id: str):
    exam = _create_examination(user_a, workspace_id)
    run_response = _post(
        user_a, "analysis_runs", {"examination_id": exam, "analysis_type": "classification"}
    )
    assert run_response.status_code == 201, run_response.text
    run = run_response.json()
    if isinstance(run, list):
        run = run[0]
    bad = _post(
        user_a,
        "classification_results",
        {"analysis_run_id": run["id"], "class_name": "X", "probability": 1.5, "source": "ensemble"},
    )
    assert bad.status_code >= 400, "probability > 1 doit violer classification_results_probability_range_check."
    _delete(user_a, "examinations", f"id=eq.{exam}")


def test_constraint_invalid_modality_and_analysis_type_are_rejected(user_a: str, workspace_id: str):
    bad_modality = _post(
        user_a,
        "examinations",
        {"workspace_id": workspace_id, "name": "TEST - modalite invalide", "modality": "reconstruction_3d"},
    )
    assert bad_modality.status_code >= 400, "Une modality hors CHECK doit être rejetée."

    exam = _create_examination(user_a, workspace_id)
    bad_type = _post(
        user_a, "analysis_runs", {"examination_id": exam, "analysis_type": "reconstruction_3d"}
    )
    assert bad_type.status_code >= 400, "reconstruction_3d est interdit (FONDATION.md §2)."
    _delete(user_a, "examinations", f"id=eq.{exam}")


def test_unique_legacy_id_is_enforced(user_a: str, workspace_id: str):
    legacy = f"live-unique-{uuid.uuid4().hex[:10]}"
    first = _post(
        user_a,
        "examinations",
        {"workspace_id": workspace_id, "legacy_id": legacy, "name": "TEST - legacy 1", "modality": "radiography"},
    )
    assert first.status_code == 201, first.text
    second = _post(
        user_a,
        "examinations",
        {"workspace_id": workspace_id, "legacy_id": legacy, "name": "TEST - legacy 2", "modality": "radiography"},
    )
    assert second.status_code >= 400, "Un legacy_id déjà utilisé doit violer la contrainte unique."
    created = first.json()
    if isinstance(created, list):
        created = created[0]
    _delete(user_a, "examinations", f"id=eq.{created['id']}")


# ---------------------------------------------------------------------------
# RLS — scénario multi-utilisateur (FONDATION.md §26)
# USER A peut lire/écrire dans son workspace.
# USER B ne peut NI le lire NI y écrire (même avec un UUID valide).
# Aucun service_role : les deux acteurs utilisent la clé anon + leur JWT.
# ---------------------------------------------------------------------------


def test_rls_user_b_cannot_read_user_a_workspace(user_a: str, user_b: str, workspace_id: str):
    read = _get(user_b, "workspaces", f"id=eq.{workspace_id}")
    assert read.status_code in (200, 404)
    if read.status_code == 200:
        assert read.json() == [], "RLS : USER B ne doit voir aucun workspace de USER A."


def test_rls_user_b_cannot_write_in_user_a_workspace(user_a: str, user_b: str, workspace_id: str):
    write = _post(
        user_b,
        "examinations",
        {"workspace_id": workspace_id, "name": "TEST - intrusion", "modality": "radiography"},
    )
    # WITH CHECK de RLS → violation (PostgREST 4xx), jamais une 2xx silencieuse.
    assert write.status_code >= 400, (
        "RLS : USER B ne doit pas pouvoir créer un examen dans le workspace de USER A."
    )


def test_rls_user_a_reads_own_workspace(user_a: str, workspace_id: str):
    read = _get(user_a, "workspaces", f"id=eq.{workspace_id}")
    assert read.status_code == 200, read.text
    rows = read.json()
    assert len(rows) == 1 and rows[0]["id"] == workspace_id



