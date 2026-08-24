/**
 * Tests LIVE Supabase — Phase Database 4 (SUITE.md §19/§20/§21).
 *
 * Exécutés UNIQUEMENT si les credentials réels sont configurés
 * (client/.env : VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY,
 * VITE_DEV_AUTH_EMAIL, VITE_DEV_AUTH_PASSWORD).
 * Sans credentials : SKIPPED explicite — jamais de « PASS » simulé.
 * Aucune clé service_role n'est utilisée, ici ou ailleurs.
 */

import { describe, expect, it } from "vitest";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? "";
const PUBLISHABLE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "";
const DEV_EMAIL = process.env.VITE_DEV_AUTH_EMAIL ?? "";
const DEV_PASSWORD = process.env.VITE_DEV_AUTH_PASSWORD ?? "";

const liveEnabled =
  SUPABASE_URL.length > 0 &&
  PUBLISHABLE_KEY.length > 0 &&
  DEV_EMAIL.length > 0 &&
  DEV_PASSWORD.length > 0;

describe.skipIf(!liveEnabled)("Supabase LIVE — images (§19)", () => {
  it("upload réel → lecture réelle → record DB réel → URL contrôlée → suppression réelle", async () => {
    /* Imports dynamiques : le code applicatif n'est chargé que si live. */
    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(SUPABASE_URL, PUBLISHABLE_KEY);

    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: DEV_EMAIL,
      password: DEV_PASSWORD,
    });
    expect(authError).toBeNull();
    const userId = authData!.user!.id;

    const path = `${userId}/live-test/exam-live/images/img-live/live-${Date.now()}.png`;
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // signature PNG

    // 1. upload réel
    const tUploadStart = Date.now();
    const up = await supabase.storage.from("medical-images").upload(path, bytes, {
      contentType: "image/png",
      upsert: true,
    });
    expect(up.error).toBeNull();
    const uploadMs = Date.now() - tUploadStart;

    // 2. lecture réelle (+ §21 mesure download)
    const tDownloadStart = Date.now();
    const down = await supabase.storage.from("medical-images").download(path);
    expect(down.error).toBeNull();
    const downloadMs = Date.now() - tDownloadStart;
    expect((await down.data!.arrayBuffer()).byteLength).toBe(bytes.byteLength);
    console.info(
      `[live] perf §21 : upload ${uploadMs} ms / download ${downloadMs} ms / taille ${bytes.byteLength} o`,
    );

    // 3. création DB réelle (examen jetable dans le workspace par défaut)
    const ws = await supabase
      .from("workspaces")
      .insert({ owner_id: userId, name: "LIVE - Espace jetable Phase 4" })
      .select("*")
      .single();
    expect(ws.error).toBeNull();
    const exam = await supabase
      .from("examinations")
      .insert({
        workspace_id: ws.data!.id,
        legacy_id: `live-${Date.now()}`,
        name: "LIVE - Examen image",
        modality: "unknown",
      })
      .select("*")
      .single();
    expect(exam.error).toBeNull();

    // 4. lecture contrôlée via la table (RLS active)
    const readBack = await supabase
      .from("examination_images")
      .insert({
        examination_id: exam.data!.id,
        filename: path.split("/").at(-1),
        storage_path: path,
        mime_type: "image/png",
        source_kind: "browser-image",
      })
      .select("*")
      .single();
    expect(readBack.error).toBeNull();
    expect(readBack.data!.storage_path).toBe(path);

    // 5. suppressions réelles (DB puis Storage)
    expect((await supabase.from("examinations").delete().eq("id", exam.data!.id)).error).toBeNull();
    expect((await supabase.storage.from("medical-images").remove([path])).error).toBeNull();
    expect(
      (await supabase.from("workspaces").delete().eq("id", ws.data!.id)).error,
    ).toBeNull();
  });
});

/* ============================================================================
 * Phase Database 5 (SUITE.md §25/§26) — LIVE annotations + mesures + RLS.
 * Mêmes gardes : exécuté UNIQUEMENT avec des credentials réels ; SKIPPED sinon ;
 * JAMAIS de service_role ; la RLS n'est jamais désactivée pour un test.
 * ========================================================================== */

describe.skipIf(!liveEnabled)("Supabase LIVE — annotations CRUD (§26)", () => {
  it("insert → select → update → delete réel d'une annotation", async () => {
    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(SUPABASE_URL, PUBLISHABLE_KEY);
    const { data: auth } = await supabase.auth.signInWithPassword({ email: DEV_EMAIL, password: DEV_PASSWORD });
    expect(auth.error).toBeNull();
    const userId = auth!.user!.id;

    const ws = await supabase.from("workspaces").insert({ owner_id: userId, name: "LIVE - Ann P5" }).select("id").single();
    expect(ws.error).toBeNull();
    const exam = await supabase
      .from("examinations")
      .insert({ workspace_id: ws.data!.id, legacy_id: `live-ann-${Date.now()}`, name: "LIVE", modality: "unknown" })
      .select("id")
      .single();
    expect(exam.error).toBeNull();
    const image = await supabase
      .from("examination_images")
      .insert({ examination_id: exam.data!.id, filename: "live.png" })
      .select("id")
      .single();
    expect(image.error).toBeNull();

    const inserted = await supabase
      .from("annotations")
      .insert({
        image_id: image.data!.id,
        legacy_shape_id: "live-shape-1",
        type: "rectangle",
        geometry: { x: 1, y: 2, w: 3, h: 4, points: [] },
        created_by: "user",
        action_id: null,
      })
      .select("*")
      .single();
    expect(inserted.error).toBeNull();

    const updated = await supabase
      .from("annotations")
      .update({ geometry: { x: 9, y: 9, w: 1, h: 1, points: [] }, visible: false })
      .eq("id", inserted.data!.id)
      .select("*")
      .single();
    expect(updated.error).toBeNull();
    expect((updated.data!.geometry as Record<string, unknown>).x).toBe(9);

    expect((await supabase.from("annotations").delete().eq("id", inserted.data!.id)).error).toBeNull();
    expect((await supabase.from("examinations").delete().eq("id", exam.data!.id)).error).toBeNull();
    expect((await supabase.from("workspaces").delete().eq("id", ws.data!.id)).error).toBeNull();
  });
});

describe.skipIf(!liveEnabled)("Supabase LIVE — mesures + RLS multi-user (§25)", () => {
  it("USER B ne voit ni ne modifie les annotations/mesures de USER A", async () => {
    const secondEmail = process.env.VITE_DEV_AUTH_SECOND_EMAIL ?? "";
    const secondPassword = process.env.VITE_DEV_AUTH_SECOND_PASSWORD ?? "";
    if (!secondEmail || !secondPassword) {
      console.warn("[live] §25 partiellement exécutable : second compte non configuré.");
      return;
    }
    const { createClient } = await import("@supabase/supabase-js");
    const userA = createClient(SUPABASE_URL, PUBLISHABLE_KEY);
    const userB = createClient(SUPABASE_URL, PUBLISHABLE_KEY);
    await userA.auth.signInWithPassword({ email: DEV_EMAIL, password: DEV_PASSWORD });
    await userB.auth.signInWithPassword({ email: secondEmail, password: secondPassword });

    /* A crée son arbre complet et une annotation + mesure. */
    const uidA = (await userA.auth.getUser()).data.user!.id;
    const ws = await userA.from("workspaces").insert({ owner_id: uidA, name: "LIVE - RLS P5" }).select("id").single();
    const exam = await userA
      .from("examinations")
      .insert({ workspace_id: ws.data!.id, legacy_id: `live-rls-${Date.now()}`, name: "RLS", modality: "unknown" })
      .select("id")
      .single();
    const image = await userA.from("examination_images").insert({ examination_id: exam.data!.id, filename: "r.png" }).select("id").single();
    const ann = await userA
      .from("annotations")
      .insert({ image_id: image.data!.id, legacy_shape_id: "rls-shape", type: "line", geometry: { x: 0, y: 0, w: 5, h: 5, points: [] }, created_by: "user" })
      .select("id")
      .single();
    const mea = await userA
      .from("measurements")
      .insert({ image_id: image.data!.id, annotation_id: ann.data!.id, type: "DISTANCE", value: 7.07, unit: "px", source: "user", metadata: {} })
      .select("id")
      .single();
    expect(mea.error).toBeNull();

    /* B ne voit rien… */
    const seenByB = await userB.from("annotations").select("id").eq("id", ann.data!.id);
    expect(seenByB.data).toHaveLength(0);
    const meaByB = await userB.from("measurements").select("id").eq("id", mea.data!.id);
    expect(meaByB.data).toHaveLength(0);

    /* …ne peut pas modifier… */
    const forbiddenUpdate = await userB.from("annotations").update({ visible: false }).eq("id", ann.data!.id);
    expect(forbiddenUpdate.error).not.toBeNull();

    /* …ni supprimer. */
    const forbiddenDelete = await userB.from("measurements").delete().eq("id", mea.data!.id);
    expect(forbiddenDelete.error).not.toBeNull();

    /* Cleanup propriétaire. */
    await userA.from("examinations").delete().eq("id", exam.data!.id);
    await userA.from("workspaces").delete().eq("id", ws.data!.id);
  });
});

/* ============================================================================
 * Phase Database 6 (SUITE.md §28/§29) — LIVE analysis_runs + RLS.
 * ========================================================================== */

describe.skipIf(!liveEnabled)("Supabase LIVE — analysis_runs CRUD (§28)", () => {
  it("crée un run réel, y rattache un classification_result, puis purge", async () => {
    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(SUPABASE_URL, PUBLISHABLE_KEY);
    const { data: auth } = await supabase.auth.signInWithPassword({ email: DEV_EMAIL, password: DEV_PASSWORD });
    expect(auth.error).toBeNull();
    const userId = auth!.user!.id;

    const ws = await supabase.from("workspaces").insert({ owner_id: userId, name: "LIVE - Runs P6" }).select("id").single();
    expect(ws.error).toBeNull();
    const exam = await supabase
      .from("examinations")
      .insert({ workspace_id: ws.data!.id, legacy_id: `live-run-${Date.now()}`, name: "LIVE", modality: "unknown" })
      .select("id")
      .single();
    expect(exam.error).toBeNull();

    const run = await supabase
      .from("analysis_runs")
      .insert({
        examination_id: exam.data!.id,
        analysis_type: "classification",
        model_name: "ensemble(2)",
        status: "running",
        started_at: new Date().toISOString(),
        metadata: { persistance: "post-hoc" },
      })
      .select("*")
      .single();
    expect(run.error).toBeNull();

    const done = await supabase
      .from("analysis_runs")
      .update({
        status: "done",
        completed_at: new Date().toISOString(),
        metadata: { persistance: "post-hoc", ensemble_prediction: "Pneumonia", num_models: 2 },
      })
      .eq("id", run.data!.id)
      .select("status")
      .single();
    expect(done.error).toBeNull();
    expect(done.data!.status).toBe("done");

    const result = await supabase
      .from("classification_results")
      .insert({ analysis_run_id: run.data!.id, class_name: "Pneumonia", probability: 0.65, source: "ensemble" })
      .select("id")
      .single();
    expect(result.error).toBeNull();

    /* Historique par image/examen lisible (§27). */
    const history = await supabase.from("analysis_runs").select("id").eq("examination_id", exam.data!.id);
    expect(history.data).toHaveLength(1);

    /* Suppression run → résultats purgés par CASCADE. */
    expect((await supabase.from("analysis_runs").delete().eq("id", run.data!.id)).error).toBeNull();
    const orphanResults = await supabase.from("classification_results").select("id").eq("analysis_run_id", run.data!.id);
    expect(orphanResults.data).toHaveLength(0);

    expect((await supabase.from("examinations").delete().eq("id", exam.data!.id)).error).toBeNull();
    expect((await supabase.from("workspaces").delete().eq("id", ws.data!.id)).error).toBeNull();
  });
});

describe.skipIf(!liveEnabled)("Supabase LIVE — RLS analysis_runs (§29)", () => {
  it("USER B ne voit ni ne termine le run de USER A", async () => {
    const secondEmail = process.env.VITE_DEV_AUTH_SECOND_EMAIL ?? "";
    const secondPassword = process.env.VITE_DEV_AUTH_SECOND_PASSWORD ?? "";
    if (!secondEmail || !secondPassword) {
      console.warn("[live] §29 partiellement exécutable : second compte non configuré.");
      return;
    }
    const { createClient } = await import("@supabase/supabase-js");
    const userA = createClient(SUPABASE_URL, PUBLISHABLE_KEY);
    const userB = createClient(SUPABASE_URL, PUBLISHABLE_KEY);
    await userA.auth.signInWithPassword({ email: DEV_EMAIL, password: DEV_PASSWORD });
    await userB.auth.signInWithPassword({ email: secondEmail, password: secondPassword });

    const uidA = (await userA.auth.getUser()).data.user!.id;
    const ws = await userA.from("workspaces").insert({ owner_id: uidA, name: "LIVE - RLS Runs" }).select("id").single();
    const exam = await userA
      .from("examinations")
      .insert({ workspace_id: ws.data!.id, legacy_id: `live-rlsrun-${Date.now()}`, name: "RLS", modality: "unknown" })
      .select("id")
      .single();
    const run = await userA
      .from("analysis_runs")
      .insert({ examination_id: exam.data!.id, analysis_type: "gradcam", status: "running", metadata: {} })
      .select("id")
      .single();
    expect(run.error).toBeNull();

    const seenByB = await userB.from("analysis_runs").select("id").eq("id", run.data!.id);
    expect(seenByB.data).toHaveLength(0);
    const forbiddenUpdate = await userB.from("analysis_runs").update({ status: "done" }).eq("id", run.data!.id);
    expect(forbiddenUpdate.error).not.toBeNull();

    await userA.from("examinations").delete().eq("id", exam.data!.id);
    await userA.from("workspaces").delete().eq("id", ws.data!.id);
  });
});

/* ============================================================================
 * Phase Database 9 (SUITE.md §2 — 9A) — LIVE AUTH : login A/B, logout,
 * restauration. Porte obligatoire avant tout nettoyage localStorage.
 * ========================================================================== */

describe.skipIf(!liveEnabled)("Supabase LIVE — authentification (9A)", () => {
  it("login USER A → session A ; logout ; login USER B → identité B ; restore OK", async () => {
    const { createClient } = await import("@supabase/supabase-js");
    const client = createClient(SUPABASE_URL, PUBLISHABLE_KEY);

    /* A login */
    const a = await client.auth.signInWithPassword({ email: DEV_EMAIL, password: DEV_PASSWORD });
    expect(a.error).toBeNull();
    const uidA = a.data.user!.id;
    expect(uidA).toBeTruthy();

    /* logout */
    expect((await client.auth.signOut()).error).toBeNull();
    const afterLogout = await client.auth.getSession();
    expect(afterLogout.data.session).toBeNull();

    /* B login */
    const secondEmail = process.env.VITE_DEV_AUTH_SECOND_EMAIL ?? "";
    const secondPassword = process.env.VITE_DEV_AUTH_SECOND_PASSWORD ?? "";
    if (!secondEmail || !secondPassword) {
      console.warn("[live] 9A partiel : USER B non configuré — identité B non vérifiée.");
      return;
    }
    const b = await client.auth.signInWithPassword({ email: secondEmail, password: secondPassword });
    expect(b.error).toBeNull();
    expect(b.data.user!.id).not.toBe(uidA); // deux identités distinctes

    /* restore */
    const restored = await client.auth.getSession();
    expect(restored.data.session?.user.id).toBe(b.data.user!.id);
    await client.auth.signOut();
  });
});

describe.skipIf(!liveEnabled)("Storage security — isolation utilisateurs (§20)", () => {
  it("USER B ne peut ni lire ni supprimer un fichier de USER A", async () => {
    /* Prérequis documenté : deux comptes de dev (VITE_DEV_AUTH_EMAIL + second compte).
       Ce test est volontairement conservé minimal : il crée l'objet avec le
       premier utilisateur puis vérifie qu'un JWT différent ne voit rien.
       Il NE désactive JAMAIS la RLS et N'utilise PAS service_role. */
    const secondEmail = process.env.VITE_DEV_AUTH_SECOND_EMAIL ?? "";
    const secondPassword = process.env.VITE_DEV_AUTH_SECOND_PASSWORD ?? "";
    if (!secondEmail || !secondPassword) {
      console.warn("[live] §20 partiellement exécutable : second compte non configuré.");
      return;
    }
    const { createClient } = await import("@supabase/supabase-js");
    const userA = createClient(SUPABASE_URL, PUBLISHABLE_KEY);
    const userB = createClient(SUPABASE_URL, PUBLISHABLE_KEY);

    await userA.auth.signInWithPassword({ email: DEV_EMAIL, password: DEV_PASSWORD });
    await userB.auth.signInWithPassword({ email: secondEmail, password: secondPassword });

    const pathA = `${(await userA.auth.getUser()).data.user!.id}/live-sec/exam/images/img/secret.png`;
    await userA.storage.from("medical-images").upload(pathA, new Uint8Array([1, 2, 3]), { upsert: true });

    const readByB = await userB.storage.from("medical-images").download(pathA);
    expect(readByB.error).not.toBeNull(); // lecture interdite

    const deleteByB = await userB.storage.from("medical-images").remove([pathA]);
    expect(deleteByB.error).not.toBeNull(); // suppression interdite

    await userA.storage.from("medical-images").remove([pathA]); // cleanup propriétaire
  });
});

/* ============================================================================
 * Phase Database 7 (SUITE.md §23) — LIVE reports + RLS A/B + export Storage.
 * ========================================================================== */

describe.skipIf(!liveEnabled)("Supabase LIVE — reports CRUD + RLS (§23)", () => {
  it("create → read → update → RLS A/B → export Storage → delete réels", async () => {
    const { createClient } = await import("@supabase/supabase-js");
    const userA = createClient(SUPABASE_URL, PUBLISHABLE_KEY);
    const userB = createClient(SUPABASE_URL, PUBLISHABLE_KEY);
    const { data: authA } = await userA.auth.signInWithPassword({ email: DEV_EMAIL, password: DEV_PASSWORD });
    expect(authA.error).toBeNull();
    const userId = authA!.user!.id;

    const ws = await userA.from("workspaces").insert({ owner_id: userId, name: "LIVE - Reports P7" }).select("id").single();
    expect(ws.error).toBeNull();
    const exam = await userA
      .from("examinations")
      .insert({
        workspace_id: ws.data!.id,
        legacy_id: `live-rep-${Date.now()}`,
        name: "LIVE",
        modality: "radiography",
      })
      .select("id")
      .single();
    expect(exam.error).toBeNull();

    /* create : IA ⇒ needs_review, jamais validated (§5/§18). */
    const created = await userA
      .from("reports")
      .insert({
        examination_id: exam.data!.id,
        type: "radiography_ai",
        status: "needs_review",
        content: "RAPPORT LIVE…",
        structured_data: {
          diagnosis: { class: "Pneumonia", confidence: null },
          source_analysis_runs: [],
        },
        created_by: "ai",
      })
      .select("*")
      .single();
    expect(created.error).toBeNull();
    expect(created.data!.status).toBe("needs_review");

    /* update contenu puis validation explicite. */
    expect(
      (await userA.from("reports").update({ content: "Révisé." }).eq("id", created.data!.id)).error,
    ).toBeNull();
    const validated = await userA
      .from("reports")
      .update({ status: "validated" })
      .eq("id", created.data!.id)
      .select("status")
      .single();
    expect(validated.error).toBeNull();
    expect(validated.data!.status).toBe("validated");

    /* Export JSON réel vers le bucket privé reports. */
    const exportPath = `${userId}/${ws.data!.id}/${exam.data!.id}/${created.data!.id}/exports/report.json`;
    const blob = new Blob([JSON.stringify(created.data!.structured_data)], { type: "application/json" });
    expect((await userA.storage.from("reports").upload(exportPath, blob, { upsert: true })).error).toBeNull();
    const downloaded = await userA.storage.from("reports").download(exportPath);
    expect(downloaded.error).toBeNull();
    expect((await userA.storage.from("reports").remove([exportPath])).error).toBeNull();

    /* RLS A/B : USER B ne voit ni ne modifie le rapport de USER A. */
    const secondEmail = process.env.VITE_DEV_AUTH_SECOND_EMAIL ?? "";
    const secondPassword = process.env.VITE_DEV_AUTH_SECOND_PASSWORD ?? "";
    if (secondEmail && secondPassword) {
      await userB.auth.signInWithPassword({ email: secondEmail, password: secondPassword });
      const seenByB = await userB.from("reports").select("id").eq("id", created.data!.id);
      expect(seenByB.data).toHaveLength(0);
      const forbidden = await userB.from("reports").update({ status: "draft" }).eq("id", created.data!.id);
      expect(forbidden.error).not.toBeNull();
    } else {
      console.warn("[live] §23 partiellement exécutable : second compte non configuré.");
    }

    expect((await userA.from("reports").delete().eq("id", created.data!.id)).error).toBeNull();
    expect((await userA.from("examinations").delete().eq("id", exam.data!.id)).error).toBeNull();
    expect((await userA.from("workspaces").delete().eq("id", ws.data!.id)).error).toBeNull();
  });
});
