import type { ExamImageMetadata } from "./examinations";
import type { WlValue } from "../state/workspace";

/** Metadata rows shown in the UI. Values are real DICOM fields when available. */

export interface MetadataInput {
  name: string;
  dims: { w: number; h: number };
  metadata: ExamImageMetadata | null;
  wl: WlValue;
}

function valueOrUnknown(value: string | number | undefined): string {
  return value === undefined || value === "" ? "Non renseigné" : String(value);
}

function compactUid(uid: string | undefined): string {
  if (!uid) return "Non renseigné";
  return uid.length <= 34 ? uid : `${uid.slice(0, 17)}…${uid.slice(-12)}`;
}

export function deriveMetadata({ name, dims, metadata, wl }: MetadataInput): [string, string][] {
  const rows: [string, string][] = [
    ["Name", name],
    ["Dimensions", `${dims.w} × ${dims.h} px`],
    ["Display W/L", `${Math.round(wl.window)} / ${Math.round(wl.level)}`],
  ];
  if (!metadata) {
    return [
      ["Source", "Image navigateur"],
      ["Modality", "Non renseignée"],
      ["Calibration", "Absente — mesures en pixels"],
      ...rows,
    ];
  }

  const spacing = metadata.pixelSpacingMm
    ? `${metadata.pixelSpacingMm[0]} × ${metadata.pixelSpacingMm[1]} mm/px (row × column)`
    : "Absente — mesures en pixels";
  return [
    ["Source", "DICOM rendu par le serveur"],
    ["Modality", valueOrUnknown(metadata.modality)],
    ["Pixel spacing", spacing],
    ["Calibration", metadata.pixelSpacingMm ? "DICOM active" : "Non calibrée"],
    ["Rows / Columns", `${valueOrUnknown(metadata.rows)} / ${valueOrUnknown(metadata.columns)}`],
    ["Bits stored", valueOrUnknown(metadata.bitsStored)],
    ["Photometric", valueOrUnknown(metadata.photometricInterpretation)],
    ["View position", valueOrUnknown(metadata.viewPosition)],
    ["Body part", valueOrUnknown(metadata.bodyPartExamined)],
    ["Study UID", compactUid(metadata.studyInstanceUid)],
    ["Series UID", compactUid(metadata.seriesInstanceUid)],
    ["Frame count", valueOrUnknown(metadata.numberOfFrames)],
    ...rows,
  ];
}
