/**
 * Tests Phase Database 5 — annotations + mesures (SUITE.md §23/§24).
 * Client Supabase mocké ; les tests RLS/live réels restent SKIPPED sans credentials.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnnotationRow, MeasurementRow } from "../src/lib/db/types";

/* ------------------------------ État partagé ------------------------------- */

const h = vi.hoisted(() => {
  const state = {
    configured: true,
    imageUuids: new Map<string, string>([["img-1", "uuid-img-1"]]),
    annotations: [] as AnnotationRow[],
    measurements: [] as MeasurementRow[],
    idCounter: 0,
    statuses: [] as string[],
  };
  return { state };
});

function makeAnnotation(partial: Partial<AnnotationRow>): AnnotationRow {
  h.state.idCounter += 1;
  return {
    id: `ann-${h.state.idCounter}`,
    image_id: "uuid-img-1",
    legacy_shape_id: null,
    type: "rectangle",
    geometry: {},
    style: {},
    label: null,
    visible: true,
    created_by: "user",
    action_id: null,
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
  emitSyncStatus: (status: string) => h.state.statuses.push(status),
}));

vi.mock("../src/lib/db/repositories/annotationRepository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/db/repositories/annotationRepository")>();
  void actual;
  return {
    createAnnotation: async (values: Record<string, unknown>) => {
      const row = makeAnnotation({
        image_id: values.image_id as string,
        legacy_shape_id: (values.legacy_shape_id as string) ?? null,
        type: values.type as string,
        geometry: values.geometry as Record<string, unknown>,
        style: values.style as Record<string, unknown> | null,
        label: values.label as string | null,
        visible: (values.visible as boolean | undefined) ?? true,
        created_by: values.created_by as string,
        action_id: values.action_id as string | null,
      });
      h.state.annotations.push(row);
      return row;
    },
    getAnnotationByLegacyShapeId: async (legacyId: string) =>
      h.state.annotations.find((row) => row.legacy_shape_id === legacyId) ?? null,
    listAnnotationsByImage: async (imageId: string) =>
      h.state.annotations.filter((row) => row.image_id === imageId),
    updateAnnotation: async (id: string, patch: Partial<AnnotationRow>) => {
      const row = h.state.annotations.find((candidate) => candidate.id === id);
      if (row === undefined) throw new Error(`annotation inconnue ${id}`);
      Object.assign(row, patch);
      return row;
    },
    deleteAnnotation: async (id: string) => {
      h.state.annotations = h.state.annotations.filter((row) => row.id !== id);
      return true;
    },
  };
});

vi.mock("../src/lib/db/repositories/imageRepository", () => ({
  getImageByLegacyId: async (legacyId: string) => {
    const uuid = h.state.imageUuids.get(legacyId);
    return uuid === undefined ? null : { id: uuid };
  },
}));

vi.mock("../src/lib/db/repositories/measurementRepository", () => ({
  createMeasurement: async (values: Record<string, unknown>) => {
    h.state.idCounter += 1;
    const row = { id: `mea-${h.state.idCounter}`, ...values } as unknown as MeasurementRow;
    h.state.measurements.push(row);
    return row;
  },
  listMeasurementsByImage: async (imageId: string) =>
    h.state.measurements.filter((row) => row.image_id === imageId),
  updateMeasurement: async (id: string, patch: Partial<MeasurementRow>) => {
    const row = h.state.measurements.find((candidate) => candidate.id === id);
    if (row === undefined) throw new Error(`mesure inconnue ${id}`);
    Object.assign(row, patch);
    return row;
  },
  deleteMeasurement: async (id: string) => {
    h.state.measurements = h.state.measurements.filter((row) => row.id !== id);
    return true;
  },
}));

/* ------------------------------- Utilitaires -------------------------------- */

import {
  annotationRowToShape,
  computeShapeMeasure,
  flushShapes,
  mergeRemoteShapes,
  persistLandmarkSet,
  scheduleShapesPersist,
  __resetEditorPersistenceForTests,
  type EditorShape,
} from "../src/lib/db/editorPersistence";
import type { FetalExam } from "../src/lib/fetal/types";

function shape(overrides: Partial<EditorShape> = {}): EditorShape {
  return {
    id: "shape-1",
    type: "rectangle",
    x: 10,
    y: 20,
    w: 30,
    h: 40,
    points: [],
    strokeWidth: 2,
    visible: true,
    createdBy: "user",
    ...overrides,
  };
}

beforeEach(() => {
  h.state.configured = true;
  h.state.imageUuids = new Map([["img-1", "uuid-img-1"]]);
  h.state.annotations = [];
  h.state.measurements = [];
  h.state.statuses = [];
});

afterEach(() => {
  vi.useRealTimers();
});

async function fresh(): Promise<typeof import("../src/lib/db/editorPersistence")> {
  vi.resetModules();
  return import("../src/lib/db/editorPersistence");
}

/* --------------------------- Mapping Shape ↔ DB (§5/§6) --------------------- */

describe("mapping réversible Shape ↔ Annotation", () => {
  it("préserve géométrie, style, label, visibilité, provenance et action_id", async () => {
    const mod = await fresh();
    const original = shape({
      id: "uid-9",
      type: "text",
      label: "Zone d'intérêt",
      fontSize: 14,
      fontFamily: "sans",
      color: "#ff0000",
      createdBy: "ai",
      actionId: "landmarks:ctr",
      points: [{ x: 1, y: 2 }],
    });
    const row = mod.annotationRowToShape(
      makeAnnotation(mod.shapeToAnnotationInsert(original, "uuid-img-1") as never) as never,
    );
    expect(row.id).toBe("uid-9");
    expect(row.type).toBe("text");
    expect(row.label).toBe("Zone d'intérêt");
    expect(row.createdBy).toBe("ai");
    expect(row.actionId).toBe("landmarks:ctr");
    expect(row.x).toBe(10);
    expect(row.points[0]).toEqual({ x: 1, y: 2 });
  });

  it("couvre tous les types requis (§6)", async () => {
    const mod = await fresh();
    for (const type of ["rectangle", "ellipse", "line", "arrow", "freedraw", "measure", "angle", "distance", "text"]) {
      const values = mod.shapeToAnnotationInsert(shape({ type }), "uuid-img-1");
      expect(values.type).toBe(type);
      expect(values.geometry).toHaveProperty("points");
    }
  });
});

describe("valeurs de mesures outils — unités réelles (§13)", () => {
  it("distance en px sans spacing, en mm avec spacing, angle en deg", async () => {
    const mod = await fresh();
    const line = shape({ type: "distance", x: 0, y: 0, w: 3, h: 4 });
    expect(mod.computeShapeMeasure(line)).toEqual({ type: "distance", value: 5, unit: "px" });
    expect(mod.computeShapeMeasure(line, [0.5, 0.7])).toEqual({ type: "distance", value: 3, unit: "mm" });
    const angle = shape({ type: "angle", x: 1, y: 0, w: 1, h: 0, points: [{ x: 0, y: 1 }] });
    expect(mod.computeShapeMeasure(angle)).toEqual({ type: "angle", value: 90, unit: "deg" });
  });
});

describe("flush shapes — insert/update/delete idempotents (§8/§11)", () => {
  it("insère puis ne réécrit rien à l'identique, met à jour puis supprime", async () => {
    vi.useFakeTimers();
    const { scheduleShapesPersist: schedule } = await fresh();
    schedule("img-1", [shape()]);
    await vi.advanceTimersByTimeAsync(800);
    expect(h.state.annotations).toHaveLength(1);
    expect(h.state.annotations[0].legacy_shape_id).toBe("shape-1");

    /* Identique : diff vide → aucune écriture supplémentaire. */
    await flushShapes("img-1");
    expect(h.state.annotations).toHaveLength(1);

    /* Modification géométrique → update (pas de doublon). */
    schedule("img-1", [shape({ x: 99 })]);
    await vi.advanceTimersByTimeAsync(800);
    expect(h.state.annotations).toHaveLength(1);
    expect((h.state.annotations[0].geometry as Record<string, unknown>).x).toBe(99);

    /* Suppression locale → delete distant. */
    schedule("img-1", []);
    await vi.advanceTimersByTimeAsync(800);
    expect(h.state.annotations).toHaveLength(0);
    expect(h.state.statuses.at(-1)).toBe("synced");
  });

  it("reste local si l'image n'est pas encore synchronisée (aucune perte)", async () => {
    vi.useFakeTimers();
    h.state.imageUuids.delete("img-x");
    const { scheduleShapesPersist: schedule } = await fresh();
    schedule("img-x", [shape({ id: "s-x" })]);
    await vi.advanceTimersByTimeAsync(800);
    expect(h.state.annotations).toHaveLength(0); /* rien écrit, erreur journalisée */
  });
});

describe("mesures landmarks — set groupé (§17/§22)", () => {
  it("crée, met à jour et purge le set hybridgnet en préservant les unités", async () => {
    vi.useFakeTimers();
    const { persistLandmarkSet: persist } = await fresh();
    await persist("img-1", [
      { key: "ctr", label: "CTR", value: 0.42, std: 0.01, unit: "ratio" },
      { key: "scd", label: "SCD", value: 62.4, unit: "mm" },
    ]);
    expect(h.state.measurements.map((row) => row.type)).toEqual(["CTR", "SCD"]);

    await persist("img-1", [{ key: "ctr", label: "CTR", value: 0.45, unit: "ratio" }]);
    expect(h.state.measurements.map((row) => row.type)).toEqual(["CTR"]);
    expect(h.state.measurements[0].value).toBeCloseTo(0.45);
    expect(h.state.measurements[0].unit).toBe("ratio");
  });
});

describe("fusion LWW à la restauration (§20/§21)", () => {
  it("le distant gagne sur les ids communs ; les locaux seuls survivent", async () => {
    const mod = await fresh();
    const merged = mod.mergeRemoteShapes(
      [shape({ id: "a", x: 1 }), shape({ id: "local-only" })],
      [annotationRowToShape(makeAnnotation({ legacy_shape_id: "a", geometry: { x: 7, y: 0, w: 0, h: 0, points: [] } }))],
    );
    expect(merged.find((candidate) => candidate.id === "a")?.x).toBe(7);
    expect(merged.some((candidate) => candidate.id === "local-only")).toBe(true);
  });
});

describe("mapping fœtal F1/F2 — mocks exclus de la persistance (§15/§18)", () => {
  it("mappe BPD/CRL vers user|ai et marque les mocks localOnly", async () => {
    const mod = await import("../src/lib/db/fetalMeasurementMapping");
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
          ],
        },
      ],
    } as unknown as FetalExam;
    const drafts = mod.fetalExamToMeasurementDrafts(exam);
    expect(drafts.filter((d) => d.metadata.fetus_id === "F1").map((d) => d.type)).toEqual(["BPD", "AC"]);
    const crl = drafts.find((d) => d.type === "CRL");
    expect(crl?.metadata.fetus_id).toBe("F2");
    expect(crl?.source).toBe("ai");
    /* Le mock CRL ne doit JAMAIS devenir une mesure médicale persistée (§18). */
    expect(mod.persistableFetalDrafts(drafts).map((d) => d.type)).toEqual(["BPD", "AC"]);
  });
});

