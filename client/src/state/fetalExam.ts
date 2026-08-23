import { createContext, useContext, useEffect, useRef, useState } from "react";
import { applyMockAnalysis, createMockFetalExam } from "../lib/fetal/mocks";
import { buildFreshReport, buildSection, checkReportReadiness } from "../lib/fetal/report";
import type { BiometricMeasurement, FetalExam, FetalExamStatus, FetalImage, FetalReportSectionId } from "../lib/fetal/types";

/**
 * Store local du module échographie fœtale (phase UI/UX mockée).
 *
 * Convention projet : contexte + hook ici, Provider composant dans
 * components/fetal/FetalExamProvider.tsx. Le remplacement des mocks par les
 * vrais services backend se fera dans ce fichier SANS toucher aux panneaux.
 */

/** Phases du pipeline visuel d'analyse (INSTRUCTIONS.md §29). */
export const ANALYSIS_PHASES = [
  "Preparing images",
  "Quality analysis",
  "Plane classification",
  "Selecting representative views",
  "Extracting features",
  "Preparing report",
] as const;

export type AnalysisPhaseIndex = number;

export interface FetalExamState {
  exam: FetalExam;
  /** Index de phase courante pendant l'analyse ; null = inactif/terminé. */
  analysisPhase: AnalysisPhaseIndex | null;
  startAnalysis: () => void;
  resetExam: () => void;
  setExamStatus: (status: FetalExamStatus) => void;
  /** Met à jour une image (utilisabilité, sélection manuelle…). */
  updateImage: (imageId: string, patch: Partial<FetalImage>) => void;
  /** « Replace selection » : rejoue la sélection IA mockée sur l'état courant. */
  replaceSelection: () => void;
  /** Édite (ou efface avec null) une mesure biométrique — saisie praticien. */
  updateMeasurement: (fetusId: string, key: string, valueMm: number | null) => void;
  /** Ajoute une mesure vide (jamais de valeur inventée). */
  addMeasurement: (fetusId: string, key: string, label: string) => void;
  /** « Generate » : construit le rapport depuis les données structurées (§24). */
  generateReport: () => boolean;
  /** Édition d'une section du rapport (FetalReportEditor). */
  updateReportSection: (sectionId: FetalReportSectionId, content: string) => void;
  /** Regenerate / Reset section : reconstruit la section depuis les données. */
  resetReportSection: (sectionId: FetalReportSectionId) => void;
  /** Validation finale du rapport (Needs review → Validated). */
  validateReport: () => void;
  /** Ouverture du FetalReportEditor. */
  reportEditOpen: boolean;
  setReportEditOpen: (open: boolean) => void;
  /** Image fœtale active (filmstrip + cartes qualité/plane/findings). */
  activeImageId: string | null;
  setActiveImageId: (imageId: string | null) => void;
}

export const FetalExamContext = createContext<FetalExamState | null>(null);

/** Durée simulée d'une phase du pipeline (ms) — discret, ~2.4 s au total. */
const PHASE_DURATION_MS = 400;

export function useFetalExam(): FetalExamState {
  const ctx = useContext(FetalExamContext);
  if (!ctx) throw new Error("useFetalExam must be used within FetalExamProvider");
  return ctx;
}

/** Logique interne du provider : simulation séquencée du pipeline mocké. */
export function useFetalExamStore(): FetalExamState {
  const [exam, setExam] = useState<FetalExam>(createMockFetalExam);
  const [analysisPhase, setAnalysisPhase] = useState<AnalysisPhaseIndex | null>(null);
  const timers = useRef<number[]>([]);

  /* Nettoyage des timers de simulation au démontage. */
  useEffect(
    () => () => {
      for (const timer of timers.current) window.clearTimeout(timer);
      timers.current = [];
    },
    [],
  );

  const clearTimers = () => {
    for (const timer of timers.current) window.clearTimeout(timer);
    timers.current = [];
  };

  const startAnalysis = () => {
    if (analysisPhase !== null) return;
    clearTimers();
    setExam((prev) => ({ ...prev, status: "analyzing" }));
    ANALYSIS_PHASES.forEach((_, index) => {
      timers.current.push(
        window.setTimeout(() => {
          setAnalysisPhase(index);
          if (index === ANALYSIS_PHASES.length - 1) {
            /* Dernière phase : pose des résultats mockés et sortie du pipeline. */
            timers.current.push(
              window.setTimeout(() => {
                setAnalysisPhase(null);
                setExam((prev) => applyMockAnalysis(prev));
              }, PHASE_DURATION_MS),
            );
          }
        }, PHASE_DURATION_MS * index),
      );
    });
  };

  const resetExam = () => {
    clearTimers();
    setAnalysisPhase(null);
    setExam(createMockFetalExam());
  };

  const setExamStatus = (status: FetalExamStatus) => {
    setExam((prev) => ({ ...prev, status }));
  };

  const updateImage = (imageId: string, patch: Partial<FetalImage>) => {
    setExam((prev) => ({
      ...prev,
      images: prev.images.map((image) => (image.id === imageId ? { ...image, ...patch } : image)),
    }));
  };

  const replaceSelection = () => {
    /* Mock : rejoue la sélection déterministe sur les résultats courants.
       Le futur backend renverra une nouvelle sélection (DeepFetal selection). */
    setExam((prev) => applyMockAnalysis({ ...prev, status: "analyzed" }));
  };

  const updateMeasurement = (fetusId: string, key: string, valueMm: number | null) => {
    /* Règle absolue (§15/§33) : la valeur vient du praticien ou du modèle,
       JAMAIS d'une génération arbitraire. null = mesure effacée. */
    setExam((prev) => ({
      ...prev,
      fetuses: prev.fetuses.map((fetus) =>
        fetus.id !== fetusId
          ? fetus
          : {
              ...fetus,
              measurements: fetus.measurements.map((measurement): BiometricMeasurement =>
                measurement.key !== key
                  ? measurement
                  : {
                      ...measurement,
                      valueMm,
                      origin: "manual",
                      edited: true,
                      confidence: null,
                      source: { kind: "user", generatedAt: new Date().toISOString() },
                    },
              ),
            },
      ),
    }));
  };

  const addMeasurement = (fetusId: string, key: string, label: string) => {
    setExam((prev) => ({
      ...prev,
      fetuses: prev.fetuses.map((fetus) =>
        fetus.id !== fetusId || fetus.measurements.some((m) => m.key === key)
          ? fetus
          : {
              ...fetus,
              measurements: [
                ...fetus.measurements,
                {
                  key,
                  label,
                  valueMm: null, // vide : le praticien renseigne la valeur
                  origin: "manual",
                  confidence: null,
                  source: { kind: "user", generatedAt: new Date().toISOString() },
                } satisfies BiometricMeasurement,
              ],
            },
      ),
    }));
  };

  const reportEditOpenState = useState(false);
  const reportEditOpen = reportEditOpenState[0];
  const setReportEditOpen = reportEditOpenState[1];
  const activeImageState = useActiveImageState();

  const generateReport = (): boolean => {
    if (analysisPhase !== null) return false;
    let started = false;
    setExam((prev) => {
      if (!checkReportReadiness(prev).ok || prev.report?.state === "generating") return prev;
      started = true;
      /* §24 : le bouton passe en « Generating… » pendant la construction. */
      return { ...prev, status: "analyzing", report: { state: "generating", sections: {} as never, updatedAt: null } };
    });
    if (!started) return false;
    timers.current.push(
      window.setTimeout(() => {
        /* Génération déterministe depuis les données structurées uniquement. */
        setExam((prev) => ({
          ...prev,
          status: "report_ready",
          report: buildFreshReport({ ...prev, status: "analyzed" }),
        }));
      }, 800),
    );
    return true;
  };

  const updateReportSection = (sectionId: FetalReportSectionId, content: string) => {
    setExam((prev) =>
      prev.report
        ? {
            ...prev,
            status: "report_ready",
            report: {
              ...prev.report,
              state: prev.report.state === "validated" ? "validated" : "needs_review",
              sections: { ...prev.report.sections, [sectionId]: { ...prev.report.sections[sectionId], content, edited: true } },
              updatedAt: new Date().toISOString(),
            },
          }
        : prev,
    );
  };

  const resetReportSection = (sectionId: FetalReportSectionId) => {
    /* Regenerate / Reset section : reconstruit UNIQUEMENT la section concernée
       depuis les données structurées courantes (§23). */
    setExam((prev) =>
      prev.report
        ? {
            ...prev,
            report: {
              ...prev.report,
              sections: {
                ...prev.report.sections,
                [sectionId]: { ...buildSection({ ...prev, status: "analyzed" }, sectionId), edited: false },
              },
              updatedAt: new Date().toISOString(),
            },
          }
        : prev,
    );
  };

  const validateReport = () => {
    setExam((prev) =>
      prev.report && prev.report.state === "needs_review"
        ? { ...prev, report: { ...prev.report, state: "validated", updatedAt: new Date().toISOString() } }
        : prev,
    );
  };

  return {
    exam, analysisPhase, startAnalysis, resetExam, setExamStatus,
    updateImage, replaceSelection, updateMeasurement, addMeasurement,
    generateReport, updateReportSection, resetReportSection, validateReport,
    reportEditOpen, setReportEditOpen,
    ...activeImageState,
  };
}

/** Hook interne : état de l'image active partagé par filmstrip et cartes. */
function useActiveImageState(): { activeImageId: string | null; setActiveImageId: (id: string | null) => void } {
  const [activeImageId, setActiveImageId] = useState<string | null>(null);
  return { activeImageId, setActiveImageId };
}
