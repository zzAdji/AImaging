/**
 * Identifiants de modalité canoniques de la plateforme AImaging.
 *
 * L'éditeur est unique : la modalité détermine uniquement quels outils
 * spécifiques et quels panneaux sont affichés (cf. INSTRUCTIONS.md §Modalité
 * de l'examen). Le cœur de l'éditeur reste identique quelle que soit la valeur.
 */
export type ModalityId = "radiography" | "fetal_ultrasound" | "unknown";

/** Libellés / codes bruts reconnus comme radiographie thoracique. */
const RADIOGRAPHY_TOKENS = new Set([
  "radiography",
  "radio",
  "radiographie",
  "xray",
  "x-ray",
  "cr", // DICOM Computed Radiography
  "dx", // DICOM Digital Radiography
  "cxr",
]);

/** Libellés / codes bruts reconnus comme échographie fœtale. */
const FETAL_ULTRASOUND_TOKENS = new Set([
  "ultrasound",
  "ultrasonography",
  "us", // DICOM Ultrasound
  "echo",
  "echographie",
  "échographie",
  "fetal_ultrasound",
  "fetal-ultrasound",
  "fetalultrasound",
  "obstetric",
  "obstetrical",
  "obstétricale",
]);

function canonicalToken(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s_]+/g, "_");
}

/**
 * Normalise n'importe quelle valeur de modalité historique vers un
 * {@link ModalityId} canonique.
 *
 * Sources couvertes (rétrocompatible avec les données déjà persistées dans
 * `aimaging.examinations`) :
 * - libellés UI de création d'examen : "Radiography", "Ultrasound"… ;
 * - identifiants cibles des instructions : "radiography", "fetal_ultrasound" ;
 * - codes DICOM : "CR", "DX", "US"…
 * - valeur par défaut historique du provider : "image".
 *
 * Toute valeur inconnue (CT, MR, "Other", vide…) renvoie "unknown" :
 * les modules spécifiques ne doivent PAS être activés par défaut.
 */
export function normalizeModalityId(raw: string | null | undefined): ModalityId {
  if (!raw) return "unknown";
  const token = canonicalToken(String(raw));
  if (!token || token === "image" || token === "other") return "unknown";
  if (RADIOGRAPHY_TOKENS.has(token)) return "radiography";
  if (FETAL_ULTRASOUND_TOKENS.has(token)) return "fetal_ultrasound";
  return "unknown";
}
