import type { FetalExam, FetalImage, FetalRegion } from "./types";

/**
 * Sélecteurs purs sur le domaine fœtal — consommés par les panneaux droits.
 * Aucun effet de bord, aucune donnée inventée : tout dérive de l'examen.
 */

export interface FetalExamOverview {
  /** Nombre total d'images de l'examen. */
  total: number;
  /** Images analysées (qualité + plan disponibles). */
  analyzed: number;
  /** Images rejetées / inutilisables. */
  rejected: number;
  /** Plans distincts détects. */
  plansDetected: number;
  /** Vues retenues par la sélection IA. */
  selected: number;
}

export function examOverview(exam: FetalExam): FetalExamOverview {
  const analyzed = exam.images.filter((image) => image.quality && image.plane);
  return {
    total: exam.images.length,
    analyzed: analyzed.length,
    rejected: exam.images.filter((image) => image.rejected || image.quality?.usability === "rejected").length,
    plansDetected: new Set(analyzed.map((image) => image.plane!.planeId)).size,
    selected: exam.images.filter((image) => image.selected).length,
  };
}

export interface PlaneGroup {
  planeId: string;
  label: string;
  region: FetalRegion;
  count: number;
  /** Meilleure image représentative du plan (score de qualité max). */
  bestImage: FetalImage | null;
}

export interface RegionGroup {
  region: FetalRegion;
  planes: PlaneGroup[];
}

const REGION_ORDER: FetalRegion[] = ["brain", "heart", "abdomen", "femur", "spine", "face", "kidney", "other"];

/** Regroupe les images analysées par région puis plan (INSTRUCTIONS.md §12). */
export function groupPlanesByRegion(exam: FetalExam): RegionGroup[] {
  const byPlane = new Map<string, PlaneGroup>();
  for (const image of exam.images) {
    const plane = image.plane;
    if (!plane || image.rejected) continue;
    let group = byPlane.get(plane.planeId);
    if (!group) {
      group = { planeId: plane.planeId, label: plane.label, region: plane.region, count: 0, bestImage: null };
      byPlane.set(plane.planeId, group);
    }
    group.count += 1;
    if (!group.bestImage || (image.quality?.score ?? -1) > (group.bestImage.quality?.score ?? -1)) {
      group.bestImage = image;
    }
  }
  const regions = new Map<FetalRegion, RegionGroup>();
  for (const group of byPlane.values()) {
    let region = regions.get(group.region);
    if (!region) {
      region = { region: group.region, planes: [] };
      regions.set(group.region, region);
    }
    region.planes.push(group);
  }
  return REGION_ORDER.filter((region) => regions.has(region)).map((region) => regions.get(region)!);
}
