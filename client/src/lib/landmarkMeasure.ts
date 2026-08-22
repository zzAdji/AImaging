import type {
  LandmarkContour,
  LandmarkLine,
  WorkspaceLandmarksResult,
} from "./workspaceApi";
import type { PixelSpacingMm } from "../state/workspace";

/* Recalcul côté client des mesures landmarks (HybridGNet) à partir des
   contours — réplique fidèle de ``server/chexmask/measurements.py`` :
   - diamètres transverses = portées HORIZONTALES (x_max - x_min) ;
   - CTR = portée cœur / portée thorax (poumons fusionnés) ;
   - surfaces = formule du lacet (shoelace) du polygone fermé ;
   - incertitudes propagées (hypot pour les distances, Monte-Carlo léger
     pour les surfaces — RNG déterministe pour un rendu stable).
   Utilisé pour la mise à jour TEMPS RÉEL des valeurs quand l'utilisateur
   édite les contours sur le canvas. */

export type LandmarkOrganKey = keyof WorkspaceLandmarksResult["contours"];

export type LandmarkContours = Record<LandmarkOrganKey, LandmarkContour>;

export interface LiveLandmarkAnalysis {
  measurements: WorkspaceLandmarksResult["measurements"];
  lines: LandmarkLine[];
}

/** Portée horizontale (x_max - x_min) + nœuds extrêmes + écart-type propagé. */
function hspan(contour: LandmarkContour): {
  width: number;
  std: number;
  iMin: number;
  iMax: number;
} {
  let iMin = 0;
  let iMax = 0;
  for (let i = 1; i < contour.x.length; i++) {
    if (contour.x[i] < contour.x[iMin]) iMin = i;
    if (contour.x[i] > contour.x[iMax]) iMax = i;
  }
  const width = Math.abs(contour.x[iMax] - contour.x[iMin]);
  const std = Math.hypot(contour.std[iMin] ?? 0, contour.std[iMax] ?? 0);
  return { width, std, iMin, iMax };
}

/* RNG déterministe (mulberry32) : mêmes valeurs à chaque rendu, pas de
   scintillement des incertitudes pendant le drag d'un nœud. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussians(count: number, rng: () => number): number[] {
  const out: number[] = [];
  for (let k = 0; k < count; k += 2) {
    const u1 = Math.max(rng(), 1e-12);
    const u2 = rng();
    const r = Math.sqrt(-2 * Math.log(u1));
    out.push(r * Math.cos(2 * Math.PI * u2));
    if (out.length < count) out.push(r * Math.sin(2 * Math.PI * u2));
  }
  return out;
}

/** Écart-type de l'aire par perturbation Monte-Carlo des nœuds (comme le
    serveur, N=200) ; RNG local déterministe — estimateur équivalent. */
function areaStdMc(
  points: Array<[number, number]>,
  sigmas: number[],
  scale: number,
  n = 200,
): number {
  const rng = mulberry32(0);
  const samples: number[] = [];
  for (let s = 0; s < n; s++) {
    const g = gaussians(points.length, rng);
    const perturbed = points.map(
      ([x, y], i) => [x + g[i] * (sigmas[i] ?? 0), y + g[i] * (sigmas[i] ?? 0)] as [number, number],
    );
    samples.push(polygonArea(perturbed));
  }
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  const variance = samples.reduce((a, b) => a + (b - mean) ** 2, 0) / samples.length;
  return Math.sqrt(variance) * scale * scale;
}

const round3 = (v: number): number => Math.round(v * 1000) / 1000;

/** Recalcule mesures + segments posables depuis les contours (grille 1024).
    ``pixelSpacingMm`` active la conversion mm/mm² comme côté serveur. */
export function computeLandmarkMeasurements(
  contours: LandmarkContours,
  pixelSpacingMm: PixelSpacingMm | null | undefined,
): LiveLandmarkAnalysis {
  const pxOnly = !pixelSpacingMm;
  const scale = pxOnly ? 1 : (pixelSpacingMm[0] + pixelSpacingMm[1]) / 2;

  const heart = contours.heart;
  const right = contours.right_lung;
  const left = contours.left_lung;

  /* Thorax = union des deux poumons (points empilés comme côté serveur). */
  const thorax: LandmarkContour = {
    x: [...right.x, ...left.x],
    y: [...right.y, ...left.y],
    std: [...right.std, ...left.std],
  };

  const heartW = hspan(heart);
  const thoraxW = hspan(thorax);

  const ctr = thoraxW.width > 0 ? heartW.width / thoraxW.width : 0;
  const ctrStd =
    heartW.width > 0 && thoraxW.width > 0
      ? ctr * Math.hypot(heartW.std / heartW.width, thoraxW.std / thoraxW.width)
      : 0;

  const unitLen = pxOnly ? "px" : "mm";
  const unitArea = pxOnly ? "px²" : "mm²";

  const measurements: WorkspaceLandmarksResult["measurements"] = {
    ctr: { value: round3(ctr), std: round3(ctrStd), unit: "ratio" },
    heart_transverse_diameter: {
      value: round3(heartW.width * scale),
      std: round3(heartW.std * scale),
      unit: unitLen,
    },
    thorax_transverse_diameter: {
      value: round3(thoraxW.width * scale),
      std: round3(thoraxW.std * scale),
      unit: unitLen,
    },
    right_lung_surface: {
      value: Math.round(polygonArea(right.x.map((x, i) => [x, right.y[i]] as [number, number])) * scale * scale),
      std: Math.round(areaStdMc(right.x.map((x, i) => [x, right.y[i]] as [number, number]), right.std, scale)),
      unit: unitArea,
    },
    left_lung_surface: {
      value: Math.round(polygonArea(left.x.map((x, i) => [x, left.y[i]] as [number, number])) * scale * scale),
      std: Math.round(areaStdMc(left.x.map((x, i) => [x, left.y[i]] as [number, number]), left.std, scale)),
      unit: unitArea,
    },
    heart_surface: {
      value: Math.round(polygonArea(heartPtsOf(heart)) * scale * scale),
      std: Math.round(areaStdMc(heartPtsOf(heart), heart.std, scale)),
      unit: unitArea,
    },
  };

  return { measurements, lines: buildLines(heart, thorax, heartW, thoraxW, scale, unitLen) };
}

function heartPtsOf(contour: LandmarkContour): Array<[number, number]> {
  return contour.x.map((x, i) => [x, contour.y[i]] as [number, number]);
}

function buildLines(
  heart: LandmarkContour,
  thorax: LandmarkContour,
  heartW: { width: number; std: number; iMin: number; iMax: number },
  thoraxW: { width: number; std: number; iMin: number; iMax: number },
  scale: number,
  unitLen: string,
): LandmarkLine[] {
  return [
    {
      key: "heart_transverse",
      label: "Diamètre cœur",
      value: round3(heartW.width * scale),
      unit: unitLen,
      x1: heart.x[heartW.iMin],
      y1: heart.y[heartW.iMin],
      x2: heart.x[heartW.iMax],
      y2: heart.y[heartW.iMax],
    },
    {
      key: "thorax_transverse",
      label: "Diamètre thorax",
      value: round3(thoraxW.width * scale),
      unit: unitLen,
      x1: thorax.x[thoraxW.iMin],
      y1: (thorax.y[thoraxW.iMin] + thorax.y[thoraxW.iMax]) / 2,
      x2: thorax.x[thoraxW.iMax],
      y2: (thorax.y[thoraxW.iMin] + thorax.y[thoraxW.iMax]) / 2,
    },
  ];
}

/** Chemin SVG fermé et lissé (Catmull-Rom -> Bézier cubique) : rendu organique
    des contours, sans l'effet « droite » des polylignes brutes. Les coordonnées
    d'entrée sont déjà dans l'espace de destination (même unité pour x et y). */
export function smoothClosedSvgPath(xs: number[], ys: number[]): string {
  const n = Math.min(xs.length, ys.length);
  const fmt = (v: number) => Math.round(v * 100) / 100;
  if (n < 3) {
    if (n === 0) return "";
    let d = `M ${fmt(xs[0])},${fmt(ys[0])}`;
    for (let i = 1; i < n; i++) d += ` L ${fmt(xs[i])},${fmt(ys[i])}`;
    return d + " Z";
  }
  const at = (i: number): [number, number] => [xs[(i + n) % n], ys[(i + n) % n]];
  const [sx, sy] = at(0);
  let d = `M ${fmt(sx)},${fmt(sy)}`;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = at(i - 1);
    const [x1, y1] = at(i);
    const [x2, y2] = at(i + 1);
    const [x3, y3] = at(i + 2);
    const c1x = x1 + (x2 - x0) / 6;
    const c1y = y1 + (y2 - y0) / 6;
    const c2x = x2 - (x3 - x1) / 6;
    const c2y = y2 - (y3 - y1) / 6;
    d += ` C ${fmt(c1x)},${fmt(c1y)} ${fmt(c2x)},${fmt(c2y)} ${fmt(x2)},${fmt(y2)}`;
  }
  return d + " Z";
}

/** Les contours édités diffèrent-ils de la sortie modèle ? */
export function contoursEdited(
  edited: LandmarkContours | null,
  original: WorkspaceLandmarksResult["contours"] | undefined,
): boolean {
  if (!edited || !original) return false;
  for (const key of Object.keys(edited) as LandmarkOrganKey[]) {
    const e = edited[key];
    const o = original[key];
    if (!o || e.x.length !== o.x.length || e.y.length !== o.y.length) return true;
    for (let i = 0; i < e.x.length; i++) {
      if (e.x[i] !== o.x[i] || e.y[i] !== o.y[i]) return true;
    }
  }
  return false;
}

function polygonArea(points: Array<[number, number]>): number {
  let sum = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    sum += points[i][0] * points[j][1] - points[j][0] * points[i][1];
  }
  return 0.5 * Math.abs(sum);
}
