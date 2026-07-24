"""Génération des rapports d'entraînement/évaluation : CSV, JSON, HTML.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Dict, List, Optional

import pandas as pd

from .schemas import EvalMetrics, TrainingReport

logger = logging.getLogger("training.report")


def generate_training_csv(report: TrainingReport, output_path: Path) -> Path:
    """Exporte l'historique par époque en CSV (une ligne par époque)."""
    rows = [
        {
            "epoch": e.epoch,
            "train_loss": e.train_loss,
            "train_accuracy": e.train_accuracy,
            "val_loss": e.val_loss,
            "val_accuracy": e.val_accuracy,
            "learning_rate": e.learning_rate,
        }
        for e in report.epoch_history
    ]
    df = pd.DataFrame(rows)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(output_path, index=False, encoding="utf-8")
    logger.info("Historique d'entraînement CSV écrit : %s", output_path)
    return output_path


def _eval_metrics_to_dict(metrics: Optional[EvalMetrics]) -> Optional[dict]:
    if metrics is None:
        return None
    return {
        "split_name": metrics.split_name,
        "accuracy": metrics.accuracy,
        "class_metrics": [
            {
                "class_name": cm.class_name,
                "precision": cm.precision,
                "recall": cm.recall,
                "f1_score": cm.f1_score,
                "support": cm.support,
                "roc_auc": cm.roc_auc,
                "average_precision": cm.average_precision,
            }
            for cm in metrics.class_metrics
        ],
        "confusion_matrix": metrics.confusion_matrix,
        "class_names": metrics.class_names,
    }


def generate_training_json(report: TrainingReport, output_path: Path) -> Path:
    """Exporte le résumé du run (architecture, meilleure époque, métriques test) en JSON."""
    payload = {
        "architecture": report.architecture,
        "manifest_path": str(report.manifest_path),
        "checkpoint_path": str(report.checkpoint_path),
        "class_to_idx": report.class_to_idx,
        "best_epoch": report.best_epoch,
        "best_val_accuracy": report.best_val_accuracy,
        "best_val_loss": report.best_val_loss,
        "early_stopped": report.early_stopped,
        "training_time_seconds": round(report.training_time_seconds, 2),
        "num_epochs_run": len(report.epoch_history),
        "test_metrics": _eval_metrics_to_dict(report.test_metrics),
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    logger.info("Rapport JSON écrit : %s", output_path)
    return output_path


def _class_metrics_table(metrics: EvalMetrics) -> str:
    rows = "".join(
        f"<tr><td>{cm.class_name}</td><td>{cm.precision:.3f}</td>"
        f"<td>{cm.recall:.3f}</td><td>{cm.f1_score:.3f}</td>"
        f"<td>{cm.support}</td>"
        f"<td>{'' if cm.roc_auc is None else f'{cm.roc_auc:.3f}'}</td></tr>"
        for cm in metrics.class_metrics
    )
    return (
        '<table class="report-table"><thead><tr>'
        "<th>Classe</th><th>Précision</th><th>Rappel</th><th>F1</th>"
        "<th>Support</th><th>AUC</th></tr></thead>"
        f"<tbody>{rows}</tbody></table>"
    )


def generate_training_html(report: TrainingReport, output_path: Path) -> Path:
    """Rapport HTML de synthèse pour un run d'entraînement."""
    test_section = ""
    if report.test_metrics:
        test_section = f"""
        <h2>Métriques sur le jeu de test ({report.test_metrics.split_name})</h2>
        <p><b>Accuracy :</b> {report.test_metrics.accuracy:.4f}</p>
        {_class_metrics_table(report.test_metrics)}
        """

    html = f"""<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>Rapport d'entraînement - {report.architecture}</title>
<style>
  body {{ font-family: -apple-system, Arial, sans-serif; margin: 2rem; color: #1f1f1f; }}
  h1 {{ font-size: 1.4rem; }}
  h2 {{ font-size: 1.1rem; margin-top: 2rem; border-bottom: 1px solid #ddd; padding-bottom: 4px; }}
  table.report-table {{ border-collapse: collapse; margin-top: 0.5rem; }}
  table.report-table th, table.report-table td {{ border: 1px solid #ddd; padding: 6px 12px; text-align: left; font-size: 0.9rem; }}
  table.report-table th {{ background: #2b2b2b; color: white; }}
</style>
</head>
<body>
  <h1>Rapport d'entraînement - {report.architecture}</h1>
  <p><b>Meilleure époque :</b> {report.best_epoch}
     &nbsp;|&nbsp; <b>Val accuracy :</b> {report.best_val_accuracy:.4f}
     &nbsp;|&nbsp; <b>Val loss :</b> {report.best_val_loss:.4f}
     &nbsp;|&nbsp; <b>Arrêt anticipé :</b> {"oui" if report.early_stopped else "non"}
     &nbsp;|&nbsp; <b>Temps d'entraînement :</b> {report.training_time_seconds:.1f}s</p>
  {test_section}
</body>
</html>
"""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(html, encoding="utf-8")
    logger.info("Rapport HTML écrit : %s", output_path)
    return output_path


def generate_comparison_html(
    individual_reports: Dict[str, EvalMetrics], ensemble_metrics: EvalMetrics, output_path: Path
) -> Path:
    """Rapport comparatif modèles individuels vs ensemble (soft voting).

    Reproduit l'esprit du tableau "3.1 Model Performance Summary" de
    Shahzad et al. - une ligne par modèle, plus l'ensemble.
    """
    rows = "".join(
        f"<tr><td>{arch}</td><td>{m.accuracy:.4f}</td></tr>"
        for arch, m in individual_reports.items()
    )
    rows += f"<tr><td><b>Ensemble (soft voting)</b></td><td><b>{ensemble_metrics.accuracy:.4f}</b></td></tr>"

    html = f"""<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>Comparaison modèles individuels vs ensemble</title>
<style>
  body {{ font-family: -apple-system, Arial, sans-serif; margin: 2rem; }}
  table {{ border-collapse: collapse; margin-top: 1rem; }}
  th, td {{ border: 1px solid #ddd; padding: 6px 12px; text-align: left; }}
  th {{ background: #2b2b2b; color: white; }}
</style>
</head>
<body>
  <h1>Comparaison des modèles - accuracy test</h1>
  <table><thead><tr><th>Modèle</th><th>Accuracy test</th></tr></thead>
  <tbody>{rows}</tbody></table>
  <h2>Détail par classe - ensemble</h2>
  {_class_metrics_table(ensemble_metrics)}
</body>
</html>
"""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(html, encoding="utf-8")
    logger.info("Rapport comparatif écrit : %s", output_path)
    return output_path
