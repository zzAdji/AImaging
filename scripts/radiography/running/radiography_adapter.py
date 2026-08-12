from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List


@dataclass
class ModelVote:
    """Prediction d'un seul modele de l'ensemble, pour tracabilite."""

    architecture: str
    predicted_class: str
    confidence: float  # probabilite du modele pour SA classe predite


@dataclass
class RadiologyPredictionFacts:
    image_path: str
    predicted_class: str
    confidence: float  # probabilite de l'ensemble pour predicted_class
    all_class_probabilities: Dict[str, float]
    num_models: int
    model_votes: List[ModelVote] = field(default_factory=list)

    @property
    def unanimous(self) -> bool:
        """True si tous les modeles de l'ensemble predisent la meme classe
        que l'ensemble final - signal de confiance utile pour le LLM et
        pour le controle de coherence."""
        return all(vote.predicted_class == self.predicted_class for vote in self.model_votes)

    @property
    def agreement_ratio(self) -> float:
        """Fraction des modeles individuels d'accord avec la prediction finale."""
        if not self.model_votes:
            return 1.0
        agreeing = sum(1 for vote in self.model_votes if vote.predicted_class == self.predicted_class)
        return agreeing / len(self.model_votes)

    def to_prompt_facts(self) -> str:
        lines = [
            f"Classe predite (ensemble) : {self.predicted_class}",
            f"Confiance de l'ensemble pour cette classe : {self.confidence:.1%}",
            f"Nombre de modeles dans l'ensemble : {self.num_models}",
            f"Accord entre modeles : {self.agreement_ratio:.0%} "
            f"({'unanime' if self.unanimous else 'partiel'})",
            "Probabilites par classe (ensemble) :",
        ]
        for cls, prob in sorted(self.all_class_probabilities.items(), key=lambda x: -x[1]):
            lines.append(f"  - {cls} : {prob:.1%}")
        lines.append("Detail par modele individuel :")
        for vote in self.model_votes:
            lines.append(f"  - {vote.architecture} : {vote.predicted_class} ({vote.confidence:.1%})")
        return "\n".join(lines)


def facts_from_predict_result(predict_result: dict) -> RadiologyPredictionFacts:
    """Construit RadiologyPredictionFacts depuis un dict deja charge
    (sortie de main_predict.py, avec ou sans --output json)."""
    ensemble_probs = predict_result["ensemble_probabilities"]
    predicted_class = predict_result["ensemble_prediction"]

    votes = []
    for model_result in predict_result["per_model"]:
        probs = model_result["probabilities"]
        own_predicted_class = model_result["predicted_class"]
        votes.append(
            ModelVote(
                architecture=model_result["architecture"],
                predicted_class=own_predicted_class,
                confidence=probs[own_predicted_class],
            )
        )

    return RadiologyPredictionFacts(
        image_path=predict_result["image"],
        predicted_class=predicted_class,
        confidence=ensemble_probs[predicted_class],
        all_class_probabilities=ensemble_probs,
        num_models=predict_result["num_models"],
        model_votes=votes,
    )


def facts_from_predict_json_file(path: Path) -> RadiologyPredictionFacts:
    """Comme facts_from_predict_result, mais depuis un fichier JSON
    (ex. produit par main_predict.py --output resultat.json)."""
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    return facts_from_predict_result(data)