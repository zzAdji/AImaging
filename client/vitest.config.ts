import { defineConfig } from "vitest/config";

/**
 * Configuration de tests isolée du build applicatif :
 * - les tests vivent dans client/tests/ (hors tsconfig.app.json) ;
 * - environnement node : la couche db est testée avec un client Supabase mocké,
 *   sans base ni réseau (SUITE.md §16 ; l'intégration réelle reste documentée
 *   comme non exécutable tant que la base/Auth de dev ne sont pas provisionnées).
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    restoreMocks: true,
    /* Les suites LIVE enchaînent plusieurs allers-retours réseau Supabase
       (auth A/B + CRUD multi-tables + Storage) : 5 s par défaut suffisent
       à peine et provoquent des timeouts artificiels (bd.log §29/§23). */
    testTimeout: 30_000,
    hookTimeout: 15_000,
  },
});
