/**
 * Service d'authentification Supabase — Phase Database 8.
 *
 * - UN SEUL listener onAuthStateChange pour toute l'application (§7) ;
 * - la session Supabase est l'unique source d'identité ; `aimaging.session`
 *   n'est plus lu ni écrit (§10) ;
 * - pas de mécanique maison de remember-me : supabase-js persiste la session ;
 * - erreurs traduites en messages utilisateur clairs (§5), jamais d'exception
 *   brute Supabase remontée à l'UI ;
 * - le profile est lu après authentification (RLS select own) — jamais
 *   d'écriture de mot de passe ni de second système user (§11).
 *
 * Le contrôleur est découplé de React (injectable dans les tests) ; le
 * composant `AuthProvider` n'est qu'un adaptateur fin.
 */

import { getSupabaseClient, isSupabaseConfigured } from "./supabaseClient";

export interface AuthSnapshot {
  userId: string | null;
  email: string | null;
  displayName: string | null;
}

export interface AuthServiceDeps {
  getClient: () => {
    auth: {
      getSession: () => PromiseLike<{
        data: { session: { user: { id: string; email?: string | null } | null } | null };
        error: { message: string } | null;
      }>;
      signInWithPassword: (credentials: { email: string; password: string }) => PromiseLike<{
        data: { user: { id: string; email?: string | null } | null };
        error: { message: string; status?: number } | null;
      }>;
      signOut: () => PromiseLike<{ error: { message: string } | null }>;
      resetPasswordForEmail: (email: string) => PromiseLike<{ error: { message: string } | null }>;
      onAuthStateChange: (
        callback: (
          event: string,
          sessionPayload: { user: { id: string; email?: string | null } | null } | null,
        ) => void,
      ) => { data: { subscription: { unsubscribe: () => void } } };
    };
    from: (table: "profiles") => {
      select: (columns: string) => {
        eq: (column: string, value: string) => PromiseLike<{
          data: Array<{ display_name: string | null }> | null;
          error: { message: string } | null;
        }>;
      };
    };
  };
  isConfigured: () => boolean;
}

export const FRIENDLY_ERRORS: Array<{ match: RegExp; message: string }> = [
  { match: /invalid login credentials/i, message: "Email ou mot de passe incorrect." },
  { match: /email not confirmed/i, message: "Votre adresse email n'a pas encore été confirmée. Vérifiez votre boîte de réception." },
  { match: /too many requests|rate limit/i, message: "Trop de tentatives. Réessayez dans quelques minutes." },
  { match: /failed to fetch|network|load failed/i, message: "Service d'authentification injoignable. Vérifiez votre connexion." },
];

export function friendlyAuthError(raw: string): string {
  for (const rule of FRIENDLY_ERRORS) {
    if (rule.match.test(raw)) return rule.message;
  }
  return "Connexion impossible pour le moment. Réessayez.";
}

/* ------------------------------ Contrôleur ---------------------------------- */

export interface AuthController {
  getSnapshot: () => AuthSnapshot;
  subscribe: (listener: (snapshot: AuthSnapshot) => void) => () => void;
  bootstrap: () => Promise<AuthSnapshot>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
}

export function createAuthService(deps: AuthServiceDeps): AuthController {
  let snapshot: AuthSnapshot = { userId: null, email: null, displayName: null };
  const listeners = new Set<(snapshot: AuthSnapshot) => void>();
  let listenerRegistered = false;

  function setSnapshot(next: Partial<AuthSnapshot>): void {
    snapshot = { ...snapshot, ...next };
    for (const listener of listeners) listener(snapshot);
  }

  async function fetchDisplayName(userId: string): Promise<string | null> {
    try {
      const { data, error } = await deps.getClient().from("profiles").select("display_name").eq("id", userId);
      if (error !== null || data === null || data.length === 0) return null;
      return data[0].display_name ?? null;
    } catch {
      /* Le profile est un enrichissement : son absence ne bloque pas l'identité. */
      return null;
    }
  }

  function applySessionUser(
    user: { id: string; email?: string | null } | null,
    previousDisplayName?: string | null,
  ): Promise<void> {
    if (user === null) {
      setSnapshot({ userId: null, email: null, displayName: null });
      return Promise.resolve();
    }
    const sameUser = snapshot.userId === user.id;
    setSnapshot({
      userId: user.id,
      email: user.email ?? null,
      displayName: sameUser ? (snapshot.displayName ?? previousDisplayName ?? null) : null,
    });
    return fetchDisplayName(user.id).then((displayName) => {
      if (snapshot.userId === user.id && displayName !== null) setSnapshot({ displayName });
    });
  }

  /** Enregistre le listener centralisé au premier besoin (§7 — jamais par composant). */
  function ensureListener(): void {
    if (listenerRegistered) return;
    listenerRegistered = true;
    deps.getClient().auth.onAuthStateChange((event, sessionPayload) => {
      if (event === "SIGNED_OUT") {
        setSnapshot({ userId: null, email: null, displayName: null });
        return;
      }
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
        applySessionUser(sessionPayload?.user ?? null);
      }
    });
  }

  return {
    getSnapshot: () => snapshot,

    subscribe(listener) {
      listeners.add(listener);
      ensureListener();
      return () => listeners.delete(listener);
    },

    async bootstrap() {
      if (!deps.isConfigured()) {
        /* Hors configuration : identité anonyme, aucun accès client requis. */
        setSnapshot({ userId: null, email: null, displayName: null });
        return snapshot;
      }
      ensureListener();
      const { data, error } = await deps.getClient().auth.getSession();
      if (error !== null) throw new Error(friendlyAuthError(error.message));
      await applySessionUser(data.session?.user ?? null);
      return snapshot;
    },

    async signIn(email: string, password: string) {
      const { data, error } = await deps.getClient().auth.signInWithPassword({ email, password });
      if (error !== null || data.user === null) {
        throw new Error(friendlyAuthError(error?.message ?? "utilisateur vide"));
      }
      await applySessionUser(data.user);
    },

    async signOut() {
      /* Ne supprime ni les données Supabase, ni les caches locaux (§17). */
      const { error } = await deps.getClient().auth.signOut();
      if (error !== null) throw new Error(friendlyAuthError(error.message));
      setSnapshot({ userId: null, email: null, displayName: null });
    },

    async sendPasswordReset(email: string) {
      const { error } = await deps.getClient().auth.resetPasswordForEmail(email);
      if (error !== null) throw new Error(friendlyAuthError(error.message));
    },
  };
}

/* ------------------------- Instance applicative ----------------------------- */

function realDeps(): AuthServiceDeps {
  const getClient = (): ReturnType<AuthServiceDeps["getClient"]> =>
    getSupabaseClient() as unknown as ReturnType<AuthServiceDeps["getClient"]>;
  return { getClient, isConfigured: () => isSupabaseConfigured };
}

/** Singleton applicatif — consommé par AuthProvider. */
export const authService = createAuthService(realDeps());
