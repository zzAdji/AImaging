/**
 * findings — fusion des sources de diagnostics (ensemble local + backend
 * Neuro) en une liste unique de findings, utilisée À LA FOIS par l'affichage
 * (RightPanel > Diagnostics) et par l'export du rapport (radioExport).
 * Source unique de vérité : la sidebar et l'éditeur ne peuvent plus diverger.
 */

import type { AiDiagnosis } from "../../state/workspace";
import type { PathologyResult } from "../workspaceApi";

export type MergedSeverity = "low" | "medium" | "high";

export interface MergedFinding {
  key: string;
  label: string;
  prob: number;
  severity: MergedSeverity;
  /** Source du finding : ensemble local ou backend Neuro (YOLOv8+DenseNet). */
  source: "ensemble" | "neuro";
  risk?: string;
  region?: { x: number; y: number; w: number; h: number };
}

export function riskToSeverity(risk: string): MergedSeverity {
  if (risk === "CRITICAL" || risk === "HIGH") return "high";
  if (risk === "MEDIUM") return "medium";
  return "low";
}

function normalizeLabel(label: string): string {
  return label.replace(/_/g, " ").trim().toLowerCase();
}

/**
 * Fusionne les diagnostics de l'ensemble local et les findings confirmés du
 * backend Neuro (détection YOLOv8 filtrée par DenseNet). Un finding Neuro
 * dont la classe est déjà signalée par l'ensemble local n'est pas dupliqué :
 * l'entrée locale fait foi (elle porte la région du zoom).
 */
export function mergeFindings(
  diagnostics: AiDiagnosis[],
  pathologyResult: PathologyResult | null,
): MergedFinding[] {
  const merged: MergedFinding[] = diagnostics.map((d) => ({
    key: `local-${d.label}`,
    label: d.label,
    prob: d.prob,
    severity: d.severity,
    source: "ensemble" as const,
    region: d.region,
  }));
  const known = new Set(merged.map((f) => normalizeLabel(f.label)));
  if (pathologyResult) {
    for (const finding of pathologyResult.confirmed_findings) {
      const label = finding.condition.replace(/_/g, " ");
      const norm = normalizeLabel(label);
      if (known.has(norm)) continue;
      const box = pathologyResult.yolo_boxes.find((b) => normalizeLabel(b.class) === norm);
      merged.push({
        key: `neuro-${finding.condition}`,
        label,
        prob: finding.prob,
        severity: riskToSeverity(finding.risk),
        source: "neuro",
        risk: finding.risk,
        region: box
          ? {
              x: box.xyxy[0],
              y: box.xyxy[1],
              w: Math.max(1, box.xyxy[2] - box.xyxy[0]),
              h: Math.max(1, box.xyxy[3] - box.xyxy[1]),
            }
          : undefined,
      });
    }
  }
  return merged.sort((a, b) => b.prob - a.prob);
}
