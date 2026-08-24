/**
 * Tests Phase Database 6 — analysis_runs / classification_results / artefacts.
 * Client Supabase + Storage mockés ; live réel §28/§29 dans tests/live/.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalysisRunRow, ClassificationResultRow } from "../src/lib/db/types";

const h = vi.hoisted(() => {
  const state = {
    configured: true,
    runs: [] as Array<Record<string, unknown> & { id: string }>,
    results: [] as ClassificationResultRow[],
    artifacts: new Map<string, Blob>(),
    failResults: false,
    statuses: [] as string[],
    counter: 0,
  };
  return { state };
});

vi.mock("../src/lib/db/supabaseClient", () => ({
  get isSupabaseConfigured() {
    return h.state.configured;
  },
  getSupabaseClient: () => {
    throw new Error("getSupabaseClient ne doit pas être appelé directement.");
  },
}));

vi.mock("../src/lib/db/examinationStore", () => ({
  emitSyncStatus: (s: string) => h.state.statuses.push(s),
  resolveExamContext: async () => ({ userId: "u1", workspaceUuid: "ws1", examinationUuid: "exam-uuid" }),
}));

vi.mock("../src/lib/db/repositories/imageRepository", () => ({
  getImageByLegacyId: async (legacyId: string) =>
    legacyId === "img-x" ? null : { id: `img-uuid-${legacyId}` },
}));

vi.mock("../src/lib/db/repositories/analysisRepository", async (importOriginal) => {
  void importOriginal;
  const nowIso = () => new Date().toISOString();
  return {
    createAnalysisRun: async (values: Record<string, unknown>) => {
      h.state.counter += 1;
      const row = { id: `run-${h.state.counter}`, created_at: nowIso(), updated_at: nowIso(), ...values };
      h.state.runs.push(row);
      return row as unknown as AnalysisRunRow;
    },
    updateAnalysisRun: async (id: string, patch: Record<string, unknown>) => {
      const run = h.state.runs.find((candidate) => candidate.id === id);
      if (run === undefined) throw new Error(`run inconnu ${id}`);
      Object.assign(run, patch);
      return run as unknown as AnalysisRunRow;
    },
    markDone: async (id: string, metadata?: Record<string, unknown>) => {
      const run = h.state.runs.find((candidate) => candidate.id === id) as Record<string, unknown>;
      run.status = "done";
      run.completed_at = new Date().toISOString();
      if (metadata !== undefined) run.metadata = metadata;
      return run as unknown as AnalysisRunRow;
    },
    markError: async (id: string, errorMessage: string) => {
      const run = h.state.runs.find((candidate) => candidate.id === id) as Record<string, unknown>;
      run.status = "error";
      run.error_message = errorMessage;
      run.completed_at = new Date().toISOString();
      return run as unknown as AnalysisRunRow;
    },
    addClassificationResults: async (rows: ClassificationResultRow[]) => {
      if (h.state.failResults) throw new Error("[db] insertion résultats échouée.");
      h.state.results.push(...rows.map((row) => ({ ...row })));
      return rows;
    },
  };
});

vi.mock("../src/lib/db/storage", () => ({
  buildArtifactPath: (...segments: string[]) => segments.join("/"),
  uploadArtifactObject: async (path: string, blob: Blob) => {
    if (path.includes("__fail__")) throw new Error("[db] réseau Storage coupé.");
    h.state.artifacts.set(path, blob);
  },
  downloadArtifactObject: async (path: string) => h.state.artifacts.get(path) ?? null,
}));

vi.mock("../src/lib/db/imageStore", () => ({
  dataUrlToBlob: () => new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }),
}));

async function fresh(): Promise<typeof import("../src/lib/db/analysisRunService")> {
  vi.resetModules();
  return import("../src/lib/db/analysisRunService");
}

const PREDICTION = {
  num_models: 2,
  per_model: [
    { architecture: "DenseNet121", predicted_class: "Pneumonia", probabilities: { Normal: 0.1, Pneumonia: 0.9 } },
    { architecture: "ResNet50", predicted_class: "Normal", probabilities: { Normal: 0.6, Pneumonia: 0.4 } },
  ],
  ensemble_prediction: "Pneumonia",
  ensemble_probabilities: { Normal: 0.35, Pneumonia: 0.65 },
};

const GRADCAM = {
  className: "Pneumonia",
  modelCount: 5,
  heatmapDataUrl: "data:image/png;base64,iVBORw0KGgo=",
  peakRegion: { x: 1, y: 2, w: 3, h: 4 },
  generatedAt: "2026-08-23T12:00:00.000Z",
};

beforeEach(() => {
  h.state.configured = true;
  h.state.runs = [];
  h.state.results = [];
  h.state.artifacts.clear();
  h.state.failResults = false;
  h.state.statuses = [];
  h.state.counter = 0;
});

/* --------------------------------- Tests ------------------------------------ */

describe("classification runs (§7/§8)", () => {
  it("un run par exécution : per_model + ensemble dans classification_results", async () => {
    const svc = await fresh();
    const runId = await svc.persistClassificationRun("exam-1", "img-1", PREDICTION);

    expect(runId).toBe("run-1");
    expect(h.state.runs[0].analysis_type).toBe("classification");
    expect(h.state.runs[0].model_name).toBe("ensemble(2)");
    expect(h.state.runs[0].status).toBe("done");
    /* 2 modèles × 2 classes + 2 classes ensemble = 6 lignes. */
    expect(h.state.results).toHaveLength(6);
    expect(h.state.results.filter((row) => row.source === "per_model")).toHaveLength(4);
    expect(h.state.results.filter((row) => row.source === "ensemble")).toHaveLength(2);
    const dense = h.state.results.find(
      (row) => row.model_architecture === "DenseNet121" && row.class_name === "Pneumonia",
    );
    expect(dense?.probability).toBeCloseTo(0.9);
  });

  it("échec d'insertion ⇒ markError explicite, jamais avalé (§22)", async () => {
    const svc = await fresh();
    h.state.failResults = true;
    await expect(svc.persistClassificationRun("exam-1", "img-1", PREDICTION)).rejects.toThrow(
      "insertion résultats échouée",
    );
    expect((h.state.runs[0] as { status?: string }).status).toBe("error");
  });

  it("rejouer une analyse crée un NOUVEAU run (jamais d'écrasement, §3)", async () => {
    const svc = await fresh();
    await svc.persistClassificationRun("exam-1", "img-1", PREDICTION);
    await svc.persistClassificationRun("exam-1", "img-1", PREDICTION);
    expect(h.state.runs).toHaveLength(2);
    expect(new Set(h.state.runs.map((run) => run.id)).size).toBe(2);
  });
});

describe("gradcam — artefact Option B (§9/§10)", () => {
  it("upload heatmap vers analysis-artifacts et référence le chemin dans metadata", async () => {
    const svc = await fresh();
    const runId = await svc.persistGradcamRun("exam-1", "img-1", GRADCAM);

    const run = h.state.runs[0];
    expect(run.status).toBe("done");
    const metadata = run.metadata as { artifact: { storage_path: string } };
    expect(metadata.artifact.storage_path).toBe(
      `u1/ws1/exam-uuid/img-uuid-img-1/${runId}/gradcam/heatmap.png`,
    );
    expect(h.state.artifacts.has(metadata.artifact.storage_path)).toBe(true);
  });
});

describe("opencxr fail-closed (§13)", () => {
  it("image acceptée : run done avec le résultat de tri", async () => {
    const svc = await fresh();
    await svc.persistOpencxrSortRun("exam-1", "img-1", {
      result: { Type: "PA", status: "ACCEPTED_FRONTAL" },
      generatedAt: "2026-08-23T12:00:00.000Z",
    });
    expect(h.state.runs[0].status).toBe("done");
    expect(h.state.runs).toHaveLength(1); // pas de classification en aval ici
  });

  it("image rejetée : UN SEUL run rejected, raison tracée, rien d'autre", async () => {
    const svc = await fresh();
    await svc.persistOpencxrSortRun("exam-1", "img-1", {
      rejected: { reason: "Image non frontale." },
      generatedAt: "2026-08-23T12:00:00.000Z",
    });
    expect(h.state.runs).toHaveLength(1);
    expect(h.state.runs[0].status).toBe("rejected");
    expect(h.state.runs[0].error_message).toBe("Image non frontale.");
  });

  it("standardize : artifact null sans data URL, upload avec data URL", async () => {
    const svc = await fresh();
    await svc.persistOpencxrStandardizeRun("exam-1", "img-1", {
      width: 1024,
      height: 1024,
      sizeChanges: [["sc_crop"]],
      generatedAt: "2026-08-23T12:01:00.000Z",
    });
    expect(h.state.runs[0].status).toBe("done");
    expect((h.state.runs[0].metadata as { artifact: unknown }).artifact).toBeNull();

    await svc.persistOpencxrStandardizeRun("exam-1", "img-1", {
      width: 1024,
      height: 1024,
      sizeChanges: [],
      imageDataUrl: "data:image/png;base64,iVBORw0KGgo=",
      generatedAt: "2026-08-23T12:02:00.000Z",
    });
    expect(h.state.artifacts.size).toBe(1);
    expect([...h.state.artifacts.keys()][0]).toContain("/standardized/standardized.png");
  });
});

describe("cxas / hybridgnet + lien mesures (§11/§12)", () => {
  it("persistAnatomyRun retourne un id rattachable aux measurements", async () => {
    const svc = await fresh();
    const runId = await svc.persistAnatomyRun("hybridgnet", "exam-1", "img-1", {
      generated_at: "2026-08-23T13:00:00.000Z",
      ctr_method: "chexmask",
    });
    expect(runId).toBe("run-1");
    expect(h.state.runs[0].analysis_type).toBe("hybridgnet");

    const mod = await import("../src/lib/db/editorPersistence");
    const drafts = mod.landmarkInputsToMeasurementInserts(
      [{ key: "ctr", label: "CTR", value: 0.44, unit: "ratio" }],
      "uuid-img-x",
      undefined,
      runId,
    );
    expect(drafts[0].analysis_run_id).toBe(runId); // reliquat Phase 5 corrigé
  });

  it("mocks quality/plane/FetalCLIP/anomaly : AUCUN run créé (§14-§18)", async () => {
    const svc = await fresh();
    /* Le service n'expose volontairement aucune fonction pour ces types :
       vérification négative de la surface publique. */
    for (const forbidden of ["quality", "plane", "fetalclip", "anomaly"]) {
      expect(Object.keys(svc).some((key) => key.toLowerCase().includes(forbidden))).toBe(false);
    }
    expect(h.state.runs).toHaveLength(0);
  });
});

describe("hors ligne (non configuré)", () => {
  it("retourne null sans écriture ni erreur", async () => {
    h.state.configured = false;
    const svc = await fresh();
    expect(await svc.persistClassificationRun("exam-1", "img-1", PREDICTION)).toBeNull();
    expect(await svc.persistGradcamRun("exam-1", "img-1", GRADCAM)).toBeNull();
    expect(h.state.runs).toHaveLength(0);
  });
});

