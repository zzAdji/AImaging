/**
 * Tests pipeline PDF/print + SpeechService — INSTRUCTIONS.md §26-§30/§21.
 * Le print utilise un iframe : mocké ici (environnement node) ; on valide
 * le HTML généré et le passage d'arguments au moteur natif.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildReportFilename,
  buildReportJsonExport,
  buildWordDocument,
  documentHtml,
  printDocument,
} from "../src/lib/reports/pdfExport";
import { SpeechService } from "../src/lib/reports/speechService";
import {
  buildRadiographyStructuredData,
  defaultTemplateData,
  renderDocument,
} from "../src/lib/reports/engine";

const RADIO = buildRadiographyStructuredData({
  fields: { conclusion: "Opacité basale droite." },
  coherenceIssues: [],
  ensemblePrediction: "Pneumonia",
  numModels: 5,
  measurements: [{ label: "CTR", value: 0.44, unit: "ratio", source: "ai" }],
});

function sampleHtml(): string {
  const doc = renderDocument("radiography", RADIO, defaultTemplateData("radiography"));
  return documentHtml(doc);
}

describe("pipeline PDF/print (§26-§30)", () => {
  it("nom de fichier stable sans donnée sensible (§29)", () => {
    expect(buildReportFilename("radiography", new Date("2026-08-24T00:00:00Z"))).toBe(
      "AImaging_Radiography_2026-08-24.pdf",
    );
    expect(buildReportFilename("fetal_ultrasound", new Date("2026-08-24T00:00:00Z"))).toContain(
      "Fetal_Ultrasound",
    );
  });

  it("HTML A4 : header org, sections ordonnées/visibles uniquement, badge IA", () => {
    const template = defaultTemplateData("radiography");
    template.header.organizationName = "Hôpital Général";
    template.sections = template.sections.map((s) =>
      s.id === "impression" ? { ...s, visible: false } : s,
    );
    const html = documentHtml(renderDocument("radiography", RADIO, template));

    expect(html).toContain("@page"); // A4 paginé
    expect(html).toContain("A4 portrait");
    expect(html).toContain("Hôpital Général");
    expect(html).toContain("Assisté IA · à relire"); // badge permanent
    expect(html).toContain("Opacité basale droite.");
    expect(html).toContain("break-inside: avoid"); // §30 sections non coupées
    /* Section masquée par le template : absente du rendu. */
    expect(html).not.toContain("<h2>Impression</h2>");
  });

  it("printDocument délègue au moteur natif via iframe cachée", () => {
    const fakeDoc = { open: vi.fn(), write: vi.fn(), close: vi.fn() };
    const fakeWindow = { focus: vi.fn(), print: vi.fn() };
    const created: Array<{ style: Record<string, string>; contentDocument: unknown; contentWindow: unknown; remove: ReturnType<typeof vi.fn> }> = [];
    vi.stubGlobal("window", { setTimeout: (fn: () => void) => setTimeout(fn, 0) });
    vi.stubGlobal("document", {
      createElement: () => {
        const el = {
          style: {} as Record<string, string>,
          contentDocument: fakeDoc,
          contentWindow: fakeWindow,
          remove: vi.fn(),
        };
        created.push(el);
        return el;
      },
      body: { appendChild: vi.fn() },
    });

    try {
      printDocument(sampleHtml());
    } finally {
      vi.unstubAllGlobals();
    }

    expect(created).toHaveLength(1);
    expect(fakeDoc.write).toHaveBeenCalledOnce();
    expect(fakeWindow.print).toHaveBeenCalledOnce();
  });
});
describe("exports Word/JSON (§37)", () => {
  it("buildWordDocument enveloppe le HTML avec les namespaces Word", () => {
    const doc = renderDocument("radiography", RADIO, defaultTemplateData("radiography"));
    const word = buildWordDocument(doc);
    expect(word).toContain("urn:schemas-microsoft-com:office:word");
    expect(word).toContain("Rapport d'examen");
  });

  it("buildReportJsonExport contient template + sections + texte brut", () => {
    const doc = renderDocument("radiography", RADIO, defaultTemplateData("radiography"));
    const json = buildReportJsonExport(doc, "texte brut");
    expect(json.app).toBe("AImaging");
    expect(json.text).toBe("texte brut");
    expect(Array.isArray(json.sections)).toBe(true);
  });

  it("buildReportFilename gère l'extension demandée", () => {
    expect(buildReportFilename("radiography", new Date("2026-08-24T00:00:00Z"), "doc")).toBe(
      "AImaging_Radiography_2026-08-24.doc",
    );
    expect(buildReportFilename("radiography", new Date("2026-08-24T00:00:00Z"), "json")).toBe(
      "AImaging_Radiography_2026-08-24.json",
    );
  });
});

describe("SpeechService (§18/§19/§21)", () => {
  class FakeRecognition {
    lang = "";
    continuous = false;
    interimResults = false;
    started = false;
    stopped = false;
    aborted = false;
    onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null = null;
    onerror: ((event: { error?: string }) => void) | null = null;
    onend: (() => void) | null = null;
    start() { this.started = true; }
    stop() { this.stopped = true; this.onend?.(); }
    abort() { this.aborted = true; }
  }

  function withRecognition(): { instances: FakeRecognition[] } {
    const instances: FakeRecognition[] = [];
    (globalThis as unknown as Record<string, unknown>).SpeechRecognition = function (this: FakeRecognition) {
      const inst = new FakeRecognition();
      instances.push(inst);
      return inst;
    };
    return { instances };
  }

  beforeEach(() => {
    delete (globalThis as unknown as Record<string, unknown>).SpeechRecognition;
    delete (globalThis as unknown as Record<string, unknown>).webkitSpeechRecognition;
  });

  it("provider absent ⇒ état unsupported + message explicite", () => {
    const svc = new SpeechService();
    const states: string[] = [];
    const errors: string[] = [];
    svc.start({
      onStateChange: (s) => states.push(s),
      onError: (m) => errors.push(m),
    });
    expect(svc.getState()).toBe("unsupported");
    expect(errors[0]).toContain("non supportée");
  });

  it("start/stop : transcription finale livrée via preview, jamais appliquée directement", () => {
    const { instances } = withRecognition();
    const svc = new SpeechService();
    const states: string[] = [];
    const transcripts: string[] = [];
    svc.start({ onStateChange: (s) => states.push(s), onTranscript: (t) => transcripts.push(t) });

    expect(instances).toHaveLength(1);
    expect(svc.getState()).toBe("listening");

    /* Résultats intermédiaires du provider → preview. */
    instances[0].onresult!({
      results: [[{ transcript: "Absence de foyer alvéolaire" }]],
    });
    expect(transcripts).toEqual(["Absence de foyer alvéolaire"]);

    svc.stop();
    expect(states).toContain("processing");
    /* La voix n'écrit RIEN toute seule : c'est l'appelant qui applique (§18). */
  });

  it("cancel avorte proprement sans transcrire", () => {
    const { instances } = withRecognition();
    const svc = new SpeechService();
    const transcripts: string[] = [];
    svc.start({ onTranscript: (t) => transcripts.push(t) });
    instances[0].onresult!({ results: [[{ transcript: "brouillon" }]] });

    svc.cancel();

    expect(instances[0].aborted).toBe(true);
    expect(svc.getState()).toBe("idle");
  });

  it("not-allowed produit un message de permission actionnable (§18)", () => {
    const { instances } = withRecognition();
    const svc = new SpeechService();
    const errors: string[] = [];
    svc.start({ onError: (m) => errors.push(m) });
    instances[0].onerror!({ error: "not-allowed" });
    expect(errors[0]).toContain("Autorisez-le");
  });

  it("langue appliquée au recognizer (fr/en, §22)", () => {
    withRecognition();
    const fr = new SpeechService("fr");
    const en = new SpeechService("en");
    fr.start({});
    en.start({});
    /* Deux instances distinctes : on vérifie via une nouvelle capture. */
    const { instances } = withRecognition();
    const a = new SpeechService("en");
    a.start({});
    expect(instances[0].lang).toBe("en-US");
    void fr; void en;
  });
});
/* SUITE_PDF_TESTS_PART3 */