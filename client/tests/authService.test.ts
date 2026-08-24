/**
 * Tests Phase Database 8 — authentification (SUITE.md §22).
 * Supabase entièrement mocké via des deps injectées ; les tests RLS réels
 * vivent dans tests/live/ (jamais considérés comme couverts par ces mocks).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAuthService, type AuthServiceDeps, type AuthSnapshot } from "../src/lib/db/authService";

interface Harness {
  controller: ReturnType<typeof createAuthService>;
  snapshots: AuthSnapshot[];
  sessionUser: { id: string; email: string } | null;
  signInError: { message: string; status?: number } | null;
  profileDisplayName: string | null;
  listenerEvents: Array<[string, unknown]>;
}

function makeHarness(): Harness {
  const h: Harness = {
    controller: null as never,
    snapshots: [],
    sessionUser: null,
    signInError: null,
    profileDisplayName: "Dr A",
    listenerEvents: [],
  };
  const deps: AuthServiceDeps = {
    isConfigured: () => true,
    getClient: () =>
      ({
        auth: {
          getSession: async () => ({
            data: { session: { user: h.sessionUser } },
            error: null,
          }),
          signInWithPassword: async ({ email }: { email: string }) => {
            if (h.signInError !== null) return { data: { user: null }, error: h.signInError };
            h.sessionUser = { id: email.startsWith("b@") ? "user-b" : "user-a", email };
            return { data: { user: h.sessionUser }, error: null };
          },
          signOut: async () => {
            h.sessionUser = null;
            return { error: null };
          },
          resetPasswordForEmail: async () => ({ error: null }),
          onAuthStateChange: (callback) => {
            /* Le mock rejoue le comportement supabase-js : le callback
               enregistré est rappelé par nos simulations d'événements. */
            h.listenerEvents.push(["__registered", null]);
            (h as unknown as { __notify: (event: string) => void }).__notify = (event: string) => {
              callback(event, { user: h.sessionUser });
            };
            return { data: { subscription: { unsubscribe: () => undefined } } };
          },
        },
        from: () => ({
          select: () => ({
            eq: async () => ({
              data: [{ display_name: h.profileDisplayName }],
              error: null,
            }),
          }),
        }),
      }) as unknown as AuthServiceDeps["getClient"] extends () => infer T ? T : never,
    };
  h.controller = createAuthService(deps);
  h.controller.subscribe((snapshot) => h.snapshots.push(snapshot));
  return h;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("restauration de session (§6)", () => {
  it("session existante au démarrage ⇒ utilisateur authentifié + display_name", async () => {
    const harness = makeHarness();
    harness.sessionUser = { id: "user-a", email: "a@test.org" };

    const snapshot = await harness.controller.bootstrap();

    expect(snapshot.userId).toBe("user-a");
    expect(snapshot.email).toBe("a@test.org");
    expect(snapshot.displayName).toBe("Dr A"); // lu dans profiles (RLS own)
    expect(harness.controller.getSnapshot().userId).toBe("user-a");
  });

  it("pas de session ⇒ snapshot anonyme (isAuthenticated=false)", async () => {
    const harness = makeHarness();
    const snapshot = await harness.controller.bootstrap();
    expect(snapshot.userId).toBeNull();
    expect(harness.controller.getSnapshot().userId).toBeNull();
  });
});

describe("login (§5)", () => {
  it("succès : snapshot authentifié, message d'erreur absent", async () => {
    const harness = makeHarness();
    await harness.controller.bootstrap();
    await harness.controller.signIn("a@test.org", "secret");
    expect(harness.controller.getSnapshot().userId).toBe("user-a");
  });

  it("mauvais identifiants ⇒ erreur FR claire (jamais l'exception brute)", async () => {
    const harness = makeHarness();
    await harness.controller.bootstrap();
    harness.signInError = { message: "Invalid login credentials" };
    await expect(harness.controller.signIn("a@test.org", "wrong")).rejects.toThrow(
      "Email ou mot de passe incorrect.",
    );
  });

  it("email non confirmé ⇒ message dédié", async () => {
    const harness = makeHarness();
    await harness.controller.bootstrap();
    harness.signInError = { message: "Email not confirmed" };
    await expect(harness.controller.signIn("a@test.org", "x")).rejects.toThrow(
      "n'a pas encore été confirmée",
    );
  });
});

describe("logout + auth state change (§7/§17)", () => {
  it("signOut réinitialise le snapshot ; SIGNED_IN via listener met à jour", async () => {
    const harness = makeHarness();
    await harness.controller.bootstrap();
    harness.sessionUser = { id: "user-a", email: "a@test.org" };
    await harness.controller.signIn("a@test.org", "secret");
    expect(harness.controller.getSnapshot().userId).toBe("user-a");

    await harness.controller.signOut();
    expect(harness.controller.getSnapshot().userId).toBeNull();

    /* Changement d'utilisateur simulé par un événement push du mock. */
    harness.sessionUser = { id: "user-b", email: "b@test.org" };
    const notify = (harness as unknown as { __notify?: (event: string) => void }).__notify;
    expect(typeof notify).toBe("function");
    notify!("SIGNED_IN");
    expect(harness.controller.getSnapshot().userId).toBe("user-b");
    expect(harness.controller.getSnapshot().displayName).not.toBe("Dr A"); // pas de fuite de profile
  });

  it("un seul enregistrement de listener malgré plusieurs subscribe (§7)", async () => {
    const harness = makeHarness();
    const unsubscribe = harness.controller.subscribe(() => undefined);
    harness.controller.subscribe(() => undefined);
    const registrations = harness.listenerEvents.filter(([event]) => event === "__registered");
    expect(registrations.length).toBeLessThanOrEqual(1);
    unsubscribe();
  });
});

describe("hors configuration Supabase", () => {
  it("bootstrap reste anonyme sans lever (comportement local-only)", async () => {
    /* Harness minimal avec isConfigured=false. */
    const deps: AuthServiceDeps = {
      isConfigured: () => false,
      getClient: () => {
        throw new Error("ne doit pas être appelé.");
      },
    } as unknown as AuthServiceDeps;
    const controller = createAuthService(deps);
    const snapshot = await controller.bootstrap();
    expect(snapshot.userId).toBeNull();
  });
});

