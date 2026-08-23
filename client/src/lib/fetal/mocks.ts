import type {
  AiDataSource,
  AmnioticFluidInfo,
  AnomalyAnalysis,
  BiometricMeasurement,
  CervixInfo,
  FetalExam,
  FetalImage,
  Finding,
  FetusData,
  FetalRegion,
  PlacentaInfo,
  PlaneResult,
  QualityResult,
} from "./types";

/**
 * Données mockées de la phase UI/UX (INSTRUCTIONS.md §31 / §33 / §34).
 *
 * Règles respectées :
 * - chaque résultat porte `source.kind = "mock"` (jamais présenté comme réel) ;
 * - l'anomalie est `not_implemented`, sans score ni diagnostic ;
 * - les mocks simulent la FORME exacte des futures sorties backend.
 */

const now = () => new Date().toISOString();
const mockSource = (model: string): AiDataSource => ({ kind: "mock", model, generatedAt: now() });

/* ------------------------------ Catalogue plans ---------------------------- */

interface PlanSpec {
  planeId: string;
  label: string;
  region: FetalRegion;
  count: number;
}

const PLAN_CATALOG: PlanSpec[] = [
  { planeId: "4CH", label: "4CH", region: "heart", count: 3 },
  { planeId: "3VV", label: "3VV", region: "heart", count: 2 },
  { planeId: "LVOT", label: "LVOT", region: "heart", count: 2 },
  { planeId: "RVOT", label: "RVOT", region: "heart", count: 2 },
  { planeId: "BPD", label: "BPD", region: "brain", count: 3 },
  { planeId: "Cereb", label: "Cereb", region: "brain", count: 2 },
  { planeId: "Stomach", label: "Stomach", region: "abdomen", count: 2 },
  { planeId: "AC", label: "AC", region: "abdomen", count: 1 },
  { planeId: "FL", label: "Femur", region: "femur", count: 2 },
  { planeId: "Spine", label: "Spine", region: "spine", count: 3 },
  { planeId: "Profile", label: "Face", region: "face", count: 1 },
  { planeId: "Kidney", label: "Kidney", region: "kidney", count: 1 },
];

/** Vues retenues par la sélection IA : meilleures images par plan cible (§13). */
const SELECTED_TARGETS = ["BPD", "Cereb", "4CH", "3VV", "RVOT", "Stomach", "AC", "Profile"];

const buildMockImages = (): FetalImage[] => {
  const images: FetalImage[] = [];
  let index = 0;
  for (const spec of PLAN_CATALOG) {
    for (let n = 0; n < spec.count; n += 1) {
      index += 1;
      const id = `img-${String(index).padStart(2, "0")}`;
      /* Une image de mauvaise qualité par catalogue (dernière passe) : score
         bas, inutilisable → exercice du chemin « rejetée » (§10 / §27). */
      const isRejected = spec.planeId === "Kidney";
      const baseScore = isRejected ? 32 : 88 + ((index * 7) % 9);
      const quality: QualityResult = {
        score: baseScore,
        status: baseScore >= 90 ? "good" : baseScore >= 70 ? "fair" : "poor",
        sharpness: baseScore >= 85 ? "good" : "fair",
        contrast: baseScore >= 80 ? "good" : "fair",
        visibility: isRejected ? "poor" : "good",
        usability: isRejected ? "rejected" : "accepted",
        source: mockSource("fetal-quality-mock"),
      };
      const confidence = Math.min(0.97, 0.72 + ((index % 5) * 0.05));
      const topPredictions = [
        { planeId: spec.planeId, label: spec.label, confidence },
        ...PLAN_CATALOG.filter((p) => p.planeId !== spec.planeId)
          .slice(0, 3)
          .map((p, k) => ({ planeId: p.planeId, label: p.label, confidence: Math.max(0.01, confidence / (10 * (k + 1))) })),
      ];
      const plane: PlaneResult = {
        planeId: spec.planeId,
        label: spec.label,
        region: spec.region,
        confidence,
        topPredictions,
        source: mockSource("deepfetal-plane-mock"),
      };
      images.push({
        id,
        name: `US_${String(index).padStart(3, "0")}`,
        quality,
        plane,
        selected:
          !isRejected &&
          SELECTED_TARGETS.includes(spec.planeId) &&
          /* Une seule image retenue par plan cible (la meilleure = première). */
          n === 0,
        rejected: isRejected,
      });
    }
  }
  return images;
};

/* ------------------------------- Biométrie mock ---------------------------- */

const BIOMETRY_KEYS: Array<{ key: string; label: string }> = [
  { key: "CRL", label: "CRL" },
  { key: "BPD", label: "BPD" },
  { key: "AC", label: "AC" },
  { key: "FL", label: "FL" },
  { key: "CT", label: "CT" },
];

const buildMockMeasurements = (values: Record<string, number>): BiometricMeasurement[] =>
  BIOMETRY_KEYS.map(({ key, label }) => ({
    key,
    label,
    valueMm: values[key] ?? null,
    origin: "ai",
    confidence: 0.9,
    source: mockSource("deepfetal-biometry-mock"),
  }));

const buildMockFetuses = (): FetusData[] => [
  {
    id: "F1",
    label: "F1",
    measurements: buildMockMeasurements({ CRL: 15, BPD: 28, AC: 82, FL: 15, CT: 105 }),
    gestationalAge: { weeks: 14, days: 6 },
    edd: "2026-07-05",
    position: "Céphalique",
    heartRateBpm: 148,
    estimatedWeightG: 118,
  },
  {
    id: "F2",
    label: "F2",
    measurements: buildMockMeasurements({ CRL: 16, BPD: 29, AC: 92, FL: 16, CT: 105 }),
    gestationalAge: { weeks: 15, days: 1 },
    edd: "2026-07-03",
    position: "Siège",
    heartRateBpm: 152,
    estimatedWeightG: 126,
  },
];

/* ---------------------------- Contexte obstétrical -------------------------- */

const buildPlacenta = (): PlacentaInfo => ({
  position: "anterior",
  grade: "Grade I",
  insertion: "Normal",
  confidence: 0.88,
  source: mockSource("fetal-obstetric-mock"),
});

const buildFluid = (): AmnioticFluidInfo => ({
  status: "normal",
  measurementMm: 45,
  source: mockSource("fetal-obstetric-mock"),
});

const buildCervix = (): CervixInfo => ({
  status: "long_closed",
  lengthMm: 38,
  source: mockSource("fetal-obstetric-mock"),
});

const buildFindings = (images: FetalImage[]): Finding[] => {
  const heartImage = images.find((image) => image.plane?.planeId === "4CH");
  return [
    {
      id: "finding-morphology",
      text: "Fetal morphology appears normal",
      status: "positive",
      confidence: 0.91,
      source: mockSource("fetal-findings-mock"),
    },
    {
      id: "finding-fluid",
      text: "Amniotic fluid quantity normal",
      status: "positive",
      confidence: 0.94,
      source: mockSource("fetal-findings-mock"),
    },
    {
      id: "finding-placenta",
      text: "Placental position available",
      status: "neutral",
      confidence: null,
      source: mockSource("fetal-findings-mock"),
    },
    {
      id: "finding-review",
      text: "Finding requiring review — outflow tracts (LVOT/RVOT) to confirm",
      status: "attention",
      confidence: 0.62,
      imageId: heartImage?.id,
      source: mockSource("fetal-findings-mock"),
    },
  ];
};

const ANOMALY_NOT_IMPLEMENTED: AnomalyAnalysis = {
  status: "not_implemented",
  message: "The anomaly detection model is currently not connected.",
};

/* ------------------------------ Examen complet ------------------------------ */

/**
 * Examen échographique fœtal mocké (grossesse gémellaire) — état INITIAL :
 * images importées sans aucun résultat d'analyse (`draft`, §4/§5). Les
 * résultats (qualité, plans, sélection, biométrie, findings, contexte
 * obstétrical) émergent via {@link applyMockAnalysis}, déclenchée par
 * l'action « Analyze examination » après le pipeline visuel (§29).
 */
export function createMockFetalExam(): FetalExam {
  const images = buildMockImages().map(({ id, name }) => ({ id, name }));
  return {
    id: "fetal-exam-mock-001",
    name: "Échographie obstétricale — T2 (mock)",
    examDate: now(),
    indication: "Contrôle morphologique — grossesse gémellaire",
    ultrasoundType: "T2 morphologique",
    modality: "fetal_ultrasound",
    status: "draft",
    images,
    fetuses: buildMockFetuses().map((fetus) => ({
      ...fetus,
      measurements: fetus.measurements.map((m) => ({ ...m, valueMm: null })),
      gestationalAge: null,
      edd: null,
      position: null,
      heartRateBpm: null,
      estimatedWeightG: null,
    })),
    placenta: null,
    amnioticFluid: { status: "not_assessed", measurementMm: null, source: mockSource("fetal-obstetric-mock") },
    cervix: { status: "not_assessed", lengthMm: null, source: mockSource("fetal-obstetric-mock") },
    findings: [],
    anomaly: ANOMALY_NOT_IMPLEMENTED,
    report: null,
  };
}

/**
 * Résultat de l'analyse simulée : renvoie un NOUVEL examen enrichi avec tous
 * les résultats mockés (qualité, plans, sélection IA, biométrie, findings,
 * placenta / liquide / col). Aucune mutation de l'état précédent.
 */
export function applyMockAnalysis(previous: FetalExam): FetalExam {
  const analyzedImages = buildMockImages();
  const analyzedByName = new Map<string, FetalImage>(
    analyzedImages.map((image) => [image.name, image]),
  );
  return {
    ...previous,
    status: "analyzed",
    images: previous.images.map((image) => {
      const analyzed = analyzedByName.get(image.name);
      return analyzed
        ? { ...image, quality: analyzed.quality, plane: analyzed.plane, selected: analyzed.selected, rejected: analyzed.rejected }
        : image;
    }),
    /* Biométrie : les valeurs mockées remplissent les mesures restées vides
       au stade draft ; l'édition manuelle ultérieure prime sur la valeur IA. */
    fetuses: buildMockFetuses(),
    placenta: buildPlacenta(),
    amnioticFluid: buildFluid(),
    cervix: buildCervix(),
    findings: buildFindings(analyzedImages),
    anomaly: ANOMALY_NOT_IMPLEMENTED,
  };
}



