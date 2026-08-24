/**
 * Tests de la couche images — Phase Database 4 (SUITE.md §18).
 *
 * Client Supabase + Storage entièrement mockés : aucune base, aucun réseau.
 * Les tests réels (§19/§20/§21) vivent dans tests/live/ et se marquent
 * explicitement SKIPPED sans credentials.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExaminationImageRow } from "../src/lib/db/types";

/* ------------------------------ État partagé ------------------------------- */

const h = vi.hoisted(() => {
  const state = {
    configured: true,
    localExams: [] as Array<Record<string, unknown>>,
    /** Objets Storage simulés : chemin → Blob. */
    objects: new Map<string, { blob: Blob; type?: string }>(),
    rows: [] as ExaminationImageRow[],
    rowCounter: 0,
    /** Contextes legacy exam id → uuid (simulation examinationStore). */
    examUuids: new Map<string, string>([["exam-1", "uuid-exam-1"], ["exam-src", "uuid-exam-src"]]),
    failCreateImage: false,
    statuses: [] as string[],
  };
  return { state };
});

function makeRow(partial: Partial<ExaminationImageRow>): ExaminationImageRow {
  h.state.rowCounter += 1;
  return {
    id: `img-uuid-${h.state.rowCounter}`,
    examination_id: "uuid-exam-1",
    legacy_id: null,
    filename: "",
    storage_path: null,
    mime_type: null,
    width: null,
    height: null,
    sort_order: 0,
    source_kind: "browser-image",
    metadata: {},
    display_state: {},
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

const PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/* --------------------------------- Mocks ----------------------------------- */

vi.mock("../src/lib/db/supabaseClient", () => ({
  get isSupabaseConfigured() {
    return h.state.configured;
  },
  getSupabaseClient: () => {
    throw new Error("getSupabaseClient ne doit pas être appelé directement par les tests.");
  },
}));

vi.mock("../src/lib/db/examinationStore", () => ({
  emitSyncStatus: (status: string) => h.state.statuses.push(status),
  resolveExamContext: async (legacyId: string) => {
    const examinationUuid = h.state.examUuids.get(legacyId);
    if (examinationUuid === undefined) throw new Error(`examen legacy inconnu : ${legacyId}`);
    return { userId: "user-1", workspaceUuid: "ws-1", examinationUuid };
  },
}));

vi.mock("../src/lib/db/repositories/imageRepository", () => ({
  createImage: async (values: Record<string, unknown>) => {
    if (h.state.failCreateImage) throw new Error("[db] insertion examination_images échouée.");
    const row = makeRow({
      examination_id: values.examination_id as string,
      legacy_id: (values.legacy_id as string) ?? null,
      filename: values.filename as string,
      storage_path: values.storage_path as string,
      mime_type: values.mime_type as string | null,
      width: values.width as number | null,
      height: values.height as number | null,
      sort_order: (values.sort_order as number | undefined) ?? 0,
      source_kind: values.source_kind as string | null,
      metadata: values.metadata as Record<string, unknown>,
    });
    h.state.rows.push(row);
    return row;
  },
  getImageByLegacyId: async (legacyId: string) =>
    h.state.rows.find((row) => row.legacy_id === legacyId) ?? null,
  listImagesByExamination: async (examinationId: string) =>
    h.state.rows
      .filter((row) => row.examination_id === examinationId)
      .sort((a, b) => a.sort_order - b.sort_order),
}));

vi.mock("../src/lib/db/storage", () => ({
  buildImagePath: (
    userId: string,
    workspaceId: string,
    examinationId: string,
    imageId: string,
    filename: string,
  ) => `${userId}/${workspaceId}/${examinationId}/images/${imageId}/${filename}`,
  uploadImageObject: async (path: string, blob: Blob, contentType?: string) => {
    if (path.includes("__upload_fail__")) throw new Error("[db] réseau Storage coupé.");
    h.state.objects.set(path, { blob, type: contentType });
  },
  downloadImageObject: async (path: string) => h.state.objects.get(path)?.blob ?? null,
  removeObject: async (path: string) => {
    h.state.objects.delete(path);
  },
  removeImageObjects: async (paths: string[]) => {
    for (const path of paths) h.state.objects.delete(path);
  },
}));

vi.mock("../src/lib/examinations", () => ({
  loadExaminations: () => structuredClone(h.state.localExams),
  saveExaminations: () => undefined,
}));

/* ------------------------------- Utilitaires -------------------------------- */

type StoreModule = typeof import("../src/lib/db/imageStore");

async function freshStore(): Promise<StoreModule> {
  vi.resetModules();
  return import("../src/lib/db/imageStore");
}

function makeExam(id: string): Record<string, unknown> {
  return {
    id,
    name: `Exam ${id}`,
    createdAt: "2026-02-01T10:00:00.000Z",
    lastOpenedAt: "2026-03-01T10:00:00.000Z",
    archived: false,
    images: [
      {
        id: "img-a",
        name: "radio thorax.png",
        src: PNG_DATA_URL,
        dims: { w: 32, h: 24 },
        sourceKind: "browser-image",
      },
    ],
  };
}

beforeEach(() => {
  h.state.configured = true;
  h.state.objects.clear();
  h.state.rows = [];
  h.state.rowCounter = 0;
  h.state.examUuids = new Map([["exam-1", "uuid-exam-1"], ["exam-src", "uuid-exam-src"]]);
  h.state.localExams = [];
  h.state.failCreateImage = false;
  h.state.statuses = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

/* --------------------------------- Tests ------------------------------------ */

describe("imageStore — upload browser image (JPEG/PNG, §6/§8)", () => {
  it("upload vers le chemin canonique et crée le record avec métadonnées", async () => {
    const store = await freshStore();

    await store.syncExamImages(makeExam("exam-1") as never);

    const expectedPath = "user-1/ws-1/uuid-exam-1/images/img-a/radio_thorax.png";
    expect(h.state.objects.has(expectedPath)).toBe(true);
    expect(h.state.rows).toHaveLength(1);
    const row = h.state.rows[0];
    expect(row.storage_path).toBe(expectedPath);
    expect(row.mime_type).toBe("image/png");
    expect(row.width).toBe(32);
    expect(row.height).toBe(24);
    expect(row.sort_order).toBe(0);
    expect(row.source_kind).toBe("browser-image");
    expect(store.getImageSyncState("img-a")).toBe("synced");
  });

  it("est idempotent : une relance ne duplique ni objet ni record (§15)", async () => {
    const store = await freshStore();

    await store.syncExamImages(makeExam("exam-1") as never);
    await store.syncExamImages(makeExam("exam-1") as never);

    expect(h.state.objects.size).toBe(1);
    expect(h.state.rows).toHaveLength(1);
  });
});

describe("imageStore — DICOM (choix A validé, §9)", () => {
  it("stocke l'original .dcm capturé à l'import", async () => {
    const store = await freshStore();
    const original = new File(["DICM"], "scan.dcm", { type: "application/dicom" });
    const originals = new Map([["img-dcm", original]]);
    const exam = {
      id: "exam-1",
      images: [
        {
          id: "img-dcm",
          name: "scan",
          src: PNG_DATA_URL,
          dims: { w: 64, h: 64 },
          sourceKind: "dicom",
          metadata: { modality: "CR", patientPseudonym: "pseudo-123" },
        },
      ],
    };

    await store.syncExamImages(exam as never, { originalFiles: originals });

    const row = h.state.rows[0];
    expect(row.filename.endsWith(".dcm")).toBe(true);
    expect(row.mime_type).toBe("application/dicom");
    expect(row.source_kind).toBe("dicom");
    /* Métadonnées pseudonymisées séparées du fichier brut (§8). */
    expect(row.metadata).toHaveProperty("dicom");
  });

  it("repli legacy : PNG de frame + marqueur legacy_frame_fallback", async () => {
    const store = await freshStore();
    const exam = {
      id: "exam-1",
      images: [
        { id: "img-old", name: "legacy frame", src: PNG_DATA_URL, dims: { w: 10, h: 10 }, sourceKind: "dicom" },
      ],
    };

    await store.syncExamImages(exam as never);

    const row = h.state.rows[0];
    expect(row.filename.endsWith(".png")).toBe(true);
    expect((row.metadata as Record<string, unknown>).legacy_frame_fallback).toBe(true);
  });
});

describe("imageStore — atomicité et erreurs (§10/§18)", () => {
  it("upload OK + DB KO ⇒ objet orphelin nettoyé, erreur propagée, jamais synced", async () => {
    const store = await freshStore();
    h.state.failCreateImage = true;

    await expect(store.syncExamImages(makeExam("exam-1") as never)).rejects.toThrow(
      "insertion examination_images échouée",
    );

    expect(h.state.objects.size).toBe(0); /* rollback Storage effectif */
    expect(h.state.rows).toHaveLength(0);
    expect(store.getImageSyncState("img-a")).toBe("error"); /* jamais présenté synchronisé */
  });

  it("échec upload ⇒ rejet explicite sans record DB", async () => {
    const store = await freshStore();
    const exam = {
      id: "exam-1",
      images: [
        { id: "__upload_fail__", name: "x", src: PNG_DATA_URL, dims: { w: 1, h: 1 }, sourceKind: "browser-image" },
      ],
    };

    await expect(store.syncExamImages(exam as never)).rejects.toThrow("réseau Storage coupé");
    expect(h.state.rows).toHaveLength(0);
    expect(store.getImageSyncState("__upload_fail__")).toBe("error");
  });

  it("hors ligne (non configuré) : aucune écriture, état local conservé", async () => {
    h.state.configured = false;
    const store = await freshStore();

    await store.syncExamImages(makeExam("exam-1") as never);

    expect(h.state.objects.size).toBe(0);
    expect(h.state.rows).toHaveLength(0);
    expect(store.getImageSyncState("img-a")).toBe("local");
  });
});

describe("imageStore — duplication copy-on-duplicate (§17 A)", () => {
  it("copie le binaire sous le nouvel examen et insère un nouveau record", async () => {
    const store = await freshStore();
    await store.syncExamImages(makeExam("exam-src") as never);
    const sourceRow = h.state.rows[0];
    h.state.examUuids.set("exam-copy", "uuid-exam-copy");

    const copy = {
      id: "exam-copy",
      images: [
        { id: "img-copy", name: "copy", src: PNG_DATA_URL, dims: { w: 32, h: 24 }, sourceKind: "browser-image" },
      ],
    };
    await store.syncExamImages(copy as never, { duplicatedFrom: "exam-src" });

    expect(h.state.rows).toHaveLength(2);
    const newRow = h.state.rows[1];
    expect(newRow.examination_id).toBe("uuid-exam-copy");
    expect(newRow.legacy_id).toBe("img-copy");
    expect(newRow.storage_path).not.toBe(sourceRow.storage_path);
    expect(newRow.storage_path).toContain("uuid-exam-copy/images/img-copy/");
    expect(h.state.objects.size).toBe(2); /* deux binaires distincts */
    expect((newRow.metadata as Record<string, unknown>).duplicated_from_storage_path)
      .toBe(sourceRow.storage_path);
  });
});

describe("imageStore — migration idempotente (§14)", () => {
  it("téléverse une seule fois les images du cache local", async () => {
    h.state.localExams = [makeExam("exam-1")];
    const store = await freshStore();

    const first = await store.migrateExistingImages();
    expect(first.uploaded).toBe(1);
    expect(first.failed).toBe(0);
    expect(h.state.rows).toHaveLength(1);

    const rowsBefore = h.state.rows.length;
    const objectsBefore = h.state.objects.size;
    await store.migrateExistingImages(); /* garde anti-relance + storage_path */

    expect(h.state.rows.length).toBe(rowsBefore);
    expect(h.state.objects.size).toBe(objectsBefore);
  });
});

