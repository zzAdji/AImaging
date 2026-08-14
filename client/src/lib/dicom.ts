/** API adapter for real DICOM parsing. The original DICOM bytes never enter local storage. */

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

export interface ParsedDicomMetadata {
  modality: string | null;
  study_instance_uid: string | null;
  series_instance_uid: string | null;
  sop_instance_uid: string | null;
  frame_of_reference_uid: string | null;
  patient_pseudonym: string | null;
  pixel_spacing_mm: [number, number] | null;
  body_part_examined: string | null;
  view_position: string | null;
  study_date: string | null;
  study_description: string | null;
  series_description: string | null;
  photometric_interpretation: string | null;
  rows: number | null;
  columns: number | null;
  bits_stored: number | null;
  window_center: number | null;
  window_width: number | null;
  number_of_frames: number;
}

/** Buffer linéaire des pixels DICOM (Rescale Slope/Intercept appliqués).

`dataUrl` est un base64 d'uint16 little-endian ; chaque valeur reconstruite :
`raw = min + uint16 * scale`. Permet d'appliquer fenêtrage/niveau nativement
sur les valeurs physiques (HU) au lieu de l'approximation CSS sur le rendu PNG.
 */
export interface LinearImageBuffer {
  dataUrl: string;
  min: number;
  max: number;
  scale: number;
  width: number;
  height: number;
  /** PhotometricInterpretation === "MONOCHROME1" : le rendu doit inverser le mapping. */
  inverted: boolean;
}

export interface ParsedDicomFrame {
  frame_index: number;
  image_data_url: string;
  width: number;
  height: number;
  linear_data_url: string | null;
  linear_min: number | null;
  linear_max: number | null;
  linear_scale: number | null;
}

export interface ParsedDicomImport {
  metadata: ParsedDicomMetadata;
  frames: ParsedDicomFrame[];
  warnings: string[];
}

export function isDicomFile(file: File): boolean {
  const lowerName = file.name.toLowerCase();
  return lowerName.endsWith(".dcm") || lowerName.endsWith(".dicom") || file.type === "application/dicom";
}

export async function parseDicomFile(file: File): Promise<ParsedDicomImport> {
  const body = new FormData();
  body.append("file", file, file.name || "image.dcm");
  const response = await fetch(`${API_BASE_URL}/dicom/parse`, { method: "POST", body });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Import DICOM impossible (${response.status}) : ${detail || response.statusText}`);
  }
  return response.json() as Promise<ParsedDicomImport>;
}
