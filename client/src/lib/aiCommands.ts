import type { AiDiagnosis, WlValue } from "../state/workspace";

/* --------------------------- Command action model -------------------------- */

/** Region expressed in fractions of the image (0..1) — converted to px by the provider */
export interface RegionFrac {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type AiCommandAction =
  | { kind: "analysis"; summary: string }
  | { kind: "explain"; summary: string; region: RegionFrac }
  | { kind: "focus"; summary: string; region: RegionFrac }
  | {
      kind: "focusDiagnosis";
      summary: string;
      diagnosis: AiDiagnosis;
      region: RegionFrac;
      label: string;
    }
  | { kind: "gradcam"; summary: string }
  | { kind: "report"; summary: string }
  | { kind: "annotation"; summary: string; region: RegionFrac }
  | { kind: "measure"; summary: string; region: RegionFrac }
  | { kind: "wl"; summary: string; wl: WlValue }
  | { kind: "invert"; summary: string }
  | { kind: "compare"; summary: string }
  | { kind: "amendReport"; summary: string; text: string }
  | { kind: "unknown"; summary: string };

/* ------------------------------ Mocked results ----------------------------- */

export const LUNG_WL: WlValue = { window: 170, level: 60 };

/** Mocked diagnosis list; region is in image fractions so it scales with any image */
export function mockDiagnostics(): AiDiagnosis[] {
  return [
    {
      label: "Pneumonie — consolidation du lobe inférieur droit",
      prob: 0.87,
      severity: "high",
      region: { x: 0.58, y: 0.5, w: 0.24, h: 0.2 },
    },
    { label: "Cardiomégalie", prob: 0.22, severity: "medium" },
    { label: "Atélectasie", prob: 0.14, severity: "low" },
    { label: "Examen normal", prob: 0.09, severity: "low" },
  ];
}

/** Mocked free-text radiology report */
export function mockReport(imageName: string): string {
  const now = new Date().toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  return [
    `RAPPORT D'INTERPRÉTATION ASSISTÉ — ${imageName}`,
    `Émis le ${now} par ChestNet v3.1 (aide à l'interprétation).`,
    ``,
    `Résumé : opacités nodulaires au niveau du lobe inférieur droit,`,
    `évocatrices d'un foyer de pneumonie. Silhouette cardiaque aux`,
    `limites normales. Pas de pneumothorax visible.`,
    ``,
    `Recommandation : corrélation clinique recommandée. Ce document`,
    `ne remplace pas l'avis d'un professionnel de santé.`,
  ].join("\n");
}

/** Mocked AI amendment applied to an existing report based on the instruction */
export function amendReportText(raw: string, base: string): string {
  const q = raw.toLowerCase();
  const extra = q.includes("conclusion")
    ? "Conclusion : surveillance clinique recommandée dans 3 mois, sans signe d'aggravation à ce stade."
    : q.includes("négatif") || q.includes("rassurant") || q.includes("absence")
      ? "Aucune autre anomalie significative mise en évidence."
      : "Révision IA : formulation affinée pour un usage clinique et une relecture rapide.";
  return `${base}\n\n${extra}`;
}

/* --------------------------------- Prompts -------------------------------- */

export const AI_PROMPTS: string[] = [
  "Analyse cette radiographie.",
  "Détecte une pneumonie.",
  "Génère un rapport.",
  "Explique cette région.",
  "Affiche la Grad-CAM.",
  "Zoom sur la région suspecte.",
  "Créer une annotation.",
  "Compare avec l'analyse précédente.",
];

/* --------------------------------- Parsing -------------------------------- */

/** Central focus region of the image (fractions) — used by zoom/explain */
const CENTER_REGION: RegionFrac = { x: 0.3, y: 0.3, w: 0.4, h: 0.4 };

export function parseAiCommand(raw: string): AiCommandAction {
  const q = raw.toLowerCase();

  if (/(pneumonie|infection|nodule|infiltrat|consolidation)/.test(q)) {
    const diag = mockDiagnostics().find((d) => d.label.includes("Pneumonie"))!;
    const region = diag.region!;
    return {
      kind: "focusDiagnosis",
      summary: "Pneumonie suspecte : région en surbrillance, probabilité 87 %.",
      diagnosis: diag,
      region,
      label: "Pneumonie suspecte · 87 %",
    };
  }

  if (/(grad[\s-]?cam|heatmap|carte.*activation|activation.*carte)/.test(q)) {
    return { kind: "gradcam", summary: "Grad-CAM activée : zones contribuant à la décision mises en évidence." };
  }

  if (/(zoom|grossir|agrandir|agrandis|zoom.*région|région suspecte|focus|centre)/.test(q)) {
    return { kind: "focus", summary: "Vue recentrée sur la zone d'intérêt.", region: CENTER_REGION };
  }

  /* Report editing — must run BEFORE the generic `rapport` branch so that
     "ajoute une conclusion au rapport" is treated as an amendment while
     "Génère un rapport." still hits the `report` branch below. */
  if (/(ajoute|ajouter|corrige|corriger|modifie|modifier|réécri|réécrire|complète|compléter|améliore|améliorer|retire|retirer|supprime|supprimer)/.test(q) && /(rapport|texte|conclusion|section|résumé|recommandation)/.test(q)) {
    return {
      kind: "amendReport",
      summary: "Rapport mis à jour par l'IA.",
      text: amendReportText(raw, mockReport("examen")),
    };
  }

  if (/(rapport|report|compte[ -]?rendu|rédige|génère.*rapport)/.test(q)) {
    return { kind: "report", summary: "Rapport d'interprétation généré." };
  }

  if (/(annotat|note|étiquet|marque)/.test(q)) {
    return { kind: "annotation", summary: "Annotation placée au centre de l'image.", region: CENTER_REGION };
  }

  if (/(dessin|dessiné|tracé|tracée|tracer|forme|contour)/.test(q)) {
    return { kind: "annotation", summary: "Forme rejouée au centre de l'image.", region: CENTER_REGION };
  }

  if (/(mesur|longueur|distance|diamètre)/.test(q)) {
    return { kind: "measure", summary: "Mesure automatique tracée sur l'image.", region: CENTER_REGION };
  }

  if (/(compar|précédent|reference|évolution|détériorat)/.test(q)) {
    return { kind: "compare", summary: "Comparaison avec l'analyse précédente : aucune variation significative." };
  }

  if (/(invers|negative|negatif)/.test(q)) {
    return { kind: "invert", summary: "Image inversée (rendu radiologique négatif)." };
  }

  if (/(window|fenêtrage|niveau|level|lunge|poumon)/.test(q)) {
    return { kind: "wl", summary: "Fenêtrage Lung appliqué (W 170 · L 60).", wl: LUNG_WL };
  }

  if (/(explique|expliquer|pourquoi|que voit)/.test(q)) {
    return {
      kind: "explain",
      summary:
        "Zone analysée : opacité discrète à densité mixte, possible foyer de pneumonie débutante. Densités par ailleurs conservées.",
      region: CENTER_REGION,
    };
  }

  if (/(analys|examine|évalue|diagnostic|classification|etude|study|scan|radiographie|image)/.test(q)) {
    return { kind: "analysis", summary: "Analyse terminée : 4 hypothèses diagnostiques classées par probabilité." };
  }

  return {
    kind: "unknown",
    summary: "Commande non reconnue. Essayez « Analyse cette radiographie » ou « Affiche la Grad-CAM ».",
  };
}
