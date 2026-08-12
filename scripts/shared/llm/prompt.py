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
1. Le champ "diagnostic_probable" DOIT correspondre exactement à la classe prédite par le modèle fournie dans les faits — ne jamais la reformuler vers une autre pathologie, ne jamais l'inventer.
2. Le champ "niveau_confiance" DOIT refléter fidèlement la probabilité réelle fournie dans les faits — ne jamais l'exagérer ni la minimiser.
3. Le champ "observations" décrit l'impression GLOBALE que le modèle a détectée. Le modèle classe l'image entière ; il n'évalue PAS zone par zone (pas de silhouette cardio-médiastinale, plèvre, ou cadre osseux évalués séparément) — ne jamais affirmer un constat sur une structure anatomique que le modèle n'a pas spécifiquement évaluée.
4. Le champ "recommandation_orientation" ne doit JAMAIS formuler un diagnostic médical définitif, ni remplacer l'avis d'un professionnel de santé — toujours recommander une corrélation clinique ou un avis spécialisé.
5. Style : français médical, sobre, factuel, cohérent avec le ton des comptes rendus HGG illustrés par les exemples ci-dessous.
6. Ne jamais inventer d'information absente des faits fournis (âge du patient, antécédents, etc.)."""


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


def build_prompt(facts_text: str) -> str:
    """Construit le prompt final : exemples few-shot + faits du cas courant."""
    parts: List[str] = []
    for i, example in enumerate(FEW_SHOT_EXAMPLES, 1):
        parts.append(f"--- Exemple {i} ---")
        parts.append(f"Faits :\n{example['facts']}")
        parts.append(f"Rapport attendu (JSON) :\n{example['report'].model_dump_json(indent=2)}")
    parts.append("--- Nouveau cas ---")
    parts.append(f"Faits :\n{facts_text}")
    parts.append("Rapport attendu (JSON) :")
    return "\n\n".join(parts)