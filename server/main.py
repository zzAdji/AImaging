from __future__ import annotations

import logging
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path
from typing import List

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import paths as server_paths

server_paths.bootstrap_all()  # doit precéder tout import des packages métier ci-dessous

from config import GeminiConfig, RadiographyServerConfig  # noqa: E402
from model_registry import ModelRegistry  # noqa: E402

from main_predict import predict_with_loaded_models  # noqa: E402
from radiography_adapter import facts_from_predict_result  # noqa: E402
from report_schemas import RadiologyReportFields  # noqa: E402
from report_renderer import PatientContext, render_report_text  # noqa: E402
from prompt import SYSTEM_INSTRUCTION, build_prompt  # noqa: E402
from coherence_check import check_coherence  # noqa: E402
from workspace_protocol import ActionPlan, ActionValidationResult, WorkspaceManifest, validate_plan_against_manifest  # noqa: E402
from workspace_store import WorkspaceStore  # noqa: E402

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("server.main")

registry = ModelRegistry()
startup_errors: List[str] = []
workspace_store = WorkspaceStore()


@asynccontextmanager
async def lifespan(app: FastAPI):
    startup_errors.clear()
    logger.info("Démarrage : chargement des services...")

    try:
        registry.load_radiography(RadiographyServerConfig())
    except Exception as exc:  # noqa: BLE001
        logger.exception("Chargement des modèles radiographiques impossible.")
        startup_errors.append(f"radiography: {exc}")

    try:
        registry.load_gemini(GeminiConfig())
    except Exception as exc:  # noqa: BLE001
        # Gemini n'est requis que par /radiography/report. Le serveur et
        # /health restent disponibles sans clé afin de signaler cet état.
        logger.warning("Client Gemini indisponible : %s", exc)
        startup_errors.append(f"gemini: {exc}")

    logger.info("Serveur prêt (erreurs de démarrage : %d).", len(startup_errors))
    yield
    logger.info("Arrêt du serveur.")


app = FastAPI(title="HGG AI — Plateforme de diagnostic imagerie", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT"],
    allow_headers=["Content-Type"],
)


class WorkspaceSessionResponse(BaseModel):
    workspace_id: str
    protocol_version: str
    exam_id: str
    image_count: int


@app.post("/workspace/exams", response_model=WorkspaceSessionResponse, status_code=201)
async def create_workspace_exam(manifest: WorkspaceManifest) -> WorkspaceSessionResponse:
    """Enregistre le contexte de travail temporaire pour les futurs plans IA."""
    session = workspace_store.create(manifest)
    return WorkspaceSessionResponse(
        workspace_id=session.id,
        protocol_version=manifest.protocol_version,
        exam_id=manifest.exam_id,
        image_count=len(manifest.images),
    )


@app.put("/workspace/exams/{workspace_id}", response_model=WorkspaceSessionResponse)
async def update_workspace_exam(workspace_id: str, manifest: WorkspaceManifest) -> WorkspaceSessionResponse:
    """Actualise le manifeste après une interaction ayant modifié le canvas."""
    session = workspace_store.replace(workspace_id, manifest)
    if session is None:
        raise HTTPException(status_code=404, detail="Espace de travail temporaire introuvable ou expiré.")
    return WorkspaceSessionResponse(
        workspace_id=session.id,
        protocol_version=manifest.protocol_version,
        exam_id=manifest.exam_id,
        image_count=len(manifest.images),
    )


@app.post("/workspace/exams/{workspace_id}/actions/validate", response_model=ActionValidationResult)
async def validate_workspace_actions(workspace_id: str, plan: ActionPlan) -> ActionValidationResult:
    """Valide un plan structuré sans l'exécuter dans le navigateur."""
    session = workspace_store.get(workspace_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Espace de travail temporaire introuvable ou expiré.")
    return validate_plan_against_manifest(plan, session.manifest)

@app.post("/radiography/predict")
async def predict_radiography(image: UploadFile = File(...)) -> dict:
    if not registry.radiography_models:
        raise HTTPException(status_code=503, detail="Modèles radiographie non chargés.")

    suffix = Path(image.filename or "image.jpg").suffix or ".jpg"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(await image.read())
        tmp_path = Path(tmp.name)

    try:
        result = predict_with_loaded_models(tmp_path, registry.radiography_models, registry.radiography_device)
        # Le chemin temporaire n'a aucun sens pour l'appelant - on le remplace par le nom d'origine.
        result["image"] = image.filename
        return result
    except Exception as exc:  # noqa: BLE001
        logger.exception("Échec de la prédiction.")
        raise HTTPException(status_code=500, detail=f"Échec de la prédiction : {exc}") from exc
    finally:
        tmp_path.unlink(missing_ok=True)


class PatientInfo(BaseModel):
    nom_prenom: str
    prescripteur: str = ""
    date_examen: str = ""


class ReportRequest(BaseModel):
    prediction: dict  # tel que renvoyé par /radiography/predict
    patient: PatientInfo


class ReportResponse(BaseModel):
    report: RadiologyReportFields
    coherence_passed: bool
    coherence_issues: List[str]
    rendered_text: str


@app.post("/radiography/report", response_model=ReportResponse)
async def generate_radiography_report(request: ReportRequest) -> ReportResponse:
    if registry.gemini_client is None:
        raise HTTPException(status_code=503, detail="Client Gemini non initialisé.")

    try:
        facts = facts_from_predict_result(request.prediction)
    except KeyError as exc:
        raise HTTPException(
            status_code=422,
            detail=f"'prediction' ne correspond pas au format attendu (sortie de /radiography/predict) : {exc}",
        ) from exc

    prompt = build_prompt(facts.to_prompt_facts())
    try:
        fields = registry.gemini_client.generate_structured(
            system_instruction=SYSTEM_INSTRUCTION, prompt=prompt, response_schema=RadiologyReportFields,
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception("Échec de la génération du rapport.")
        raise HTTPException(status_code=502, detail=f"Échec de l'appel au LLM : {exc}") from exc

    coherence = check_coherence(fields, facts)
    if not coherence.passed:
        logger.warning("Rapport incohérent détecté pour %s : %s", request.prediction.get("image"), coherence.issues)

    patient = PatientContext(**request.patient.model_dump())
    rendered_text = render_report_text(patient, fields)

    return ReportResponse(
        report=fields,
        coherence_passed=coherence.passed,
        coherence_issues=coherence.issues,
        rendered_text=rendered_text,
    )


@app.get("/health")
async def health() -> dict:
    return {
        "status": "ok" if not startup_errors else "degraded",
        "radiography_models_loaded": len(registry.radiography_models),
        "gemini_ready": registry.gemini_client is not None,
        "startup_errors": startup_errors,
    }
