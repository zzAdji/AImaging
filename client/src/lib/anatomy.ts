/** Structures clés de la segmentation anatomique (labels PAXRay) et leurs
 *  couleurs officielles CXAS (``cxas.label_mapper.colors``, valeurs 0..255,
 *  vérifiées au runtime) — la même palette que les overlays serveur. */
export const ANATOMY_KEY_LABELS: ReadonlyArray<{ id: string; rgb: [number, number, number] }> = [
  { id: "lung", rgb: [57, 110, 100] },
  { id: "right lung", rgb: [184, 0, 91] },
  { id: "left lung", rgb: [255, 128, 61] },
  { id: "heart", rgb: [0, 236, 2] },
  { id: "right hemidiaphragm", rgb: [205, 41, 71] },
  { id: "left hemidiaphragm", rgb: [195, 52, 137] },
  { id: "spine", rgb: [215, 0, 0] },
];

export const ANATOMY_KEY_IDS = ANATOMY_KEY_LABELS.map((key) => key.id);

/** Indices PAXRay réels : les clés de ``masks_b64_png`` et ``labels`` du
 *  serveur sont des indices (str), pas les noms sémantiques ci-dessus.
 *  (Vérifiés d'après ``cxas.label_mapper.id2label_dict``.) */
export const ANATOMY_KEY_INDEX: Record<string, number> = {
  lung: 134,
  "right lung": 135,
  "left lung": 136,
  heart: 121,
  "right hemidiaphragm": 107,
  "left hemidiaphragm": 106,
  spine: 0,
};

export function anatomyKeyRgb(id: string): [number, number, number] | undefined {
  return ANATOMY_KEY_LABELS.find((key) => key.id === id)?.rgb;
}

/** Couleur CSS pleine opacité (pastilles de légende, badge, halo). */
export function anatomyKeyColor(id: string): string | undefined {
  const rgb = anatomyKeyRgb(id);
  return rgb ? `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})` : undefined;
}

/** Couleur CSS avec opacité (aplats de la carte de segmentation). */
export function anatomyKeyFill(id: string, alpha: number): string | undefined {
  const rgb = anatomyKeyRgb(id);
  return rgb ? `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})` : undefined;
}

/** Data-URL du masque PNG d'un id sémantique (undefined si structure absente).
 *  Les masques sont indexés par l'indice PAXRay du label dans la réponse. */
export function anatomyMaskSrc(
  segmentation: { masks_b64_png?: Record<string, string> } | undefined,
  id: string,
): string | undefined {
  const index = ANATOMY_KEY_INDEX[id];
  return segmentation?.masks_b64_png?.[String(index)];
}

/** Décode un masque PNG serveur en canvas de sa taille native, avec un
 *  vrai canal alpha de silhouette.
 *
 *  Le PNG servi par l'API (`_masks_to_data_urls`, service.py) est encodé en
 *  mode "L" — niveaux de gris SANS canal alpha (0 = hors structure,
 *  255 = structure). Un tel PNG est décodé 100% opaque par le navigateur,
 *  quel que soit le niveau de gris : `ctx.drawImage()` produit un canvas où
 *  alpha vaut 255 aussi bien sur le fond noir que sur la structure blanche.
 *  Composer ce canvas avec `source-in` (paintAnatomyMask) remplit alors TOUTE
 *  la surface de la couleur, et le hit-test (qui lit `data[3]`) matche
 *  n'importe quel pixel de n'importe quel masque — d'où une seule structure
 *  (la dernière dessinée / testée) qui « avale » toute la carte.
 *
 *  On reporte donc la luminance (canal R, identique à G et B pour un PNG
 *  "L") dans le canal alpha : fond -> alpha 0 (transparent), structure ->
 *  alpha 255 (opaque). Après cette passe, alpha représente fidèlement la
 *  silhouette et peut servir à la fois au hit-test et au `source-in`. */
export function decodeMaskToCanvas(src: string): Promise<HTMLCanvasElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(null);
        return;
      }
      ctx.drawImage(image, 0, 0);
      const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const px = frame.data;
      for (let i = 0; i < px.length; i += 4) {
        px[i + 3] = px[i]; // alpha := luminance (R=G=B pour un PNG "L")
      }
      ctx.putImageData(frame, 0, 0);
      resolve(canvas);
    };
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

/** Réduit (width, height) à ``maxLongSide`` sur le plus grand côté, en
 *  conservant le ratio. Les masques PAXRay sont nativement basse résolution
 *  (grille ~512, voire moins une fois `mask_max_side` appliqué côté
 *  serveur) : les rendre à la pleine résolution native d'une radio (souvent
 *  plusieurs milliers de px) ne sert à rien visuellement — le canvas n'est
 *  de toute façon jamais affiché à cette taille — et coûte cher à chaque
 *  survol. On borne la résolution de travail à une valeur raisonnable ; le
 *  rendu final est ensuite mis à l'échelle (bilinéaire) vers la taille
 *  réellement demandée par l'appelant, sans perte visible. */
export function fitWithinLongSide(
  width: number,
  height: number,
  maxLongSide: number,
): { width: number; height: number } {
  const long = Math.max(width, height);
  if (long <= maxLongSide) return { width, height };
  const scale = maxLongSide / long;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Sur-échantillonnage utilisé pour lisser les bords lors de la composition
 *  (silhouette + anneau), en plus du plafond ``MAX_WORKING_SIDE``. */
const SUPERSAMPLE = 2;

/** Plafond de résolution de la canvas de travail (silhouette + anneau),
 *  indépendant de la résolution de destination demandée par l'appelant —
 *  voir ``fitWithinLongSide``. */
const MAX_WORKING_SIDE = 1400;

/** Épaisseur par défaut du contour, en px de la résolution *demandée* par
 *  l'appelant (donc indépendante du plafond de résolution de travail). */
const DEFAULT_EDGE_WIDTH = 1.4;

function workingCanvasSize(width: number, height: number): { w: number; h: number } {
  const fitted = fitWithinLongSide(width * SUPERSAMPLE, height * SUPERSAMPLE, MAX_WORKING_SIDE);
  return { w: Math.max(1, fitted.width), h: Math.max(1, fitted.height) };
}

/** Redresse la rampe alpha d'un masque décodé autour de 50 % : un masque
 *  PAXRay natif ~512 px, agrandi vers une résolution de travail bien plus
 *  grande, produit un dégradé flou sur plusieurs pixels à chaque frontière
 *  (c'est la cause principale de l'aspect « flou/moche » des structures).
 *  Cette passe resserre le dégradé à ~1 px tout en gardant un léger
 *  anti-crénelage — la silhouette lit ensuite comme un aplat net plutôt
 *  qu'une tache diffuse. */
function sharpenSilhouetteEdges(canvas: HTMLCanvasElement, steepness = 3.2): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = frame.data;
  for (let i = 3; i < px.length; i += 4) {
    const a = px[i] / 255;
    const t = Math.min(1, Math.max(0, (a - 0.5) * steepness + 0.5));
    px[i] = Math.round(t * t * (3 - 2 * t) * 255); // smoothstep : resserre sans créer de crénelures
  }
  ctx.putImageData(frame, 0, 0);
}

/** Dilatation approximative d'une silhouette alpha de ``radius`` px, par
 *  empilement additif de copies décalées dans 8 directions. Ce n'est pas un
 *  noyau morphologique exact, mais à l'échelle d'un contour de 1-2 px cette
 *  approximation (octogonale) est visuellement indissociable d'un vrai
 *  disque — sans dépendance externe. */
function dilateSilhouette(source: HTMLCanvasElement, radius: number): HTMLCanvasElement | null {
  const out = document.createElement("canvas");
  out.width = source.width;
  out.height = source.height;
  const ctx = out.getContext("2d");
  if (!ctx) return null;
  ctx.globalCompositeOperation = "lighter";
  const directions = 8;
  for (let i = 0; i < directions; i++) {
    const angle = (i / directions) * Math.PI * 2;
    ctx.drawImage(source, Math.round(Math.cos(angle) * radius), Math.round(Math.sin(angle) * radius));
  }
  return out;
}

export interface AnatomyMaskGeometry {
  /** Silhouette alpha nette (sharpened), résolution de travail. */
  silhouette: HTMLCanvasElement;
  /** Fin anneau le long de la frontière de la silhouette, même résolution. */
  ring: HTMLCanvasElement;
  width: number;
  height: number;
}

/** Précalcule la partie coûteuse et indépendante du style (sur-échantillon,
 *  redressement des bords, anneau de contour) une seule fois par masque.
 *  Coûteux (getImageData + 8 passes de dilatation) : à mettre en cache par
 *  l'appelant et réutiliser via ``paintAnatomyMask`` à chaque changement de
 *  survol/sélection plutôt que de la relancer à chaque frame. */
export function prepareAnatomyMask(
  mask: HTMLCanvasElement,
  width: number,
  height: number,
): AnatomyMaskGeometry | null {
  const { w: bw, h: bh } = workingCanvasSize(width, height);
  const silhouette = document.createElement("canvas");
  silhouette.width = bw;
  silhouette.height = bh;
  const sctx = silhouette.getContext("2d");
  if (!sctx) return null;
  sctx.drawImage(mask, 0, 0, bw, bh);
  sharpenSilhouetteEdges(silhouette);

  const workingRatio = bw / width; // px de travail par px de destination
  const dilated = dilateSilhouette(silhouette, DEFAULT_EDGE_WIDTH * workingRatio);
  let ring = silhouette;
  if (dilated) {
    const rctx = dilated.getContext("2d");
    if (rctx) {
      rctx.globalCompositeOperation = "destination-out";
      rctx.drawImage(silhouette, 0, 0);
      ring = dilated;
    }
  }
  return { silhouette, ring, width: bw, height: bh };
}

export interface AnatomyMaskStyle {
  /** Opacité de l'aplat intérieur (0..1) — volontairement discret pour que
   *  la radiographie reste lisible sous la structure. */
  fillAlpha: number;
  /** Opacité du contour (0..1) — porte l'essentiel du signal couleur. */
  edgeAlpha: number;
  /** Halo doux derrière la forme (survol/sélection uniquement). */
  glow?: { blur: number; alpha: number };
}

/** Passe de composition bon marché : peint une géométrie précalculée sur
 *  ``ctx`` à (0,0,destWidth,destHeight) selon ``style``. Fait pour tourner à
 *  chaque changement de survol/sélection (contrairement à
 *  ``prepareAnatomyMask``, appelée une seule fois par masque). */
export function paintAnatomyMask(
  ctx: CanvasRenderingContext2D,
  geometry: AnatomyMaskGeometry,
  destWidth: number,
  destHeight: number,
  rgb: [number, number, number],
  style: AnatomyMaskStyle,
): void {
  const color = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
  const tint = (alphaSrc: HTMLCanvasElement, alpha: number): HTMLCanvasElement | null => {
    if (alpha <= 0) return null;
    const c = document.createElement("canvas");
    c.width = geometry.width;
    c.height = geometry.height;
    const cctx = c.getContext("2d");
    if (!cctx) return null;
    cctx.drawImage(alphaSrc, 0, 0);
    cctx.globalCompositeOperation = "source-in";
    cctx.globalAlpha = alpha;
    cctx.fillStyle = color;
    cctx.fillRect(0, 0, geometry.width, geometry.height);
    return c;
  };

  if (style.glow) {
    const glowSrc = tint(geometry.silhouette, 1);
    if (glowSrc) {
      ctx.save();
      ctx.globalAlpha = style.glow.alpha;
      ctx.shadowColor = color;
      ctx.shadowBlur = style.glow.blur;
      ctx.drawImage(glowSrc, 0, 0, destWidth, destHeight);
      ctx.drawImage(glowSrc, 0, 0, destWidth, destHeight); // 2e passe : halo plus dense
      ctx.restore();
    }
  }

  const fill = tint(geometry.silhouette, style.fillAlpha);
  if (fill) ctx.drawImage(fill, 0, 0, destWidth, destHeight);

  const edge = tint(geometry.ring, style.edgeAlpha);
  if (edge) ctx.drawImage(edge, 0, 0, destWidth, destHeight);
}