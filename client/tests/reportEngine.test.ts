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
  it("génère overview/findings/ai/measurements/impression depuis les données", () => {
    const data = buildRadiographyStructuredData(RADIO_INPUT);
    const doc = renderDocument("radiography", data, null);
    const byId = new Map(doc.sections.map((s) => [s.id, s]));

    expect(byId.get("overview")?.lines.join("\n")).toContain("Opacité basale droite.");
    expect(byId.get("ai_results")?.lines.join("\n")).toContain("Prédiction ensemble : Pneumonia");
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
});
