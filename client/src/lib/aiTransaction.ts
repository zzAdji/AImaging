/** Transaction multi-images : exécution atomique d'un plan d'actions IA.

Un plan peut cibler plusieurs images d'un examen. Le moteur capture un
instantané des états mutables (src, buffer linéaire, état éditeur) de toutes
les images ciblées AVANT exécution ; en cas d'échec, il restaure l'intégralité
de la transaction (rollback). Les snapshots servent aussi à l'annulation
globale (Ctrl+Z) dans le shell.
 */

import type { LinearImageBuffer } from "./dicom";
import type { ImageStateSnapshot } from "../state/workspace";

export interface ExamImageMutableSnapshot {
  src: string;
  linear: LinearImageBuffer | null;
  state: ImageStateSnapshot | null;
}

export type MutableSnapshotMap = Map<string, ExamImageMutableSnapshot>;

function cloneSnapshot(value: ImageStateSnapshot): ImageStateSnapshot {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as ImageStateSnapshot;
}

/** Deep-clones the mutable fields of the requested images (ids). */
export function captureMutableSnapshots(
  images: ReadonlyArray<{ id: string; src: string; state?: ImageStateSnapshot; linear?: LinearImageBuffer | null }>,
  ids: Iterable<string>,
): MutableSnapshotMap {
  const wanted = new Set(ids);
  const map: MutableSnapshotMap = new Map();
  for (const image of images) {
    if (!wanted.has(image.id)) continue;
    map.set(image.id, {
      src: image.src,
      linear: image.linear ?? null,
      state: image.state ? cloneSnapshot(image.state) : null,
    });
  }
  return map;
}

/** Applique un snapshot à une image d'examen (retourne une copie). */
export function applyMutableSnapshot(
  image: { id: string; src: string; state?: ImageStateSnapshot; linear?: LinearImageBuffer | null },
  snapshot: ExamImageMutableSnapshot | undefined,
): { id: string; src: string; state?: ImageStateSnapshot; linear?: LinearImageBuffer | null } {
  if (!snapshot) return image;
  return {
    ...image,
    src: snapshot.src,
    linear: snapshot.linear ?? undefined,
    state: snapshot.state ? { ...snapshot.state } : undefined,
  };
}