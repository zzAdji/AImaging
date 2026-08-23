/**
 * Domaine échographie fœtale AImaging — CONTRATS DE DONNÉES.
 *
 * Ces schémas sont ceux que les futurs services backend (DeepFetal,
 * FetalCLIP, modèles d'anomalies) devront respecter (INSTRUCTIONS.md §33).
 * Les données UI ne se mélangent jamais avec les données backend : tout
 * résultat dérivé d'un modèle porte une source typée (`AiDataSource`).
 *
 * Phase actuelle = UI/UX mockée : les valeurs proviennent de mocks marqués
 * `kind: "mock"`. Aucune valeur n'est jamais inventée au rendu : un champ
 * absent reste `null` / `undefined` et s'affiche comme « non évalué ».
 */

/* ------------------------------ Provenance IA ------------------------------ */

/** Toute sortie d'analyse porte sa provenance. Jamais de donnée sans origine. */
export interface AiDataSource {
  /** "mock" = simulé côté client ; "model" = inférence réelle ; "user" = saisie praticien. */
  kind: "mock" | "model" | "user";
  /** Identifiant du modèle/service (ex. "deepfetal-plane-v0"). */
  model?: string;
  generatedAt: string;
}

/* -------------------------------- Qualité --------------------------------- */

export type QualityGrade = "good" | "fair" | "poor";

export interface QualityResult {
  /** Score global 0-100 (%). */
  score: number;
  status: QualityGrade;
  sharpness: QualityGrade;
  contrast: QualityGrade;
  visibility: QualityGrade;
  /** Décision d'utilisabilité clinique de l'image. */
  usability: "accepted" | "rejected" | "review";
  source: AiDataSource;
}

/* --------------------------------- Plans ---------------------------------- */

export type FetalRegion =
  | "brain"
  | "heart"
  | "abdomen"
  | "femur"
  | "spine"
  | "face"
  | "kidney"
  | "other";

export interface PlanePrediction {
  planeId: string;
  label: string;
  /** Confiance 0-1. */
  confidence: number;
}

export interface PlaneResult {
  /** Plan retenu (ex. "4CH", "3VV", "BPD", "Cereb"). */
  planeId: string;
  label: string;
  region: FetalRegion;
  confidence: number;
  /** Top-k prédictions du classifieur (plan retenu inclus). */
  topPredictions: PlanePrediction[];
  source: AiDataSource;
}

/* ------------------------------- Biométrie -------------------------------- */

/**
 * Mesure biométrique. La valeur n'est JAMAIS générée : elle vient du modèle
 * (`source.kind = "mock"`) ou d'une saisie manuelle du praticien.
 */
export interface BiometricMeasurement {
  /** Clé standard : "CRL", "BPD", "AC", "FL", "CT", "NT", … ouverte. */
  key: string;
  label: string;
  /** Valeur en mm ; null = absente / non renseignée. */
  valueMm: number | null;
  origin: "ai" | "manual";
  edited?: boolean;
  confidence?: number | null;
  source: AiDataSource;
}

export interface GestationalAge {
  weeks: number;
  days: number;
}

export interface FetusData {
  /** Identifiant stable ("F1", "F2", …). */
  id: string;
  label: string;
  measurements: BiometricMeasurement[];
  gestationalAge: GestationalAge | null;
  /** Date prévue d'accouchement (ISO). */
  edd: string | null;
  position?: string | null;
  heartRateBpm?: number | null;
  estimatedWeightG?: number | null;
}

/* ------------------------- Données obstétricales --------------------------- */

export interface PlacentaInfo {
  position: "anterior" | "posterior" | "fundal" | "lateral" | "previa" | null;
  grade: string | null;
  insertion: string | null;
  confidence: number | null;
  source: AiDataSource;
}

export interface AmnioticFluidInfo {
  status: "normal" | "abnormal" | "not_assessed";
  /** Profondeur / index mesuré si disponible — jamais généré. */
  measurementMm: number | null;
  source: AiDataSource;
}

export interface CervixInfo {
  status: "long_closed" | "shortened" | "open" | "not_assessed";
  lengthMm: number | null;
  source: AiDataSource;
}

/* -------------------------------- Findings -------------------------------- */

export interface Finding {
  id: string;
  text: string;
  status: "positive" | "neutral" | "attention";
  confidence: number | null;
  imageId?: string;
  source: AiDataSource;
}

/* ------------------------------ Anomalies --------------------------------- */

/**
 * État FINAL tant qu'aucun modèle d'anomalie n'est branché (INSTRUCTIONS.md
 * §21 / §34) : pas de score, pas de diagnostic, statut explicite.
 */
export interface AnomalyAnalysis {
  status: "not_implemented";
  message: string;
}

/* -------------------------------- Rapport --------------------------------- */

export type FetalReportState =
  | "idle"
  | "generating"
  | "generated"
  | "needs_review"
  | "validated";

export type FetalReportSectionId = "header" | "observations" | "biometry" | "conclusion";

export interface FetalReportSection {
  title: string;
  /** Contenu texte éditable. */
  content: string;
  edited?: boolean;
}

export interface FetalReport {
  state: FetalReportState;
  sections: Record<FetalReportSectionId, FetalReportSection>;
  updatedAt: string | null;
}

/* -------------------------------- Examen ---------------------------------- */

/** États du workflow (INSTRUCTIONS.md §5 / §28). */
export type FetalExamStatus = "draft" | "analyzing" | "analyzed" | "report_ready";

export interface FetalImage {
  id: string;
  name: string;
  quality?: QualityResult;
  plane?: PlaneResult;
  /** Vue retenue par la sélection IA (ou manuellement). */
  selected?: boolean;
  /** Image écartée du flux clinique (qualité insuffisante / rejet tri). */
  rejected?: boolean;
}

export interface FetalExam {
  id: string;
  name: string;
  /** Date de l'examen (ISO). */
  examDate: string;
  indication: string | null;
  /** Type d'échographie (T1 / T2 / morphologique / croissance…). */
  ultrasoundType: string | null;
  modality: "fetal_ultrasound";
  status: FetalExamStatus;
  images: FetalImage[];
  /** Un fœtus minimum ; grossesse multiple ⇒ F2, F3… */
  fetuses: FetusData[];
  placenta: PlacentaInfo | null;
  amnioticFluid: AmnioticFluidInfo | null;
  cervix: CervixInfo | null;
  findings: Finding[];
  anomaly: AnomalyAnalysis;
  report: FetalReport | null;
}


