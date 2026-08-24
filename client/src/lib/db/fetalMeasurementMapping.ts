/**
 * Mapping pur `FetalExam → Measurement` — Phase Database 5 (SUITE.md §14/§15/§18).
 *
 * IMPORTANT : le provider fœtal actuel est MOCKÉ. Ce module ne branche donc
 * AUCUNE écriture : il fournit le contrat de migration futur.
 * - `source` : manual/user → "user", model → "ai" ;
 * - les valeurs `kind: "mock"` produisent `localOnly = true` : la table
 *   measurements n'accepte que user|ai (CHECK Phase 2), un mock ne doit donc
 *   JAMAIS devenir une prétendue mesure médicale persistée (§18) ;
 * - `metadata.fetus_id` = F1/F2 uniquement si présents dans l'examen (§15) ;
 * - aucune mesure inventée : value null reste null (§14).
 */

import type { FetalExam } from "../fetal/types";

export interface FetalMeasurementDraft {
  type: string;
  value: number | null;
  unit: "mm";
  /** Valeur admise par la contrainte SQL (user | ai). */
  source: "user" | "ai";
  /** true ⇒ donnée de développement mockée : à ne PAS persister. */
  localOnly: boolean;
  confidence: number | null;
  metadata: { label: string; fetus_id: string; provenance: "mock" | "model" | "user" };
}

export function fetalExamToMeasurementDrafts(exam: FetalExam): FetalMeasurementDraft[] {
  const drafts: FetalMeasurementDraft[] = [];
  for (const fetus of exam.fetuses) {
    for (const measurement of fetus.measurements) {
      const provenance = measurement.source.kind;
      drafts.push({
        type: measurement.key.toUpperCase(),
        value: measurement.valueMm,
        unit: "mm",
        source: measurement.origin === "manual" ? "user" : "ai",
        localOnly: provenance === "mock",
        confidence: measurement.confidence ?? null,
        metadata: {
          label: measurement.label,
          fetus_id: fetus.id,
          provenance,
        },
      });
    }
  }
  return drafts;
}

/** Sous-ensemble réellement persistable (exclut les mocks). */
export function persistableFetalDrafts(drafts: FetalMeasurementDraft[]): FetalMeasurementDraft[] {
  return drafts.filter((draft) => !draft.localOnly);
}
