"""Génération des rapports : un CSV exhaustif (machine) et un PDF (humain)."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import List

import pandas as pd
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import (
    Image as RLImage,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from .schemas import AnalysisReport

logger = logging.getLogger("dataset_analyzer.report")

# Au-delà de ce nombre de lignes, le PDF tronque le tableau et renvoie
# vers le CSV complet plutôt que de produire un document de centaines de pages.
_MAX_ROWS_IN_PDF = 30


class CSVReportGenerator:
    """Exporte le rapport complet, une ligne par image, en CSV."""

    @staticmethod
    def generate(report: AnalysisReport, output_path: Path) -> Path:
        rows = []
        for r in report.records:
            rows.append(
                {
                    "path": str(r.path),
                    "class": r.class_name,
                    "is_corrupted": r.is_corrupted,
                    "corruption_reason": r.corruption_reason or "",
                    "width": r.width,
                    "height": r.height,
                    "channels": r.channels,
                    "format": r.image_format,
                    "file_size_bytes": r.file_size_bytes,
                    "sha256": r.sha256,
                    "phash": r.phash,
                    "is_atypical": r.is_atypical,
                    "atypical_reasons": ";".join(r.atypical_reasons),
                }
            )
        df = pd.DataFrame(rows)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        df.to_csv(output_path, index=False, encoding="utf-8")
        logger.info("Rapport CSV écrit : %s (%d lignes)", output_path, len(df))
        return output_path


def _build_recommendations(report: AnalysisReport) -> List[str]:
    recs: List[str] = []
    n_corrupted = len(report.corrupted_records)
    n_atypical = len(report.atypical_records)
    n_dupes = len(report.duplicate_groups)

    if n_corrupted:
        recs.append(
            f"{n_corrupted} image(s) corrompue(s) ou illisible(s) détectée(s) : "
            "à retirer du dataset avant tout entraînement."
        )
    if n_dupes:
        recs.append(
            f"{n_dupes} paire(s) de doublons/quasi-doublons détectée(s) : "
            "vérifier Review/Duplicates/ pour éviter une fuite entre train/test."
        )
    if n_atypical:
        recs.append(
            f"{n_atypical} image(s) atypique(s) (taille, contraste ou luminosité "
            "anormale) : à valider manuellement dans Review/Atypical/ avant usage."
        )
    if report.is_imbalanced:
        recs.append(
            f"Déséquilibre entre classes détecté (ratio {report.imbalance_ratio:.2f}) : "
            "envisager un ré-échantillonnage, une pondération de la perte, ou la "
            "collecte de données supplémentaires pour la classe minoritaire."
        )
    if not recs:
        recs.append("Aucun problème majeur détecté : le dataset semble propre.")
    return recs


class PDFReportGenerator:
    """Construit le rapport d'audit PDF, professionnel et lisible par un humain."""

    def __init__(self, report: AnalysisReport) -> None:
        self.report = report
        self.styles = getSampleStyleSheet()
        self.styles.add(
            ParagraphStyle(
                name="SectionTitle",
                fontSize=14,
                spaceAfter=10,
                spaceBefore=16,
                textColor=colors.HexColor("#1F1F1F"),
            )
        )

    def generate(self, output_path: Path) -> Path:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        doc = SimpleDocTemplate(
            str(output_path), pagesize=A4, topMargin=2 * cm, bottomMargin=2 * cm
        )
        story = []

        story += self._summary_section()
        story.append(PageBreak())
        story += self._class_section()
        story += self._chart_section()
        story.append(PageBreak())
        story += self._corrupted_section()
        story += self._duplicate_section()
        story += self._atypical_section()
        story.append(PageBreak())
        story += self._recommendations_section()

        doc.build(story)
        logger.info("Rapport PDF écrit : %s", output_path)
        return output_path

    def _summary_section(self) -> list:
        r = self.report
        elements = [
            Paragraph("Rapport d'audit du dataset", self.styles["Title"]),
            Spacer(1, 12),
            Paragraph(f"Dataset analysé : {r.dataset_path}", self.styles["Normal"]),
            Paragraph("Résumé", self.styles["SectionTitle"]),
        ]
        data = [
            ["Images totales", str(r.total_images)],
            ["Images valides", str(len(r.valid_records))],
            ["Images corrompues", str(len(r.corrupted_records))],
            ["Images atypiques", str(len(r.atypical_records))],
            ["Groupes de doublons", str(len(r.duplicate_groups))],
            ["Classes déséquilibrées", "Oui" if r.is_imbalanced else "Non"],
            ["Temps d'exécution", f"{r.execution_time_seconds:.2f} s"],
        ]
        elements.append(self._table(data))
        return elements

    def _class_section(self) -> list:
        elements = [Paragraph("Statistiques par classe", self.styles["SectionTitle"])]
        header = [
            "Classe", "N", "Largeur moy.", "Hauteur moy.",
            "Largeur méd.", "Hauteur méd.", "Min L×H", "Max L×H",
        ]
        data = [header]
        for s in self.report.class_statistics:
            data.append(
                [
                    s.class_name,
                    str(s.count),
                    f"{s.mean_width:.0f}",
                    f"{s.mean_height:.0f}",
                    f"{s.median_width:.0f}",
                    f"{s.median_height:.0f}",
                    f"{s.min_width}×{s.min_height}",
                    f"{s.max_width}×{s.max_height}",
                ]
            )
        elements.append(self._table(data))
        return elements

    def _chart_section(self) -> list:
        elements = [Paragraph("Visualisations", self.styles["SectionTitle"])]
        for path in self.report.generated_charts.values():
            try:
                elements.append(
                    RLImage(str(path), width=14 * cm, height=14 * cm * 0.6, kind="proportional")
                )
                elements.append(Spacer(1, 10))
            except Exception as exc:  # noqa: BLE001
                logger.warning("Image ignorée dans le PDF (%s) : %s", path, exc)
        return elements

    def _corrupted_section(self) -> list:
        elements = [Paragraph("Images corrompues", self.styles["SectionTitle"])]
        rows = self.report.corrupted_records
        elements.extend(
            self._truncated_table(
                header=["Chemin", "Raison"],
                rows=[[str(r.path), r.corruption_reason or ""] for r in rows],
            )
        )
        return elements

    def _duplicate_section(self) -> list:
        elements = [Paragraph("Doublons détectés", self.styles["SectionTitle"])]
        rows = self.report.duplicate_groups
        elements.extend(
            self._truncated_table(
                header=["Original", "Doublon", "Distance"],
                rows=[
                    [str(g.original), str(g.duplicate), str(g.hamming_distance)]
                    for g in rows
                ],
            )
        )
        return elements

    def _atypical_section(self) -> list:
        elements = [Paragraph("Images atypiques", self.styles["SectionTitle"])]
        rows = self.report.atypical_records
        elements.extend(
            self._truncated_table(
                header=["Chemin", "Raisons"],
                rows=[[str(r.path), ", ".join(r.atypical_reasons)] for r in rows],
            )
        )
        return elements

    def _recommendations_section(self) -> list:
        elements = [Paragraph("Recommandations", self.styles["SectionTitle"])]
        for rec in _build_recommendations(self.report):
            elements.append(Paragraph(f"• {rec}", self.styles["Normal"]))
            elements.append(Spacer(1, 6))
        return elements

    def _truncated_table(self, header: list, rows: list) -> list:
        """Retourne une liste de flowables (jamais une liste imbriquée)."""
        if not rows:
            return [Paragraph("Aucune.", self.styles["Normal"])]
        shown = rows[:_MAX_ROWS_IN_PDF]
        data = [header] + shown
        flowables = [self._table(data)]
        if len(rows) > _MAX_ROWS_IN_PDF:
            flowables.append(Spacer(1, 6))
            flowables.append(
                Paragraph(
                    f"... et {len(rows) - _MAX_ROWS_IN_PDF} ligne(s) supplémentaire(s), "
                    "voir dataset_report.csv pour la liste complète.",
                    self.styles["Italic"],
                )
            )
        return flowables

    def _table(self, data: list) -> Table:
        table = Table(data, hAlign="LEFT")
        table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#2B2B2B")),
                    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                    ("FONTSIZE", (0, 0), (-1, -1), 8),
                    ("GRID", (0, 0), (-1, -1), 0.25, colors.grey),
                    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F2F2F2")]),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ]
            )
        )
        return table
