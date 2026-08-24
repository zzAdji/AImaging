/**
 * organizationRepository — contexte établissement réutilisable
 * (INSTRUCTIONS.md §12/§14). Une ligne par propriétaire (unique owner_id).
 */

import { getSupabaseClient } from "../supabaseClient";
import type { OrganizationInsert, OrganizationRow, OrganizationUpdate } from "../types";
import { queryMaybeOne, queryOne } from "../repositoryUtils";

const TABLE = "organizations" as const;

export async function upsertOrganization(values: OrganizationInsert): Promise<OrganizationRow> {
  return queryOne("organizations.upsert", () =>
    getSupabaseClient()
      .from(TABLE)
      .upsert(values, { onConflict: "owner_id" })
      .select("*")
      .single(),
  );
}

/** Organisation du propriétaire connecté (RLS own) ; null si non renseignée. */
export async function getMyOrganization(): Promise<OrganizationRow | null> {
  return queryMaybeOne("organizations.get_mine", () =>
    getSupabaseClient().from(TABLE).select("*").limit(1).maybeSingle(),
  );
}

export async function updateOrganization(
  id: string,
  patch: OrganizationUpdate,
): Promise<OrganizationRow> {
  return queryOne("organizations.update", () =>
    getSupabaseClient().from(TABLE).update(patch).eq("id", id).select("*").single(),
  );
}
