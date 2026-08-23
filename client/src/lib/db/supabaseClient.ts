/**
 * Client Supabase unique de l'application (FONDATION.md §24).
 *
 * Règles :
 * - un seul module crée le client ; aucun composant ne doit appeler
 *   createClient() directement ;
 * - uniquement VITE_SUPABASE_URL et VITE_SUPABASE_PUBLISHABLE_KEY (clé
 *   publiable). La clé service_role est INTERDITE côté frontend ;
 * - initialisation paresseuse : l'application démarre et fonctionne
 *   exactement comme aujourd'hui (localStorage) tant que Supabase n'est pas
 *   configuré dans client/.env.
 */

import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

/** true lorsque les deux variables d'environnement sont présentes. */
export const isSupabaseConfigured: boolean =
  typeof SUPABASE_URL === "string" && SUPABASE_URL.length > 0 &&
  typeof SUPABASE_PUBLISHABLE_KEY === "string" && SUPABASE_PUBLISHABLE_KEY.length > 0;

function buildClient() {
  // Non-null sûr : appelé uniquement après la garde isSupabaseConfigured.
  return createClient<Database>(SUPABASE_URL as string, SUPABASE_PUBLISHABLE_KEY as string, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
  });
}

/** Type public du client partagé (inféré, pour rester aligné sur supabase-js). */
export type AimagingSupabaseClient = ReturnType<typeof buildClient>;

let cachedClient: AimagingSupabaseClient | null = null;

/**
 * Retourne le client Supabase partagé. Lève une erreur explicite si les
 * variables d'environnement manquent — jamais d'échec silencieux.
 */
export function getSupabaseClient(): AimagingSupabaseClient {
  if (!isSupabaseConfigured) {
    throw new Error(
      "[db] Supabase n'est pas configuré : définissez VITE_SUPABASE_URL et " +
        "VITE_SUPABASE_PUBLISHABLE_KEY dans client/.env (voir client/.env.example).",
    );
  }
  if (cachedClient === null) {
    cachedClient = buildClient();
  }
  return cachedClient;
}

