/**
 * clinicalContext — contexte clinique complet des rapports radiographiques.
 *
 * Fusionne les trois sources d'analyse disponibles côté client :
 *  1. l'ensemble local de classification (déjà transmis via `prediction`) ;
 *  2. les détections confirmées du pipeline Neuro (YOLOv8 filtré par
 *     DenseNet, `workspace.pathologyResult.confirmed_findings`) ;
 *  3. les observations régionales de la carte anatomique : textes IA par
 *     région + éditions du praticien (l'édition manuelle PRIME toujours sur
 *     le texte IA), avec le flag anomalie par région.
 *
 * Le contexte est transmis au backend `/radiography/report` (3ᵉ argument
 * optionnel — un backend ancien l'ignorera sans casser) ET utilisé
 * localement pour enrichir le texte rendu, le `structured_data` persisté et
 * les exports PDF/Word/JSON. Aucune valeur n'est inventée : une région sans
 * observation (ni IA ni praticien) est simplement absente du rapport.
 */

import { ANATOMY_REGIONS } from "../anatomyMap";
import type { PathologyResult } from "../workspaceApi";

/** Détection Neuro confirmée, réduite aux champs utiles au rapport. */
export interface NeuroFindingSummary {
  condition: string;
  prob: number;
  risk: string;
}

/** Observation régionale anatomique prête pour le rapport. */
export interface AnatomyObservation {
  region_id: string;
  label: string;
  observation: string;
  /** true = écart signalé par l'IA pour cette région. */
  anomaly: boolean;
  /** « practitioner » quand l'édition manuelle prime sur le texte IA. */
  source: "ai" | "practitioner";
}

export interface ReportClinicalContext {
  neuro_findings: NeuroFindingSummary[];
  neuro_risk_level: string | null;
  anatomy_observations: AnatomyObservation[];
}

export interface ClinicalContextInputs {
  pathologyResult?: PathologyResult | null;
  anatomyRegionTexts?: Record<string, string>;
  anatomyRegionAnomalies?: Record<string, boolean>;
  anatomyRegionOverrides?: Record<string, string>;
}

const labelOfRegion = new Map<string, string>(ANATOMY_REGIONS.map((r) => [r.id, r.label]));

/**
 * Construit le contexte clinique depuis l'état du workspace.
 * Règles : l'override praticien prime sur le texte IA ; une entrée vide ou
 * blanche est ignorée ; les libellés de région inconnus retombent sur l'id.
 */
export function buildReportClinicalContext(inputs: ClinicalContextInputs): ReportClinicalContext {
  const neuroFindings: NeuroFindingSummary[] = (inputs.pathologyResult?.confirmed_findings ?? []).map(
    (finding) => ({
      condition: finding.condition,
      prob: finding.prob,
      risk: finding.risk,
    }),
  );
  const texts = inputs.anatomyRegionTexts ?? {};
  const overrides = inputs.anatomyRegionOverrides ?? {};
  const anomalies = inputs.anatomyRegionAnomalies ?? {};
  const observations: AnatomyObservation[] = [];
  const push = (regionId: string, text: string, source: AnatomyObservation["source"]) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    observations.push({
      region_id: regionId,
      label: labelOfRegion.get(regionId) ?? regionId,
      observation: trimmed,
      anomaly: anomalies[regionId] === true,
      source,
    });
  };
  /* Overrides d'abord : ils écrasent le texte IA correspondant ci-dessous. */
  for (const [regionId, text] of Object.entries(overrides)) {
    if ((overrides[regionId] ?? "").trim().length === 0) continue;
    push(regionId, text, "practitioner");
  }
  for (const [regionId, text] of Object.entries(texts)) {
    if ((overrides[regionId] ?? "").trim().length > 0) continue;
    push(regionId, text, "ai");
  }
  return {
    neuro_findings: neuroFindings,
    neuro_risk_level: inputs.pathologyResult?.risk_level ?? null,
    anatomy_observations: observations,
  };
}

/** Indique si le contexte apporte quelque chose au-delà de la prédiction ensemble. */
export function hasClinicalExtras(ctx: ReportClinicalContext): boolean {
  return ctx.neuro_findings.length > 0 || ctx.anatomy_observations.length > 0;
}

/** Lignes « Détections Neuro » formatées pour un rapport texte. */
export function formatNeuroFindingsLines(ctx: ReportClinicalContext): string[] {
  return ctx.neuro_findings.map(
    (f) =>
      `${f.condition.replace(/_/g, " ")} : ${Math.round(f.prob * 100)} % (risque ${f.risk})`,
  );
}

/** Lignes « Observations régionales » formatées pour un rapport texte. */
export function formatAnatomyLines(ctx: ReportClinicalContext): string[] {
  return ctx.anatomy_observations.map(
    (o) =>
      `${o.label}${o.anomaly ? " — anomalie signalée" : ""} (${
        o.source === "practitioner" ? "observation praticien" : "analyse IA"
      }) : ${o.observation}`,
  );
}

/**
 * Enrichit le `rendered_text` du backend avec les sections locales Neuro et
 * anatomique. Appelé côté client après chaque génération réussie : même si
 * le backend ignore encore le contexte, le rapport affiché, persisté et
 * exporté contient toutes les analyses disponibles.
 */
export function appendClinicalSections(renderedText: string, ctx: ReportClinicalContext): string {
  let out = typeof renderedText === "string" ? renderedText.trimEnd() : "";
  const neuro = formatNeuroFindingsLines(ctx);
  if (neuro.length > 0) {
    const riskSuffix =
      ctx.neuro_risk_level !== null && ctx.neuro_risk_level.length > 0
        ? ` — niveau de risque ${ctx.neuro_risk_level}`
        : "";
    out += `\n\nDétections complémentaires (pipeline Neuro${riskSuffix}) :\n${neuro
      .map((line) => `- ${line}`)
      .join("\n")}`;
  }
  const observations = formatAnatomyLines(ctx);
  if (observations.length > 0) {
    out += `\n\nObservations anatomiques régionales :\n${observations
      .map((line) => `- ${line}`)
      .join("\n")}`;
  }
  return out;
}
