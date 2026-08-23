/**
 * Types TypeScript du schéma Supabase AImaging — Phase Fondation.
 *
 * ⚠️ TYPES TEMPORAIRES DOCUMENTÉS (FONDATION.md §23) :
 * écrits à la main en miroir exact des migrations `supabase/migrations/`,
 * car la base n'est pas encore provisionnée et la CLI Supabase n'est pas
 * disponible ici. Dès que la base existe, remplacer ce fichier par les types
 * générés : `supabase gen types typescript --linked > client/src/lib/db/types.ts`
 * (l'interface `Database` ci-dessous respecte déjà le format généré).
 *
 * Convention : snake_case = colonnes PostgreSQL ; Row = ligne lue,
 * Insert = création (valeurs par défaut optionnelles), Update = patch partiel.
 */

/** JSONB tel que typé par supabase-js. */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

/* --------------------------------- profiles -------------------------------- */

export type ProfileRow = {
  id: string;
  display_name: string | null;
  ui_preferences: Json;
  created_at: string;
  updated_at: string;
};

export type ProfileInsert = {
  id: string;
  display_name?: string | null;
  ui_preferences?: Json;
};

export type ProfileUpdate = {
  display_name?: string | null;
  ui_preferences?: Json;
};

/* -------------------------------- workspaces ------------------------------- */

export type WorkspaceRow = {
  id: string;
  owner_id: string;
  name: string;
  created_at: string;
  updated_at: string;
};

export type WorkspaceInsert = {
  id?: string;
  owner_id: string;
  name: string;
};

export type WorkspaceUpdate = {
  name?: string;
};

/* ------------------------------- examinations ------------------------------ */

/** Modalités canoniques acceptées par examinations_modality_check (extensible via migration). */
export type ExaminationModality = "radiography" | "fetal_ultrasound" | "unknown";

export type ExaminationRow = {
  id: string;
  workspace_id: string;
  legacy_id: string | null;
  name: string;
  modality: string;
  archived: boolean;
  created_at: string;
  updated_at: string;
  last_opened_at: string | null;
};

export type ExaminationInsert = {
  id?: string;
  workspace_id: string;
  legacy_id?: string | null;
  name: string;
  modality: string;
  archived?: boolean;
  last_opened_at?: string | null;
  /** Préservé uniquement par la migration legacy (localStorage → Supabase) ;
      sinon la valeur par défaut PostgreSQL `now()` s'applique. */
  created_at?: string;
  /** Voir created_at : jamais écrit par les opérations CRUD normales
      (le trigger set_updated_at_examinations reste maître). */
  updated_at?: string;
};

export type ExaminationUpdate = {
  name?: string;
  modality?: string;
  archived?: boolean;
  last_opened_at?: string | null;
};

/* ---------------------------- examination_images --------------------------- */

export type ImageSourceKind = "browser-image" | "dicom" | "unknown";

export type ExaminationImageRow = {
  id: string;
  examination_id: string;
  legacy_id: string | null;
  filename: string;
  storage_path: string | null;
  mime_type: string | null;
  width: number | null;
  height: number | null;
  sort_order: number;
  source_kind: string | null;
  metadata: Json;
  display_state: Json;
  created_at: string;
  updated_at: string;
};

export type ExaminationImageInsert = {
  id?: string;
  examination_id: string;
  legacy_id?: string | null;
  filename: string;
  storage_path?: string | null;
  mime_type?: string | null;
  width?: number | null;
  height?: number | null;
  sort_order?: number;
  source_kind?: string | null;
  metadata?: Json;
  display_state?: Json;
};

export type ExaminationImageUpdate = {
  filename?: string;
  storage_path?: string | null;
  mime_type?: string | null;
  width?: number | null;
  height?: number | null;
  sort_order?: number;
  source_kind?: string | null;
  metadata?: Json;
  display_state?: Json;
};

/* -------------------------------- annotations ------------------------------ */

export type AnnotationCreatedBy = "user" | "ai";

export type AnnotationRow = {
  id: string;
  image_id: string;
  legacy_shape_id: string | null;
  type: string;
  geometry: Json;
  style: Json | null;
  label: string | null;
  visible: boolean;
  created_by: string;
  action_id: string | null;
  created_at: string;
  updated_at: string;
};

export type AnnotationInsert = {
  id?: string;
  image_id: string;
  legacy_shape_id?: string | null;
  type: string;
  geometry: Json;
  style?: Json | null;
  label?: string | null;
  visible?: boolean;
  created_by: string;
  action_id?: string | null;
};

export type AnnotationUpdate = {
  type?: string;
  geometry?: Json;
  style?: Json | null;
  label?: string | null;
  visible?: boolean;
  action_id?: string | null;
};

/* ------------------------------- analysis_runs ----------------------------- */

/**
 * Types d'analyse acceptés par `analysis_runs_analysis_type_check`.
 * reconstruction_3d volontairement absent : la 3D est hors périmètre
 * (FONDATION.md §2).
 */
export type AnalysisType =
  | "classification"
  | "gradcam"
  | "cxas"
  | "hybridgnet"
  | "quality"
  | "plane"
  | "fetalclip"
  | "anomaly"
  | "multimodal"
  | "opencxr_sort"
  | "opencxr_standardize"
  | "report";

export type AnalysisStatus = "pending" | "running" | "done" | "error" | "rejected";

export type AnalysisRunRow = {
  id: string;
  examination_id: string;
  image_id: string | null;
  analysis_type: string;
  model_name: string | null;
  model_version: string | null;
  status: string;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  metadata: Json;
  created_at: string;
  updated_at: string;
};

export type AnalysisRunInsert = {
  id?: string;
  examination_id: string;
  image_id?: string | null;
  analysis_type: string;
  model_name?: string | null;
  model_version?: string | null;
  status?: string;
  error_message?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  metadata?: Json;
};

export type AnalysisRunUpdate = {
  image_id?: string | null;
  status?: string;
  error_message?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  metadata?: Json;
};

/* --------------------------- classification_results ------------------------ */

export type ClassificationSource = "per_model" | "ensemble";

export type ClassificationResultRow = {
  id: string;
  analysis_run_id: string;
  class_name: string;
  probability: number;
  source: string;
  model_architecture: string | null;
  created_at: string;
};

export type ClassificationResultInsert = {
  id?: string;
  analysis_run_id: string;
  class_name: string;
  probability: number;
  source: string;
  model_architecture?: string | null;
};

/* -------------------------------- measurements ----------------------------- */

export type MeasurementSource = "user" | "ai";

export type MeasurementRow = {
  id: string;
  analysis_run_id: string | null;
  image_id: string;
  annotation_id: string | null;
  type: string;
  value: number | null;
  unit: string;
  source: string;
  confidence: number | null;
  geometry: Json | null;
  metadata: Json;
  created_at: string;
  updated_at: string;
};

export type MeasurementInsert = {
  id?: string;
  analysis_run_id?: string | null;
  image_id: string;
  annotation_id?: string | null;
  type: string;
  value?: number | null;
  unit: string;
  source: string;
  confidence?: number | null;
  geometry?: Json | null;
  metadata?: Json;
};

export type MeasurementUpdate = {
  value?: number | null;
  unit?: string;
  confidence?: number | null;
  annotation_id?: string | null;
  geometry?: Json | null;
  metadata?: Json;
};

/* ---------------------------------- reports -------------------------------- */

export type ReportType = "radiography_ai" | "fetal_obstetric";

export type ReportStatus = "draft" | "generated" | "needs_review" | "validated";

export type ReportRow = {
  id: string;
  examination_id: string;
  type: string;
  status: string;
  content: string | null;
  structured_data: Json | null;
  storage_path: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type ReportInsert = {
  id?: string;
  examination_id: string;
  type: string;
  status?: string;
  content?: string | null;
  structured_data?: Json | null;
  storage_path?: string | null;
  created_by?: string;
};

export type ReportUpdate = {
  status?: string;
  content?: string | null;
  structured_data?: Json | null;
  storage_path?: string | null;
};

/* ----------------------------------------------------------------------------
 * Interface `Database` au format des types générés par supabase-js :
 * permet de brancher createClient<Database>() sans changement le jour où les
 * types sont régénérés depuis la base réelle.
 * ------------------------------------------------------------------------- */
export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: ProfileRow;
        Insert: ProfileInsert;
        Update: ProfileUpdate;
        Relationships: [];
      };
      workspaces: {
        Row: WorkspaceRow;
        Insert: WorkspaceInsert;
        Update: WorkspaceUpdate;
        Relationships: [];
      };
      examinations: {
        Row: ExaminationRow;
        Insert: ExaminationInsert;
        Update: ExaminationUpdate;
        Relationships: [];
      };
      examination_images: {
        Row: ExaminationImageRow;
        Insert: ExaminationImageInsert;
        Update: ExaminationImageUpdate;
        Relationships: [];
      };
      annotations: {
        Row: AnnotationRow;
        Insert: AnnotationInsert;
        Update: AnnotationUpdate;
        Relationships: [];
      };
      analysis_runs: {
        Row: AnalysisRunRow;
        Insert: AnalysisRunInsert;
        Update: AnalysisRunUpdate;
        Relationships: [];
      };
      classification_results: {
        Row: ClassificationResultRow;
        Insert: ClassificationResultInsert;
        Update: Partial<ClassificationResultInsert>;
        Relationships: [];
      };
      measurements: {
        Row: MeasurementRow;
        Insert: MeasurementInsert;
        Update: MeasurementUpdate;
        Relationships: [];
      };
      reports: {
        Row: ReportRow;
        Insert: ReportInsert;
        Update: ReportUpdate;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      owns_workspace: {
        Args: { ws_id: string };
        Returns: boolean;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
