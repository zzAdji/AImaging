/**
 * workspaceRepository — CRUD de la table `workspaces` (FONDATION.md §25).
 *
 * Couche d'accès aux données SANS branchement UI : aucun composant existant
 * n'appelle ce module pendant la phase Fondation.
 */

import { getSupabaseClient } from "../supabaseClient";
import type { WorkspaceInsert, WorkspaceRow, WorkspaceUpdate } from "../types";
import { queryExecuted, queryMany, queryMaybeOne, queryOne } from "../repositoryUtils";

const TABLE = "workspaces" as const;

/** Crée un espace de travail pour le propriétaire donné. */
export async function createWorkspace(values: WorkspaceInsert): Promise<WorkspaceRow> {
  return queryOne("workspaces.insert", () =>
    getSupabaseClient().from(TABLE).insert(values).select("*").single(),
  );
}

/** Lit un espace par son identifiant ; null si absent. */
export async function getWorkspace(id: string): Promise<WorkspaceRow | null> {
  return queryMaybeOne("workspaces.get", () =>
    getSupabaseClient().from(TABLE).select("*").eq("id", id).maybeSingle(),
  );
}

/** Liste les espaces d'un propriétaire, du plus récent au plus ancien. */
export async function listWorkspacesByOwner(ownerId: string): Promise<WorkspaceRow[]> {
  return queryMany("workspaces.list", () =>
    getSupabaseClient().from(TABLE).select("*").eq("owner_id", ownerId).order("created_at", { ascending: false }),
  );
}

/** Met à jour un espace (patch partiel) et retourne la ligne à jour. */
export async function updateWorkspace(id: string, patch: WorkspaceUpdate): Promise<WorkspaceRow> {
  return queryOne("workspaces.update", () =>
    getSupabaseClient().from(TABLE).update(patch).eq("id", id).select("*").single(),
  );
}

/** Supprime un espace (cascade sur examens → images → analyses). */
export async function deleteWorkspace(id: string): Promise<boolean> {
  return queryExecuted("workspaces.delete", () =>
    getSupabaseClient().from(TABLE).delete().eq("id", id),
  );
}
