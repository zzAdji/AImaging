/**
 * Garde-fou de nettoyage localStorage — Phase Database 9 (§15).
 *
 * RÈGLE : aucune donnée locale n'est supprimée tant que sa contrepartie
 * Supabase n'est pas CONFIRMÉE (comptes locaux vs distants comparés).
 *
 * Utilisation prévue (après provisionnement live 9A) :
 *   const decision = evaluateCleanup({ local: countsFromCache(), remote: countsFromSupabase() });
 *   if (decision.safe) { // purge autorisée, entité par entité
 *     // ...
 *   }
 *
 * Aucune suppression automatique ici : ce module DÉCIDE, il ne détruit pas.
 */

export interface StorageCounts {
  examinations: number;
  images: number;
  annotations: number;
  measurements: number;
  analysisRuns: number;
  reports: number;
}

export type EntityName = keyof StorageCounts;

export interface CleanupDecision {
  safe: boolean;
  /** Entités dont la contrepartie Supabase couvre au moins le local. */
  approved: EntityName[];
  /** Entités refusées avec l'écart constaté (local − distant > 0). */
  blocked: Array<{ entity: EntityName; localCount: number; remoteCount: number }>;
}

/** Compare local vs Supabase entité par entité ; strict : tout déficit bloque. */
export function evaluateCleanup(local: StorageCounts, remote: StorageCounts): CleanupDecision {
  const approved: EntityName[] = [];
  const blocked: CleanupDecision["blocked"] = [];
  for (const entity of Object.keys(local) as EntityName[]) {
    if (remote[entity] >= local[entity]) {
      approved.push(entity);
    } else {
      blocked.push({ entity, localCount: local[entity], remoteCount: remote[entity] });
    }
  }
  return { safe: blocked.length === 0, approved, blocked };
}

/**
 * Génère la sauvegarde JSON locale obligatoire AVANT toute suppression (§15.1).
 * Le blob retourné doit être téléchargé/vérifié par l'appelant.
 */
export function buildLegacyBackupPayload(
  userId: string | null,
  legacyExams: unknown[],
  extras: Record<string, unknown>,
): { exportedAt: string; userId: string | null; examinations: unknown[]; extras: Record<string, unknown> } {
  return {
    exportedAt: new Date().toISOString(),
    userId,
    examinations: legacyExams,
    extras,
  };
}
