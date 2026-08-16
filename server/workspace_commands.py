"""Analyse déterministe des commandes explicites préfixées par @."""

from __future__ import annotations

import shlex
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field

from workspace_protocol import ActionPlan, WorkspaceManifest


class CommandError(ValueError):
    pass


class CommandRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str = Field(min_length=2, max_length=8_000)


class CommandResponse(BaseModel):
    command: str
    plan: ActionPlan


COMMAND_CATALOG = [
    {"name": "analyze", "usage": "@analyze [image:<id>|all]", "description": "Analyse une image ou tout l'examen."},
    {"name": "predict", "usage": "@predict [image:<id>|all]", "description": "Lance la classification radiographique."},
    {"name": "gradcam", "usage": "@gradcam [image:<id>|all] [class:<nom>] [opacity:0-100]", "description": "Calcule et affiche une Grad-CAM."},
    {"name": "3d", "usage": "@3d [image:<id>]", "description": "Reconstruit le volume 3D de la radio et l'affiche."},
    {"name": "wl", "usage": "@wl [image:<id>] preset:<lung|bone|soft|default> | window:<n> level:<n>", "description": "Applique un fenêtrage."},
    {"name": "brightness", "usage": "@brightness value:0-100 [image:<id>]", "description": "Règle la luminosité."},
    {"name": "contrast", "usage": "@contrast value:0-100 [image:<id>]", "description": "Règle le contraste."},
    {"name": "invert", "usage": "@invert [value:true|false] [image:<id>]", "description": "Inverse ou rétablit les niveaux de gris."},
    {"name": "annotation", "usage": "@annotation text:\"...\" x:<px> y:<px> [image:<id>] [color:#RRGGBB] [size:<px>]", "description": "Crée une annotation texte."},
    {"name": "measure", "usage": "@measure x1:<px> y1:<px> x2:<px> y2:<px> [image:<id>] [color:#RRGGBB] [width:<px>]", "description": "Crée une mesure."},
    {"name": "layer", "usage": "@layer layer:<image|annotations|measurements|gradcam> visible:<true|false> [opacity:0-100] [image:<id>]", "description": "Modifie une couche."},
    {"name": "report", "usage": "@report", "description": "Génère le rapport à partir des prédictions."},
    {"name": "help", "usage": "@help", "description": "Affiche le catalogue des commandes."},
]

WL_PRESETS = {
    "default": (255, 127.5),
    "lung": (170, 60),
    "bone": (350, 110),
    "soft": (60, 40),
}


def _new_action(action_type: str, order: int, reason: str, **data: object) -> dict:
    return {"id": str(uuid4()), "order": order, "type": action_type, "reason": reason, **data}


def _parse_bool(value: str, name: str) -> bool:
    if value.lower() in {"true", "1", "yes", "on"}:
        return True
    if value.lower() in {"false", "0", "no", "off"}:
        return False
    raise CommandError(f"{name} doit être true ou false.")


def _parse_options(tokens: list[str]) -> tuple[list[str], dict[str, str]]:
    positional: list[str] = []
    options: dict[str, str] = {}
    for token in tokens:
        if ":" not in token:
            positional.append(token)
            continue
        key, value = token.split(":", 1)
        if not key or not value:
            raise CommandError(f"Paramètre invalide : '{token}'.")
        if key in options:
            raise CommandError(f"Paramètre dupliqué : '{key}'.")
        options[key.lower()] = value
    return positional, options


def _require(options: dict[str, str], name: str) -> str:
    value = options.get(name)
    if value is None:
        raise CommandError(f"Paramètre requis manquant : {name}:...")
    return value


def _target_ids(manifest: WorkspaceManifest, options: dict[str, str], *, allow_all: bool) -> list[str]:
    raw = options.get("image")
    if raw in {None, "active"}:
        if manifest.active_image_id is None:
            raise CommandError("Aucune image active : précisez image:<id>.")
        return [manifest.active_image_id]
    if raw == "all":
        if not allow_all:
            raise CommandError("Cette commande ne peut cibler qu'une seule image.")
        return [image.image_id for image in manifest.images]
    if raw not in {image.image_id for image in manifest.images}:
        raise CommandError(f"Image inconnue : '{raw}'.")
    return [raw]


def parse_explicit_command(text: str, manifest: WorkspaceManifest) -> CommandResponse:
    if not text.lstrip().startswith("@"):
        raise CommandError("Une commande explicite doit commencer par @.")
    try:
        tokens = shlex.split(text.lstrip()[1:])
    except ValueError as exc:
        raise CommandError(f"Syntaxe invalide : {exc}") from exc
    if not tokens:
        raise CommandError("Commande manquante après @. Essayez @help.")

    command = tokens[0].lower()
    positional, options = _parse_options(tokens[1:])
    if positional:
        raise CommandError(f"Argument inattendu : '{positional[0]}'. Utilisez key:value.")
    actions: list[dict] = []

    if command == "help":
        plan = ActionPlan(summary="Catalogue des commandes disponible dans l'interface.", actions=[])
        return CommandResponse(command=command, plan=plan)

    if command in {"analyze", "predict", "gradcam"}:
        targets = _target_ids(manifest, options, allow_all=True)
        for image_id in targets:
            if command == "analyze":
                actions.append(_new_action("analyze_image", len(actions), "Analyse demandée par l'utilisateur.", target_image_id=image_id))
            elif command == "predict":
                actions.append(_new_action("predict", len(actions), "Prédiction demandée par l'utilisateur.", target_image_id=image_id))
            else:
                actions.append(_new_action("generate_gradcam", len(actions), "Grad-CAM demandée par l'utilisateur.", target_image_id=image_id, class_name=options.get("class")))
                actions.append(_new_action("show_gradcam", len(actions), "Afficher la Grad-CAM demandée.", target_image_id=image_id, opacity=int(options.get("opacity", "62"))))

    elif command == "3d":
        image_id = _target_ids(manifest, options, allow_all=False)[0]
        actions.append(_new_action("generate_3d", 0, "Reconstruction 3D demandée par l'utilisateur.", target_image_id=image_id))
        actions.append(_new_action("show_3d", 1, "Afficher le volume 3D reconstruit.", target_image_id=image_id, visible=True))

    elif command == "wl":
        image_id = _target_ids(manifest, options, allow_all=False)[0]
        if "preset" in options:
            if "window" in options or "level" in options:
                raise CommandError("Utilisez soit preset, soit window et level.")
            preset = options["preset"].lower()
            if preset not in WL_PRESETS:
                raise CommandError(f"Preset inconnu : '{preset}'. Valeurs : {', '.join(WL_PRESETS)}.")
            window, level = WL_PRESETS[preset]
        else:
            window, level = float(_require(options, "window")), float(_require(options, "level"))
        actions.append(_new_action("set_window_level", 0, "Fenêtrage demandé par l'utilisateur.", target_image_id=image_id, window=window, level=level))

    elif command in {"brightness", "contrast"}:
        image_id = _target_ids(manifest, options, allow_all=False)[0]
        action_type = "set_brightness" if command == "brightness" else "set_contrast"
        actions.append(_new_action(action_type, 0, f"{command.title()} demandée par l'utilisateur.", target_image_id=image_id, value=int(_require(options, "value"))))

    elif command == "invert":
        image_id = _target_ids(manifest, options, allow_all=False)[0]
        actions.append(_new_action("invert", 0, "Inversion demandée par l'utilisateur.", target_image_id=image_id, value=_parse_bool(options.get("value", "true"), "value")))

    elif command == "annotation":
        image_id = _target_ids(manifest, options, allow_all=False)[0]
        x, y = float(_require(options, "x")), float(_require(options, "y"))
        style = {"color": options.get("color", "#ffffff"), "font_size": float(options.get("size", "16"))}
        actions.append(_new_action("create_shape", 0, "Annotation demandée par l'utilisateur.", target_image_id=image_id, shape={
            "id": str(uuid4()), "type": "annotation", "x": x, "y": y, "w": 0, "h": 0,
            "points": [{"x": x, "y": y}], "label": _require(options, "text"), "created_by": "ai", "style": style,
        }))

    elif command == "measure":
        image_id = _target_ids(manifest, options, allow_all=False)[0]
        x1, y1 = float(_require(options, "x1")), float(_require(options, "y1"))
        x2, y2 = float(_require(options, "x2")), float(_require(options, "y2"))
        actions.append(_new_action("create_shape", 0, "Mesure demandée par l'utilisateur.", target_image_id=image_id, shape={
            "id": str(uuid4()), "type": "measure", "x": x1, "y": y1, "w": x2 - x1, "h": y2 - y1,
            "points": [], "created_by": "ai", "style": {"stroke_color": options.get("color", "#3b82f6"), "stroke_width": float(options.get("width", "2"))},
        }))

    elif command == "layer":
        image_id = _target_ids(manifest, options, allow_all=False)[0]
        layer = _require(options, "layer")
        if "visible" in options:
            actions.append(_new_action("set_layer_visibility", len(actions), "Visibilité de couche demandée.", target_image_id=image_id, layer=layer, visible=_parse_bool(options["visible"], "visible")))
        if "opacity" in options:
            actions.append(_new_action("set_layer_opacity", len(actions), "Opacité de couche demandée.", target_image_id=image_id, layer=layer, opacity=int(options["opacity"])))
        if not actions:
            raise CommandError("@layer exige visible:true|false et/ou opacity:0-100.")

    elif command == "report":
        if options:
            raise CommandError("@report ne prend pas de paramètre pour le moment.")
        actions.append(_new_action("generate_report", 0, "Rapport demandé par l'utilisateur."))

    else:
        names = ", ".join(item["name"] for item in COMMAND_CATALOG)
        raise CommandError(f"Commande inconnue : '@{command}'. Disponibles : {names}.")

    return CommandResponse(command=command, plan=ActionPlan(summary=f"Commande @{command} analysée.", actions=actions))
