"""Phase D — vérification systématique de la cohérence entre le texte
généré par le LLM et la prédiction brute du modèle (exigence explicite
du cahier des charges, section 5.5 : "pour limiter le risque
d'incohérence ou d'hallucination du texte").

Contrôles programmatiques (pas d'appel LLM supplémentaire ici — plus
rapide, plus fiable, sans dépendance réseau) :
1. La classe mentionnée dans diagnostic_probable correspond-elle à la
   classe réellement prédite par l'ensemble ?
2. Le pourcentage de confiance mentionné dans niveau_confiance
   correspond-il (à un arrondi près) à la confiance réelle du modèle ?

Un rapport qui échoue ce contrôle ne doit JAMAIS être transmis tel quel
— voir REJECTED dans ReportGenerationStatus (à gérer par l'appelant :
nouvelle tentative, ou alerte pour révision humaine).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import List

from radiography_adapter import RadiologyPredictionFacts
from report_schemas import RadiologyReportFields


@dataclass
class CoherenceCheckResult:
    passed: bool
    issues: List[str] = field(default_factory=list)


def check_coherence(
    fields: RadiologyReportFields, facts: RadiologyPredictionFacts
) -> CoherenceCheckResult:
    """Vérifie que le rapport généré ne contredit pas les faits bruts.

    Contrôle volontairement simple (correspondance textuelle) plutôt
    qu'un second appel LLM : plus rapide, déterministe, sans risque
    d'halluciner *sur* la vérification elle-même. À affiner si des faux
    positifs/négatifs apparaissent en usage réel (ex. correspondance
    approximative, gestion des synonymes).
    """
    issues: List[str] = []

    if facts.predicted_class.lower() not in fields.diagnostic_probable.lower():
        issues.append(
            f"diagnostic_probable ('{fields.diagnostic_probable}') ne mentionne pas la "
            f"classe prédite par le modèle ('{facts.predicted_class}')."
        )

    confidence_pct = round(facts.confidence * 100)
    confidence_mentioned = any(
        str(candidate) in fields.niveau_confiance.replace(",", ".").replace("%", "")
        for candidate in (confidence_pct, round(facts.confidence * 100, 1))
    )
    if not confidence_mentioned:
        issues.append(
            f"niveau_confiance ('{fields.niveau_confiance}') ne semble pas citer la "
            f"confiance réelle du modèle (~{confidence_pct} %)."
        )

    return CoherenceCheckResult(passed=(len(issues) == 0), issues=issues)