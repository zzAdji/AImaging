/**
 * annotationRepository — CRUD de la table `annotations` (FONDATION.md §25).
 *
 * Formes du canvas (geometry JSONB en pixels), créées par l'utilisateur ou
 * par l'IA (`created_by`, `action_id` pour la traçabilité).
 * Aucun branchement UI pendant la phase Fondation.
 */

import { getSupabaseClient } from "../supabaseClient";
import type { AnnotationInsert, AnnotationRow, AnnotationUpdate } from "../types";
import { queryExecuted, queryMany, queryMaybeOne, queryOne } from "../repositoryUtils";

const TABLE = "annotations" as const;

/** Crée une annotation sur une image. */
export async function createAnnotation(values: AnnotationInsert): Promise<AnnotationRow> {
  return queryOne("annotations.insert", () =>
    getSupabaseClient().from(TABLE).insert(values).select("*").single(),
  );
}

/** Lit une annotation ; null si absente. */
export async function getAnnotation(id: string): Promise<AnnotationRow | null> {
  return queryMaybeOne("annotations.get", () =>
    getSupabaseClient().from(TABLE).select("*").eq("id", id).maybeSingle(),
  );
}

/** Liste les annotations d'une image, de la plus ancienne à la plus récente. */
export async function listAnnotationsByImage(imageId: string): Promise<AnnotationRow[]> {
  return queryMany("annotations.list_by_image", () =>
    getSupabaseClient()
      .from(TABLE)
      .select("*")
      .eq("image_id", imageId)
      .order("created_at", { ascending: true }),
  );
}

/** Recherche une annotation par legacy_shape_id (migration des Shape[] locales). */
export async function getAnnotationByLegacyShapeId(legacyShapeId: string): Promise<AnnotationRow | null> {
  return queryMaybeOne("annotations.get_by_legacy_shape_id", () =>
    getSupabaseClient().from(TABLE).select("*").eq("legacy_shape_id", legacyShapeId).maybeSingle(),
  );
}

/** Met à jour une annotation (patch partiel) et retourne la ligne à jour. */
export async function updateAnnotation(id: string, patch: AnnotationUpdate): Promise<AnnotationRow> {
  return queryOne("annotations.update", () =>
    getSupabaseClient().from(TABLE).update(patch).eq("id", id).select("*").single(),
  );
}

/** Supprime une annotation (les mesures liées passent annotation_id à NULL). */
export async function deleteAnnotation(id: string): Promise<boolean> {
  return queryExecuted("annotations.delete", () =>
    getSupabaseClient().from(TABLE).delete().eq("id", id),
  );
}
