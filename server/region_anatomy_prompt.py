"""Instructions et prompt pour la description de l'anatomie région par région."""

from __future__ import annotations

import json
from typing import Any

from agent_context import compact_anatomy_context, WorkspaceAnatomyContext


def build_region_anatomy_prompt(
    image_id: str,
    anatomy: WorkspaceAnatomyContext | dict[str, Any],
    regions: list[dict[str, Any]],
    image_attached: bool,
) -> str:
    """Construit le prompt textuel envoyé à Gemini pour générer les descriptions par région."""
    if isinstance(anatomy, WorkspaceAnatomyContext):
        compacted = compact_anatomy_context(anatomy)
    elif isinstance(anatomy, dict):
        # Si c'est déjà le format compact ou un dict brut de WorkspaceAnatomyContext
        if "key_structures" in anatomy or "measurements" in anatomy:
            compacted = anatomy
        else:
            try:
                compacted = compact_anatomy_context(WorkspaceAnatomyContext.model_validate(anatomy))
            except Exception:
                compacted = anatomy
    else:
        compacted = {}

    image_intro = (
        "Une capture de l'image courante (annotée) est jointe : analyse-la région par "
        "région, de la même manière qu'un radiologue lit une radio de face."
        if image_attached
        else "Aucune capture d'image n'est jointe : base ton analyse uniquement sur les données CXAS fournies."
    )

    regions_json = json.dumps(
        [
            {
                "id": r.get("id"),
                "label": r.get("label"),
                "structures": r.get("structures", []),
                "reference": r.get("reference", ""),
            }
            for r in regions
        ],
        ensure_ascii=False,
        indent=2,
    )

    compacted_json = json.dumps(compacted, ensure_ascii=False, indent=2)

    return f"""Tu es un assistant radiologique : tu décris, région par région, l'état d'une
radiographie thoracique à partir de l'image fournie ET de la segmentation
anatomique CXAS avec ses mesures. Ton rôle est de repérer les anomalies,
pas de rassurer : une région n'est « normale » que si son examen visuel ET
ses mesures sont réellement rassurants.

{image_intro}

RÈGLES STRICTES :
1. Appuie-toi à la fois sur l'image jointe (lecture visuelle : transparence,
   contours, opacités) et sur les données CXAS fournies (mesures, structures,
   aires, labels). Croise les deux : ne décris visuellement que ce que tu vois
   réellement sur l'image, et ne cite une valeur chiffrée que si elle figure
   dans les données fournies.
2. N'invente JAMAIS une valeur, une structure ou un diagnostic absent des deux
   sources. Si une structure n'apparaît ni visuellement ni dans les données,
   écris : « Aucune structure segmentée dans cette région. »
3. Cite les valeurs exactes telles que fournies quand la région y est liée
   (ex. « CTR = 0,55 »), sinon décris la région de façon générique.
4. COMPARE SYSTÉMATIQUEMENT à la référence normale fournie pour chaque région.
   Tout écart visible ou mesuré (opacité, épanchement, comblement du sinus,
   CTR ≥ 50 %, déviation, masse, nodule, émoussement de l'angle...) doit être
   DÉCRIT PRÉCISÉMENT dans le texte ET signalé comme anomalie (true).
   N'écris « aspects normaux » QUE si tu as réellement vérifié la région et
   que rien ne s'en écarte — jamais par défaut ni par prudence.
5. En cas de doute entre normal et anormal, signale l'écart possible
   (« anomalie possible ») et mets region_anomalies à true : mieux vaut
   signaler à tort que passer sous silence un vrai signe.
6. CTR/SCD sont des indicateurs de modèle, pas des diagnostics : ne conclus
   jamais un diagnostic, seulement une orientation à corréler cliniquement.
7. Texte en français, ton neutre, pas d'abréviations mystérieuses.
8. Si aucune image n'est jointe, signale-le toi-même dans chaque texte :
   « (analyse basée sur les données CXAS, sans image) » et reste prudent.

FORMAT DE SORTIE — JSON strict, aucune clé supplémentaire :
{{"region_texts": {{"<region_id>": "<texte>", ...}},
 "region_anomalies": {{"<region_id>": true|false, ...}}}}
Chaque région demandée doit apparaître dans les DEUX dictionnaires.

Régions demandées (id, label, structures associées, référence normale) :
{regions_json}

Données CXAS de l'image {image_id} (mesures disponibles, structures avec aire) :
{compacted_json}
"""
