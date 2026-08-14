from __future__ import annotations

import base64
import binascii
import json
import logging
import re
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path
from typing import List

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from google.genai import types as genai_types
from pydantic import BaseModel, Field

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
from workspace_protocol import (  # noqa: E402
    ActionPlan,
    ActionType,
    ActionValidationResult,
    WorkspaceConsistencyIssue,
    WorkspaceManifest,
    inspect_manifest_consistency,
    validate_plan_against_manifest,
)
from workspace_store import WorkspaceStore  # noqa: E402
from workspace_commands import COMMAND_CATALOG, CommandError, CommandRequest, CommandResponse, parse_explicit_command  # noqa: E402
from workspace_agent import AgentProposal, AgentTurnResponse, build_agent_turn, fallback_agent_turn  # noqa: E402
from workspace_agent_prompt import WORKSPACE_AGENT_SYSTEM_INSTRUCTION  # noqa: E402
from gradcam_service import generate_ensemble_gradcam  # noqa: E402
from dicom_service import DicomImportError, parse_dicom_bytes  # noqa: E402

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


class WorkspaceAgentTurnRequest(BaseModel):
    instruction: str
    predictions: dict[str, dict] = Field(default_factory=dict)
    visual_context: WorkspaceVisualContextRequest = Field(default_factory=WorkspaceVisualContextRequest)


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
    prompt = (
        "Instruction utilisateur :\n"
        f"{instruction}\n\n"
        "Manifeste courant (sans le binaire des captures) :\n"
        f"{json.dumps(manifest_context, ensure_ascii=False, separators=(',', ':'))}\n\n"
        "Résultats de prédiction disponibles, indexés par image_id :\n"
        f"{json.dumps(predictions, ensure_ascii=False, separators=(',', ':'))}\n\n"
        "Contexte visuel réellement joint :\n"
        f"{json.dumps(visual_context, ensure_ascii=False, separators=(',', ':'))}\n\n"
        "Contrôles de cohérence déterministes :\n"
        f"{json.dumps([issue.model_dump(mode='json') for issue in consistency_issues], ensure_ascii=False, separators=(',', ':'))}\n\n"
        "Capacités disponibles :\n"
        f"{json.dumps({'available_action_types': [action.value for action in ActionType]}, ensure_ascii=False)}"
    )
    try:
        proposal = registry.gemini_client.generate_json_validated(
            system_instruction=WORKSPACE_AGENT_SYSTEM_INSTRUCTION,
            prompt=prompt,
            response_model=AgentProposal,
            media_parts=visual_parts,
        )
    except Exception:  # noqa: BLE001
        logger.exception("Échec de la génération du tour IA.")
        return fallback_agent_turn(
            "Je n'ai pas pu produire une réponse fiable pour cette demande. Réessayez dans quelques secondes.",
            "La réponse de Gemini n'a pas pu être validée ; aucune action n'a été exécutée.",
        )

    turn = build_agent_turn(proposal, session.manifest)
    blocking_consistency_issues = [issue for issue in consistency_issues if issue.level == "error"]
    if turn.intent.value == "comparison_request" and blocking_consistency_issues:
        blocked_turn = fallback_agent_turn(
            "Je ne peux pas comparer ces images comme un même examen, car les contrôles DICOM ont détecté une incohérence bloquante.",
            "Aucune action de comparaison n'a été exécutée.",
        )
        return blocked_turn.model_copy(update={
            "warnings": [
                *blocked_turn.warnings,
                *(issue.message for issue in blocking_consistency_issues),
            ],
        })
    extra_warnings = [
        *visual_warnings,
        *(issue.message for issue in consistency_issues),
        *(f"Prédiction ignorée : image inconnue '{image_id}'." for image_id in unknown_prediction_ids),
    ]
    if extra_warnings:
        turn = turn.model_copy(update={"warnings": [*turn.warnings, *extra_warnings]})
    return turn

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
