/**
 * imageRepository — CRUD de la table `examination_images` (FONDATION.md §25).
 *
 * Métadonnées uniquement : les fichiers binaires vivent dans le bucket privé
 * `medical-images` et ne sont référencés que par `storage_path`.
 * Aucun branchement UI pendant la phase Fondation.
 */

import { getSupabaseClient } from "../supabaseClient";
import type { ExaminationImageInsert, ExaminationImageRow, ExaminationImageUpdate } from "../types";
import { queryExecuted, queryMany, queryMaybeOne, queryOne } from "../repositoryUtils";

const TABLE = "examination_images" as const;

/** Crée une metadata d'image dans l'examen donné. */
export async function createImage(values: ExaminationImageInsert): Promise<ExaminationImageRow> {
  return queryOne("examination_images.insert", () =>
    getSupabaseClient().from(TABLE).insert(values).select("*").single(),
  );
}

/** Lit une metadata d'image ; null si absente. */
export async function getImage(id: string): Promise<ExaminationImageRow | null> {
  return queryMaybeOne("examination_images.get", () =>
    getSupabaseClient().from(TABLE).select("*").eq("id", id).maybeSingle(),
  );
}

/** Liste les images d'un examen dans l'ordre d'affichage. */
export async function listImagesByExamination(examinationId: string): Promise<ExaminationImageRow[]> {
  return queryMany("examination_images.list", () =>
    getSupabaseClient()
      .from(TABLE)
      .select("*")
      .eq("examination_id", examinationId)
      .order("sort_order", { ascending: true }),
  );
}

/** Recherche une metadata d'image par legacy_id (migration depuis localStorage). */
export async function getImageByLegacyId(legacyId: string): Promise<ExaminationImageRow | null> {
  return queryMaybeOne("examination_images.get_by_legacy_id", () =>
    getSupabaseClient().from(TABLE).select("*").eq("legacy_id", legacyId).maybeSingle(),
  );
}

/** Met à jour une metadata d'image (patch partiel) et retourne la ligne à jour. */
export async function updateImage(
  id: string,
  patch: ExaminationImageUpdate,
): Promise<ExaminationImageRow> {
  return queryOne("examination_images.update", () =>
    getSupabaseClient().from(TABLE).update(patch).eq("id", id).select("*").single(),
  );
}

/** Supprime une metadata d'image (les annotations/analyses enfants suivent). */
export async function deleteImage(id: string): Promise<boolean> {
  return queryExecuted("examination_images.delete", () =>
    getSupabaseClient().from(TABLE).delete().eq("id", id),
  );
}
