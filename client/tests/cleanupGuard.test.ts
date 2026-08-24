/**
 * Tests Phase Database 9 — garde-fou de nettoyage (§15/§16).
 * Aucune suppression réelle : le module décide, il ne détruit pas.
 */

import { describe, expect, it } from "vitest";
import {
  buildLegacyBackupPayload,
  evaluateCleanup,
  type StorageCounts,
} from "../src/lib/db/cleanupGuard";

const FULL: StorageCounts = {
  examinations: 3,
  images: 7,
  annotations: 12,
  measurements: 5,
  analysisRuns: 4,
  reports: 2,
};

describe("evaluateCleanup — porte §15", () => {
  it("autorise la purge uniquement quand Supabase couvre le local", () => {
    const decision = evaluateCleanup(FULL, FULL);
    expect(decision.safe).toBe(true);
    expect(decision.blocked).toHaveLength(0);
    expect(decision.approved).toHaveLength(6);
  });

  it("bloque toute entité en déficit côté Supabase (jamais de perte silencieuse)", () => {
    const decision = evaluateCleanup(
      { ...FULL, examinations: 3, annotations: 12 },
      { ...FULL, examinations: 2, annotations: 20 },
    );
    expect(decision.safe).toBe(false);
    expect(decision.blocked).toEqual([
      { entity: "examinations", localCount: 3, remoteCount: 2 },
    ]);
    expect(decision.approved).toContain("annotations"); // excédent distant OK
    expect(decision.approved).not.toContain("examinations");
  });

  it("Supabase vide ⇒ tout est bloqué (cas 9A non exécuté)", () => {
    const empty: StorageCounts = {
      examinations: 0,
      images: 0,
      annotations: 0,
      measurements: 0,
      analysisRuns: 0,
      reports: 0,
    };
    const decision = evaluateCleanup(FULL, empty);
    expect(decision.safe).toBe(false);
    expect(decision.blocked).toHaveLength(6);
  });
});

describe("sauvegarde legacy obligatoire avant suppression (§15.1)", () => {
  it("produit un payload horodaté contenant examens et extras", () => {
    const payload = buildLegacyBackupPayload(
      "user-a",
      [{ id: "uid-1" }],
      { prefs: { theme: "dark" } },
    );
    expect(payload.userId).toBe("user-a");
    expect(payload.examinations).toEqual([{ id: "uid-1" }]);
    expect(payload.extras.prefs).toEqual({ theme: "dark" });
    expect(typeof payload.exportedAt).toBe("string");
  });
});
