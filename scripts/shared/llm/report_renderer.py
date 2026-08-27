"""Assemblage deterministe du rapport final, au format observe sur les 3
exemples HGG reels fournis. AUCUN appel LLM ici : ce module met en forme
des donnees deja produites ailleurs (contexte patient fourni par la
plateforme + les 6 champs generes par le LLM).

Structure observee sur les 3 exemples reels (2 echographies + 1
radiographie) :
    [Bloc patient : Nom, Indication, Prescripteur, Date...]
    RESULTAT / COMPTE RENDU
    - ...
    CONCLUSION
    (symbole) ...

Les rapports humains fournis n'ont ni "niveau de confiance" ni
"recommandation d'orientation" (un medecin ne s'auto-evalue pas en %) —
le rapport final n'en fait donc pas partie (rapport signable tel quel).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from report_schemas import RadiologyReportFields


@dataclass
class PatientContext:
    """Informations fournies par la plateforme (saisie utilisateur),
    JAMAIS par le LLM — le LLM ne voit jamais ces champs, il ne genere
    que le contenu clinique (RadiologyReportFields).
    """

    nom_prenom: str
    prescripteur: str = ""
    date_examen: str = ""  # JJ/MM/AAAA ; date du jour par defaut si non fournie

    def __post_init__(self) -> None:
        if not self.date_examen:
            self.date_examen = date.today().strftime("%d/%m/%Y")


def _as_bullets(text: str) -> str:
    """Convertit un bloc de texte en liste à tirets, cohérente avec le
    style RESULTAT des rapports HGG réels."""
    sentences = [s.strip() for s in text.replace("\n", " ").split(".") if s.strip()]
    if not sentences:
        return "- Aucune observation disponible."
    return "\n".join(f"- {s}." for s in sentences)


def render_report_text(patient: PatientContext, fields: RadiologyReportFields) -> str:
    """Assemble le rapport final en texte structuré.

    Structure stricte : en-tête/identification, RESULTAT, CONCLUSION — ni
    pied de page, ni signature, ni bloc « Analyse assistée par IA », ni
    niveau de confiance, ni avertissement. Le rapport doit pouvoir être
    signé tel quel par le praticien (compte rendu hospitalier classique).

    Le rendu visuel final (papier à en-tête HGG, logo, mise en page Word)
    est un sujet séparé — géré par un gabarit de document ou l'interface,
    pas par cette fonction qui ne produit que le CONTENU textuel.
    """
    lines = [
        fields.type_examen.upper(),
        "",
        f"Nom et Prénom : {patient.nom_prenom}",
        f"Indication : {fields.zone_analysee}",
        f"Prescripteur : {patient.prescripteur}" if patient.prescripteur else "Prescripteur :",
        f"Date : {patient.date_examen}",
        "",
        "RESULTAT",
        _as_bullets(fields.observations),
        "",
        "CONCLUSION",
        f"❖ {fields.diagnostic_probable}",
    ]
    if fields.recommandation_orientation.strip():
        lines.append(f"❖ {fields.recommandation_orientation}")
    return "\n".join(lines)