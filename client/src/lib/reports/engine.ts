/**
 * ReportEngine — cœur pur (sans I/O) du système de rapports
 * (INSTRUCTIONS.md « Finalisation du système de rapports »).
 *
 * Principes :
 * - STRUCTURED DATA FIRST : le document est dérivé de structured_data +
 *   template_data ; aucune valeur inventée, une donnée absente reste absente ;
 * - un seul modèle de document alimente l'aperçu live ET l'export PDF/print ;
 * - templates par modalité (radiography / fetal_ultrasound / generic) avec
 *   défauts intégrés ; un template radio ne fuit jamais vers l'échographie ;
 * - Fetus 2 uniquement si grossesse multiple ; jamais de mesure absente ;
 * - bilingue fr/en pour les libellés de sections (§22).
 */

export type ReportModality = "radiography" | "fetal_ultrasound" | "generic";
export type ReportLanguage = "fr" | "en";

/* ------------------------------ Modèle template ----------------------------- */

export interface TemplateSection {
  id: string;
  title: string;
  visible: boolean;
}

/**
 * Variable personnalisable insérable dans le document via le token
 * `{{key}}`. Chaque variable a une valeur par défaut éditée dans le
 * builder puis résolue au rendu (modèle « document Word dynamique »).
 */
export interface TemplateVariable {
  key: string;
  label: string;
  value: string;
  visible: boolean;
}

/** Brique d'édition libre (systeme type Word) placée dans le document. */
export type TemplateBlockKind = "heading" | "paragraph" | "variable" | "divider";

export interface TemplateBlock {
  id: string;
  kind: TemplateBlockKind;
  /** Texte libre, ou token `{{key}}` pour kind === "variable". */
  text: string;
  visible: boolean;
}

/** Brique résolue (tokens remplacés), prête pour le preview / export. */
export interface RenderedBlock {
  id: string;
  kind: TemplateBlockKind;
  /** HTML déjà construit (heading / paragraph / variable / divider). */
  html: string;
  visible: boolean;
}

export interface ReportTemplateData {
  page: { size: "A4"; orientation: "portrait" | "landscape"; marginsMm: { top: number; right: number; bottom: number; left: number } };
  typography: { fontFamily: string; fontSizePt: number; lineHeight: number; color: string };
  accentColor: string;
  header: {
    visible: boolean;
    logoPath: string | null;
    organizationName: string;
    subtitle: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
    align: "left" | "center" | "right";
  };
  footer: { visible: boolean; text: string | null; showDate: boolean; showPagination: boolean };
  sections: TemplateSection[];
  /**
   * Variables personnalisables (model Word-like) résolues par token
   * `{{key}}`. Les champs d'en-tête (organisation…) sont aussi résolus.
   */
  variables: TemplateVariable[];
  /** Briques d'édition libre insérées dans le document final. */
  customBlocks: TemplateBlock[];
  signature: {
    visible: boolean;
    name: string | null;
    role: string | null;
    imagePath: string | null;
    position: "left" | "center" | "right";
  };
}

/* --------------------------- Défauts par modalité --------------------------- */

const RADIO_SECTIONS_FR: TemplateSection[] = [
  { id: "header", title: "En-tête", visible: true },
  { id: "overview", title: "Overview", visible: true },
  { id: "findings", title: "Findings", visible: true },
  { id: "ai_results", title: "AI Results", visible: true },
  { id: "measurements", title: "Measurements", visible: true },
  { id: "impression", title: "Impression", visible: true },
  { id: "footer", title: "Footer", visible: true },
];

const FETAL_SECTIONS_FR: TemplateSection[] = [
  { id: "header", title: "Échographie obstétricale", visible: true },
  { id: "observations", title: "Observations générales", visible: true },
  { id: "fetus_1", title: "Fetus 1", visible: true },
  { id: "fetus_2", title: "Fetus 2", visible: false }, // visible seulement si grossesse multiple (§5)
  { id: "biometry", title: "Biométrie", visible: true },
  { id: "placenta", title: "Placenta", visible: true },
  { id: "amniotic_fluid", title: "Liquide amniotique", visible: true },
  { id: "cervix", title: "Col", visible: true },
  { id: "findings", title: "Findings", visible: true },
  { id: "conclusion", title: "Conclusion", visible: true },
  { id: "footer", title: "Footer", visible: true },
];

function baseTemplate(sections: TemplateSection[]): ReportTemplateData {
  return {
    page: { size: "A4", orientation: "portrait", marginsMm: { top: 18, right: 15, bottom: 15, left: 15 } },
    typography: { fontFamily: "Inter, sans-serif", fontSizePt: 11, lineHeight: 1.45, color: "#111111" },
    accentColor: "#2563eb",
    header: {
      visible: true,
      logoPath: null,
      organizationName: "",
      subtitle: null,
      address: null,
      phone: null,
      email: null,
      align: "left",
    },
    footer: { visible: true, text: null, showDate: true, showPagination: true },
    sections,
    variables: defaultVariables(),
    customBlocks: [],
    signature: { visible: true, name: null, role: null, imagePath: null, position: "right" },
  };
}

/** Variables par défaut disponibles dans tout template (réseau + local). */
export function defaultVariables(): TemplateVariable[] {
  return [
    { key: "patientName", label: "Nom du patient", value: "____________________", visible: true },
    { key: "examinerName", label: "Médecin demandeur / interprétateur", value: "____________________", visible: true },
    { key: "examDate", label: "Date de l'examen", value: "____ / ____ / ________", visible: true },
    { key: "examId", label: "N° d'examen", value: "____________________", visible: true },
  ];
}

/**
 * Répare un objet template chargé depuis la persistance (localStorage/DB) :
 * les anciennes valeurs éditées avant l'ajout des blocs/variables/composites
 * ne contiennent ni `variables` ni `customBlocks`. Ce normaliseur garantit
 * qu'un rendu (aperçu/export) ne plante jamais sur des champs absents.
 */
export function normalizeTemplateData(template: ReportTemplateData): ReportTemplateData {
  const defaults = defaultTemplateData("radiography");
  return {
    ...template,
    page: template.page ?? defaults.page,
    typography: template.typography ?? defaults.typography,
    accentColor: template.accentColor ?? defaults.accentColor,
    header: { ...defaults.header, ...(template.header ?? {}) },
    footer: { ...defaults.footer, ...(template.footer ?? {}) },
    signature: { ...defaults.signature, ...(template.signature ?? {}) },
    sections: Array.isArray(template.sections) && template.sections.length > 0
      ? template.sections
      : defaults.sections,
    variables: Array.isArray(template.variables)
      ? template.variables
          .filter((v): v is TemplateVariable => Boolean(v) && typeof v.key === "string")
          .map((v) => ({
            ...v,
            visible: v.visible !== false,
            label: v.label ?? v.key,
            value: v.value ?? "",
          }))
      : defaultVariables(),
    customBlocks: Array.isArray(template.customBlocks) ? template.customBlocks : [],
  };
}

/** Template par défaut intégré pour une modalité (§7 : un défaut par modalité). */
export function defaultTemplateData(
  modality: Exclude<ReportModality, "generic"> | ReportModality,
  language: ReportLanguage = "fr",
): ReportTemplateData {
  void language; // libellés UI déjà en fr/en côté sections métier ; extensible §22
  const sections =
    modality === "fetal_ultrasound"
      ? FETAL_SECTIONS_FR.map((s) => ({ ...s }))
      : modality === "radiography"
        ? RADIO_SECTIONS_FR.map((s) => ({ ...s }))
        : RADIO_SECTIONS_FR.map((s) => ({ ...s }));
  return baseTemplate(sections);
}

/* ------------------------ Rendu document (data+template) -------------------- */

export interface RenderedSection {
  id: string;
  title: string;
  /** Lignes de texte déjà mises en forme ; vide ⇒ section omise du rendu. */
  lines: string[];
  visible: boolean;
}

export interface RenderedDocument {
  modality: ReportModality;
  template: ReportTemplateData;
  sections: RenderedSection[];
  /** Champs d'en-tête résolus (organisation + examen), prêts pour preview/PDF. */
  headerFields: Array<{ label: string; value: string }>;
  /** Briques d'édition libre résolues (tokens `{{key}}` remplacés). */
  blocks: RenderedBlock[];
  /** Résolution des tokens utiles au preview/export (variables + en-tête). */
  tokenValues: Record<string, string>;
}

/** Valeurs des tokens pour le rendu d'un document (défaut vide). */
export function defaultTokenValues(template: ReportTemplateData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const variable of template.variables) {
    if (variable.visible) out[variable.key] = variable.value;
  }
  if (template.header.organizationName.length > 0) out.organization = template.header.organizationName;
  return out;
}

function substituteTokens(text: string, values: Record<string, string>): string {
  return text.replace(/\{\{([^}]+)\}\}/g, (match, key: string) => {
    const trimmed = key.trim();
    return trimmed in values ? values[trimmed] : match;
  });
}

/**
 * Résout les briques libres du template : tokens remplacés, chaque brique
 * convertie en HTML selon son type (heading / paragraph / variable / divider).
 */
export function resolveBlocks(template: ReportTemplateData, values: Record<string, string>): RenderedBlock[] {
  return template.customBlocks.filter((block) => block.visible).map((block) => {
    const text = substituteTokens(block.text, values);
    let html = "";
    switch (block.kind) {
      case "heading":
        html = `<h3 class="custom-heading">${escapeHtml(text)}</h3>`;
        break;
      case "paragraph":
        html = `<p>${escapeHtml(text)}</p>`;
        break;
      case "variable": {
        html = `<span class="field-row"><span class="field-label">${escapeHtml(text)}</span></span>`;
        break;
      }
      case "divider":
        html = `<hr class="doc-divider"/>`;
        break;
    }
    return { id: block.id, kind: block.kind, html, visible: true };
  });
}

/** Échappement HTML réutilisé par le builder (défini ici pour éviter un cycle). */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;");
}

type StringMap = Record<string, unknown>;

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function pushLine(lines: string[], text: string): void {
  const t = text.trim();
  if (t.length > 0) lines.push(t);
}

/* ---------------------- Builders structured_data ---------------------------- */

/** Entrée minimale pour le rendu radiographie (issu de /radiography/report). */
export interface RadiographyReportInput {
  fields: Record<string, string>;
  coherenceIssues: string[];
  renderedText?: string;
  ensemblePrediction?: string | null;
  numModels?: number | null;
  /** Mesures réellement posées sur l'image (unité préservée). */
  measurements?: Array<{ label: string; value: number | null; unit: string; source: "ai" | "user" }>;
}

/** Construit le structured_data radio — aucune valeur inventée (§3/§4). */
export function buildRadiographyStructuredData(input: RadiographyReportInput): StringMap {
  return {
    modality: "radiography",
    findings: input.fields,
    impression: {
      ensemble_prediction: input.ensemblePrediction ?? null,
      confidence: null, // jamais inventé : absent tant que non fourni
    },
    ai: {
      model_count: input.numModels ?? null,
      coherence_issues: input.coherenceIssues,
      assisted: true,
    },
    measurements: input.measurements ?? [],
  };
}

/* --------------------------- Rendu radiographie ----------------------------- */

function renderRadiography(data: StringMap, headerFields: Array<{ label: string; value: string }>): RenderedSection[] {
  const findings = (data.findings ?? {}) as Record<string, unknown>;
  const impression = (data.impression ?? {}) as Record<string, unknown>;
  const ai = (data.ai ?? {}) as Record<string, unknown>;
  const measurements = Array.isArray(data.measurements)
    ? (data.measurements as Array<Record<string, unknown>>)
    : [];

  const sections: RenderedSection[] = [];
  const overview: string[] = [];
  for (const [key, value] of Object.entries(findings)) {
    pushLine(overview, `${key} : ${str(value)}`);
  }
  sections.push({ id: "overview", title: "Overview", lines: overview, visible: true });

  const findingLines: string[] = [];
  if (ai.assisted === true) {
    pushLine(findingLines, "AI-assisted results — needs review until validation.");
  }
  const issues = Array.isArray(ai.coherence_issues) ? (ai.coherence_issues as unknown[]) : [];
  for (const issue of issues) pushLine(findingLines, `⚠ ${str(issue)}`);
  sections.push({ id: "findings", title: "Findings", lines: findingLines, visible: true });

  const aiLines: string[] = [];
  const modelCount = num(ai.model_count);
  if (modelCount !== null) pushLine(aiLines, `Ensemble de ${modelCount} modèle(s).`);
  const prediction = str(impression.ensemble_prediction);
  if (prediction.length > 0) pushLine(aiLines, `Prédiction ensemble : ${prediction}`);
  sections.push({ id: "ai_results", title: "AI Results", lines: aiLines, visible: true });

  const measLines: string[] = [];
  for (const m of measurements) {
    const value = num(m.value);
    /* Une mesure absente reste absente : jamais de « N/A » inventé (§3). */
    if (value === null) continue;
    pushLine(measLines, `${str(m.label)} : ${value} ${str(m.unit)} (${str(m.source)})`);
  }
  sections.push({ id: "measurements", title: "Measurements", lines: measLines, visible: true });

  const impressionLines: string[] = [];
  if (prediction.length > 0) pushLine(impressionLines, `Suspicion / prédiction : ${prediction}`);
  for (const issue of issues) pushLine(impressionLines, `Limite : ${str(issue)}`);
  sections.push({ id: "impression", title: "Impression", lines: impressionLines, visible: true });

  void headerFields;
  return sections;
}

/* ------------------------- Rendu échographie fœtale ------------------------- */

function renderFetal(data: StringMap): RenderedSection[] {
  const sections: RenderedSection[] = [];

  const observations = (data.observations ?? {}) as Record<string, unknown>;
  const obsLines: string[] = [];
  for (const [key, value] of Object.entries(observations)) {
    pushLine(obsLines, `${key} : ${str(value)}`);
  }
  sections.push({ id: "observations", title: "Observations générales", lines: obsLines, visible: true });

  /* Fetus : uniquement ceux réellement présents (jamais de Fetus 2 fantôme, §5). */
  const fetuses = Array.isArray(data.fetuses) ? (data.fetuses as Array<Record<string, unknown>>) : [];
  fetuses.forEach((fetus, index) => {
    const lines: string[] = [];
    const biometry = (fetus.biometry ?? {}) as Record<string, { value?: number | null; unit?: string }>;
    for (const [key, entry] of Object.entries(biometry)) {
      const value = entry?.value ?? null;
      if (value === null || value === undefined) continue; // mesure absente ⇒ absente
      pushLine(lines, `${key} : ${value} ${entry.unit ?? "mm"}`);
    }
    for (const extra of ["gestationalAge", "edd"] as const) {
      const v = fetus[extra];
      if (v !== null && v !== undefined) pushLine(lines, `${extra} : ${str(v)}`);
    }
    sections.push({
      id: `fetus_${index + 1}`,
      title: `Fetus ${index + 1}`,
      lines,
      visible: true,
    });
  });

  const placenta = data.placenta as Record<string, unknown> | undefined;
  if (placenta !== undefined) {
    const lines: string[] = [];
    for (const key of ["position", "grade", "insertion"] as const) {
      const v = placenta[key];
      if (v !== null && v !== undefined) pushLine(lines, `${key} : ${str(v)}`);
    }
    sections.push({ id: "placenta", title: "Placenta", lines, visible: true });
  }

  const fluid = data.amniotic_fluid as Record<string, unknown> | undefined;
  if (fluid !== undefined) {
    const lines: string[] = [];
    pushLine(lines, `status : ${str(fluid.status)}`);
    if (fluid.measurementMm !== null && fluid.measurementMm !== undefined) {
      pushLine(lines, `measurementMm : ${String(fluid.measurementMm)} mm`);
    }
    sections.push({ id: "amniotic_fluid", title: "Liquide amniotique", lines, visible: true });
  }

  const cervix = data.cervix as Record<string, unknown> | undefined;
  if (cervix !== undefined) {
    const lines: string[] = [];
    pushLine(lines, `status : ${str(cervix.status)}`);
    if (cervix.lengthMm !== null && cervix.lengthMm !== undefined) {
      pushLine(lines, `lengthMm : ${String(cervix.lengthMm)} mm`);
    }
    sections.push({ id: "cervix", title: "Col", lines, visible: true });
  }

  const findingsList = Array.isArray(data.findings) ? (data.findings as Array<Record<string, unknown>>) : [];
  const findingLines: string[] = [];
  for (const finding of findingsList) {
    const status = str(finding.status);
    pushLine(findingLines, `[${status}] ${str(finding.text)}`);
  }
  sections.push({ id: "findings", title: "Findings", lines: findingLines, visible: true });

  const conclusionLines: string[] = [];
  const conclusion = data.conclusion as Record<string, unknown> | undefined;
  if (conclusion !== undefined) {
    for (const [key, value] of Object.entries(conclusion)) {
      if (value === null || value === undefined) continue;
      pushLine(conclusionLines, `${key} : ${str(value)}`);
    }
  }
  sections.push({ id: "conclusion", title: "Conclusion", lines: conclusionLines, visible: true });

  return sections;
}

/* ------------------------------ API publique -------------------------------- */

/**
 * Rend le document final : structured_data + template_data → sections
 * ordonnées/filtrées selon le template (§16). Les sections sans contenu sont
 * renvoyées avec lines=[] — l'aperçu/PDF les omet.
 */
export function renderDocument(
  modality: ReportModality,
  structuredData: StringMap,
  templateData: ReportTemplateData | null,
): RenderedDocument {
  const template = normalizeTemplateData(templateData ?? defaultTemplateData(modality));
  const headerFields: Array<{ label: string; value: string }> = [];
  if (template.header.organizationName.length > 0) {
    headerFields.push({ label: "Établissement", value: template.header.organizationName });
  }
  const rawSections =
    modality === "fetal_ultrasound" ? renderFetal(structuredData) : renderRadiography(structuredData, headerFields);

  const byId = new Map(rawSections.map((section) => [section.id, section]));
  const ordered: RenderedSection[] = [];

  /* Ordre/visibilité imposés par le template ; sections data inconnues du
     template ajoutées à la fin (jamais perdues). */
  for (const sectionTemplate of template.sections) {
    const section = byId.get(sectionTemplate.id);
    if (section === undefined) continue;
    byId.delete(sectionTemplate.id);
    ordered.push({ ...section, title: sectionTemplate.title, visible: sectionTemplate.visible });
  }
  for (const leftover of byId.values()) ordered.push(leftover);

  const tokenValues = defaultTokenValues(template);
  const blocks = resolveBlocks(template, tokenValues);

  return { modality, template, sections: ordered, headerFields, blocks, tokenValues };
}

/** Sections réellement affichables (visibles ET non vides). */
export function visibleSections(document: RenderedDocument): RenderedSection[] {
  return document.sections.filter((section) => section.visible && section.lines.length > 0);
}
