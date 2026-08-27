/**
 * radioExport — pipeline d'export UNIQUE du rapport radiographique
 * (PDF / Word / JSON), partagé par la RightSidebar (« Rapport ») et la barre
 * d'actions de l'éditeur de rapport (ReportActionsBar). Une seule source de
 * vérité : mêmes données structurées, même texte rendu, quel que soit le
 * bouton de téléchargement utilisé.
 *
 * Défaut §1 : les données structurées proviennent des vraies données
 * collectées (champs LLM, diagnostics fusionnés, contexte clinique Neuro +
 * observations anatomiques) — jamais du texte brut tronqué seul.
 */

import {
  buildRadiographyStructuredData,
  defaultTemplateData,
  renderDocument,
  type ReportModality,
  type ReportTemplateData,
} from "./engine";
import { buildReportClinicalContext } from "./clinicalContext";
import { mergeFindings } from "./findings";
import {
  buildReportFilename,
  buildReportJsonExport,
  buildWordDocument,
  documentHtml,
  downloadTextFile,
  printDocument,
} from "./pdfExport";
import { getLocalDefault } from "../db/templateStore";
import type { AiDiagnosis, PatientInfo } from "../../state/workspace";
import type { PathologyResult } from "../workspaceApi";

/** État workspace minimal requis pour construire le rapport exporté. */
export interface RadioReportSourceState {
  patientInfo: PatientInfo;
  diagnostics: AiDiagnosis[];
  modelCount: number | null;
  /** Champs structurés bruts du backend (RadiologyReportFields) ; null tant
   * qu'aucune génération LLM n'a réussi (aucune valeur inventée). */
  reportFields: Record<string, string> | null;
  reportCoherenceIssues: string[];
  pathologyResult: PathologyResult | null;
  anatomyRegionTexts: Record<string, string>;
  anatomyRegionAnomalies: Record<string, boolean>;
  anatomyRegionOverrides: Record<string, string>;
}

/**
 * Injecte les infos patient de la carte « Document » comme variables du
 * template (upsert par clé) pour que les tokens `{{patientName}}` etc. des
 * blocs libres et les cellules d'en-tête PDF/Word portent les vraies valeurs
 * éditées par le praticien — plus jamais les valeurs codées en dur.
 */
function upsertPatientVariables(template: ReportTemplateData, p: PatientInfo): ReportTemplateData {
  const patientTokens: Record<string, string> = {
    patientName: p.name,
    patientId: p.patientId,
    age: p.age,
    sex: p.sex,
    ageSex: [p.age, p.sex].filter((s) => s.length > 0).join(" / "),
    examDate: p.studyDate,
    modality: p.modality,
    study: p.study,
  };
  const existingKeys = new Set(template.variables.map((v) => v.key));
  return {
    ...template,
    variables: [
      ...template.variables.map((v) =>
        v.key in patientTokens ? { ...v, value: patientTokens[v.key] ?? v.value } : v,
      ),
      ...Object.entries(patientTokens)
        .filter(([key]) => !existingKeys.has(key))
        .map(([key, value]) => ({
          key,
          label: key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()),
          value,
          visible: true,
        })),
    ],
  };
}

/**
 * Construit le structured_data radio depuis l'état réel du workspace :
 * champs LLM, cohérence, prédiction ensemble fusionnée avec le Neuro,
 * observations régionales anatomiques (éditions praticien prioritaires).
 * Aucune valeur n'est inventée.
 */
export function buildRadioStructuredInput(
  state: RadioReportSourceState,
  reportText: string,
): ReturnType<typeof buildRadiographyStructuredData> {
  const clinicalCtx = buildReportClinicalContext({
    pathologyResult: state.pathologyResult,
    anatomyRegionTexts: state.anatomyRegionTexts,
    anatomyRegionAnomalies: state.anatomyRegionAnomalies,
    anatomyRegionOverrides: state.anatomyRegionOverrides,
  });
  return buildRadiographyStructuredData({
    fields: state.reportFields ?? {},
    coherenceIssues: state.reportCoherenceIssues,
    renderedText: reportText || undefined,
    ensemblePrediction: mergeFindings(state.diagnostics, state.pathologyResult)[0]?.label ?? null,
    numModels: state.modelCount,
    neuroFindings: clinicalCtx.neuro_findings,
    neuroRiskLevel: clinicalCtx.neuro_risk_level,
    anatomyObservations: clinicalCtx.anatomy_observations,
    /* TODO(§1) : brancher les mesures réellement posées sur le canvas
       (LandmarksMeasurementsCard) — ce composant n'expose pas encore ses
       données au niveau du workspace ; aucune mesure n'est donc inventée ici
       tant que ce câblage n'existe pas. */
    measurements: [],
  });
}

/**
 * Exporte le rapport (PDF impression / Word .doc / JSON structuré) à partir
 * du texte courant et de l'état workspace partagé. Utilisé tel quel par les
 * deux points d'entrée UI — garantit des fichiers identiques.
 *
 * `preferText` distingue les DEUX intentions d'export d'un même pipeline :
 *  - défaut `false` (panneau latéral « Rapport ») ⇒ champs structurés :
 *    Résultat + Conclusion uniques ; mesures, détections Neuro et
 *    observations régionales sont des PUCES du Résultat (jamais de section
 *    dédiée) — concis, sans doublon ;
 *  - `true` (éditeur de rapport, `icône Export`) ⇒ le TEXTE ÉDITÉ du praticien
 *    fait foi : c'est la version revue/corrigée du rapport, rendue strictement
 *    (tirets/titres internes supprimés, Résultat + Conclusion).
 */
export function exportRadioReport(
  kind: "pdf" | "word" | "json",
  modality: ReportModality,
  state: RadioReportSourceState,
  reportText: string,
  templateOverride?: ReportTemplateData,
  preferText = false,
): void {
  const template = upsertPatientVariables(
    templateOverride ?? resolveRadioTemplate(modality),
    state.patientInfo,
  );
  /* Radiographie : l'éditeur (preferText) exporte le texte édité ; le panneau
     latéral exporte les champs structurés (tout en puces du Résultat).
     Les autres modalités (fœtal…) partent toujours du texte édité. */
  const fromDraft =
    modality !== "radiography" ||
    (modality === "radiography" && preferText);
  const structured = fromDraft
    ? {
        findings: { draft: reportText.slice(0, 4000) },
        note: "Contenu édité par le praticien.",
      }
    : buildRadioStructuredInput(state, reportText);
  const rendered = renderDocument(modality, structured, template);
  const date = new Date();
  if (kind === "pdf") {
    printDocument(documentHtml(rendered));
  } else if (kind === "word") {
    downloadTextFile(
      buildReportFilename(modality, date, "doc"),
      buildWordDocument(rendered),
      "application/msword",
    );
  } else {
    downloadTextFile(
      buildReportFilename(modality, date, "json"),
      JSON.stringify(buildReportJsonExport(rendered, reportText), null, 2),
      "application/json",
    );
  }
}

/** Template résolu : défaut local s'il existe, sinon défaut du moteur. */
export function resolveRadioTemplate(modality: ReportModality): ReportTemplateData {
  return getLocalDefault(modality, null)?.data ?? (defaultTemplateData(modality) as ReportTemplateData);
}
