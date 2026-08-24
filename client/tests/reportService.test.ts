/**
 * Tests Phase Database 7 — reports (SUITE.md §20/§21/§22).
 * Client Supabase + Storage mockés ; live réel §23 dans tests/live/.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FetalExam, ReportRow } from "../src/lib/db/types";

const h = vi.hoisted(() => {
  const state = {
    configured: true,
    examUuids: new Map<string, string>([["exam-1", "uuid-exam-1"]]),
    rows: [] as ReportRow[],
    exports: new Map<string, Blob>(),
    idCounter: 0,
  };
  return { state };
});

function makeRow(partial: Partial<ReportRow>): ReportRow {
  h.state.idCounter += 1;
  return {
    id: `rep-${h.state.idCounter}`,
    examination_id: "uuid-exam-1",
    type: "radiography_ai",
    status: "needs_review",
    content: null,
    structured_data: null,
    storage_path: null,
    created_by: "ai",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

vi.mock("../src/lib/db/supabaseClient", () => ({
  get isSupabaseConfigured() {
    return h.state.configured;
  },
  getSupabaseClient: () => {
    throw new Error("getSupabaseClient ne doit pas être appelé directement.");
  },
}));

vi.mock("../src/lib/db/examinationStore", () => ({
  emitSyncStatus: () => undefined,
  resolveExamContext: async (legacyId: string) => ({
    userId: "u1",
    workspaceUuid: "ws1",
    examinationUuid: h.state.examUuids.get(legacyId) ?? "unknown",
  }),
}));

vi.mock("../src/lib/db/repositories/reportRepository", async (importOriginal) => {
  void importOriginal;
  return {
    createReport: async (values: Record<string, unknown>) => {
      const row = makeRow({
        examination_id: values.examination_id as string,
        type: values.type as string,
        status: (values.status as string) ?? "draft",
        content: (values.content as string | null) ?? null,
        structured_data: values.structured_data as Record<string, unknown> | null,
        created_by: (values.created_by as string) ?? "ai",
      });
      h.state.rows.push(row);
      return row;
    },
    updateReport: async (id: string, patch: Partial<ReportRow>) => {
      const row = h.state.rows.find((candidate) => candidate.id === id);
      if (row === undefined) throw new Error(`report inconnu ${id}`);
      Object.assign(row, patch);
      row.updated_at = new Date().toISOString();
      return row;
    },
    listReportsByExamination: async (examinationId: string) =>
      h.state.rows
        .filter((row) => row.examination_id === examinationId)
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    getLatestReport: async (examinationId: string) =>
      h.state.rows
        .filter((row) => row.examination_id === examinationId)
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0] ?? null,
  };
});

vi.mock("../src/lib/db/storage", () => ({
  buildReportExportPath: (
    userId: string,
    workspaceId: string,
    examinationId: string,
    reportId: string,
    filename: string,
  ) => `${userId}/${workspaceId}/${examinationId}/${reportId}/exports/${filename}`,
  uploadReportObject: async (path: string, blob: Blob) => {
    h.state.exports.set(path, blob);
  },
  downloadReportObject: async (path: string) => h.state.exports.get(path) ?? null,
}));

vi.mock("../src/lib/db/analysisRunService", () => ({
  getSourceRunIds: (imageLegacyId: string) =>
    imageLegacyId === "img-1" ? ["run-a", "run-b"] : [],
}));

async function fresh(): Promise<typeof import("../src/lib/db/reportService")> {
  vi.resetModules();
  return import("../src/lib/db/reportService");
}

const RADIO_INPUT = {
  fields: { conclusion: "Opacité basale droite.", recommandations: "Contrôle à 3 mois." },
  coherencePassed: true,
  coherenceIssues: [],
  renderedText: "RAPPORT — opacité basale droite…",
  ensemblePrediction: "Pneumonia",
  numModels: 5,
};

beforeEach(() => {
  h.state.configured = true;
  h.state.examUuids = new Map([["exam-1", "uuid-exam-1"]]);
  h.state.rows = [];
  h.state.exports.clear();
  h.state.idCounter = 0;
});

/* --------------------------- Radio workflow (§20) --------------------------- */

describe("rapport radiographique — cycle complet (§5/§6/§20)", () => {
  it("génération ⇒ NOUVEAU report needs_review, jamais validated", async () => {
    const svc = await fresh();
    const row = await svc.persistGeneratedRadioReport("exam-1", ["img-1"], RADIO_INPUT);
    expect(row?.status).toBe("needs_review");
    expect(row?.type).toBe("radiography_ai");
    expect(row?.content).toContain("opacité basale");
  });

  it("structured_data conserve findings, limites et source_analysis_runs (§7/§13)", async () => {
    const svc = await fresh();
    const row = (await svc.persistGeneratedRadioReport("exam-1", ["img-1"], RADIO_INPUT))!;
    const sd = row.structured_data as Record<string, unknown>;
    expect(sd.source_analysis_runs).toEqual(["run-a", "run-b"]); // traçabilité §13
    expect((sd.findings as Record<string, string>).conclusion).toContain("Opacité");
    expect(sd.coherence_passed).toBe(true);
  });

  it("rejouer la génération crée un second report (jamais d'écrasement, §10)", async () => {
    const svc = await fresh();
    await svc.persistGeneratedRadioReport("exam-1", ["img-1"], RADIO_INPUT);
    await svc.persistGeneratedRadioReport("exam-1", ["img-1"], RADIO_INPUT);
    expect(h.state.rows).toHaveLength(2);
    expect(new Set(h.state.rows.map((row) => row.id)).size).toBe(2);
  });

  it("édition : update du courant ; validé édité ⇒ retour needs_review (§5/§10)", async () => {
    const svc = await fresh();
    const created = (await svc.persistGeneratedRadioReport("exam-1", ["img-1"], RADIO_INPUT))!;

    /* Édition sur needs_review → statut conservé. */
    await svc.persistReportEdit(created.id, "Texte révisé.", "needs_review");
    expect(created.status).toBe("needs_review");
    expect(created.content).toBe("Texte révisé.");

    /* Validation explicite uniquement (§18). */
    await svc.validateReportById(created.id);
    expect(created.status).toBe("validated");

    /* Nouvelle édition d'un rapport validé ⇒ repasse en needs_review. */
    await svc.persistReportEdit(created.id, "Retouche post-validation.", "validated");
    expect(created.status).toBe("needs_review");

    /* getLatest + list (§15/§20). */
    const repo = await import("../src/lib/db/repositories/reportRepository");
    expect((await repo.getLatestReport("uuid-exam-1"))?.id).toBe(created.id);
    expect(await repo.listReportsByExamination("uuid-exam-1")).toHaveLength(1);
  });
});

/* ------------------- Fœtal : mapping données seules (§21) ------------------- */

describe("mapping fœtal — données mockées identifiées (§8/§17/§21)", () => {
  it("mappe F1/F2 BPD-CRL-AC-FL-NT + placenta/liquide/col/findings avec provenance", async () => {
    const { mapFetalExamToStructuredData } = await fresh();
    const exam = {
      fetuses: [
        {
          id: "F1",
          measurements: [
            { key: "BPD", label: "BPD", valueMm: 28, origin: "manual", source: { kind: "user", generatedAt: "" } },
            { key: "AC", label: "AC", valueMm: null, origin: "manual", source: { kind: "user", generatedAt: "" } },
          ],
        },
        {
          id: "F2",
          measurements: [
            { key: "CRL", label: "CRL", valueMm: 54, origin: "ai", confidence: 0.9, source: { kind: "mock", generatedAt: "" } },
            { key: "FL", label: "FL", valueMm: 32, origin: "ai", source: { kind: "mock", generatedAt: "" } },
            { key: "NT", label: "NT", valueMm: null, origin: "manual", source: { kind: "user", generatedAt: "" } },
          ],
        },
      ],
      placenta: { position: "anterior", grade: null, insertion: null, confidence: null, source: { kind: "mock", generatedAt: "" } },
      amnioticFluid: { status: "normal", measurementMm: 42, source: { kind: "mock", generatedAt: "" } },
      cervix: { status: "long_closed", lengthMm: 38, source: { kind: "mock", generatedAt: "" } },
      findings: [{ id: "f1", text: "Estomac visible", status: "positive", confidence: null, source: { kind: "mock", generatedAt: "" } }],
      anomaly: { status: "not_implemented", message: "" },
      report: { sections: { header: { title: "Header", content: "…" } }, state: "generated", updatedAt: null },
    } as unknown as FetalExam;

    const draft = mapFetalExamToStructuredData(exam);

    expect(draft.mock_data).toBe(true); // jamais présenté comme IA réel (§8)
    const f1 = draft.fetuses.find((f) => f.fetus_id === "F1")!;
    expect(Object.keys(f1.biometry)).toEqual(["BPD", "AC"]);
    expect(f1.biometry.AC.value).toBeNull(); // aucune valeur inventée
    const f2 = draft.fetuses.find((f) => f.fetus_id === "F2")!;
    expect(f2.biometry.CRL.provenance).toBe("mock");
    expect(draft.placenta.position).toBe("anterior");
    expect(draft.amniotic_fluid.measurementMm).toBe(42);
    expect(draft.cervix.lengthMm).toBe(38);
    expect(draft.findings[0].text).toBe("Estomac visible");
    expect(draft.sections.header.title).toBe("Header");
  });
});

/* ------------------------- Export JSON Storage (§22) ------------------------ */

describe("export JSON vers reports bucket (§16/§22)", () => {
  it("upload au chemin canonique puis storage_path référencé en DB ; reload OK", async () => {
    const svc = await fresh();
    const created = (await svc.persistGeneratedRadioReport("exam-1", ["img-1"], RADIO_INPUT))!;
    const path = await svc.uploadReportJsonExport("exam-1", created);

    expect(path).toBe(`u1/ws1/uuid-exam-1/${created.id}/exports/report.json`);
    expect(h.state.exports.has(path)).toBe(true);
    expect(created.storage_path).toBe(path);

    const { downloadReportObject } = await import("../src/lib/db/storage");
    const blob = await downloadReportObject(path!);
    const parsed = JSON.parse(await blob!.text());
    expect(parsed.diagnosis.class).toBe("Pneumonia");
  });

  it("hors ligne : export null, rien écrit", async () => {
    h.state.configured = false;
    const svc = await fresh();
    expect(await svc.uploadReportJsonExport("exam-1", makeRow({ id: "rep-x" }))).toBeNull();
    expect(h.state.exports.size).toBe(0);
  });
});

