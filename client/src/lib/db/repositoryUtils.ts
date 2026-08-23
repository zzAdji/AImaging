/**
 * Utilitaires partagés des repositories (FONDATION.md §25).
 *
 * Règle absolue : AUCUN catch {} silencieux. Toute erreur PostgREST est
 * journalisée proprement puis propagée avec un contexte lisible.
 */

import type { PostgrestError } from "@supabase/supabase-js";

/** Résultat brut d'une requête supabase-js v2. */
interface QueryResult<T> {
  data: T | null;
  error: PostgrestError | null;
  /** Statut HTTP PostgREST (présent sur les builders supabase-js). */
  status?: number;
}

/** Journalise puis propage une erreur avec le contexte de l'opération. */
export function throwDbError(label: string, error: PostgrestError): never {
  console.error(`[db] ${label} a échoué (${error.code}) : ${error.message}`, error.details);
  throw new Error(`${label} : ${error.message}`);
}

/**
 * Exécute une opération devant retourner exactement UNE ligne
 * (.select("*").single()) — erreur si la ligne est absente.
 */
export async function queryOne<T>(
  label: string,
  operation: () => PromiseLike<QueryResult<T>>,
): Promise<T> {
  const { data, error } = await operation();
  if (error) return throwDbError(label, error);
  if (data === null) {
    console.error(`[db] ${label} : aucune ligne retournée.`);
    throw new Error(`${label} : aucune ligne retournée.`);
  }
  return data;
}

/**
 * Exécute une opération retournant ZÉRO ou UNE ligne (.maybeSingle()).
 * Retourne null sans erreur quand la ligne est absente.
 */
export async function queryMaybeOne<T>(
  label: string,
  operation: () => PromiseLike<QueryResult<T>>,
): Promise<T | null> {
  const { data, error } = await operation();
  if (error) return throwDbError(label, error);
  return data;
}

/**
 * Exécute une opération retournant PLUSIEURS lignes (.select("*") sans .single()).
 */
export async function queryMany<T>(
  label: string,
  operation: () => PromiseLike<QueryResult<T[]>>,
): Promise<T[]> {
  const { data, error } = await operation();
  if (error) return throwDbError(label, error);
  return data ?? [];
}

/**
 * Exécute une opération sans résultat (insert/update/delete sans select).
 * Retourne true lorsque la mutation a bien été appliquée.
 */
export async function queryExecuted(
  label: string,
  operation: () => PromiseLike<QueryResult<unknown>>,
): Promise<boolean> {
  const { error, status } = await operation();
  if (error) return throwDbError(label, error);
  if (status !== undefined && status >= 400) {
    console.error(`[db] ${label} : statut HTTP inattendu ${status}.`);
    throw new Error(`${label} : statut HTTP inattendu ${status}.`);
  }
  return true;
}
