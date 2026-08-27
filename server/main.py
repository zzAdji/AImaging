from __future__ import annotations

import base64
import binascii
import json
import logging
import re
import tempfile
import time
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import List, Literal
from uuid import uuid4

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from google.genai import types as genai_types
from pydantic import BaseModel, Field

import paths as server_paths

server_paths.bootstrap_all()  # doit precéder tout import des packages métier ci-dessous

from config import CxasServerConfig, GeminiConfig, RadiographyServerConfig  # noqa: E402
from model_registry import ModelRegistry  # noqa: E402

from main_predict import predict_with_loaded_models  # noqa: E402
from radiography_adapter import facts_from_predict_result  # noqa: E402
from report_schemas import RadiologyReportFields  # noqa: E402
from report_renderer import PatientContext, render_report_text  # noqa: E402
from prompt import SYSTEM_INSTRUCTION, build_clinical_facts, build_prompt  # noqa: E402
from coherence_check import check_coherence  # noqa: E402
from workspace_protocol import (  # noqa: E402
    ActionPlan,
    ActionType,
    ActionValidationResult,
    WorkspaceConsistencyIssue,
    WorkspaceManifest,
    inspect_manifest_consistency,
    validate_plan_against_manifest,
)
from workspace_store import AgentTurnRecord, WorkspaceStore  # noqa: E402
from agent_context import (  # noqa: E402
    WorkspaceAnatomyContext,
    compact_anatomy_context,
    conversation_context,
)
from region_anatomy_prompt import build_region_anatomy_prompt  # noqa: E402
from workspace_commands import COMMAND_CATALOG, CommandError, CommandRequest, CommandResponse, parse_explicit_command  # noqa: E402
from workspace_agent import AgentProposal, AgentTurnResponse, build_agent_turn, fallback_agent_turn  # noqa: E402
from workspace_agent_prompt import WORKSPACE_AGENT_SYSTEM_INSTRUCTION  # noqa: E402
from gradcam_service import generate_ensemble_gradcam  # noqa: E402
from three_d_service import (  # noqa: E402
    ReconstructionBusyError,
    RemoteThreeDUnavailable,
    get_job,
    get_remote_url,
    probe_remote_backend,
    set_remote_url,
    start_reconstruction,
)
from dicom_service import DicomImportError, parse_dicom_bytes  # noqa: E402
from pathology_service import (  # noqa: E402
    PathologyUnavailableError,
    active_url as get_pathology_active_url,
    detect_pathologies as detect_pathologies_remote,
    get_remote_url as get_pathology_remote_url,
    probe_remote_backend as probe_pathology_backend,
    set_remote_url as set_pathology_remote_url,
)
from sorter_service import (  # noqa: E402
    OpenCxrUnavailableError,
    active_url as get_opencxr_active_url,
    is_available as opencxr_available,
    probe_remote_backend as probe_opencxr_backend,
    set_remote_url as set_opencxr_remote_url,
    sort_image as opencxr_sort_image,
    standardize_image as opencxr_standardize_image,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("server.main")

registry = ModelRegistry()
startup_errors: List[str] = []
workspace_store = WorkspaceStore()
RADIOGRAPHY_DICOM_MODALITIES = {"CR", "DX"}
DICOM_GEMINI_PRIVATE_FIELDS = (
    "study_instance_uid",
    "series_instance_uid",
    "sop_instance_uid",
    "frame_of_reference_uid",
    "patient_pseudonym",
)


def _three_d_default_iterations() -> int:
    """Itérations par défaut du pipeline 3D (n_iter de la config, pas 150).

    Import paresseux : ``three_d_maker`` n'est importable qu'après
    ``bootstrap_all()`` ; on le charge à la première requête, pas à l'import.
    """
    from three_d_maker.config import MODEL_CONFIG  # noqa: PLC0415

    return int(MODEL_CONFIG["reconstruction"]["n_iter"])


def _is_cxas_infrastructure_error(message: str | None) -> bool:
    """Une erreur CXAS est une panne d'infrastructure (lib/poids absents) ?"""
    if not message:
        return False
    return any(marker in message for marker in (
        "n'est pas installée",
        "n'a pas pu être instancié",
        "poids non téléchargés",
    ))


def _is_radiography_compatible(image) -> bool:
    """The loaded ensemble is restricted to computed/digital radiographs."""
    if image.source_kind != "dicom":
        return True
    modality = (image.metadata.modality or "").strip().upper()
    return modality in RADIOGRAPHY_DICOM_MODALITIES


def _radiography_modality_message(image) -> str:
    modality = image.metadata.modality or "DICOM sans modalité"
    return (
        f"'{image.name}' ignorée : le modèle radiographique est limité aux DICOM CR/DX "
        f"(modalité reçue : {modality})."
    )


def _manifest_context_for_gemini(manifest: WorkspaceManifest) -> dict:
    """Prépare le manifeste pour Gemini sans données de pixels ni identifiants DICOM."""
    context = manifest.model_dump(mode="json", exclude_none=True)
    for image in context["images"]:
        image["canvas"].pop("rendered_canvas", None)
        # Les identifiants DICOM servent aux contrôles locaux de cohérence. Ils
        # ne sont pas nécessaires au raisonnement du modèle conversationnel.
        for field_name in DICOM_GEMINI_PRIVATE_FIELDS:
            image.get("metadata", {}).pop(field_name, None)
    return context

WORKSPACE_PLANNER_INSTRUCTION = """Tu es le planificateur d'actions d'un poste d'imagerie medicale.
Transforme l'instruction utilisateur en un ActionPlan JSON. La reponse DOIT etre exactement cet objet :
{"protocol_version":"1.0","summary":"resume court","actions":[...]}
N'utilise jamais les cles kind, exam_id, properties, oneOf ou discriminator. Chaque action DOIT avoir
id, order, type et reason. La cle est obligatoirement type, jamais kind.

Exemple obligatoire pour une question explicative sans modification du canvas :
{"protocol_version":"1.0","summary":"Reponse informative.","actions":[{"id":"notify-0","order":0,"type":"notify","reason":"L'utilisateur demande une explication.","level":"info","message":"Reponse clinique prudente, sans diagnostic definitif."}]}

Types et champs supplementaires autorises :
- notify : level (info|warning|error), message
- zoom_to_region : target_image_id, region {x,y,w,h}
- set_window_level : target_image_id, window, level
- set_brightness ou set_contrast : target_image_id, value entre 0 et 100
- invert : target_image_id, value booleen
- show_gradcam : target_image_id, visible, opacity entre 0 et 100
- create_shape : target_image_id, shape {id,type,x,y,w,h,points,visible,created_by:"ai",style}; label est optionnel
- update_shape ou delete_shape : target_image_id, shape_id; update_shape requiert patch
- set_layer_visibility : target_image_id, layer (image|annotations|measurements|gradcam), visible
- set_layer_opacity : target_image_id, layer (image|annotations|measurements|gradcam), opacity
- analyze_image, predict ou generate_gradcam : target_image_id
- analyze_exam et generate_report : aucun champ supplementaire

Tu ne fais aucune action hors de ce plan. Utilise exclusivement les image_id et shape_id presents dans
le manifeste. Les coordonnees sont en pixels de l'image cible. Pour ajouter une forme, utilise un id
unique et renseigne explicitement le style si l'utilisateur en donne un. N'invente pas de resultat
medical ni de mesure calibree si le Pixel Spacing est absent. Si l'intention est impossible, emets une
action notify de niveau warning ou error. Les ordres sont consecutifs et strictement croissants a partir
de 0. Ne produis aucun texte hors du JSON."""


@asynccontextmanager
async def lifespan(app: FastAPI):
    startup_errors.clear()
    logger.info("Démarrage : chargement des modèles...")

    try:
        registry.load_radiography(RadiographyServerConfig())
    except Exception as exc:  # noqa: BLE001
        logger.exception("Chargement des modèles radiographiques impossible.")
        startup_errors.append(f"radiography: {exc}")

    # CXAS (segmentation anatomique) : préchargé ici plutôt qu'à la première
    # requête pour supprimer le coût froid (imports, UNet, poids) en analyse.
    try:
        t0 = time.perf_counter()
        from anatomy_service import preload as preload_anatomy  # noqa: PLC0415

        preload_anatomy()
        logger.info("CXAS préchargé en %.1f s.", time.perf_counter() - t0)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Préchargement CXAS impossible : %s", exc)
        startup_errors.append(f"anatomy: {exc}")

    # HybridGNet (landmarks poumons + cœur) : mêmes motif et gestion d'erreur.
    try:
        t0 = time.perf_counter()
        from chexmask_service import preload as preload_hybridgnet  # noqa: PLC0415

        preload_hybridgnet()
        logger.info("HybridGNet préchargé en %.1f s.", time.perf_counter() - t0)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Préchargement HybridGNet impossible : %s", exc)
        startup_errors.append(f"hybridgnet: {exc}")

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
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "http://0.0.0.0:5173", "http://192.168.0.120:5173", "http://10.44.189.180:5173"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT"],
    allow_headers=["Content-Type"],
)


class WorkspaceSessionResponse(BaseModel):
    workspace_id: str
    protocol_version: str
    exam_id: str
    image_count: int
    consistency_issues: List[WorkspaceConsistencyIssue] = []


class WorkspaceImagePrediction(BaseModel):
    image_id: str
    prediction: dict


class WorkspaceAnalysisResponse(BaseModel):
    workspace_id: str
    results: List[WorkspaceImagePrediction]
    warnings: List[str] = []


class WorkspaceGradcamResponse(BaseModel):
    workspace_id: str
    image_id: str
    class_name: str
    model_count: int
    heatmap_data_url: str
    peak_region: dict[str, float] | None = None
    generated_at: str
    per_model: List[dict]


class WorkspaceAnatomyResponse(BaseModel):
    workspace_id: str
    image_id: str
    status: str = "ok"  # ok | error
    error: str | None = None
    measurements: dict = {}
    segmentation: dict = {}
    warnings: List[str] = []
    inference_time_ms: float | None = None
    generated_at: str


class AnatomyRegionItem(BaseModel):
    model_config = {"extra": "forbid"}

    id: str
    label: str
    structures: list[str] = Field(default_factory=list)
    reference: str = ""


class WorkspaceAnatomyRegionsRequest(BaseModel):
    model_config = {"extra": "forbid"}

    image_id: str
    canvas_data_url: str | None = None
    anatomy: WorkspaceAnatomyContext
    regions: list[AnatomyRegionItem]


class WorkspaceAnatomyRegionsResponse(BaseModel):
    model_config = {"extra": "forbid"}

    region_texts: dict[str, str] = Field(default_factory=dict)
    """Statut anomalie par région : True = écart visible/mesuré signalé."""
    region_anomalies: dict[str, bool] = Field(default_factory=dict)


class WorkspaceThreeDJobResponse(BaseModel):
    workspace_id: str
    image_id: str
    job_id: str
    status: str
    progress: dict = {}
    error: str | None = None


class WorkspaceThreeDStatusResponse(BaseModel):
    job_id: str
    status: str
    progress: dict = {}
    result: dict | None = None
    error: str | None = None


class WorkspaceLandmarksResponse(BaseModel):
    workspace_id: str
    image_id: str
    status: str = "ok"  # ok | error
    error: str | None = None
    contours: dict = {}
    measurements: dict = {}
    custom: list = []
    warnings: List[str] = []
    uncertainty: dict = {}
    scale_used: str = "pixels"
    ctr_method: str = ""
    lines: list = []
    inference_time_ms: float | None = None
    generated_at: str


class AnatomyAnalysisSourceResult(BaseModel):
    """Résultat d'un moteur anatomique (CXAS ou HybridGNet).

    ``source`` identifie le moteur exact qui a produit ``payload`` : les deux
    analyses ne sont jamais fusionnées mathématiquement, le client peut
    afficher séparément ``source=CXAS`` et ``source=HybridGNet``.
    """

    source: Literal["CXAS", "HybridGNet"]
    status: str = "ok"  # ok | error
    error: str | None = None
    inference_time_ms: float | None = None
    payload: dict = {}


class WorkspaceAnatomyAnalysisResponse(BaseModel):
    workspace_id: str
    image_id: str
    status: str = "ok"  # ok | partial | error
    sources: List[str] = []
    cxas: AnatomyAnalysisSourceResult | None = None
    hybridgnet: AnatomyAnalysisSourceResult | None = None
    warnings: List[str] = []
    inference_time_ms: float | None = None
    generated_at: str


class ThreeDBackendInfo(BaseModel):
    mode: str = "local"  # local | remote
    remote_url: str | None = None
    reachable: bool | None = None
    backend: dict | None = None


class ThreeDBackendUpdate(BaseModel):
    remote_url: str = ""


class OpenCxrBackendInfo(BaseModel):
    mode: str = "local"  # local = désactivé, remote = microservice opencxr
    remote_url: str | None = None
    reachable: bool | None = None
    backend: dict | None = None


class OpenCxrBackendUpdate(BaseModel):
    remote_url: str = ""


class WorkspaceOpenCxrSortResponse(BaseModel):
    workspace_id: str
    image_id: str
    result: dict
    generated_at: str


class WorkspaceOpenCxrStandardizeResponse(BaseModel):
    workspace_id: str
    image_id: str
    image_data_url: str
    width: int
    height: int
    # opencxr renvoie la liste des opérations appliquées (crop/resize/pad).
    size_changes: list = []
    inference_time_ms: float | None = None
    generated_at: str


class PathologyBackendInfo(BaseModel):
    mode: str = "remote"  # toujours remote : Space public par défaut ou surcharge
    remote_url: str | None = None
    reachable: bool | None = None
    backend: dict | None = None


class PathologyBackendUpdate(BaseModel):
    remote_url: str = ""


class WorkspacePathologyDetectResponse(BaseModel):
    workspace_id: str
    image_id: str
    result: dict
    inference_time_ms: float | None = None
    generated_at: str


class DicomMetadataResponse(BaseModel):
    modality: str | None = None
    study_instance_uid: str | None = None
    series_instance_uid: str | None = None
    sop_instance_uid: str | None = None
    frame_of_reference_uid: str | None = None
    patient_pseudonym: str | None = None
    pixel_spacing_mm: tuple[float, float] | None = None
    body_part_examined: str | None = None
    view_position: str | None = None
    study_date: str | None = None
    study_description: str | None = None
    series_description: str | None = None
    photometric_interpretation: str | None = None
    rows: int | None = None
    columns: int | None = None
    bits_stored: int | None = None
    window_center: float | None = None
    window_width: float | None = None
    number_of_frames: int


class DicomFrameResponse(BaseModel):
    frame_index: int
    image_data_url: str
    width: int
    height: int
    linear_data_url: str | None = None
    linear_min: float | None = None
    linear_max: float | None = None
    linear_scale: float | None = None


class DicomImportResponse(BaseModel):
    metadata: DicomMetadataResponse
    frames: List[DicomFrameResponse]
    warnings: List[str] = []


class WorkspaceInstructionRequest(BaseModel):
    instruction: str


class WorkspacePlanResponse(BaseModel):
    validation: ActionValidationResult


class WorkspaceVisualContextRequest(BaseModel):
    """Décrit les captures déjà stockées dans le manifeste temporaire."""

    available: bool = False
    image_ids: List[str] = Field(default_factory=list)


class WorkspaceAnatomyContext(BaseModel):
    """Contexte compact de la segmentation CXAS d'une image (jamais les masques binaires).

    Ce qui est transmis : état, mesures (CTR, SCD...), structures clés avec
    leur aire en pixels, labels, dimensions du masque, provenance. Les data
    URLs (masques/overlay) sont exclues pour ne pas gonfler le prompt.
    """

    model_config = {"extra": "ignore"}

    status: str = "ok"
    error: str | None = None
    measurements: dict[str, dict] = Field(default_factory=dict)
    labels: dict[str, str] = Field(default_factory=dict)
    areas_px: dict[str, float] = Field(default_factory=dict)
    mask_shape: List[int] | None = None
    file_size: List[int] | None = None
    mask_downscaled: bool | None = None
    generated_at: str | None = None


class WorkspaceAgentTurnRequest(BaseModel):
    instruction: str
    predictions: dict[str, dict] = Field(default_factory=dict)
    visual_context: WorkspaceVisualContextRequest = Field(default_factory=WorkspaceVisualContextRequest)
    anatomy: dict[str, WorkspaceAnatomyContext] = Field(default_factory=dict)


@app.post("/workspace/exams", response_model=WorkspaceSessionResponse, status_code=201)
async def create_workspace_exam(manifest: WorkspaceManifest) -> WorkspaceSessionResponse:
    """Enregistre le contexte de travail temporaire pour les futurs plans IA."""
    session = workspace_store.create(manifest)
    return WorkspaceSessionResponse(
        workspace_id=session.id,
        protocol_version=manifest.protocol_version,
        exam_id=manifest.exam_id,
        image_count=len(manifest.images),
        consistency_issues=inspect_manifest_consistency(manifest),
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
        consistency_issues=inspect_manifest_consistency(manifest),
    )


@app.post("/workspace/exams/{workspace_id}/actions/validate", response_model=ActionValidationResult)
async def validate_workspace_actions(workspace_id: str, plan: ActionPlan) -> ActionValidationResult:
    """Valide un plan structuré sans l'exécuter dans le navigateur."""
    session = workspace_store.get(workspace_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Espace de travail temporaire introuvable ou expiré.")
    return validate_plan_against_manifest(plan, session.manifest)


@app.post("/workspace/exams/{workspace_id}/analyze", response_model=WorkspaceAnalysisResponse)
async def analyze_workspace_exam(
    workspace_id: str,
    image_ids: List[str] = Form(...),
    images: List[UploadFile] = File(...),
) -> WorkspaceAnalysisResponse:
    """Classifie plusieurs images d'un même espace de travail temporaire."""
    session = workspace_store.get(workspace_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Espace de travail temporaire introuvable ou expiré.")
    if not registry.radiography_models:
        raise HTTPException(status_code=503, detail="Modèles radiographie non chargés.")
    if len(image_ids) != len(images):
        raise HTTPException(status_code=422, detail="Chaque fichier doit avoir exactement un image_id associé.")
    if len(set(image_ids)) != len(image_ids):
        raise HTTPException(status_code=422, detail="Les image_id envoyés doivent être uniques.")

    images_by_id = {item.image_id: item for item in session.manifest.images}
    known_ids = set(images_by_id)
    unknown = set(image_ids) - known_ids
    if unknown:
        raise HTTPException(status_code=422, detail=f"Images inconnues dans cet espace : {sorted(unknown)}")

    results: List[WorkspaceImagePrediction] = []
    modality_warnings: list[str] = []
    for image_id, image in zip(image_ids, images):
        workspace_image = images_by_id[image_id]
        if not _is_radiography_compatible(workspace_image):
            modality_warnings.append(_radiography_modality_message(workspace_image))
            continue
        suffix = Path(image.filename or "image.jpg").suffix or ".jpg"
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(await image.read())
            tmp_path = Path(tmp.name)
        try:
            prediction = predict_with_loaded_models(tmp_path, registry.radiography_models, registry.radiography_device)
            prediction["image"] = image.filename
            results.append(WorkspaceImagePrediction(image_id=image_id, prediction=prediction))
        except Exception as exc:  # noqa: BLE001
            logger.exception("Échec de la prédiction de l'image %s.", image_id)
            raise HTTPException(status_code=500, detail=f"Échec de la prédiction de '{image_id}' : {exc}") from exc
        finally:
            tmp_path.unlink(missing_ok=True)

    if not results:
        raise HTTPException(
            status_code=422,
            detail="Aucune image compatible avec le modèle radiographique : seuls les DICOM CR/DX sont acceptés.",
        )
    consistency_warnings = [
        issue.message
        for issue in inspect_manifest_consistency(session.manifest)
    ]
    return WorkspaceAnalysisResponse(
        workspace_id=workspace_id,
        results=results,
        warnings=[*consistency_warnings, *modality_warnings],
    )


@app.post("/workspace/exams/{workspace_id}/gradcam", response_model=WorkspaceGradcamResponse)
async def generate_workspace_gradcam(
    workspace_id: str,
    image_id: str = Form(...),
    image: UploadFile = File(...),
    class_name: str | None = Form(default=None),
) -> WorkspaceGradcamResponse:
    """Calcule la Grad-CAM réelle de l'ensemble pour une image du workspace."""
    session = workspace_store.get(workspace_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Espace de travail temporaire introuvable ou expiré.")
    if not registry.radiography_models:
        raise HTTPException(status_code=503, detail="Modèles radiographie non chargés.")
    workspace_image = next((item for item in session.manifest.images if item.image_id == image_id), None)
    if workspace_image is None:
        raise HTTPException(status_code=422, detail=f"Image inconnue dans cet espace : '{image_id}'.")
    if not _is_radiography_compatible(workspace_image):
        raise HTTPException(status_code=422, detail=_radiography_modality_message(workspace_image))

    suffix = Path(image.filename or "image.png").suffix or ".png"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(await image.read())
        tmp_path = Path(tmp.name)
    try:
        result = generate_ensemble_gradcam(
            tmp_path,
            registry.radiography_models,
            registry.radiography_device,
            class_name.strip() if class_name else None,
        )
        return WorkspaceGradcamResponse(
            workspace_id=workspace_id,
            image_id=image_id,
            class_name=result.class_name,
            model_count=result.model_count,
            heatmap_data_url=result.heatmap_data_url,
            peak_region=result.peak_region,
            generated_at=result.generated_at,
            per_model=result.per_model,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("Échec du calcul Grad-CAM pour l'image %s.", image_id)
        raise HTTPException(status_code=500, detail="Échec du calcul Grad-CAM.") from exc
    finally:
        tmp_path.unlink(missing_ok=True)


@app.post("/workspace/exams/{workspace_id}/3d", response_model=WorkspaceThreeDJobResponse, status_code=202)
async def generate_workspace_3d(
    workspace_id: str,
    image_id: str = Form(...),
    image: UploadFile = File(...),
    iterations: int | None = Form(default=None, ge=1, le=1500),
) -> WorkspaceThreeDJobResponse:
    """Lance la reconstruction DeepScan3D d'une radio et retourne un job.

    La reconstruction s'exécute en arrière-plan (plusieurs minutes sur CPU) :
    interroger GET /workspace/exams/{id}/3d/jobs/{job_id} pour la progression.
    """
    session = workspace_store.get(workspace_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Espace de travail temporaire introuvable ou expiré.")
    workspace_image = next((item for item in session.manifest.images if item.image_id == image_id), None)
    if workspace_image is None:
        raise HTTPException(status_code=422, detail=f"Image inconnue dans cet espace : '{image_id}'.")
    if not _is_radiography_compatible(workspace_image):
        raise HTTPException(status_code=422, detail=_radiography_modality_message(workspace_image))
    try:
        job = start_reconstruction(
            await image.read(),
            workspace_id=workspace_id,
            image_id=image_id,
            image_name=workspace_image.name,
            # Défaut aligné sur la config du pipeline (n_iter=600) plutôt que 150 :
            # 150 itérations sous-entraînent la reconstruction (résultat flou).
            # Ce défaut est aussi celui envoyé au backend distant (GPU) : c'est le
            # levier de qualité principal pour le tunnel actif.
            iterations=iterations or _three_d_default_iterations(),
        )
    except ReconstructionBusyError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except RemoteThreeDUnavailable as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return WorkspaceThreeDJobResponse(
        workspace_id=workspace_id,
        image_id=image_id,
        job_id=job["job_id"],
        status=job["status"],
        progress=job["progress"],
        error=job["error"],
    )


@app.post("/workspace/exams/{workspace_id}/anatomy", response_model=WorkspaceAnatomyResponse)
async def generate_workspace_anatomy(
    workspace_id: str,
    image_id: str = Form(...),
    image: UploadFile = File(...),
    pixel_spacing_mm: str | None = Form(default=None),
) -> WorkspaceAnatomyResponse:
    """Segmente anatomiquement une image (CXAS) et mesure CTR/SCD.

    CXAS est chargé paresseusement à la première demande (poids
    téléchargés au premier appel) ; le serveur reste disponible sans.
    """
    session = workspace_store.get(workspace_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Espace de travail temporaire introuvable ou expiré.")
    workspace_image = next((item for item in session.manifest.images if item.image_id == image_id), None)
    if workspace_image is None:
        raise HTTPException(status_code=422, detail=f"Image inconnue dans cet espace : '{image_id}'.")
    if not _is_radiography_compatible(workspace_image):
        raise HTTPException(status_code=422, detail=_radiography_modality_message(workspace_image))

    # (ligne,col) du DICOM source ; les JPG n'en ont pas -> reste en pixels.
    spacing = None
    if pixel_spacing_mm:
        try:
            values = tuple(float(x) for x in pixel_spacing_mm.split(","))
            spacing = values if len(values) == 2 else None
        except ValueError:
            raise HTTPException(status_code=422, detail="pixel_spacing_mm attend R,C (ex: 0.1688,0.1688)") from None

    suffix = Path(image.filename or "image.png").suffix or ".png"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(await image.read())
        tmp_path = Path(tmp.name)
    try:
        from anatomy_service import analyze_anatomy_image  # noqa: PLC0415
        from anatomy.cxas_engine import CxasUnavailableError  # noqa: PLC0415

        result = analyze_anatomy_image(
            tmp_path, CxasServerConfig(), pixel_spacing_mm=spacing
        )
        if result["status"] == "error" and _is_cxas_infrastructure_error(result.get("error")):
            # Erreur CXAS connue (bibliothèque/poids absents) : même surface
            # d'erreur que /landmarks (503), pas un 200 ambigu. Un statut
            # "error" sans message CXAS reste un résultat d'analyse valide
            # (ex. "aucune structure anatomique détectée").
            raise CxasUnavailableError(result["error"] or "Analyse anatomique impossible")
        return WorkspaceAnatomyResponse(
            workspace_id=workspace_id,
            image_id=image_id,
            status=result["status"],
            error=result["error"],
            measurements=result["measurements"],
            segmentation=result["segmentation"],
            warnings=result["warnings"],
            inference_time_ms=result["inference_time_ms"],
            generated_at=datetime.now(UTC).isoformat(),
        )
    except CxasUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("Échec de l'analyse anatomique pour l'image %s.", image_id)
        raise HTTPException(status_code=500, detail=f"Échec de l'analyse anatomique : {exc}") from exc
    finally:
        tmp_path.unlink(missing_ok=True)


@app.post("/workspace/exams/{workspace_id}/landmarks", response_model=WorkspaceLandmarksResponse)
async def generate_workspace_landmarks(
    workspace_id: str,
    image_id: str = Form(...),
    image: UploadFile = File(...),
    pixel_spacing_mm: str | None = Form(default=None),
    custom_measures: str | None = Form(default=None),
    n_samples: str = Form(default="50"),
) -> WorkspaceLandmarksResponse:
    """Traque les contours poumons + cœur (HybridGNet) et mesure CTR/diamètres.

    Les landmarks sont prédits avec incertitude par nœud (échantillonnage
    stochastique du VAE) ; ``custom_measures`` est un JSON de mesures libres :
    [{label, a, b}] (distance entre nœuds) ou [{label, nodes: [i, j, ...]}]
    (surface d'un contour fermé). Le moteur (torch + torch_geometric + poids)
    est chargé paresseusement à la première demande.
    """
    from chexmask_service import analyze_landmarks, is_available as chexmask_available  # noqa: PLC0415
    from chexmask.inference import CheXmaskUnavailableError  # noqa: PLC0415

    session = workspace_store.get(workspace_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Espace de travail temporaire introuvable ou expiré.")
    workspace_image = next((item for item in session.manifest.images if item.image_id == image_id), None)
    if workspace_image is None:
        raise HTTPException(status_code=422, detail=f"Image inconnue dans cet espace : '{image_id}'.")
    if not _is_radiography_compatible(workspace_image):
        raise HTTPException(status_code=422, detail=_radiography_modality_message(workspace_image))
    if not chexmask_available():
        raise HTTPException(
            status_code=503,
            detail="Moteur landmarks (HybridGNet) indisponible : torch/torch_geometric "
            "ou poids du modèle manquants.",
        )

    spacing = None
    if pixel_spacing_mm:
        try:
            values = tuple(float(x) for x in pixel_spacing_mm.split(","))
            spacing = values if len(values) == 2 else None
        except ValueError:
            raise HTTPException(status_code=422, detail="pixel_spacing_mm attend R,C (ex: 0.1688,0.1688)") from None

    custom = None
    if custom_measures:
        try:
            custom = json.loads(custom_measures)
        except json.JSONDecodeError:
            raise HTTPException(status_code=422, detail="custom_measures : JSON invalide.") from None

    try:
        samples = int(n_samples)
        samples = samples if 1 <= samples <= 200 else 50
    except ValueError:
        samples = 50

    suffix = Path(image.filename or "image.png").suffix or ".png"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(await image.read())
        tmp_path = Path(tmp.name)
    try:
        result = analyze_landmarks(
            tmp_path,
            pixel_spacing_mm=spacing,
            custom_measures=custom,
            n_samples=samples,
        )
        return WorkspaceLandmarksResponse(
            workspace_id=workspace_id,
            image_id=image_id,
            status=result["status"],
            error=result.get("error"),
            contours=result["contours"],
            measurements=result["measurements"],
            custom=result["custom"],
            warnings=result["warnings"],
            uncertainty=result["uncertainty"],
            scale_used=result["scale_used"],
            ctr_method=result["ctr_method"],
            lines=result["lines"],
            inference_time_ms=result["inference_time_ms"],
            generated_at=datetime.now(UTC).isoformat(),
        )
    except CheXmaskUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("Échec de l'analyse landmarks pour l'image %s.", image_id)
        raise HTTPException(status_code=500, detail=f"Échec de l'analyse landmarks : {exc}") from exc
    finally:
        tmp_path.unlink(missing_ok=True)


@app.post("/workspace/exams/{workspace_id}/anatomy-analysis", response_model=WorkspaceAnatomyAnalysisResponse)
async def generate_workspace_anatomy_analysis(
    workspace_id: str,
    image_id: str = Form(...),
    image: UploadFile = File(...),
    pixel_spacing_mm: str | None = Form(default=None),
    n_samples: str = Form(default="50"),
) -> WorkspaceAnatomyAnalysisResponse:
    """Analyse anatomique unifiée : segmentation CXAS + landmarks HybridGNet.

    Les deux moteurs restent strictement séparés (``cxas`` / ``hybridgnet``
    dans la réponse, chacun avec sa ``source``) : aucune fusion mathématique.
    Une défaillance d'un moteur n'empêche pas l'autre — le statut global est
    alors ``partial``.
    """
    session = workspace_store.get(workspace_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Espace de travail temporaire introuvable ou expiré.")
    workspace_image = next((item for item in session.manifest.images if item.image_id == image_id), None)
    if workspace_image is None:
        raise HTTPException(status_code=422, detail=f"Image inconnue dans cet espace : '{image_id}'.")
    if not _is_radiography_compatible(workspace_image):
        raise HTTPException(status_code=422, detail=_radiography_modality_message(workspace_image))

    spacing = None
    if pixel_spacing_mm:
        try:
            values = tuple(float(x) for x in pixel_spacing_mm.split(","))
            spacing = values if len(values) == 2 else None
        except ValueError:
            raise HTTPException(status_code=422, detail="pixel_spacing_mm attend R,C (ex: 0.1688,0.1688)") from None

    try:
        samples = int(n_samples)
        samples = samples if 1 <= samples <= 200 else 50
    except ValueError:
        samples = 50

    suffix = Path(image.filename or "image.png").suffix or ".png"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(await image.read())
        tmp_path = Path(tmp.name)

    started = time.perf_counter()
    warnings: list[str] = []
    cxas_result: AnatomyAnalysisSourceResult | None = None
    hybridgnet_result: AnatomyAnalysisSourceResult | None = None

    try:
        try:
            from anatomy_service import analyze_anatomy_image  # noqa: PLC0415
            from anatomy.cxas_engine import CxasUnavailableError  # noqa: PLC0415

            cxas = analyze_anatomy_image(tmp_path, CxasServerConfig(), pixel_spacing_mm=spacing)
            cxas_result = AnatomyAnalysisSourceResult(
                source="CXAS",
                status=cxas.get("status", "error"),
                error=cxas.get("error"),
                inference_time_ms=cxas.get("inference_time_ms"),
                payload={
                    "segmentation": cxas.get("segmentation", {}),
                    "measurements": cxas.get("measurements", {}),
                    "warnings": cxas.get("warnings", []),
                },
            )
            if cxas_result.status != "ok":
                warnings.append(f"Source CXAS : {cxas.get('error') or 'résultat non exploitable'}")
        except CxasUnavailableError as exc:
            cxas_result = AnatomyAnalysisSourceResult(source="CXAS", status="error", error=str(exc))
            warnings.append(f"Source CXAS indisponible : {exc}")
        except Exception as exc:  # noqa: BLE001
            logger.exception("Analyse anatomique CXAS en échec pour %s.", image_id)
            cxas_result = AnatomyAnalysisSourceResult(source="CXAS", status="error", error=f"{type(exc).__name__}: {exc}")
            warnings.append(f"Source CXAS en échec : {exc}")

        try:
            from chexmask_service import analyze_landmarks  # noqa: PLC0415
            from chexmask.inference import CheXmaskUnavailableError  # noqa: PLC0415

            lm = analyze_landmarks(tmp_path, pixel_spacing_mm=spacing, n_samples=samples)
            hybridgnet_result = AnatomyAnalysisSourceResult(
                source="HybridGNet",
                status=lm.get("status", "error"),
                error=lm.get("error"),
                inference_time_ms=lm.get("inference_time_ms"),
                payload={
                    "contours": lm.get("contours", {}),
                    "measurements": lm.get("measurements", {}),
                    "custom": lm.get("custom", []),
                    "warnings": lm.get("warnings", []),
                    "uncertainty": lm.get("uncertainty", {}),
                    "scale_used": lm.get("scale_used", "pixels"),
                    "ctr_method": lm.get("ctr_method", ""),
                    "lines": lm.get("lines", []),
                },
            )
            if hybridgnet_result.status != "ok":
                warnings.append(f"Source HybridGNet : {lm.get('error') or 'résultat non exploitable'}")
        except CheXmaskUnavailableError as exc:
            hybridgnet_result = AnatomyAnalysisSourceResult(source="HybridGNet", status="error", error=str(exc))
            warnings.append(f"Source HybridGNet indisponible : {exc}")
        except Exception as exc:  # noqa: BLE001
            logger.exception("Analyse landmarks HybridGNet en échec pour %s.", image_id)
            hybridgnet_result = AnatomyAnalysisSourceResult(source="HybridGNet", status="error", error=f"{type(exc).__name__}: {exc}")
            warnings.append(f"Source HybridGNet en échec : {exc}")
    finally:
        tmp_path.unlink(missing_ok=True)

    sources = [block.source for block in (cxas_result, hybridgnet_result) if block is not None]
    statuses = [block.status for block in (cxas_result, hybridgnet_result) if block is not None]
    global_status = "ok" if statuses and all(s == "ok" for s in statuses) else ("partial" if any(s == "ok" for s in statuses) else "error")

    return WorkspaceAnatomyAnalysisResponse(
        workspace_id=workspace_id,
        image_id=image_id,
        status=global_status,
        sources=sources,
        cxas=cxas_result,
        hybridgnet=hybridgnet_result,
        warnings=warnings,
        inference_time_ms=round((time.perf_counter() - started) * 1000, 1),
        generated_at=datetime.now(UTC).isoformat(),
    )


@app.post("/workspace/exams/{workspace_id}/opencxr/sort", response_model=WorkspaceOpenCxrSortResponse)
async def opencxr_sort_workspace_image(
    workspace_id: str,
    image_id: str = Form(...),
    image: UploadFile = File(...),
) -> WorkspaceOpenCxrSortResponse:
    """Classifie une radio (PA/AP/lateral/notCXR) via le microservice opencxr."""
    session = workspace_store.get(workspace_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Espace de travail temporaire introuvable ou expiré.")
    workspace_image = next((item for item in session.manifest.images if item.image_id == image_id), None)
    if workspace_image is None:
        raise HTTPException(status_code=422, detail=f"Image inconnue dans cet espace : '{image_id}'.")
    if not opencxr_available():
        raise HTTPException(status_code=503, detail="Microservice opencxr indisponible ou non configuré.")
    data = await image.read()
    if not data:
        raise HTTPException(status_code=422, detail="Image vide.")
    try:
        result = opencxr_sort_image(data, image.filename or "image.png")
    except OpenCxrUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return WorkspaceOpenCxrSortResponse(
        workspace_id=workspace_id,
        image_id=image_id,
        result=result,
        generated_at=datetime.now(UTC).isoformat(),
    )


@app.post("/workspace/exams/{workspace_id}/opencxr/standardize", response_model=WorkspaceOpenCxrStandardizeResponse)
async def opencxr_standardize_workspace_image(
    workspace_id: str,
    image_id: str = Form(...),
    image: UploadFile = File(...),
    do_crop_to_lung_box: str = Form("true"),
    final_square_size: str = Form("1024"),
    pixel_spacing_mm: str | None = Form(default=None),
) -> WorkspaceOpenCxrStandardizeResponse:
    """Normalise une radio frontale via le microservice opencxr."""
    session = workspace_store.get(workspace_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Espace de travail temporaire introuvable ou expiré.")
    workspace_image = next((item for item in session.manifest.images if item.image_id == image_id), None)
    if workspace_image is None:
        raise HTTPException(status_code=422, detail=f"Image inconnue dans cet espace : '{image_id}'.")
    if not opencxr_available():
        raise HTTPException(status_code=503, detail="Microservice opencxr indisponible ou non configuré.")
    data = await image.read()
    if not data:
        raise HTTPException(status_code=422, detail="Image vide.")
    crop = (do_crop_to_lung_box or "").strip().lower() in {"true", "1", "yes", "on"}
    try:
        size = int(final_square_size)
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail="final_square_size doit être un entier positif.") from None
    # (ligne,col) du DICOM source ; les JPG n'en ont pas -> reste en pixels.
    spacing: tuple[float, float] | None = None
    if pixel_spacing_mm:
        try:
            values = tuple(float(x) for x in pixel_spacing_mm.split(","))
            spacing = values if len(values) == 2 else None
        except ValueError:
            raise HTTPException(status_code=422, detail="pixel_spacing_mm attend R,C (ex: 0.1688,0.1688)") from None
    try:
        result = opencxr_standardize_image(
            data,
            image.filename or "image.png",
            do_crop_to_lung_box=crop,
            final_square_size=size,
            pixel_spacing_mm=spacing,
        )
    except OpenCxrUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return WorkspaceOpenCxrStandardizeResponse(
        workspace_id=workspace_id,
        image_id=image_id,
        image_data_url=result["image_data_url"],
        width=result["width"],
        height=result["height"],
        size_changes=result.get("size_changes", []),
        inference_time_ms=result.get("inference_time_ms"),
        generated_at=datetime.now(UTC).isoformat(),
    )


@app.get("/workspace/opencxr/backend", response_model=OpenCxrBackendInfo)
async def opencxr_backend() -> OpenCxrBackendInfo:
    """État du microservice opencxr (URL effective + sonde de santé)."""
    remote_url = get_opencxr_active_url()
    info = OpenCxrBackendInfo(mode="remote" if remote_url else "local", remote_url=remote_url or None)
    if remote_url:
        info.backend = probe_opencxr_backend()
        info.reachable = info.backend is not None
    return info


@app.put("/workspace/opencxr/backend", response_model=OpenCxrBackendInfo)
async def opencxr_backend_update(payload: OpenCxrBackendUpdate) -> OpenCxrBackendInfo:
    """Change l'URL du microservice opencxr à chaud (vide = désactivé)."""
    try:
        remote_url = set_opencxr_remote_url(payload.remote_url)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    info = OpenCxrBackendInfo(mode="remote" if remote_url else "local", remote_url=remote_url or None)
    if remote_url:
        info.backend = probe_opencxr_backend()
        info.reachable = info.backend is not None
    return info


# --------------------------- Pathologies (backend Neuro) ---------------------------

@app.post(
    "/workspace/exams/{workspace_id}/pathology/detect",
    response_model=WorkspacePathologyDetectResponse,
)
async def pathology_detect_workspace_image(
    workspace_id: str,
    image_id: str = Form(...),
    image: UploadFile = File(...),
) -> WorkspacePathologyDetectResponse:
    """Détection de pathologies + heatmaps via le backend Neuro distant.

    Délègue l'image au pipeline DenseNet-121 (classification + Grad-CAM) et
    YOLOv8s (bounding boxes) exposé par le Space HF communiqué.
    """
    session = workspace_store.get(workspace_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Espace de travail temporaire introuvable ou expiré.")
    workspace_image = next((item for item in session.manifest.images if item.image_id == image_id), None)
    if workspace_image is None:
        raise HTTPException(status_code=422, detail=f"Image inconnue dans cet espace : '{image_id}'.")
    data = await image.read()
    if not data:
        raise HTTPException(status_code=422, detail="Image vide.")
    started = time.perf_counter()
    try:
        result = detect_pathologies_remote(data, image.filename or "image.png")
    except PathologyUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    inference_ms = round((time.perf_counter() - started) * 1000, 1)
    workspace_store.record_audit(workspace_id, {
        "at": datetime.now(UTC).isoformat(),
        "endpoint": "/pathology/detect",
        "image_id": image_id,
        "inference_time_ms": inference_ms,
        "positive_conditions": result.get("positive_conditions", [])[:8],
    })
    return WorkspacePathologyDetectResponse(
        workspace_id=workspace_id,
        image_id=image_id,
        result=result,
        inference_time_ms=inference_ms,
        generated_at=datetime.now(UTC).isoformat(),
    )


@app.get("/workspace/pathology/backend", response_model=PathologyBackendInfo)
async def pathology_backend() -> PathologyBackendInfo:
    """État du backend Neuro (URL effective + sonde de santé)."""
    override = get_pathology_remote_url()
    active = get_pathology_active_url()
    info = PathologyBackendInfo(mode="remote", remote_url=active)
    info.backend = probe_pathology_backend()
    info.reachable = info.backend is not None
    info.mode = "remote-default" if not override else "remote-custom"
    return info


@app.put("/workspace/pathology/backend", response_model=PathologyBackendInfo)
async def pathology_backend_update(payload: PathologyBackendUpdate) -> PathologyBackendInfo:
    """Change l'URL du backend Neuro à chaud (vide = défaut public)."""
    try:
        set_pathology_remote_url(payload.remote_url)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    active = get_pathology_active_url()
    info = PathologyBackendInfo(mode="remote", remote_url=active)
    info.backend = probe_pathology_backend()
    info.reachable = info.backend is not None
    info.mode = "remote-default" if not get_pathology_remote_url() else "remote-custom"
    return info


@app.get("/workspace/exams/{workspace_id}/3d/jobs/{job_id}", response_model=WorkspaceThreeDStatusResponse)
async def workspace_three_d_job_status(
    workspace_id: str,
    job_id: str,
) -> WorkspaceThreeDStatusResponse:
    """Progression et résultat d'un job de reconstruction 3D."""
    try:
        job = get_job(job_id)
    except RemoteThreeDUnavailable as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    if job is None or job["workspace_id"] != workspace_id:
        raise HTTPException(status_code=404, detail="Job 3D introuvable ou expiré.")
    return WorkspaceThreeDStatusResponse(
        job_id=job["job_id"],
        status=job["status"],
        progress=job["progress"],
        result=job["result"],
        error=job["error"],
    )


@app.get("/workspace/3d/backend", response_model=ThreeDBackendInfo)
async def workspace_three_d_backend() -> ThreeDBackendInfo:
    """État du backend 3D (local CPU ou service distant GPU) + sonde de santé."""
    remote_url = get_remote_url()
    info = ThreeDBackendInfo(mode="remote" if remote_url else "local", remote_url=remote_url or None)
    if remote_url:
        info.backend = probe_remote_backend()
        info.reachable = info.backend is not None
    return info


@app.put("/workspace/3d/backend", response_model=ThreeDBackendInfo)
async def workspace_three_d_backend_update(payload: ThreeDBackendUpdate) -> ThreeDBackendInfo:
    """Change le backend 3D à chaud (URL du tunnel) ; vide = retour au CPU local."""
    try:
        remote_url = set_remote_url(payload.remote_url)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    info = ThreeDBackendInfo(mode="remote" if remote_url else "local", remote_url=remote_url or None)
    if remote_url:
        info.backend = probe_remote_backend()
        info.reachable = info.backend is not None
    return info


@app.post("/dicom/parse", response_model=DicomImportResponse)
async def parse_dicom(file: UploadFile = File(...)) -> DicomImportResponse:
    """Rend un DICOM en PNG et extrait ses m\u00e9tadonn\u00e9es non identifiantes."""
    try:
        result = parse_dicom_bytes(await file.read())
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except DicomImportError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("\u00c9chec inattendu pendant l'import DICOM.")
        raise HTTPException(status_code=500, detail="\u00c9chec inattendu pendant la lecture DICOM.") from exc

    metadata = result.metadata
    return DicomImportResponse(
        metadata=DicomMetadataResponse(
            modality=metadata.modality,
            study_instance_uid=metadata.study_instance_uid,
            series_instance_uid=metadata.series_instance_uid,
            sop_instance_uid=metadata.sop_instance_uid,
            frame_of_reference_uid=metadata.frame_of_reference_uid,
            patient_pseudonym=metadata.patient_pseudonym,
            pixel_spacing_mm=metadata.pixel_spacing_mm,
            body_part_examined=metadata.body_part_examined,
            view_position=metadata.view_position,
            study_date=metadata.study_date,
            study_description=metadata.study_description,
            series_description=metadata.series_description,
            photometric_interpretation=metadata.photometric_interpretation,
            rows=metadata.rows,
            columns=metadata.columns,
            bits_stored=metadata.bits_stored,
            window_center=metadata.window_center,
            window_width=metadata.window_width,
            number_of_frames=metadata.number_of_frames,
        ),
        frames=[
            DicomFrameResponse(
                frame_index=frame.frame_index,
                image_data_url=frame.image_data_url,
                width=frame.width,
                height=frame.height,
                linear_data_url=frame.linear_data_url,
                linear_min=frame.linear_min,
                linear_max=frame.linear_max,
                linear_scale=frame.linear_scale,
            )
            for frame in result.frames
        ],
        warnings=result.warnings,
    )


@app.get("/workspace/commands/catalog")
async def workspace_command_catalog() -> list[dict[str, str]]:
    return COMMAND_CATALOG


@app.post("/workspace/exams/{workspace_id}/commands/parse", response_model=CommandResponse)
async def parse_workspace_command(workspace_id: str, request: CommandRequest) -> CommandResponse:
    """Transforme une commande @ explicite en plan structuré, sans l'exécuter."""
    session = workspace_store.get(workspace_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Espace de travail temporaire introuvable ou expiré.")
    try:
        response = parse_explicit_command(request.text, session.manifest)
    except CommandError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    validation = validate_plan_against_manifest(response.plan, session.manifest)
    if not validation.accepted:
        raise HTTPException(status_code=422, detail={"message": "Plan de commande invalide.", "errors": validation.errors})
    return response


@app.post("/workspace/exams/{workspace_id}/ai/plan", response_model=WorkspacePlanResponse)
async def plan_workspace_instruction(workspace_id: str, request: WorkspaceInstructionRequest) -> WorkspacePlanResponse:
    """Planifie une instruction libre avec Gemini, puis valide strictement le JSON produit."""
    session = workspace_store.get(workspace_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Espace de travail temporaire introuvable ou expiré.")
    if registry.gemini_client is None:
        raise HTTPException(status_code=503, detail="Client Gemini non initialisé.")
    instruction = request.instruction.strip()
    if not instruction:
        raise HTTPException(status_code=422, detail="L'instruction IA ne peut pas être vide.")

    manifest = _manifest_context_for_gemini(session.manifest)
    consistency_issues = inspect_manifest_consistency(session.manifest)
    prompt = (
        "Instruction utilisateur :\n"
        f"{instruction}\n\n"
        "Manifeste courant de l'examen :\n"
        f"{json.dumps(manifest, ensure_ascii=False, separators=(',', ':'))}\n\n"
        "Contrôles de cohérence déterministes :\n"
        f"{json.dumps([issue.model_dump(mode='json') for issue in consistency_issues], ensure_ascii=False, separators=(',', ':'))}"
    )
    try:
        plan = registry.gemini_client.generate_json_validated(
            system_instruction=WORKSPACE_PLANNER_INSTRUCTION,
            prompt=prompt,
            response_model=ActionPlan,
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception("Échec de la planification Gemini.")
        raise HTTPException(
            status_code=502,
            detail="Gemini n'a pas pu produire un plan d'actions valide. Réessayez dans quelques secondes.",
        ) from exc

    validation = validate_plan_against_manifest(plan, session.manifest)
    workspace_store.record_audit(workspace_id, {
        "at": datetime.now(UTC).isoformat(),
        "endpoint": "/ai/plan",
        "instruction": instruction[:500],
        "actions_count": len(plan.actions),
        "actions_types": [action.type.value for action in plan.actions],
        "accepted": validation.accepted,
        "errors_count": len(validation.errors),
        "warnings_count": len(validation.warnings),
    })
    if not validation.accepted:
        raise HTTPException(status_code=422, detail={"message": "Plan IA invalide.", "errors": validation.errors})
    return WorkspacePlanResponse(validation=validation)


def _decode_canvas_data_url(data_url: str) -> tuple[str, bytes] | None:
    """Décode une capture canvas data: URI sans jamais l'inclure dans le prompt texte."""
    if not data_url.startswith("data:image/") or "," not in data_url:
        return None
    header, encoded = data_url.split(",", 1)
    if ";base64" not in header:
        return None
    mime_type = header[5:].split(";", 1)[0].lower()
    if mime_type not in {"image/png", "image/jpeg", "image/webp"}:
        return None
    try:
        return mime_type, base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError):
        return None


def _build_visual_parts(
    manifest: WorkspaceManifest,
    requested: WorkspaceVisualContextRequest,
) -> tuple[list[genai_types.Part], list[str], list[str]]:
    """Construit les pièces multimodales correspondant aux captures versionnées du manifeste."""
    if not requested.available:
        return [], [], []

    image_ids = requested.image_ids or ([manifest.active_image_id] if manifest.active_image_id else [])
    images = {image.image_id: image for image in manifest.images}
    parts: list[genai_types.Part] = []
    attached_image_ids: list[str] = []
    warnings: list[str] = []
    for image_id in image_ids:
        image = images.get(image_id)
        if image is None:
            warnings.append(f"Capture visuelle ignorée : image inconnue '{image_id}'.")
            continue
        if not image.canvas.rendered_canvas:
            warnings.append(f"Capture visuelle indisponible pour '{image.name}'.")
            continue
        decoded = _decode_canvas_data_url(image.canvas.rendered_canvas)
        if decoded is None:
            warnings.append(f"Capture visuelle illisible pour '{image.name}'.")
            continue
        mime_type, data = decoded
        parts.append(genai_types.Part.from_text(
            text=(
                f"Capture canvas de l'image_id={image.image_id}, nom={image.name}, "
                f"dimensions originales={image.width}x{image.height}."
            ),
        ))
        parts.append(genai_types.Part.from_bytes(data=data, mime_type=mime_type))
        attached_image_ids.append(image_id)
    return parts, attached_image_ids, warnings


@app.post("/workspace/exams/{workspace_id}/ai/turn", response_model=AgentTurnResponse)
async def run_workspace_agent_turn(
    workspace_id: str,
    request: WorkspaceAgentTurnRequest,
) -> AgentTurnResponse:
    """Produit une réponse IA lisible et des actions optionnelles validées.

    Une erreur Gemini reste un tour IA exploitable pour l'interface : le client
    ne reçoit jamais une trace Pydantic ou le détail brut d'une sortie modèle.
    """
    session = workspace_store.get(workspace_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Espace de travail temporaire introuvable ou expiré.")
    instruction = request.instruction.strip()
    if not instruction:
        raise HTTPException(status_code=422, detail="L'instruction IA ne peut pas être vide.")
    consistency_issues = inspect_manifest_consistency(session.manifest)
    if registry.gemini_client is None:
        unavailable_turn = fallback_agent_turn(
            "Le service conversationnel est momentanément indisponible. Les outils locaux restent utilisables.",
            "Gemini n'est pas prêt sur le serveur.",
        )
        if consistency_issues:
            unavailable_turn = unavailable_turn.model_copy(update={
                "warnings": [*unavailable_turn.warnings, *(issue.message for issue in consistency_issues)],
            })
        return unavailable_turn

    known_image_ids = {image.image_id for image in session.manifest.images}
    unknown_prediction_ids = sorted(set(request.predictions) - known_image_ids)
    predictions = {
        image_id: prediction
        for image_id, prediction in request.predictions.items()
        if image_id in known_image_ids
    }
    unknown_anatomy_ids = sorted(set(request.anatomy) - known_image_ids)
    anatomy_context = {
        image_id: compact_anatomy_context(context)
        for image_id, context in request.anatomy.items()
        if image_id in known_image_ids
    }
    visual_parts, attached_visual_image_ids, visual_warnings = _build_visual_parts(
        session.manifest,
        request.visual_context,
    )

    manifest_context = _manifest_context_for_gemini(session.manifest)
    visual_context = {
        "available": bool(attached_visual_image_ids),
        "image_ids": attached_visual_image_ids,
        "kind": "annotated_canvas_capture" if attached_visual_image_ids else "none",
    }
    recent_turns = workspace_store.conversation_turns(workspace_id)
    conversation_memory = conversation_context(recent_turns)
    prompt = (
        "Instruction utilisateur :\n"
        f"{instruction}\n\n"
        "Manifeste courant (sans le binaire des captures) :\n"
        f"{json.dumps(manifest_context, ensure_ascii=False, separators=(',', ':'))}\n\n"
        "Résultats de prédiction disponibles, indexés par image_id :\n"
        f"{json.dumps(predictions, ensure_ascii=False, separators=(',', ':'))}\n\n"
        "Résultats de segmentation anatomique CXAS (mesures et structures), indexés par image_id :\n"
        f"{json.dumps(anatomy_context, ensure_ascii=False, separators=(',', ':'))}\n\n"
        "Contexte visuel réellement joint :\n"
        f"{json.dumps(visual_context, ensure_ascii=False, separators=(',', ':'))}\n\n"
        "Conversation récente (tours précédents, ordre chronologique) :\n"
        f"{json.dumps(conversation_memory, ensure_ascii=False, separators=(',', ':'))}\n\n"
        "Contrôles de cohérence déterministes :\n"
        f"{json.dumps([issue.model_dump(mode='json') for issue in consistency_issues], ensure_ascii=False, separators=(',', ':'))}\n\n"
        "Capacités disponibles :\n"
        f"{json.dumps({'available_action_types': [action.value for action in ActionType if action.value not in {'generate_3d', 'show_3d'}]}, ensure_ascii=False)}"
    )
    turn_started_at = datetime.now(UTC)
    try:
        proposal = registry.gemini_client.generate_json_validated(
            system_instruction=WORKSPACE_AGENT_SYSTEM_INSTRUCTION,
            prompt=prompt,
            response_model=AgentProposal,
            media_parts=visual_parts,
        )
    except Exception:  # noqa: BLE001
        logger.exception("Échec de la génération du tour IA.")
        fallback = fallback_agent_turn(
            "Je n'ai pas pu produire une réponse fiable pour cette demande. Réessayez dans quelques secondes.",
            "La réponse de Gemini n'a pas pu être validée ; aucune action n'a été exécutée.",
        )
        workspace_store.record_turn(workspace_id, AgentTurnRecord(
            turn_id=str(uuid4().hex[:12]),
            instruction=instruction,
            intent=fallback.intent.value,
            assistant_message=fallback.assistant_message,
            action_types=[],
            validation_accepted=False,
            warnings=fallback.warnings,
        ))
        return fallback

    turn = build_agent_turn(proposal, session.manifest)
    blocking_consistency_issues = [issue for issue in consistency_issues if issue.level == "error"]
    if turn.intent.value == "comparison_request" and blocking_consistency_issues:
        blocked_turn = fallback_agent_turn(
            "Je ne peux pas comparer ces images comme un même examen, car les contrôles DICOM ont détecté une incohérence bloquante.",
            "Aucune action de comparaison n'a été exécutée.",
        )
        blocked_turn = blocked_turn.model_copy(update={
            "warnings": [
                *blocked_turn.warnings,
                *(issue.message for issue in blocking_consistency_issues),
            ],
        })
        workspace_store.record_turn(workspace_id, AgentTurnRecord(
            turn_id=str(uuid4().hex[:12]),
            instruction=instruction,
            intent=turn.intent.value,
            assistant_message=blocked_turn.assistant_message,
            action_types=[],
            validation_accepted=False,
            warnings=blocked_turn.warnings,
        ))
        return blocked_turn
    extra_warnings = [
        *visual_warnings,
        *(issue.message for issue in consistency_issues),
        *(f"Prédiction ignorée : image inconnue '{image_id}'." for image_id in unknown_prediction_ids),
        *(f"Anatomie ignorée : image inconnue '{image_id}'." for image_id in unknown_anatomy_ids),
    ]
    if extra_warnings:
        turn = turn.model_copy(update={"warnings": [*turn.warnings, *extra_warnings]})

    workspace_store.record_turn(workspace_id, AgentTurnRecord(
        turn_id=str(uuid4().hex[:12]),
        instruction=instruction,
        intent=turn.intent.value,
        assistant_message=turn.assistant_message,
        action_types=[action.type.value for action in turn.validation.plan.actions],
        validation_accepted=turn.validation.accepted,
        warnings=turn.warnings,
    ))
    workspace_store.record_audit(workspace_id, {
        "at": datetime.now(UTC).isoformat(),
        "endpoint": "/ai/turn",
        "instruction": instruction[:500],
        "prompt_chars": len(prompt),
        "intent": turn.intent.value,
        "actions_count": len(turn.validation.plan.actions),
        "actions_types": [action.type.value for action in turn.validation.plan.actions],
        "accepted": turn.validation.accepted,
        "errors_count": len(turn.validation.errors),
        "warnings_count": len(turn.warnings),
        "visual_images": attached_visual_image_ids,
        "anatomy_images": list(anatomy_context),
        "elapsed_ms": int((datetime.now(UTC) - turn_started_at).total_seconds() * 1000),
    })
    return turn


@app.post("/workspace/exams/{workspace_id}/anatomy/regions", response_model=WorkspaceAnatomyRegionsResponse)
async def generate_workspace_anatomy_regions(
    workspace_id: str,
    request: WorkspaceAnatomyRegionsRequest,
) -> WorkspaceAnatomyRegionsResponse:
    """Génère l'interprétation IA par région anatomique d'après l'image annotée et la segmentation CXAS."""
    session = workspace_store.get(workspace_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Espace de travail temporaire introuvable ou expiré.")

    fallback_offline = "Interprétation IA indisponible (service hors ligne)."
    if registry.gemini_client is None:
        return WorkspaceAnatomyRegionsResponse(
            region_texts={region.id: fallback_offline for region in request.regions}
        )
    media_parts: list[genai_types.Part] = []
    image_attached = False
    if request.canvas_data_url:
        decoded = _decode_canvas_data_url(request.canvas_data_url)
        if decoded is not None:
            mime_type, data = decoded
            media_parts.append(genai_types.Part.from_text(
                text=f"Capture canvas de l'image {request.image_id} (annotations, fenêtrage, zoom courants) — analyse chaque région sur cette image."
            ))
            media_parts.append(genai_types.Part.from_bytes(data=data, mime_type=mime_type))
            image_attached = True
        else:
            logger.warning("Capture canvas invalide pour l'analyse des régions anatomiques de %s.", request.image_id)

    prompt = build_region_anatomy_prompt(
        image_id=request.image_id,
        anatomy=request.anatomy,
        regions=[r.model_dump() for r in request.regions],
        image_attached=image_attached,
    )

    system_instruction = (
        "Tu es un assistant radiologique expert. Tu décris, région par région, l'état d'une radiographie thoracique "
        "à partir de l'image fournie et de la segmentation anatomique CXAS avec ses mesures. "
        "Tu signales explicitement toute déviation visuelle ou mesurée au lieu de conclure à la normale. "
        "Réponds impérativement au format JSON strict avec deux clés : 'region_texts' "
        "(dictionnaire region_id -> texte) et 'region_anomalies' (dictionnaire region_id -> booléen, "
        "true si la région présente une anomalie)."
    )

    try:
        response_data = registry.gemini_client.generate_json_validated(
            system_instruction=system_instruction,
            prompt=prompt,
            response_model=WorkspaceAnatomyRegionsResponse,
            media_parts=media_parts if media_parts else None,
        )
        texts = dict(response_data.region_texts)
        anomalies = {k: bool(v) for k, v in dict(response_data.region_anomalies).items()}
        for region in request.regions:
            if region.id not in texts or not texts[region.id]:
                # Fallback neutre : ne jamais affirmer une normale non vérifiée.
                texts[region.id] = f"{region.label} : interprétation IA indisponible pour cette région."
                anomalies.pop(region.id, None)
            elif region.id not in anomalies:
                anomalies[region.id] = False

        workspace_store.record_audit(workspace_id, {
            "at": datetime.now(UTC).isoformat(),
            "endpoint": "/anatomy/regions",
            "image_id": request.image_id,
            "regions_count": len(request.regions),
            "image_attached": image_attached,
            "anomalies_count": sum(1 for v in anomalies.values() if v),
        })
        return WorkspaceAnatomyRegionsResponse(region_texts=texts, region_anomalies=anomalies)
    except Exception:
        logger.exception("Échec de la génération des descriptions anatomiques par région pour l'image %s.", request.image_id)
        return WorkspaceAnatomyRegionsResponse(
            region_texts={region.id: f"{region.label} : Interprétation IA indisponible." for region in request.regions}
        )


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
    # Contexte clinique complémentaire (à égalité avec la prédiction locale) :
    # le diagnostic doit provenir des DEUX sources. Champs optionnels : un
    # client plus ancien qui ne les envoie pas n'est pas cassé.
    neuro_findings: List[dict] = Field(default_factory=list)
    neuro_risk_level: str | None = None
    anatomy_observations: List[dict] = Field(default_factory=list)


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

    clinical_facts = build_clinical_facts(
        request.neuro_findings,
        request.neuro_risk_level,
        request.anatomy_observations,
    )
    prompt = build_prompt(facts.to_prompt_facts(), clinical_facts or None)
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
    try:
        from anatomy_service import is_available as anatomy_available, is_loaded as anatomy_is_loaded  # noqa: PLC0415

        anatomy_ready = anatomy_available()
        anatomy_loaded = anatomy_is_loaded()
    except Exception:  # noqa: BLE001
        anatomy_ready = False
        anatomy_loaded = False
    try:
        from chexmask_service import is_loaded as hybridgnet_is_loaded  # noqa: PLC0415

        hybridgnet_loaded = hybridgnet_is_loaded()
    except Exception:  # noqa: BLE001
        hybridgnet_loaded = False
    return {
        "status": "ok" if not startup_errors else "degraded",
        "radiography_models_loaded": len(registry.radiography_models),
        "gemini_ready": registry.gemini_client is not None,
        "anatomy_ready": anatomy_ready,
        "anatomy_loaded": anatomy_loaded,
        "hybridgnet_loaded": hybridgnet_loaded,
        "opencxr_ready": opencxr_available(),
        "pathology_ready": probe_pathology_backend() is not None,
        "startup_errors": startup_errors,
    }


class VoiceTranscribeResponse(BaseModel):
    text: str
    language: str | None = None
    model: str


@app.post("/voice/transcribe", response_model=VoiceTranscribeResponse)
async def transcribe_voice(
    file: UploadFile = File(...),
    language: str | None = Form(default=None),
) -> VoiceTranscribeResponse:
    """Transcrit une dictée vocale (webm/ogg/wav) via Gemini.

    Le client enregistre le micro puis poste l'audio ici ; Gemini fait la
    retranscription (repli Web Speech API côté navigateur si serveur absent).
    """
    if registry.gemini_client is None:
        raise HTTPException(status_code=503, detail="Client Gemini non initialisé (clé API manquante).")
    data = await file.read()
    if not data:
        raise HTTPException(status_code=422, detail="Fichier audio vide.")
    mime_type = file.content_type or "audio/webm"
    if mime_type.startswith("audio/"):
        mime_type = mime_type[: mime_type.find(";")]
    try:
        text = registry.gemini_client.transcribe_audio(
            data,
            mime_type=mime_type or "audio/webm",
            language=language or None,
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception("Transcription Gemini impossible.")
        raise HTTPException(
            status_code=502,
            detail="Gemini n'a pas pu transcrire l'audio. Réessayez dans quelques secondes.",
        ) from exc
    return VoiceTranscribeResponse(text=text, language=language, model=registry.gemini_client.model_name)
