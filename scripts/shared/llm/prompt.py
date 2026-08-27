"""Construction du prompt few-shot pour la génération de rapport (Phase C).

IMPORTANT : les exemples ci-dessous sont CONSTRUITS par Claude à partir du
style observé sur les 3 rapports HGG réels fournis (structure, ton,
formulations) — ce ne sont PAS des rapports HGG authentiques associés à
de vraies sorties de modèle, puisqu'aucune paire (faits du modèle ->
rapport HGG réel) n'existe encore. À FAIRE VALIDER par un praticien HGG
avant tout usage réel ; à remplacer par de vrais cas (anonymisés) dès que
possible — voir DATASET_STRUCTURE.md pour la même logique appliquée à
l'échographie.
"""

from __future__ import annotations

from typing import List

from report_schemas import RadiologyReportFields

SYSTEM_INSTRUCTION = """Tu es un assistant de rédaction de comptes rendus radiologiques pour l'Hôpital Général de Garoua (HGG).

RÈGLES STRICTES, NON NÉGOCIABLES :
1. Le champ "diagnostic_probable" DOIT refléter TOUTES les sources fournies, à égalité : la classe prédite par l'ensemble ET les éventuelles détections confirmées (pipeline Neuro) listées dans les faits. Ne jamais reformuler vers une autre pathologie, ne jamais en inventer, ne jamais privilégier une seule source quand plusieurs concordent.
2. Le champ "niveau_confiance" DOIT refléter fidèlement la probabilité réelle fournie dans les faits — ne jamais l'exagérer ni la minimiser.
3. Le champ "observations" décrit l'impression GLOBALE que le modèle a détectée. S'y ajoutent, sous forme de constatations factuelles, les détections confirmées et les observations anatomiques régionales fournies dans les faits — sans affirmer un constat sur une structure que les données ne couvrent pas.
4. Le champ "recommandation_orientation" ne doit JAMAIS formuler un diagnostic médical définitif, ni remplacer l'avis d'un professionnel de santé — toujours recommander une corrélation clinique ou un avis spécialisé.
5. Style : français médical, sobre, factuel, cohérent avec le ton des comptes rendus HGG illustrés par les exemples ci-dessous.
6. Ne jamais inventer d'information absente des faits fournis (âge du patient, antécédents, etc.)."""


def build_clinical_facts(
    neuro_findings: list | None = None,
    neuro_risk_level: str | None = None,
    anatomy_observations: list | None = None,
) -> str:
    """Met en forme le contexte clinique complémentaire (pipeline Neuro +
    observations anatomiques régionales) en faits lisibles pour le LLM.

    Ces faits sont présentés À ÉGALITÉ avec la prédiction de l'ensemble :
    le diagnostic ne provient pas du résultat local seul. Aucune valeur
    n'est inventée — une source absente n'apparaît pas.
    """
    lines: list[str] = []

    neuro = neuro_findings or []
    if neuro:
        lines.append("Détections confirmées (pipeline Neuro) :")
        for finding in neuro:
            condition = str(finding.get("condition", "")).replace("_", " ")
            prob = finding.get("prob")
            risk = finding.get("risk")
            parts = [condition]
            if prob is not None:
                try:
                    parts.append(f"{round(float(prob) * 100)} %")
                except (TypeError, ValueError):
                    pass
            if risk:
                parts.append(f"risque {risk}")
            lines.append("  - " + " ; ".join(parts))
        if neuro_risk_level:
            lines.append(f"Niveau de risque global : {neuro_risk_level}")

    anatomy = anatomy_observations or []
    if anatomy:
        lines.append("Observations anatomiques régionales :")
        for obs in anatomy:
            region = str(obs.get("label") or obs.get("region_id") or "Région")
            text = str(obs.get("observation", "")).strip()
            if not text:
                continue
            source = "praticien" if obs.get("source") == "practitioner" else "IA"
            lines.append(f"  - {region} ({source}) : {text}")

    return "\n".join(lines)


# Exemples construits à partir du style réel — voir avertissement en tête de fichier.
FEW_SHOT_EXAMPLES = [
    {
        "facts": (
            "Classe predite (ensemble) : Pneumonia\n"
            "Confiance de l'ensemble pour cette classe : 94.0%\n"
            "Nombre de modeles dans l'ensemble : 5\n"
            "Accord entre modeles : 100% (unanime)"
        ),
        "report": RadiologyReportFields(
            type_examen="Radiographie thoracique de face",
            zone_analysee="Champs pulmonaires",
            observations=(
                "L'analyse automatisée détecte un aspect compatible avec un foyer "
                "infectieux évocateur d'une pneumopathie."
            ),
            diagnostic_probable="Pneumonia",
            niveau_confiance="Élevé (94 %) — accord unanime des 5 modèles de l'ensemble",
            recommandation_orientation=(
                "Corrélation clinique recommandée. Avis médical conseillé pour confirmation "
                "et prise en charge adaptée."
            ),
        ),
    },
    {
        "facts": (
            "Classe predite (ensemble) : Normal\n"
            "Confiance de l'ensemble pour cette classe : 97.5%\n"
            "Nombre de modeles dans l'ensemble : 5\n"
            "Accord entre modeles : 100% (unanime)"
        ),
        "report": RadiologyReportFields(
            type_examen="Radiographie thoracique de face",
            zone_analysee="Champs pulmonaires",
            observations=(
                "L'analyse automatisée ne détecte pas d'anomalie évocatrice parmi les "
                "catégories reconnues par le modèle."
            ),
            diagnostic_probable="Normal",
            niveau_confiance="Élevé (97,5 %) — accord unanime des 5 modèles de l'ensemble",
            recommandation_orientation=(
                "Aspect radiologique jugé normal par l'analyse automatisée. Suivi de "
                "routine recommandé, sans caractère d'urgence."
            ),
        ),
    },
    {
        "facts": (
            "Classe predite (ensemble) : Normal\n"
            "Confiance de l'ensemble pour cette classe : 55.0%\n"
            "Nombre de modeles dans l'ensemble : 5\n"
            "Accord entre modeles : 60% (partiel)"
        ),
        "report": RadiologyReportFields(
            type_examen="Radiographie thoracique de face",
            zone_analysee="Champs pulmonaires",
            observations=(
                "L'analyse automatisée penche vers l'absence d'anomalie, mais les modèles "
                "de l'ensemble ne sont pas unanimes sur cette conclusion."
            ),
            diagnostic_probable="Normal",
            niveau_confiance="Modéré (55 %) — accord partiel (3 modèles sur 5)",
            recommandation_orientation=(
                "Confiance modérée du modèle : une relecture par un professionnel de santé "
                "est recommandée avant toute conclusion."
            ),
        ),
    },
]


def build_prompt(facts_text: str, clinical_facts: str | None = None) -> str:
    """Construit le prompt final : exemples few-shot + faits du cas courant.

    ``clinical_facts`` (optionnel) ajoute les détections confirmées et les
    observations anatomiques au niveau de la prédiction de l'ensemble :
    le diagnostic du LLM s'appuie sur LES DEUX sources, jamais sur le
    résultat local seul.
    """
    parts: List[str] = []
    for i, example in enumerate(FEW_SHOT_EXAMPLES, 1):
        parts.append(f"--- Exemple {i} ---")
        parts.append(f"Faits :\n{example['facts']}")
        parts.append(f"Rapport attendu (JSON) :\n{example['report'].model_dump_json(indent=2)}")
    parts.append("--- Nouveau cas ---")
    parts.append(f"Faits :\n{facts_text}")
    if clinical_facts:
        parts.append(f"Contexte clinique complémentaire (à égalité avec la prédiction) :\n{clinical_facts}")
    parts.append("Rapport attendu (JSON) :")
    return "\n\n".join(parts)