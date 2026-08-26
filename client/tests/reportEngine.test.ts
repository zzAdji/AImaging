/**
 * Tests ReportEngine — INSTRUCTIONS.md §40 (radio + échographie).
 * Cœur pur : aucun I/O, aucun mock nécessaire.
 */

import { describe, expect, it } from "vitest";
import {
  buildRadiographyStructuredData,
  defaultTemplateData,
  renderDocument,
  visibleSections,
  type ReportTemplateData,
} from "../src/lib/reports/engine";

const RADIO_INPUT = {
  fields: { conclusion: "Opacité basale droite.", recommandations: "Contrôle à 3 mois." },
  coherenceIssues: ["Discordance mineure sur le lobe inférieur."],
  ensemblePrediction: "Pneumonia",
  numModels: 5,
  measurements: [
    { label: "CTR", value: 0.44, unit: "ratio", source: "ai" as const },
    { label: "Distance", value: null, unit: "px", source: "user" as const }, // absente
  ],
};

describe("default templates par modalité (§7)", () => {
  it("radio ≠ échographie : sections distinctes", () => {
    const radio = defaultTemplateData("radiography");
    const fetal = defaultTemplateData("fetal_ultrasound");
    expect(radio.sections.map((s) => s.id)).not.toEqual(fetal.sections.map((s) => s.id));
    expect(fetal.sections.some((s) => s.id === "biometry")).toBe(true);
    expect(radio.sections.some((s) => s.id === "biometry")).toBe(false);
  });

  it("Fetus 2 est masqué par défaut dans le template fœtal (§5)", () => {
    const fetal = defaultTemplateData("fetal_ultrasound");
    expect(fetal.sections.find((s) => s.id === "fetus_2")?.visible).toBe(false);
  });
});

describe("rendu radiographie", () => {
  it("génère overview/findings/measurements/impression depuis les données, sans section IA", () => {
    const data = buildRadiographyStructuredData(RADIO_INPUT);
    const doc = renderDocument("radiography", data, null);
    const byId = new Map(doc.sections.map((s) => [s.id, s]));

    expect(byId.get("overview")?.lines.join("\n")).toContain("Opacité basale droite.");
    /* Plus de section « AI Results » : la prédiction rejoint la conclusion,
       libellée « Suspicion » sans mention de modèle (compte rendu hospitalier). */
    expect(byId.has("ai_results")).toBe(false);
    expect(byId.get("impression")?.lines.join("\n")).toContain("Suspicion : Pneumonia");
    expect(byId.get("measurements")?.lines.join("\n")).toContain("CTR : 0.44 ratio");
  });

  it("une mesure absente reste absente — jamais inventée (§3)", () => {
    const doc = renderDocument("radiography", buildRadiographyStructuredData(RADIO_INPUT), null);
    const measurements = doc.sections.find((s) => s.id === "measurements")!;
    expect(measurements.lines.join("\n")).not.toContain("Distance");
  });
});

describe("rendu échographie obstétricale (§5)", () => {
  const SINGLE = {
    observations: { uterus: "gravide", cardiac_activity: "présente" },
    fetuses: [
      {
        biometry: { BPD: { value: 28, unit: "mm" }, AC: { value: null, unit: "mm" } },
        gestationalAge: "21 SA",
      },
    ],
    placenta: { position: "anterior" },
    amniotic_fluid: { status: "normal", measurementMm: 42 },
    cervix: { status: "long_closed", lengthMm: 38 },
    findings: [{ text: "Estomac visible", status: "positive" }],
    conclusion: { grossesse: "unique évolutive" },
  };

  it("grossesse unique : aucune section Fetus 2 rendue", () => {
    const doc = renderDocument("fetal_ultrasound", SINGLE, null);
    expect(doc.sections.some((s) => s.id === "fetus_2")).toBe(false);
    const f1 = doc.sections.find((s) => s.id === "fetus_1")!;
    expect(f1.lines.join("\n")).toContain("BPD : 28 mm");
    /* Mesure absente (AC=null) ⇒ absente du rendu (§3). */
    expect(f1.lines.join("\n")).not.toContain("AC");
  });

  it("grossesse multiple : Fetus 2 rendu avec ses propres données", () => {
    const multiple = {
      ...SINGLE,
      fetuses: [
        ...SINGLE.fetuses,
        { biometry: { BPD: { value: 30, unit: "mm" } } },
      ],
    };
    const doc = renderDocument("fetal_ultrasound", multiple, null);
    const f2 = doc.sections.find((s) => s.id === "fetus_2");
    expect(f2).toBeDefined();
    expect(f2!.lines.join("\n")).toContain("BPD : 30 mm");
  });

  it("placenta / liquide / col / conclusion rendus depuis les données réelles", () => {
    const doc = renderDocument("fetal_ultrasound", SINGLE, null);
    const byId = new Map(doc.sections.map((s) => [s.id, s]));
    expect(byId.get("placenta")?.lines.join("\n")).toContain("anterior");
    expect(byId.get("amniotic_fluid")?.lines.join("\n")).toContain("42 mm");
    expect(byId.get("cervix")?.lines.join("\n")).toContain("38 mm");
    expect(byId.get("conclusion")?.lines.join("\n")).toContain("unique évolutive");
  });
});

describe("forme stricte du document généré (logo + texte IA)", () => {
  /* Texte tel que produit par /radiography/report (rendered_text) puis édité
     dans l'éditeur de rapport — c'est CE qui était recopié tel quel avant. */
  const AI_TEXT = [
    "RADIOGRAPHIE THORACIQUE DE FACE",
    "",
    "Nom et Prénom : Jean DUPONT",
    "Indication : Champs pulmonaires et silhouette cardiomédiastinale",
    "Prescripteur : Dr KAMGA",
    "Date : 26/08/2026",
    "",
    "RESULTAT",
    "- Absence de foyer alvéolaire.",
    "  - Sinus costophréniques libres.",
    "",
    "CONCLUSION",
    "❖ Pneumopathie basale probable.",
    "",
    "--- Analyse assistée par intelligence artificielle ---",
    "Niveau de confiance : Élevé (98 %)",
    "Recommandation : Corrélation clinique recommandée",
    "",
    "Ce document est généré par un système d'aide au diagnostic et ne remplace pas " +
      "l'interprétation d'un professionnel de santé qualifié.",
  ].join("\n");

  it("le logo par défaut hgg.jpg est présent dans le template", () => {
    expect(defaultTemplateData("radiography").header.logoPath).toBe("/hgg.jpg");
    expect(defaultTemplateData("fetal_ultrasound").header.logoPath).toBe("/hgg.jpg");
  });

  it("un template legacy sans logo retombe sur le logo par défaut", () => {
    const doc = renderDocument("radiography", {}, { ...defaultTemplateData("radiography"), header: { ...defaultTemplateData("radiography").header, logoPath: null } } as ReportTemplateData);
    expect(doc.template.header.logoPath).toBe("/hgg.jpg");
  });

  it("tirets, titres internes et méta-patient du texte IA ne sont jamais restitués tels quels", () => {
    const doc = renderDocument("radiography", { findings: { draft: AI_TEXT } }, null);
    const byId = new Map(doc.sections.map((s) => [s.id, s]));
    const overview = byId.get("overview")?.lines.join("\n") ?? "";
    expect(overview).toContain("Absence de foyer alvéolaire.");
    expect(overview).toContain("Sinus costophréniques libres.");
    /* Aucun tiret résiduel en début de ligne (les puces appartiennent au style
       du document, pas au contenu). */
    for (const line of overview.split("\n")) expect(line.startsWith("-")).toBe(false);
    /* Titre « RESULTAT » dupliqué : supprimé. */
    expect(overview).not.toContain("RESULTAT");
    /* Méta-patient déjà présente dans le bloc d'identification : supprimée. */
    expect(overview).not.toContain("Jean DUPONT");
    expect(overview).not.toContain("Prescripteur");
    /* Grand titre officiel dupliqué (première ligne tout en majuscules) : supprimé. */
    expect(overview).not.toContain("RADIOGRAPHIE THORACIQUE DE FACE");
    /* Mention légale : déjà couverte par le pied de page du modèle. */
    expect(overview).not.toContain("système d'aide au diagnostic");
  });

  it("la Conclusion existe toujours et reçoit le diagnostic du texte IA", () => {
    const doc = renderDocument("radiography", { findings: { draft: AI_TEXT } }, null);
    const impression = doc.sections.find((s) => s.id === "impression")!;
    expect(impression.lines.length).toBeGreaterThan(0);
    expect(visibleSections(doc).some((s) => s.id === "impression")).toBe(true);
    expect(impression.lines.join("\n")).toContain("Pneumopathie basale probable.");
    /* Confiance/recommandation du bloc « Analyse assistée » → Conclusion. */
    expect(impression.lines.join("\n")).toContain("Niveau de confiance : Élevé (98 %)");
    expect(impression.lines.join("\n")).toContain("Corrélation clinique recommandée");
  });

  it("champs structurés : priorité sur le draft, jamais de doublon ; labels français", () => {
    const base = buildRadiographyStructuredData({
      fields: {
        type_examen: "Radiographie thoracique de face",
        zone_analysee: "Champs pulmonaires",
        observations: "Absence de foyer alvéolaire.",
        diagnostic_probable: "Pneumonie",
        niveau_confiance: "Élevé (98 %)",
        recommandation_orientation: "Corrélation clinique recommandée",
      },
      coherenceIssues: [],
      ensemblePrediction: null,
      numModels: null,
    });
    const data = {
      ...base,
      /* Champs structurés ET texte brut présents simultanément (cas réel). */
      findings: { ...(base.findings as Record<string, unknown>), draft: AI_TEXT },
    };
    const doc = renderDocument("radiography", data, null);
    const byId = new Map(doc.sections.map((s) => [s.id, s]));
    const overview = byId.get("overview")?.lines.join("\n") ?? "";
    const impression = byId.get("impression")?.lines.join("\n") ?? "";
    /* Labels français au lieu des clés techniques backend. */
    expect(overview).toContain("Observations : Absence de foyer alvéolaire.");
    expect(overview).not.toContain("type_examen");
    /* Diagnostic/confiance/recommandation dans la Conclusion. */
    expect(impression).toContain("Diagnostic probable : Pneumonie");
    expect(impression).toContain("Niveau de confiance : Élevé (98 %)");
    /* Le draft brut n'est PAS dupliqué à côté des champs structurés. */
    expect(overview).not.toContain("Sinus costophréniques libres.");
  });
});

describe("template contrôle ordre/visibilité/titres (§6/§16)", () => {
  it("section masquée reste dans le document mais est omise de l'affichage", () => {
    const template = defaultTemplateData("radiography");
    template.sections = template.sections.map((s) =>
      s.id === "impression" ? { ...s, visible: false, title: "Synthèse" } : s,
    );
    template.header.organizationName = "Hôpital Général";
    const doc = renderDocument(
      "radiography",
      buildRadiographyStructuredData(RADIO_INPUT),
      template,
    );

    const impression = doc.sections.find((s) => s.id === "impression")!;
    expect(impression.title).toBe("Synthèse"); // titre template
    expect(impression.visible).toBe(false);
    expect(visibleSections(doc).some((s) => s.id === "impression")).toBe(false);
    expect(doc.headerFields[0]).toEqual({ label: "Établissement", value: "Hôpital Général" });
  });
});

describe("briques libres et variables (modèle type Word, §38)", () => {
  it("resolveBlocks remplace les tokens {{clé}} par les valeurs des variables", () => {
    const template = defaultTemplateData("radiography");
    template.customBlocks = [
      { id: "b1", kind: "heading", text: "Compte rendu de {{patientName}}", visible: true },
      { id: "b2", kind: "paragraph", text: "Examens de {{examId}}", visible: true },
      { id: "b3", kind: "divider", text: "", visible: true },
      { id: "b4", kind: "variable", text: "{{examinerName}}", visible: true },
    ];
    template.variables = [
      { key: "patientName", label: "Patient", value: "Jean DUPONT", visible: true },
      { key: "examId", label: "N°", value: "2026-42", visible: true },
      { key: "examinerName", label: "Médecin", value: "Dr RENARD", visible: true },
    ];
    const doc = renderDocument("radiography", {}, template);
    expect(doc.tokenValues.patientName).toBe("Jean DUPONT");
    expect(doc.blocks.find((b) => b.id === "b1")?.html).toContain("Jean DUPONT");
    expect(doc.blocks.find((b) => b.id === "b2")?.html).toContain("2026-42");
    expect(doc.blocks.find((b) => b.id === "b3")?.html).toContain("doc-divider");
    expect(doc.blocks.find((b) => b.id === "b4")?.html).toContain("Dr RENARD");
  });

  it("un bloc masqué est exclu du rendu", () => {
    const template = defaultTemplateData("radiography");
    template.customBlocks = [{ id: "hidden", kind: "paragraph", text: "secret", visible: false }];
    const doc = renderDocument("radiography", {}, template);
    expect(doc.blocks).toHaveLength(0);
  });

  it("un template legacy sans variables/blocks ne plante pas (écran noir §regression)", () => {
    /* Ancien template persisté avant l'ajout de variables/customBlocks : */
    const legacy = {
      ...defaultTemplateData("radiography"),
      variables: undefined,
      customBlocks: undefined,
    } as unknown as ReportTemplateData;
    expect(() => renderDocument("radiography", {}, legacy)).not.toThrow();
    const doc = renderDocument("radiography", {}, legacy);
    expect(doc.blocks).toEqual([]);
    expect(doc.tokenValues.patientName).toBeDefined();
  });
});
