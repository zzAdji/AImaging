"""Tests du module de rédaction de rapport (scripts/shared/llm).

Verrouille la structure stricte du rapport (en-tête/identification +
RESULTAT + CONCLUSION) et le diagnostic multi-source (prédiction locale et
détections Neuro à égalité) : jamais de mention d'IA, de niveau de
confiance ou d'avertissement dans le rapport final.
"""

from __future__ import annotations

import sys
from pathlib import Path

SERVER_DIR = Path(__file__).resolve().parent.parent
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

import paths  # noqa: E402

paths.bootstrap_all()

from prompt import build_clinical_facts, build_prompt  # noqa: E402
from report_renderer import PatientContext, render_report_text  # noqa: E402
from report_schemas import RadiologyReportFields  # noqa: E402


def _fields() -> RadiologyReportFields:
    return RadiologyReportFields(
        type_examen="Radiographie thoracique de face",
        zone_analysee="Champs pulmonaires",
        observations="Opacité basale droite.",
        diagnostic_probable="Pneumonia",
        niveau_confiance="Élevé (94 %) — accord unanime des 5 modèles",
        recommandation_orientation="Corrélation clinique recommandée.",
    )


def test_render_report_text_structure_stricte() -> None:
    patient = PatientContext(nom_prenom="Jean DUPONT", prescripteur="Dr KAMGA", date_examen="26/08/2026")
    text = render_report_text(patient, _fields())

    lines = text.splitlines()
    # RESULTAT est bien suivi de la Conclusion.
    assert "RESULTAT" in lines
    assert "CONCLUSION" in lines
    assert lines.index("CONCLUSION") > lines.index("RESULTAT")
    # Identification patient présente.
    assert "Nom et Prénom : Jean DUPONT" in lines
    assert "Date : 26/08/2026" in lines
    # Diagnostic probable + recommandation dans la Conclusion (classe prédite exacte).
    assert "Pneumonia" in text


def test_render_report_text_aucune_mention_ia() -> None:
    text = render_report_text(PatientContext(nom_prenom="X"), _fields())
    lowered = text.lower()
    # Ni niveau de confiance, ni bloc « Analyse assistée », ni avertissement.
    assert "niveau de confiance" not in lowered
    assert "assistée par" not in lowered
    assert "système d'aide au diagnostic" not in lowered
    assert "ne remplace pas" not in lowered
    assert "intelligence artificielle" not in lowered


def test_render_report_text_date_defaut_si_absente() -> None:
    text = render_report_text(PatientContext(nom_prenom="Y"), _fields())
    assert "Date :" in text  # date du jour remplie par PatientContext


def test_build_clinical_facts_egale_au_local() -> None:
    facts = build_clinical_facts(
        neuro_findings=[{"condition": "Cardiomegaly", "prob": 0.82, "risk": "HIGH"}],
        neuro_risk_level="high",
        anatomy_observations=[
            {"label": "Poumon gauche", "observation": "Opacité", "anomaly": True, "source": "ai"},
        ],
    )
    assert "Cardiomegaly" in facts
    assert "82 %" in facts
    assert "risque HIGH" in facts
    assert "Poumon gauche" in facts
    assert "Opacité" in facts


def test_build_clinical_facts_vide_sans_source() -> None:
    assert build_clinical_facts() == ""


def test_build_prompt_injecte_contexte_clinique() -> None:
    prompt = build_prompt("Classe predite (ensemble) : Pneumonia", "Cardiomegaly ; 82 %")
    assert "Cardiomegaly" in prompt