/** Définition des régions anatomiques sur le fond `anatomy_map.png`.
 *  Dimensions natives : 1122 x 1402 px.
 */

export interface AnatomyRegion {
  /** Slug stable, ex. "apex-droit". */
  id: string;
  /** Libellé affiché en français. */
  label: string;
  /** Polygone en pixels natifs de l'image (1122x1402). */
  polygon: { x: number; y: number }[];
  /** Couleur officielle CXAS de la structure dominante. */
  color: string;
  /** Identifiants CXAS associés (right lung, heart, etc.). */
  structures: string[];
  /** Texte de référence anatomique normale. */
  reference: string;
}

export const ANATOMY_MAP_WIDTH = 1122;
export const ANATOMY_MAP_HEIGHT = 1402;

export const OVERVIEW_DESC =
  "Radiographie thoracique de face : structures osseuses, silhouette médiastinale, hiles et parenchymes " +
  "sont examinés zone par zone. En l'absence d'anomalie signalée, chaque secteur est décrit comme normal.";

/** Ordre de dessin (du fond vers le premier plan).
 *  Au hit-test, l'ordre inverse est utilisé afin que les régions plus spécifiques
 *  et situées au premier plan soient sélectionnées en priorité. */
export const ANATOMY_REGIONS: AnatomyRegion[] = [
  {
    id: "rachis",
    label: "Rachis thoracique",
    polygon: [
      { x: 520, y: 80 },
      { x: 600, y: 80 },
      { x: 605, y: 1340 },
      { x: 515, y: 1340 },
    ],
    color: "#d70000",
    structures: ["spine"],
    reference:
      "Alignement régulier des corps vertébraux dorsaux sur la ligne médiane, hauteur des disques et pédicules " +
      "bien visibles, absence de tassement ou de scoliose majeure.",
  },
  {
    id: "base-droite",
    label: "Base droite",
    polygon: [
      { x: 150, y: 670 },
      { x: 450, y: 670 },
      { x: 470, y: 930 },
      { x: 410, y: 1020 },
      { x: 250, y: 1030 },
      { x: 140, y: 850 },
    ],
    color: "#cd2947",
    structures: ["right lung", "right hemidiaphragm"],
    reference:
      "Parenchyme clair jusqu'à la coupole droite, qui se projette au niveau de la 10e arcade postérieure. " +
      "Cul-de-sac latéral ouvert, pas d'épanchement pleural.",
  },
  {
    id: "base-gauche",
    label: "Base gauche",
    polygon: [
      { x: 650, y: 670 },
      { x: 970, y: 670 },
      { x: 970, y: 880 },
      { x: 940, y: 1040 },
      { x: 740, y: 1060 },
      { x: 650, y: 950 },
    ],
    color: "#c33489",
    structures: ["left lung", "left hemidiaphragm"],
    reference:
      "La poche à air gastrique sous la coupole gauche est une opacité de référence normale. " +
      "Pas d'épanchement, pas d'opacité rétro-cardiaque anormale.",
  },
  {
    id: "champ-sup-droit",
    label: "Champ supérieur droit",
    polygon: [
      { x: 170, y: 410 },
      { x: 490, y: 410 },
      { x: 490, y: 670 },
      { x: 150, y: 670 },
    ],
    color: "#b8005b",
    structures: ["right lung"],
    reference:
      "Réseau vasculaire de calibre progressivement décroissant vers la périphérie, clarté homogène, " +
      "sans opacité nodulaire ni ligne de pneumothorax.",
  },
  {
    id: "champ-sup-gauche",
    label: "Champ supérieur gauche",
    polygon: [
      { x: 630, y: 410 },
      { x: 950, y: 410 },
      { x: 970, y: 670 },
      { x: 630, y: 670 },
    ],
    color: "#ff803d",
    structures: ["left lung"],
    reference:
      "Parenchyme clair en regard de la région sous-clavière. La crosse aortique dessine un liseré médiastinal " +
      "régulier, sans élargissement.",
  },
  {
    id: "apex-droit",
    label: "Apex droit",
    polygon: [
      { x: 250, y: 220 },
      { x: 480, y: 220 },
      { x: 490, y: 410 },
      { x: 220, y: 410 },
    ],
    color: "#b8005b",
    structures: ["right lung"],
    reference:
      "Sommet pulmonaire clair, parcouru de fines opacités vasculaires qui s'amenuisent vers le rebord supérieur. " +
      "La plèvre apicale reste fine et régulière, sans opacité en calotte.",
  },
  {
    id: "apex-gauche",
    label: "Apex gauche",
    polygon: [
      { x: 630, y: 220 },
      { x: 860, y: 220 },
      { x: 890, y: 410 },
      { x: 630, y: 410 },
    ],
    color: "#ff803d",
    structures: ["left lung"],
    reference:
      "Transparence symétrique au côté droit. Le sommet s'efface partiellement derrière la clé de voûte aortique " +
      "en incidence de face, ce qui est habituel.",
  },
  {
    id: "silhouette-cardiaque",
    label: "Silhouette cardiaque",
    polygon: [
      { x: 450, y: 670 },
      { x: 640, y: 660 },
      { x: 730, y: 770 },
      { x: 780, y: 910 },
      { x: 760, y: 1010 },
      { x: 530, y: 1050 },
      { x: 440, y: 930 },
      { x: 430, y: 800 },
    ],
    color: "#00ec02",
    structures: ["heart"],
    reference:
      "Index cardio-thoracique < 50 % en incidence PA, contours nets, bord droit régulier, " +
      "apex gauche basculé sous la coupole. Pas de double contour ni de signe du ménisque.",
  },
  {
    id: "hile-droit",
    label: "Hile droit",
    polygon: [
      { x: 380, y: 530 },
      { x: 510, y: 530 },
      { x: 510, y: 720 },
      { x: 370, y: 720 },
    ],
    color: "#b8005b",
    structures: ["right lung"],
    reference:
      "Opacité hilaire triangulaire à base médiastinale, vaisseaux sectionnés de calibre normal (< 15 mm de section), " +
      "angle hilaire supérieur ouvert.",
  },
  {
    id: "hile-gauche",
    label: "Hile gauche",
    polygon: [
      { x: 610, y: 490 },
      { x: 740, y: 490 },
      { x: 750, y: 680 },
      { x: 610, y: 680 },
    ],
    color: "#ff803d",
    structures: ["left lung"],
    reference:
      "Hile physiologiquement plus haut que le droit. Absence de masse, d'adénopathie ou de calcification " +
      "juxta-hilaire.",
  },
  {
    id: "sinus-droit",
    label: "Sinus costo-diaphragmatique droit",
    polygon: [
      { x: 130, y: 1000 },
      { x: 250, y: 1000 },
      { x: 270, y: 1160 },
      { x: 190, y: 1220 },
      { x: 120, y: 1100 },
    ],
    color: "#cd2947",
    structures: ["right hemidiaphragm", "right lung"],
    reference:
      "Angles costo-phréniques droits pointus et clairs, ouverture supérieure à 30°, sans niveau liquide " +
      "ni comblement pleural.",
  },
  {
    id: "sinus-gauche",
    label: "Sinus costo-diaphragmatique gauche",
    polygon: [
      { x: 870, y: 1020 },
      { x: 990, y: 1020 },
      { x: 990, y: 1150 },
      { x: 910, y: 1250 },
      { x: 850, y: 1160 },
    ],
    color: "#c33489",
    structures: ["left hemidiaphragm", "left lung"],
    reference:
      "Angles costo-phréniques gauches pointus et clairs, ouverture supérieure à 30°, sans niveau liquide " +
      "ni émoussement pleural.",
  },
];

/** Algorithme de Ray-Casting pour tester si un point (x, y) est à l'intérieur d'un polygone. */
export function pointInPolygon(x: number, y: number, polygon: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Teste le point sur la carte (coordonnées en fraction 0..1 de la carte).
 *  Parcourt les régions dans l'ordre inverse de dessin (du premier plan vers le fond). */
export function regionHitTest(xF: number, yF: number): AnatomyRegion | null {
  if (xF < 0 || xF > 1 || yF < 0 || yF > 1) return null;
  const px = xF * ANATOMY_MAP_WIDTH;
  const py = yF * ANATOMY_MAP_HEIGHT;

  for (let i = ANATOMY_REGIONS.length - 1; i >= 0; i--) {
    const reg = ANATOMY_REGIONS[i];
    if (pointInPolygon(px, py, reg.polygon)) {
      return reg;
    }
  }
  return null;
}

/** Convertit une fraction de l'image (0..1) en fraction de la carte (projection 1:1)
 *  puis effectue le hit-test. */
export function regionAtImage(xF: number, yF: number): AnatomyRegion | null {
  return regionHitTest(xF, yF);
}
