/**
 * Tests templateStore — repli local, défaut unique par modalité (§6/§7/§13).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteLocalTemplate,
  ensureLocalDefault,
  getLocalDefault,
  listLocalTemplates,
  saveLocalTemplate,
} from "../src/lib/db/templateStore";
import { defaultTemplateData } from "../src/lib/reports/engine";

const mem = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
});

beforeEach(() => {
  mem.clear();
});

describe("templateStore — repli local (§13)", () => {
  it("ensureLocalDefault crée puis réutilise le défaut de modalité", () => {
    const a = ensureLocalDefault("radiography", "u1");
    const b = ensureLocalDefault("radiography", "u1");
    expect(b.id).toBe(a.id);
    expect(a.isDefault).toBe(true);
    expect(a.data.sections.length).toBeGreaterThan(3);
  });

  it("isole les caches par utilisateur (§19)", () => {
    const a = ensureLocalDefault("fetal_ultrasound", "user-a");
    expect(getLocalDefault("fetal_ultrasound", "user-b")).toBeNull();
    expect(a.name).toContain("Obstétrical");
  });

  it("saveLocalTemplate : défaut unique par modalité + version incrémentée", () => {
    const base = ensureLocalDefault("radiography", "u1");
    const second = saveLocalTemplate({
      userId: "u1",
      name: "Radio compacte",
      modality: "radiography",
      data: defaultTemplateData("radiography"),
      isDefault: true,
    });
    expect(second.isDefault).toBe(true);
    expect(second.version).toBe(1);

    /* Relecture fraîche (le store sérialise) : l'ancien défaut est retiré. */
    const oldEntry = listLocalTemplates("u1").find((t) => t.id === base.id);
    expect(oldEntry?.isDefault).toBe(false);

    const updated = saveLocalTemplate({
      id: second.id,
      userId: "u1",
      name: "Radio compacte v2",
      modality: "radiography",
      data: defaultTemplateData("radiography"),
    });
    expect(updated.version).toBe(2); // versioning §15
    expect(updated.id).toBe(second.id);
    expect(listLocalTemplates("u1").filter((t) => t.modality === "radiography" && t.isDefault)).toHaveLength(1);
    expect(listLocalTemplates("u1").filter((t) => t.modality === "radiography" && t.isDefault)).toHaveLength(1);
  });

  it("deleteLocalTemplate retire l'entrée", () => {
    const t = ensureLocalDefault("generic", "u1");
    deleteLocalTemplate(t.id, "u1");
    expect(listLocalTemplates("u1")).toHaveLength(0);
  });

  it("defaultTemplateData fournit une structure complète", () => {
    const data = defaultTemplateData("fetal_ultrasound");
    expect(data.page.size).toBe("A4");
    expect(data.header.visible).toBe(true);
    expect(data.signature.visible).toBe(true);
    expect(Array.isArray(data.variables)).toBe(true);
    expect(data.variables.length).toBeGreaterThan(0);
    expect(Array.isArray(data.customBlocks)).toBe(true);
  });
});
