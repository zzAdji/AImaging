import { examModality, type Examination } from "./examinations";
import type { ModalityId } from "./modality";

/**
 * Registre des modules de modalité AImaging.
 *
 * Un "module" décrit UNIQUEMENT les contributions spécifiques d'une modalité :
 * outils IA additionnels, outils spécifiques, cartes du panneau droit et
 * suggestions de commandes. Le cœur de l'éditeur (TitleBar, CanvasViewport,
 * LeftToolbar commune, StatusBar, annotations, mesures, historique) reste
 * partagé et identique quelle que soit la modalité (INSTRUCTIONS.md §32).
 *
 * Le module est volontairement un ensemble de DONNÉES pures (pas de composants,
 * pas d'icônes) : le rendu est résolu par les composants hôtes, ce qui garde ce
 * fichier testable isolément et évite tout couplage au DOM.
 */

/** Définition déclarative d'un outil propre à une modalité. */
export interface ModalityToolDef {
  /** Identifiant stable (clé de rendu, data-attr, tests). */
  id: string;
  /** Libellé court affiché dans la toolbox. */
  label: string;
}

/** Suggestion de commande pour la barre flottante. */
export interface ModalityCommandDef {
  /** Nom court (@name). */
  name: string;
  /** Phrase envoyée au moteur de commandes. */
  usage: string;
}

/**
 * Contribution déclarative d'une modalité.
 * Tableaux vides = la modalité n'ajoute rien (ex. radiographie : son UI
 * actuelle fait référence et n'est PAS migrée dans le registre).
 */
export interface ModalityModule {
  id: ModalityId;
  /** Nom lisible de la modalité (TitleBar, exam properties…). */
  label: string;
  /** Outils IA additionnels (section « Outils IA » de la sidebar gauche). */
  aiTools: ModalityToolDef[];
  /** Outils spécifiques à la modalité (section dédiée de la sidebar gauche). */
  modalityTools: ModalityToolDef[];
  /** Identifiants stables des cartes supplémentaires du panneau droit. */
  rightCards: string[];
  /** Suggestions de commandes contextuelles. */
  commands: ModalityCommandDef[];
}

/* ------------------------------ Radiographie ------------------------------ */
/**
 * Modalité de référence : l'interface radiographique existante (Grad-CAM,
 * CXAS, HybridGNet, Sonde, tri opencxr, rapport…) reste rendue par les
 * composants historiques. Contributions vides par conception : AUCUN
 * changement visuel ou comportemental pour la radiographie.
 */
const RADIOGRAPHY_MODULE: ModalityModule = {
  id: "radiography",
  label: "Radiographie",
  aiTools: [],
  modalityTools: [],
  rightCards: [],
  commands: [],
};

/* --------------------------- Échographie fœtale ---------------------------- */
/**
 * Deuxième modalité de la plateforme (phase UI/UX mockée).
 * Les données ci-dessous reprennent INSTRUCTIONS.md §2 (outils),
 * §9-§22 (panneaux) et §25 (commandes). Le rendu est branché progressivement :
 * un identifiant sans renderer associé NE DOIT PAS être affiché par les hôtes.
 */
const FETAL_ULTRASOUND_MODULE: ModalityModule = {
  id: "fetal_ultrasound",
  label: "Échographie fœtale",
  aiTools: [
    { id: "fetal-analyze", label: "Analyze" },
    { id: "fetal-quality", label: "Quality" },
    { id: "fetal-plane-detection", label: "Plane Detection" },
    { id: "fetal-selection", label: "AI Selection" },
    { id: "fetal-biometry", label: "Biometrics" },
    { id: "fetal-findings", label: "Findings" },
    { id: "fetal-anomaly", label: "Anomaly Analysis" },
    { id: "fetal-report", label: "Report" },
  ],
  modalityTools: [
    { id: "fetal-examination", label: "Examination" },
    { id: "fetal-plans", label: "Plans" },
    { id: "fetal-fetus", label: "Fetus" },
    { id: "fetal-measurements", label: "Measurements" },
    { id: "fetal-placenta", label: "Placenta" },
    { id: "fetal-fluid", label: "Amniotic Fluid" },
    { id: "fetal-cervix", label: "Cervix" },
    { id: "fetal-pregnancy", label: "Pregnancy" },
  ],
  rightCards: [
    "fetal-examination",
    "fetal-quality",
    "fetal-plane-detection",
    "fetal-plans",
    "fetal-selection",
    "fetal-fetus",
    "fetal-biometry",
    "fetal-measurements",
    "fetal-placenta",
    "fetal-fluid",
    "fetal-cervix",
    "fetal-findings",
    "fetal-anomaly",
    "fetal-report",
  ],
  commands: [
    { name: "analyze_image", usage: "Analyse cette image" },
    { name: "detect_plane", usage: "Détecte le plan" },
    { name: "best_views", usage: "Montre les meilleures vues" },
    { name: "biometry", usage: "Affiche la biométrie" },
    { name: "show_f1", usage: "Montre F1" },
    { name: "show_f2", usage: "Montre F2" },
    { name: "generate_report", usage: "Génère le compte rendu" },
    { name: "heart_images", usage: "Montre les images du cœur" },
    { name: "measurements", usage: "Affiche les mesures" },
  ],
};

/* --------------------------------- Inconnue -------------------------------- */
/** Fail-closed : aucune contribution pour une modalité non reconnue. */
const UNKNOWN_MODULE: ModalityModule = {
  id: "unknown",
  label: "Autre",
  aiTools: [],
  modalityTools: [],
  rightCards: [],
  commands: [],
};

const MODULES: Record<ModalityId, ModalityModule> = {
  radiography: RADIOGRAPHY_MODULE,
  fetal_ultrasound: FETAL_ULTRASOUND_MODULE,
  unknown: UNKNOWN_MODULE,
};

/** Module déclaratif d'une modalité canonique (jamais null : fallback `unknown`). */
export function getModalityModule(id: ModalityId): ModalityModule {
  return MODULES[id] ?? UNKNOWN_MODULE;
}

/** Module déclaratif correspondant à un examen (modalité normalisée). */
export function modalityModuleForExam(exam: Pick<Examination, "modality">): ModalityModule {
  return getModalityModule(examModality(exam));
}
