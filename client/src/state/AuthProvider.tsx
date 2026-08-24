/**
 * AuthProvider — Phase Database 8 (SUITE.md §8).
 * Adaptateur React minimal autour du service d'authentification centralisé.
 * Les composants consomment useAuth() : isAuthenticated sans jamais lire
 * localStorage ; un seul listener d'état pour toute l'app (dans authService).
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { authService } from "../lib/db/authService";

export interface AuthContextValue {
  /** auth.uid() de l'utilisateur connecté ; null sinon. */
  userId: string | null;
  email: string | null;
  displayName: string | null;
  /** true pendant la restauration initiale de session (§6). */
  loading: boolean;
  isAuthenticated: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState(authService.getSnapshot());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const unsubscribe = authService.subscribe((next) => {
      if (!cancelled) setSnapshot(next);
    });
    void authService
      .bootstrap()
      .then((next) => {
        if (!cancelled) setSnapshot(next);
      })
      .catch((exc: unknown) => console.error("[auth] Restauration de session impossible.", exc))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      userId: snapshot.userId,
      email: snapshot.email,
      displayName: snapshot.displayName,
      loading,
      isAuthenticated: snapshot.userId !== null,
      signIn: authService.signIn,
      signOut: authService.signOut,
      sendPasswordReset: authService.sendPasswordReset,
    }),
    [snapshot, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Accès au contexte d'authentification — jamais de lecture localStorage directe (§8). */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
