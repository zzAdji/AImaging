/**
 * Persistance éditeur — Phase Database 5 (SUITE.md) :
 * annotations/shapes + mesures vers Supabase, sans toucher au moteur d'édition.
 *
 * Règles appliquées :
 * - undo/redo RESTE local et synchrone (§4) : ce module ne voit que des états ;
 * - workflow (§9/§10) : state local → UI → snapshot undo → flush débounced ;
 * - mapping réversible Shape ↔ Annotation (§5/§6), géométrie existante conservée ;
 * - provenance `created_by` = user|ai intacte, modèle tracé dans `action_id` (§7) ;
 * - idempotence par `legacy_shape_id` : lookup → update si présent, insert sinon (§8) ;
 * - conflit local/distant : last-write-wins via updated_at (§21) ;
 * - lecture groupée par image (§22) : une requête annotations + une mesures.
 */

import { isSupabaseConfigured } from "./supabaseClient";
import { emitSyncStatus } from "./examinationStore";
import {
  createAnnotation,
  deleteAnnotation,
  listAnnotationsByImage,
  updateAnnotation,
} from "./repositories/annotationRepository";
import { getImageByLegacyId } from "./repositories/imageRepository";
import {
  createMeasurement,
  deleteMeasurement,
  listMeasurementsByImage,
  updateMeasurement,
} from "./repositories/measurementRepository";
import type { AnnotationInsert, AnnotationRow, Json, MeasurementInsert } from "./types";

export const DEBOUNCE_MS = 800;

/* ------------------------- Mapping réversible (§5/§6) ----------------------- */

/** Sous-ensemble du modèle éditeur nécessaire à la persistance (state/workspace.ts). */
export interface EditorShape {
  id: string;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  points: Array<{ x: number; y: number }>;
  strokeWidth?: number;
  label?: string;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: string;
  color?: string;
  strokeColor?: string;
  fillColor?: string;
  visible?: boolean;
  createdBy?: "user" | "ai";
  actionId?: string;
}

/** Géométrie conservée au format existant — aucune invention de format (§6). */
function shapeGeometry(shape: EditorShape): Json {
  return { x: shape.x, y: shape.y, w: shape.w, h: shape.h, points: shape.points };
}

function geometryToShapeFields(geometry: Json): Pick<EditorShape, "x" | "y" | "w" | "h" | "points"> {
  const g = (geometry ?? {}) as Record<string, unknown>;
  return {
    x: Number(g.x ?? 0),
    y: Number(g.y ?? 0),
    w: Number(g.w ?? 0),
    h: Number(g.h ?? 0),
    points: Array.isArray(g.points)
      ? (g.points as Array<Record<string, unknown>>).map((p) => ({ x: Number(p.x), y: Number(p.y) }))
      : [],
  };
}

function shapeStyle(shape: EditorShape): Json {
  return {
    stroke_width: shape.strokeWidth,
    font_size: shape.fontSize,
    font_family: shape.fontFamily,
    font_weight: shape.fontWeight,
    color: shape.color,
    stroke_color: shape.strokeColor,
    fill_color: shape.fillColor,
  };
}

function styleToShapeFields(style: Json): Partial<EditorShape> {
  const s = (style ?? {}) as Record<string, unknown>;
  return {
    strokeWidth: s.stroke_width === null || s.stroke_width === undefined ? undefined : Number(s.stroke_width),
    fontSize: s.font_size === null || s.font_size === undefined ? undefined : Number(s.font_size),
    fontFamily: (s.font_family as string | undefined) ?? undefined,
    fontWeight: (s.font_weight as string | undefined) ?? undefined,
    color: (s.color as string | undefined) ?? undefined,
    strokeColor: (s.stroke_color as string | undefined) ?? undefined,
    fillColor: (s.fill_color as string | undefined) ?? undefined,
  };
}

/** Shape locale → ligne `annotations` (insert ou update). */
export function shapeToAnnotationInsert(shape: EditorShape, imageUuid: string): AnnotationInsert {
  return {
    image_id: imageUuid,
    legacy_shape_id: shape.id,
    type: shape.type,
    geometry: shapeGeometry(shape),
    style: shapeStyle(shape),
    label: shape.label ?? null,
    visible: shape.visible !== false,
    created_by: shape.createdBy === "ai" ? "ai" : "user",
    action_id: shape.actionId ?? null,
  };
}

/** Ligne `annotations` → Shape locale (mapping réversible §6). */
export function annotationRowToShape(row: AnnotationRow): EditorShape {
  return {
    id: row.legacy_shape_id ?? `remote:${row.id}`,
    type: row.type,
    ...geometryToShapeFields(row.geometry),
    ...styleToShapeFields(row.style),
    label: row.label ?? undefined,
    visible: row.visible,
    createdBy: row.created_by === "ai" ? "ai" : "user",
    actionId: row.action_id ?? undefined,
  };
}

/* --------------------- Valeurs de mesures outils (§13/§16) ------------------ */

export interface ShapeMeasureDraft {
  type: string;
  value: number | null;
  unit: string;
}

const round2 = (v: number): number => Math.round(v * 100) / 100;

/**
 * Calcule la valeur d'une shape de mesure depuis sa géométrie — mêmes
 * conventions que le rendu canvas (w/h = deltas signés ; points[0] = second
 * bras pour angle). L'unité réelle est préservée : px OU mm si le pixel
 * spacing est connu, deg pour les angles. Aucune conversion artificielle (§13).
 */
export function computeShapeMeasure(shape: EditorShape, pixelSpacingMm?: [number, number] | null): ShapeMeasureDraft {
  if (shape.type === "angle") {
    const ax = shape.w;
    const ay = shape.h; /* premier bras : deltas depuis le sommet */
    const bx = (shape.points[0]?.x ?? 0);
    const by = (shape.points[0]?.y ?? 0);
    const dot = ax * bx + ay * by;
    const mag = Math.hypot(ax, ay) * Math.hypot(bx, by);
    const deg = mag === 0 ? 0 : (Math.acos(Math.max(-1, Math.min(1, dot / mag))) * 180) / Math.PI;
    return { type: "angle", value: round2(deg), unit: "deg" };
  }
  /* measure / distance : longueur du segment principal */
  const lengthPx = Math.hypot(shape.w, shape.h);
  if (pixelSpacingMm && pixelSpacingMm[0] > 0 && pixelSpacingMm[1] > 0) {
    const meanSpacing = (pixelSpacingMm[0] + pixelSpacingMm[1]) / 2;
    return { type: shape.type, value: round2(lengthPx * meanSpacing), unit: "mm" };
  }
  return { type: shape.type, value: round2(lengthPx), unit: "px" };
}

/** La shape porte-t-elle une mesure à persister ? */
export function isMeasureShape(shape: EditorShape): boolean {
  return shape.type === "measure" || shape.type === "distance" || shape.type === "angle";
}

/* ------------------- Mesures landmarks HybridGNet (§17) --------------------- */

/** Entrée normalisée produite par computeLandmarkMeasurements (lib/landmarkMeasure). */
export interface LandmarkMeasureInput {
  key: string;
  label: string;
  value: number;
  std?: number;
  unit: string;
}

/**
 * Construit les drafts `measurements` d'un set landmarks.
 * analysis_run_id reste null : la migration des runs IA est une phase
 * distincte (§17/§28) — aucun faux run n'est fabriqué.
 */
export function landmarkInputsToMeasurementInserts(
  inputs: LandmarkMeasureInput[],
  imageUuid: string,
  annotationUuidByLegacy?: Map<string, string>,
  analysisRunId?: string | null,
): MeasurementInsert[] {
  return inputs.map((input) => ({
    image_id: imageUuid,
    analysis_run_id: analysisRunId ?? null,
    annotation_id:
      input.key === "ctr" ? (annotationUuidByLegacy?.get("landmarks:ctr") ?? null) : null,
    type: input.key.toUpperCase(),
    value: Math.round(input.value * 1000) / 1000,
    unit: input.unit,
    source: "ai",
    confidence: input.std !== undefined ? Math.max(0, Math.min(1, 1 - Math.min(input.std, 1))) : null,
    geometry: null,
    metadata: { label: input.label, engine: "hybridgnet", std: input.std ?? null } as Json,
  }));
}

/* ------------------------- Moteur de synchronisation ------------------------ */

interface ImageRuntime {
  shapesTimer: ReturnType<typeof setTimeout> | null;
  landmarkTimer: ReturnType<typeof setTimeout> | null;
  imageUuid: string | null;
  /** Dernier état de shapes entièrement synchronisé (diff minimal, §10). */
  lastSyncedJson: string | null;
  pendingShapes: EditorShape[] | null;
  annotationUuidByLegacy: Map<string, string>;
}

const runtimes = new Map<string, ImageRuntime>();

function runtimeFor(imageLegacyId: string): ImageRuntime {
  let rt = runtimes.get(imageLegacyId);
  if (!rt) {
    rt = {
      shapesTimer: null,
      landmarkTimer: null,
      imageUuid: null,
      lastSyncedJson: null,
      pendingShapes: null,
      annotationUuidByLegacy: new Map(),
    };
    runtimes.set(imageLegacyId, rt);
  }
  return rt;
}

/** Résout (et cache) l'UUID examination_images d'une image legacy. */
async function resolveImageUuid(rt: ImageRuntime, imageLegacyId: string): Promise<string> {
  if (rt.imageUuid !== null) return rt.imageUuid;
  const row = await getImageByLegacyId(imageLegacyId);
  if (row === null) {
    throw new Error(`[db] Image non synchronisée (${imageLegacyId}) : annotations en attente locales.`);
  }
  rt.imageUuid = row.id;
  return row.id;
}

/**
 * Programme la persistance des shapes d'une image (§9/§19).
 * Ne bloque jamais le dessin : simple replanification d'un timer global par image.
 */
export function scheduleShapesPersist(imageLegacyId: string, shapes: EditorShape[]): "scheduled" | "local-only" {
  if (!isSupabaseConfigured) return "local-only";
  const rt = runtimeFor(imageLegacyId);
  rt.pendingShapes = shapes.map((s) => ({ ...s }));
  if (rt.shapesTimer !== null) clearTimeout(rt.shapesTimer);
  rt.shapesTimer = setTimeout(() => {
    rt.shapesTimer = null;
    void flushShapes(imageLegacyId).catch((exc: unknown) => {
      console.error("[db] Flush des annotations échoué (état local conservé).", exc);
    });
  }, DEBOUNCE_MS);
  return "scheduled";
}

function serialize(shapes: EditorShape[]): string {
  return JSON.stringify(
    shapes
      .map((s) => [s.id, s.type, s.x, s.y, s.w, s.h, s.points, s.strokeWidth, s.label, s.visible, s.createdBy, s.actionId, s.color, s.strokeColor, s.fillColor, s.fontSize, s.fontFamily, s.fontWeight])
      .sort(),
  );
}

/** Flush effectif : diff local/distant puis écritures contrôlées (§8/§10/§11). */
export async function flushShapes(imageLegacyId: string): Promise<void> {
  const rt = runtimeFor(imageLegacyId);
  const shapes = rt.pendingShapes;
  if (shapes === null) return;
  rt.pendingShapes = null;
  if (serialize(shapes) === rt.lastSyncedJson) return;

  emitSyncStatus("syncing");
  try {
    const imageUuid = await resolveImageUuid(rt, imageLegacyId);
    const remoteRows = await listAnnotationsByImage(imageUuid);
    const remoteByLegacy = new Map<string, AnnotationRow>();
    for (const row of remoteRows) {
      if (row.legacy_shape_id !== null) remoteByLegacy.set(row.legacy_shape_id, row);
    }

    /* SUPPRESSIONS (§11) : présentes à distance, absentes localement. */
    const localIds = new Set(shapes.map((s) => s.id));
    for (const [legacyId, row] of remoteByLegacy) {
      if (localIds.has(legacyId)) continue;
      await deleteAnnotation(row.id);
      rt.annotationUuidByLegacy.delete(legacyId);
    }

    /* UPSERTS idempotents : lookup legacy_shape_id → update sinon insert (§8). */
    const freshUuids = new Map(rt.annotationUuidByLegacy);
    for (const shape of shapes) {
      const values = shapeToAnnotationInsert(shape, imageUuid);
      const existing = remoteByLegacy.get(shape.id);
      if (existing !== undefined) {
        await updateAnnotation(existing.id, {
          type: values.type,
          geometry: values.geometry,
          style: values.style ?? null,
          label: values.label ?? null,
          visible: values.visible ?? true,
          action_id: values.action_id ?? null,
        });
        freshUuids.set(shape.id, existing.id);
      } else if (freshUuids.has(shape.id)) {
        await updateAnnotation(freshUuids.get(shape.id) as string, {
          type: values.type,
          geometry: values.geometry,
          style: values.style ?? null,
          label: values.label ?? null,
          visible: values.visible ?? true,
          action_id: values.action_id ?? null,
        });
      } else {
        const inserted = await createAnnotation(values);
        freshUuids.set(shape.id, inserted.id);
      }
    }
    rt.annotationUuidByLegacy = freshUuids;
    rt.lastSyncedJson = serialize(shapes);
    emitSyncStatus("synced");
  } catch (exc: unknown) {
    emitSyncStatus("error");
    throw exc;
  }
}

/* --------------------- Persistance des mesures (§12-§17) -------------------- */

/**
 * Persiste un set complet de mesures landmarks pour l'image :
 * update des lignes existantes (match type), suppression des excédentaires,
 * insertion des nouvelles — le tout en un seul passage groupé (§22).
 */
export interface LandmarkPersistOptions {
  /** Run d'analyse réel auquel rattacher les mesures (Phase 6 §11/§12). */
  analysisRunId?: string | null;
}

export async function persistLandmarkSet(
  imageLegacyId: string,
  inputs: LandmarkMeasureInput[],
  options: LandmarkPersistOptions = {},
): Promise<void> {
  if (!isSupabaseConfigured) return;
  const rt = runtimeFor(imageLegacyId);
  emitSyncStatus("syncing");
  try {
    const imageUuid = await resolveImageUuid(rt, imageLegacyId);
    const existingRows = await listMeasurementsByImage(imageUuid);
    const engineRows = existingRows.filter(
      (row) => (row.metadata as Record<string, unknown> | null)?.engine === "hybridgnet",
    );
    const drafts = landmarkInputsToMeasurementInserts(
      inputs,
      imageUuid,
      rt.annotationUuidByLegacy,
      options.analysisRunId ?? null,
    );
    const byType = new Map(engineRows.map((row) => [row.type.toUpperCase(), row]));
    for (const draft of drafts) {
      const match = byType.get(draft.type);
      if (match !== undefined) {
        await updateMeasurement(match.id, {
          value: draft.value ?? null,
          unit: draft.unit,
          confidence: draft.confidence ?? null,
          metadata: draft.metadata,
          ...(options.analysisRunId !== undefined ? { analysis_run_id: options.analysisRunId } : {}),
        });
        byType.delete(draft.type);
      } else {
        await createMeasurement(draft);
      }
    }
    /* Lignes du set précédent qui n'existent plus. */
    for (const stale of byType.values()) {
      await deleteMeasurement(stale.id);
    }
    emitSyncStatus("synced");
  } catch (exc: unknown) {
    emitSyncStatus("error");
    throw exc;
  }
}

/** Version débounced du set landmarks : un timer global par image (§19). */
export function scheduleLandmarkPersist(
  imageLegacyId: string,
  inputs: LandmarkMeasureInput[],
  options: LandmarkPersistOptions = {},
): void {
  if (!isSupabaseConfigured) return;
  const rt = runtimeFor(imageLegacyId);
  if (rt.landmarkTimer !== null) clearTimeout(rt.landmarkTimer);
  rt.landmarkTimer = setTimeout(() => {
    rt.landmarkTimer = null;
    void persistLandmarkSet(imageLegacyId, inputs, options).catch((exc: unknown) => {
      console.error("[db] Persistance des mesures landmarks échouée (état local conservé).", exc);
    });
  }, DEBOUNCE_MS);
}

/* ------------------- Restauration au démarrage (§20/§21) -------------------- */

export interface RestoredEditorObjects {
  shapes: EditorShape[];
  measurements: Awaited<ReturnType<typeof listMeasurementsByImage>>;
}

/**
 * Fusion local/distant à l'ouverture d'une image :
 * - distant gagne pour les legacy_shape_id communs (last-write-wins §21) ;
 * - les shapes locale-only sont CONSERVÉES (jamais de perte locale automatique).
 */
export function mergeRemoteShapes(localShapes: EditorShape[], remoteShapes: EditorShape[]): EditorShape[] {
  const remoteIds = new Set(remoteShapes.map((s) => s.id));
  return [...remoteShapes, ...localShapes.filter((s) => !remoteIds.has(s.id))];
}

/**
 * Charge annotations + mesures d'une image en DEUX requêtes (§22).
 * Retourne null hors configuration Supabase.
 */
export async function restoreEditorObjects(imageLegacyId: string): Promise<RestoredEditorObjects | null> {
  if (!isSupabaseConfigured) return null;
  const rt = runtimeFor(imageLegacyId);
  const imageUuid = await resolveImageUuid(rt, imageLegacyId);
  const [rows, measurementRows] = await Promise.all([
    listAnnotationsByImage(imageUuid),
    listMeasurementsByImage(imageUuid),
  ]);
  for (const row of rows) {
    if (row.legacy_shape_id !== null) rt.annotationUuidByLegacy.set(row.legacy_shape_id, row.id);
  }
  const remoteShapes = rows.map(annotationRowToShape);
  rt.lastSyncedJson = serialize(remoteShapes);
  return { shapes: remoteShapes, measurements: measurementRows };
}

/** Réinitialise l'état mémoire (tests). */
export function __resetEditorPersistenceForTests(): void {
  for (const rt of runtimes.values()) {
    if (rt.shapesTimer !== null) clearTimeout(rt.shapesTimer);
    if (rt.landmarkTimer !== null) clearTimeout(rt.landmarkTimer);
  }
  runtimes.clear();
}

