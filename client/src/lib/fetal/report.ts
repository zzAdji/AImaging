import type {
  FetalExam,
  FetalReport,
  FetalReportSection,
  FetalReportSectionId,
} from "./types";

/**
 * Génération déterministe du compte rendu obstétrical (INSTRUCTIONS.md §22-§24).
 *
 * Règles absolues :
 * - le texte est construit UNIQUEMENT depuis les données structurées ;
 * - une mesure absente n'est JAMAIS inventée (ligne omise ou « non mesuré ») ;
 * - aucune valeur IA n'est générée ici : c'est un assemblage de formatage.
 */

/** Informations minimales avant génération (§24). */
export function checkReportReadiness(exam: FetalExam): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  if (exam.status !== "analyzed" && exam.status !== "report_ready") {
    missing.push("L'analyse de l'examen n'est pas terminée.");
  }
  const anyMeasurement = exam.fetuses.some((fetus) =>
    fetus.measurements.some((measurement) => measurement.valueMm != null),
  );
  if (!anyMeasurement) missing.push("Aucune mesure biométrique disponible.");
  return { ok: missing.length === 0, missing };
}

const mmLine = (label: string, valueMm: number | null): string | null =>
  valueMm != null ? `${label} = ${valueMm} mm` : null;

function formatGA(ga: { weeks: number; days: number } | null): string {
  return ga ? `${ga.weeks} SA + ${ga.days} jour${ga.days > 1 ? "s" : ""}` : "non déterminé";
}

function formatEdd(edd: string | null): string {
  return edd ? new Date(edd).toLocaleDateString("fr-FR") : "—";
}

export function buildSection(exam: FetalExam, id: FetalReportSectionId): FetalReportSection {
  switch (id) {
    case "header": {
      const lines = [
        `Nom et Prénom : Mme […]`,
        `Indication : ${exam.indication ?? "—"}`,
        "Prescripteur : —",
        "Âge : —",
        `Date : ${new Date(exam.examDate).toLocaleDateString("fr-FR")}`,
      ];
      return { title: "ÉCHOGRAPHIE OBSTÉTRICALE", content: lines.join("\n") };
    }

    case "observations": {
      const lines: string[] = ["Observations générales"];
      lines.push(`- Utérus gravide, examen réalisé en ${exam.ultrasoundType ?? "standard"}.`);
      const heartRates = exam.fetuses
        .map((fetus) => (fetus.heartRateBpm != null ? `${fetus.label} : ${fetus.heartRateBpm} bpm` : null))
        .filter((value): value is string => value !== null);
      lines.push(
        heartRates.length > 0
          ? `- Activité cardiaque présente (${heartRates.join(", ")}).`
          : "- Activité cardiaque : non évaluée.",
      );
      const positions = exam.fetuses
        .map((fetus) => (fetus.position ? `${fetus.label} en ${fetus.position.toLowerCase()}` : null))
        .filter((value): value is string => value !== null);
      lines.push(positions.length > 0 ? `- Présentation : ${positions.join(", ")}.` : "- Présentation : non précisée.");
      const morphology = exam.findings.find((finding) => finding.id === "finding-morphology");
      lines.push(`- Morphologie fœtale : ${morphology ? "aspect normal" : "non concluante"}.`);
      lines.push(
        exam.amnioticFluid?.status === "normal"
          ? `- Liquide amniotique normal${exam.amnioticFluid.measurementMm != null ? ` (${exam.amnioticFluid.measurementMm} mm)` : ""}.`
          : "- Liquide amniotique : non évalué.",
      );
      lines.push(
        exam.placenta
          ? `- Placenta ${exam.placenta.position ?? "de position non précisée"}${exam.placenta.grade ? `, ${exam.placenta.grade}` : ""}.`
          : "- Placenta : non évalué.",
      );
      lines.push(
        exam.cervix?.status === "long_closed"
          ? `- Col long et fermé${exam.cervix.lengthMm != null ? ` (${exam.cervix.lengthMm} mm)` : ""}.`
          : "- Col : non évalué.",
      );
      return { title: "COMPTE RENDU", content: lines.join("\n") };
    }

    case "biometry": {
      const blocks = exam.fetuses.map((fetus) => {
        const rows = fetus.measurements
          .map((measurement) => mmLine(measurement.label, measurement.valueMm))
          .filter((line): line is string => line !== null);
        const body =
          rows.length > 0
            ? [...rows, `Âge gestationnel = ${formatGA(fetus.gestationalAge)}`, `DPA = ${formatEdd(fetus.edd)}`]
            : ["Aucune mesure disponible."];
        return [fetus.label, ...body].join("\n");
      });
      return { title: "BIOMÉTRIE", content: blocks.join("\n\n") };
    }

    case "conclusion": {
      const lines: string[] = ["CONCLUSION"];
      lines.push(
        exam.fetuses.length > 1
          ? `- Grossesse gémellaire évolutive (${exam.fetuses.map((f) => f.label).join(" et ")}).`
          : "- Grossesse monofoetale évolutive.",
      );
      const firstGa = exam.fetuses[0]?.gestationalAge;
      if (firstGa) lines.push(`- Terme estimé : ${formatGA(firstGa)}.`);
      const firstEdd = exam.fetuses[0]?.edd;
      if (firstEdd) lines.push(`- DPA : ${new Date(firstEdd).toLocaleDateString("fr-FR")}.`);
      const weights = exam.fetuses.filter((fetus) => fetus.estimatedWeightG != null);
      if (weights.length > 0) {
        lines.push(`- Poids estimé : ${weights.map((f) => `${f.label} ${f.estimatedWeightG} g`).join(", ")}.`);
      }
      lines.push(exam.cervix?.status === "long_closed" ? "- Col long et fermé." : "- Col : à réévaluer.");
      for (const warning of exam.findings.filter((finding) => finding.status === "attention")) {
        lines.push(`- À contrôler : ${warning.text}`);
      }
      return { title: "CONCLUSION", content: lines.join("\n") };
    }
  }
}

const SECTION_ORDER: FetalReportSectionId[] = ["header", "observations", "biometry", "conclusion"];

/** Construit un rapport complet frais (« Generate ») — état needs_review (§24). */
export function buildFreshReport(exam: FetalExam): FetalReport {
  const sections = {} as Record<FetalReportSectionId, FetalReportSection>;
  for (const id of SECTION_ORDER) sections[id] = buildSection(exam, id);
  return { state: "needs_review", sections, updatedAt: new Date().toISOString() };
}


