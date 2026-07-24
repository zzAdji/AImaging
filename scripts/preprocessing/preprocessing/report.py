"""Génération du rapport de prétraitement : CSV, JSON, et HTML.

Pas de dépendance de templating (Jinja2 non listé dans les bibliothèques
autorisées) : le HTML est généré par simple assemblage de chaînes,
suffisant pour un rapport de synthèse à usage interne / rapport de stage.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

import pandas as pd

from .schemas import PreprocessingReport

logger = logging.getLogger("preprocessing.report")


def generate_csv(report: PreprocessingReport, output_path: Path) -> Path:
    """Exporte une ligne par image (réussie ou en échec) en CSV."""
    rows = []
    for e in report.entries:
        rows.append(
            {
                "source_path": str(e.source_path),
                "class": e.class_name,
                "load_success": e.load_success,
                "error_reason": e.error_reason or "",
                "original_width": e.original_width,
                "original_height": e.original_height,
                "processed_width": e.processed_width,
                "processed_height": e.processed_height,
                "processed_path": str(e.processed_path) if e.processed_path else "",
                "patient_id": e.patient_id or "",
                "split": e.split or "",
            }
        )
    df = pd.DataFrame(rows)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(output_path, index=False, encoding="utf-8")
    logger.info("Rapport CSV écrit : %s (%d lignes)", output_path, len(df))
    return output_path


def generate_json(report: PreprocessingReport, output_path: Path) -> Path:
    """Exporte le résumé du run (pas le détail par image, déjà dans le CSV) en JSON."""
    payload = {
        "input_dir": str(report.input_dir),
        "output_dir": str(report.output_dir),
        "total_images": report.total_images,
        "successful_images": len(report.successful_entries),
        "failed_images": len(report.failed_entries),
        "class_counts": report.class_counts,
        "split_counts": report.split_counts,
        "normalization": (
            {
                "architecture": report.normalization.architecture,
                "input_size": list(report.normalization.input_size),
                "mean": list(report.normalization.mean),
                "std": list(report.normalization.std),
                "source": report.normalization.source,
                "dataset_mean_std": report.normalization.dataset_mean_std,
            }
            if report.normalization
            else None
        ),
        "enhancement_applied": report.enhancement_applied,
        "enhancement_method": report.enhancement_method,
        "execution_time_seconds": round(report.execution_time_seconds, 2),
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    logger.info("Rapport JSON écrit : %s", output_path)
    return output_path


def _html_table(headers: list, rows: list) -> str:
    head = "".join(f"<th>{h}</th>" for h in headers)
    body = "".join(
        "<tr>" + "".join(f"<td>{cell}</td>" for cell in row) + "</tr>" for row in rows
    )
    return f'<table class="report-table"><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table>'


def generate_html(report: PreprocessingReport, output_path: Path) -> Path:
    """Génère un rapport HTML de synthèse, sans dépendance de templating."""
    class_rows = [[cls, count] for cls, count in sorted(report.class_counts.items())]
    split_rows = [
        [split, sum(counts.values()), *[counts.get(c, 0) for c in sorted(report.class_counts)]]
        for split, counts in sorted(report.split_counts.items())
    ]
    split_headers = ["Split", "Total", *sorted(report.class_counts)]

    norm = report.normalization
    norm_html = ""
    if norm:
        norm_html = f"""
        <p><b>Backbone :</b> {norm.architecture} ({norm.source})</p>
        <p><b>Taille d'entrée :</b> {norm.input_size}</p>
        <p><b>Normalisation appliquée :</b> mean={list(norm.mean)}, std={list(norm.std)}</p>
        """
        if norm.dataset_mean_std:
            norm_html += (
                f"<p><b>Stats réelles du dataset (informatif) :</b> "
                f"mean={norm.dataset_mean_std[0]:.4f}, std={norm.dataset_mean_std[1]:.4f}</p>"
            )

    html = f"""<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>Rapport de prétraitement</title>
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
  <h1>Rapport de prétraitement - {report.input_dir.name}</h1>
  <p><b>Images totales :</b> {report.total_images}
     &nbsp;|&nbsp; <b>Réussies :</b> {len(report.successful_entries)}
     &nbsp;|&nbsp; <b>Échecs :</b> {len(report.failed_entries)}
     &nbsp;|&nbsp; <b>Temps d'exécution :</b> {report.execution_time_seconds:.1f}s</p>

  <h2>Répartition par classe</h2>
  {_html_table(["Classe", "Nombre d'images"], class_rows)}

  <h2>Répartition Train / Validation / Test</h2>
  {_html_table(split_headers, split_rows)}

  <h2>Normalisation</h2>
  {norm_html}

  <h2>Amélioration de contraste</h2>
  <p>{"Activée (" + str(report.enhancement_method) + ")" if report.enhancement_applied else "Désactivée (recommandation par défaut)"}</p>
</body>
</html>
"""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(html, encoding="utf-8")
    logger.info("Rapport HTML écrit : %s", output_path)
    return output_path
