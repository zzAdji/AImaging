/**
 * Session de développement pour la Phase Database 3 (SUITE.md §5).
 *
 * Mécanisme retenu (validé) — Option A :
 * - UN compte Supabase Auth réel dédié au développement ;
 * - connexion silencieuse (`signInWithPassword`) au premier accès à la base,
 *   uniquement lorsque Supabase est configuré dans client/.env ;
 * - aucune interface d'authentification n'est créée (pas d'écran login/signup) :
 *   l'Auth complète reste hors périmètre ;
 * - RLS intacte : toutes les policies `to authenticated` s'appliquent normalement,
 *   auth.uid() identifie le propriétaire ; aucun service_role côté navigateur.
 *
 * Variables attendues (voir client/.env.example, jamais commité) :
 *   VITE_DEV_AUTH_EMAIL
 *   VITE_DEV_AUTH_PASSWORD
 */

import { getSupabaseClient, isSupabaseConfigured } from "./supabaseClient";

/** Nom du workspace métier créé automatiquement par utilisateur. */
export const DEFAULT_WORKSPACE_NAME = "Default workspace";

const DEV_AUTH_EMAIL = import.meta.env.VITE_DEV_AUTH_EMAIL as string | undefined;
const DEV_AUTH_PASSWORD = import.meta.env.VITE_DEV_AUTH_PASSWORD as string | undefined;

/** Promesse partagée : une seule tentative de session par vie de page. */
let ensuredSession: Promise<string> | null = null;

/**
 * Garantit une session Auth active et retourne l'identifiant utilisateur
 * (auth.uid()). Lève une erreur explicite si les identifiants de développement
 * sont absents ou refusés — jamais d'échec silencieux.
 */
export function ensureDevSession(): Promise<string> {
  if (!isSupabaseConfigured) {
    return Promise.reject(
      new Error(
        "[db] Supabase n'est pas configuré : définissez VITE_SUPABASE_URL et " +
          "VITE_SUPABASE_PUBLISHABLE_KEY dans client/.env.",
      ),
    );
  }
  if (ensuredSession === null) {
    ensuredSession = (async () => {
      const client = getSupabaseClient();
      const { data, error } = await client.auth.getSession();
      if (error) {
        throw new Error(`[db] Lecture de session impossible : ${error.message}`);
      }
      if (data.session?.user) {
        return data.session.user.id;
      }
      if (!DEV_AUTH_EMAIL || !DEV_AUTH_PASSWORD) {
        throw new Error(
          "[db] Aucune session Auth et aucun compte de développement configuré : " +
            "renseignez VITE_DEV_AUTH_EMAIL et VITE_DEV_AUTH_PASSWORD dans client/.env " +
            "(compte créé au préalable dans le projet Supabase).",
        );
      }
      const { data: signedIn, error: signInError } = await client.auth.signInWithPassword({
        email: DEV_AUTH_EMAIL,
        password: DEV_AUTH_PASSWORD,
      });
      if (signInError || !signedIn.user) {
        throw new Error(
          `[db] Connexion du compte de développement impossible : ${
            signInError?.message ?? "utilisateur vide"
          }`,
        );
      }
      return signedIn.user.id;
    })().catch((exc: unknown) => {
      /* Permet une nouvelle tentative au prochain appel après correction env. */
      ensuredSession = null;
      throw exc;
    });
  }
  return ensuredSession;
}

/** Invalide la session mémorisée (tests, déconnexion future). */
export function resetDevSession(): void {
  ensuredSession = null;
}
