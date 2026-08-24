/**
 * Tests de la couche « gestion des examens » — Phase Database 3 (SUITE.md §16).
 *
 * Stratégie : le client Supabase est entièrement mocké (aucune base, aucun
 * réseau). Les tests d'intégration réels et multi-utilisateurs (§17) ne sont
 * PAS exécutables tant que la base n'est pas provisionnée et que Supabase Auth
 * n'est pas disponible ; ils restent documentés dans le rapport de phase.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExaminationRow } from "../src/lib/db/types";

/* ------------------------------ État partagé ------------------------------- */

const h = vi.hoisted(() => {
  const state = {
    configured: true,
    authUserId: "user-1" as string | null,
    localExams: [] as unknown[],
    savedLocally: [] as unknown[],
    rows: [] as ExaminationRow[],
    uuidCounter: 0,
    failure: null as Error | null,
    statuses: [] as string[],
  };
  return { state };
});

function makeRow(partial: Partial<ExaminationRow>): ExaminationRow {
  h.state.uuidCounter += 1;
  return {
    id: `uuid-${h.state.uuidCounter}`,
    workspace_id: "ws-1",
    legacy_id: null,
    name: "",
    modality: "unknown",
    archived: false,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    last_opened_at: null,
    ...partial,
  };
}

async function failing(): Promise<never> {
  throw h.state.failure ?? new Error("[db] Échec réseau simulé.");
}

/* --------------------------------- Mocks ----------------------------------- */

vi.mock("../src/lib/db/supabaseClient", () => ({
  get isSupabaseConfigured() {
    return h.state.configured;
  },
  getCurrentUserId: async () => {
    if (h.state.authUserId === null) throw new Error("Aucun utilisateur authentifié.");
    return h.state.authUserId;
  },
  getSupabaseClient: () => {
    throw new Error("getSupabaseClient ne doit pas être appelé directement par les tests.");
  },
}));

vi.mock("../src/lib/db/repositories/workspaceRepository", () => ({
  listWorkspacesByOwner: () =>
    Promise.resolve([{ id: "ws-1", owner_id: "user-1", name: "Default workspace", created_at: "", updated_at: "" }]),
  createWorkspace: () => Promise.reject(new Error("Le workspace par défaut doit être réutilisé, pas recréé.")),
}));

vi.mock("../src/lib/db/repositories/examinationRepository", () => ({
  createExamination: async (values: Record<string, unknown>) => {
    if (h.state.failure !== null) return failing();
    const row = makeRow({
      legacy_id: (values.legacy_id as string) ?? null,
      name: values.name as string,
      modality: values.modality as string,
      archived: (values.archived as boolean | undefined) ?? false,
      created_at: (values.created_at as string | undefined) ?? "2026-01-01T00:00:00.000Z",
      last_opened_at: (values.last_opened_at as string | null | undefined) ?? null,
    });
    h.state.rows.push(row);
    return row;
  },
  getExaminationByLegacyId: async (legacyId: string) => {
    if (h.state.failure !== null) return failing();
    return h.state.rows.find((row) => row.legacy_id === legacyId) ?? null;
  },
  listExaminations: async () => {
    if (h.state.failure !== null) return failing();
    return [...h.state.rows];
  },
  updateExamination: async (id: string, patch: Record<string, unknown>) => {
    if (h.state.failure !== null) return failing();
    const row = h.state.rows.find((candidate) => candidate.id === id);
    if (row === undefined) throw new Error(`[db] ligne inconnue ${id}`);
    Object.assign(row, patch);
    return row;
  },
  deleteExamination: async (id: string) => {
    if (h.state.failure !== null) return failing();
    h.state.rows = h.state.rows.filter((row) => row.id !== id);
    return true;
  },
}));

vi.mock("../src/lib/examinations", () => ({
  loadExaminations: () => h.state.localExams.map((exam) => structuredClone(exam)),
  saveExaminations: (list: unknown[]) => {
    h.state.savedLocally = structuredClone(list);
  },
}));

/* ------------------------------- Utilitaires -------------------------------- */

type StoreModule = typeof import("../src/lib/db/examinationStore");

function makeExam(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    name: `Exam ${id}`,
    modality: "Radiography",
    images: [{ id: `${id}-img`, src: "data:image/png;base64,LOCAL", dims: { w: 10, h: 10 } }],
    createdAt: "2026-02-01T10:00:00.000Z",
    lastOpenedAt: "2026-03-01T10:00:00.000Z",
    archived: false,
    ...overrides,
  };
}

async function freshStore(): Promise<StoreModule> {
  vi.resetModules();
  return import("../src/lib/db/examinationStore");
}

beforeEach(() => {
  h.state.configured = true;
  h.state.authUserId = "user-1";
  h.state.localExams = [];
  h.state.savedLocally = [];
  h.state.rows = [];
  h.state.uuidCounter = 0;
  h.state.failure = null;
  h.state.statuses = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

/* --------------------------------- Tests ------------------------------------ */

describe("examinationStore — fallback local (§8)", () => {
  it("reste en mode local-only lorsque Supabase n'est pas configuré", async () => {
    h.state.configured = false;
    h.state.localExams = [makeExam("uid-a")];
    const store = await freshStore();

    const result = await store.bootstrapExaminations();

    expect(result.status).toBe("local-only");
    expect(result.exams).toHaveLength(1);
    expect(h.state.rows).toHaveLength(0);
    expect(h.state.savedLocally).toHaveLength(0);
  });
});

describe("examinationStore — migration legacy (§6)", () => {
  it("migre les métadonnées une seule fois et préserve dates, nom, modalité, legacy_id", async () => {
    h.state.localExams = [makeExam("uid-a")];
    const store = await freshStore();

    await store.bootstrapExaminations();
    await store.bootstrapExaminations(); // idempotence

    expect(h.state.rows).toHaveLength(1);
    const row = h.state.rows[0];
    expect(row.legacy_id).toBe("uid-a");
    expect(row.name).toBe("Exam uid-a");
    expect(row.modality).toBe("radiography"); // normalisation canonique
    expect(row.created_at).toBe("2026-02-01T10:00:00.000Z");
    expect(row.last_opened_at).toBe("2026-03-01T10:00:00.000Z");
    // Aucun binaire migré : la ligne ne contient aucune donnée d'image.
    expect(JSON.stringify(row)).not.toContain("data:image");
  });

  it("fusionne l'enveloppe distante avec le contenu local et conserve les extras locaux", async () => {
    h.state.localExams = [
      makeExam("uid-a"),
      makeExam("uid-offline", { name: "Créé hors ligne" }), // jamais vu côté distant
    ];
    const store = await freshStore();
    const result = await store.bootstrapExaminations();

    expect(result.exams).toHaveLength(2);
    const merged = result.exams.find((exam) => exam.id === "uid-a");
    expect(merged?.images).toHaveLength(1); // contenu local préservé
    expect(merged?.name).toBe("Exam uid-a");
    expect(result.exams.some((exam) => exam.id === "uid-offline")).toBe(true);
    expect(h.state.savedLocally).toHaveLength(2); // cache mis à jour (§8)
    expect(result.status).toBe("synced");
  });
});

describe("examinationStore — opérations persistées (§7)", () => {
  it("crée, renomme, archive, touche puis supprime via le mapping legacy_id ↔ UUID", async () => {
    const store = await freshStore();
    await store.bootstrapExaminations();

    await store.persistCreatedExam(makeExam("uid-new") as never);
    expect(h.state.rows).toHaveLength(1);

    await store.persistRenamedExam("uid-new", "Nouveau nom");
    expect(h.state.rows[0].name).toBe("Nouveau nom");

    await store.persistArchivedExam("uid-new", true);
    expect(h.state.rows[0].archived).toBe(true);

    await store.persistLastOpenedAt("uid-new", "2026-08-23T12:00:00.000Z");
    expect(h.state.rows[0].last_opened_at).toBe("2026-08-23T12:00:00.000Z");

    await store.persistDeletedExam("uid-new");
    expect(h.state.rows).toHaveLength(0);
  });

  it("duplique uniquement les métadonnées : chaque legacy est inséré tel quel (§12)", async () => {
    const store = await freshStore();
    await store.bootstrapExaminations();

    await store.persistCreatedExam(makeExam("uid-src"));
    await store.persistCreatedExam(makeExam("uid-copy", { name: "Exam uid-src (copy)", images: [] }));

    expect(h.state.rows).toHaveLength(2);
    expect(h.state.rows.map((row) => row.legacy_id)).toEqual(["uid-src", "uid-copy"]);
  });
});

describe("examinationStore — erreurs jamais avalées (§8/§16)", () => {
  it("propage l'échec d'écriture et conserve la donnée distante et locale intactes", async () => {
    h.state.localExams = [makeExam("uid-a")];
    const store = await freshStore();
    await store.bootstrapExaminations();

    h.state.failure = new Error("[db] réseau coupé.");
    await expect(store.persistRenamedExam("uid-a", "Jamais appliqué")).rejects.toThrow("réseau coupé");

    expect(h.state.rows[0].name).toBe("Exam uid-a"); // distant inchangé
    expect(h.state.savedLocally.length).toBeGreaterThan(0); // cache local toujours présent
  });

  it("retombe sur localStorage et signale l'erreur lorsque le bootstrap échoue", async () => {
    h.state.localExams = [makeExam("uid-a")];
    const store = await freshStore();
    h.state.failure = new Error("[db] Supabase injoignable.");

    const result = await store.bootstrapExaminations();

    expect(result.status).toBe("error");
    expect(result.exams).toHaveLength(1); // données locales intactes
    expect(result.exams[0].name).toBe("Exam uid-a");
  });
});

