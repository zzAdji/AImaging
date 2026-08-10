from __future__ import annotations

from pydantic import BaseModel, Field


class RadiologyReportFields(BaseModel):
    """Les 6 champs exacts demandes par le cahier des charges. Aucun champ
    supplementaire, aucun champ manquant - la structure est fixee par la
    specification, pas par le LLM.
    """

    type_examen: str = Field(
        description="Type d'examen realise (ex. 'Radiographie thoracique de face')."
    )
    zone_analysee: str = Field(
        description="Zone anatomique analysee par le modele (ex. 'Champs pulmonaires et silhouette cardiomediastinale')."
    )
    observations: str = Field(
        description=(
            "Description factuelle de ce que le modele a observe, en langage clinique standard. "
            "Doit rester descriptif (ce qui est vu), pas interpretatif au-dela de ce que les "
            "donnees fournies permettent d'affirmer."
        )
    )
    diagnostic_probable: str = Field(
        description=(
            "Le diagnostic le plus probable selon le modele. DOIT correspondre exactement a la "
            "classe predite fournie en entree - ne jamais reformuler vers une autre pathologie."
        )
    )
    niveau_confiance: str = Field(
        description=(
            "Niveau de confiance du modele, formule clairement (ex. 'Élevé (98,5 %)', "
            "'Modéré (72 %) — accord partiel entre les modèles de l'ensemble'). "
            "DOIT refleter la probabilite reelle fournie en entree, jamais inventee."
        )
    )
    recommandation_orientation: str = Field(
        description=(
            "Recommandation d'orientation clinique (ex. 'Corrélation clinique recommandée', "
            "'Avis spécialisé conseillé'). Ne doit jamais formuler un diagnostic medical "
            "definitif ni remplacer l'avis d'un professionnel de sante."
        )
    )