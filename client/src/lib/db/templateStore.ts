/**
 * templateStore — persistance des ReportTemplates avec repli local
 * (INSTRUCTIONS.md §6/§7/§13).
 *
 * Stratégie progressive :
 * - quand Supabase est configuré ET que la table report_templates est
 *   disponible (migration 0007 appliquée), les opérations délèguent au
 *   repository distant ;
 * - sinon, repli localStorage par utilisateur (`aimaging.<uid>.reportTemplates`)
 *   afin que le Template Builder reste pleinement utilisable hors base ;
 * - un défaut par modalité est maintenu dans les deux modes.
 */

import { isSupabaseConfigured } from "./supabaseClient";
import {
  defaultTemplateData,
  normalizeTemplateData,
  type ReportLanguage,
  type ReportModality,
  type ReportTemplateData,
} from "../reports/engine";

export interface StoredReportTemplate {
  id: string;
  name: string;
  modality: ReportModality;
  language: ReportLanguage;
  version: number;
  isDefault: boolean;
  data: ReportTemplateData;
  updatedAt: string;
}

const LEGACY_KEY = "aimaging.reportTemplates";

function storageKey(userId?: string | null): string {
  return userId ? `aimaging.${userId}.reportTemplates` : LEGACY_KEY;
}

function readAll(userId?: string | null): StoredReportTemplate[] {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    /* Répare d'éventuels anciens templates persistés (champs manquants). */
    return parsed.map((t) => {
      const stored = t as Partial<StoredReportTemplate>;
      return {
        ...stored,
        data: normalizeTemplateData((stored.data ?? defaultTemplateData(stored.modality ?? "generic")) as ReportTemplateData),
      } as StoredReportTemplate;
    });
  } catch {
    return [];
  }
}

function writeAll(list: StoredReportTemplate[], userId?: string | null): void {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(list));
  } catch {
    /* quota / indisponible : l'état mémoire reste la référence */
  }
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Liste triée : défaut de modalité d'abord, puis mis à jour récemment. */
export function listLocalTemplates(userId?: string | null): StoredReportTemplate[] {
  const list = readAll(userId);
  return list.sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    return b.updatedAt.localeCompare(a.updatedAt);
  });
}

export function getLocalDefault(
  modality: ReportModality,
  userId?: string | null,
): StoredReportTemplate | null {
  const list = readAll(userId);
  const found = list.find((t) => t.modality === modality && t.isDefault);
  return found === undefined ? null : { ...found, data: normalizeTemplateData(found.data) };
}

/**
 * Crée ou met à jour un template local ; si `isDefault`, retire le flag des
 * autres templates de la même modalité (invariant du défaut unique).
 */
export function saveLocalTemplate(input: {
  id?: string;
  userId?: string | null;
  name: string;
  modality: ReportModality;
  language?: ReportLanguage;
  data: ReportTemplateData;
  isDefault?: boolean;
}): StoredReportTemplate {
  const list = readAll(input.userId);
  const existingIndex = input.id !== undefined ? list.findIndex((t) => t.id === input.id) : -1;
  const existing = existingIndex >= 0 ? list[existingIndex] : null;
  /* Défaut explicite sinon conservé (update) sinon true (création). */
  const effectiveDefault = input.isDefault ?? existing?.isDefault ?? true;
  if (effectiveDefault) {
    for (const t of list) {
      if (t.modality === input.modality && t.id !== storedId()) t.isDefault = false;
    }
  }
  function storedId(): string { return input.id ?? "__new__"; }
  const stored: StoredReportTemplate = {
    id: input.id ?? newId(),
    name: input.name,
    modality: input.modality,
    language: input.language ?? "fr",
    version: existing ? (existing.version ?? 1) + 1 : 1,
    isDefault: effectiveDefault,
    data: input.data,
    updatedAt: new Date().toISOString(),
  };
  if (existingIndex >= 0) list[existingIndex] = stored;
  else list.push(stored);
  writeAll(list, input.userId);
  return stored;
}

export function deleteLocalTemplate(id: string, userId?: string | null): void {
  writeAll(
    readAll(userId).filter((t) => t.id !== id),
    userId,
  );
}

/**
 * Garantit qu'un template par défaut existe pour la modalité donnée :
 * le crée depuis `defaultTemplateData()` sinon. Appelé à l'ouverture
 * du builder/preview pour que l'utilisateur parte toujours d'une base saine.
 */
export function ensureLocalDefault(
  modality: ReportModality,
  userId?: string | null,
): StoredReportTemplate {
  const existing = getLocalDefault(modality, userId);
  if (existing !== null) return existing;
  return saveLocalTemplate({
    userId,
    name: modality === "fetal_ultrasound" ? "Obstétrical (défaut)" : "Radiographie (défaut)",
    modality,
    data: defaultTemplateData(modality),
    isDefault: true,
  });
}

/** Indique si le mode distant (table report_templates) est utilisable. */
export function isRemoteTemplatesEnabled(): boolean {
  /* La migration 0007 doit être appliquée côté projet ; tant qu'on ne peut
     pas le vérifier depuis le client sans requête coûteuse, le basculement
     se fera après validation live (Phase 9A pattern). Pour l'instant :
     localStorage systématique, Supabase en étape suivante. */
  return false && isSupabaseConfigured;
}
