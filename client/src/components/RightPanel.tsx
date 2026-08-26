import { useMemo, useRef, useState } from "react";
import { Download, Pencil } from "lucide-react";
import { cn } from "../lib/cn";
import { downloadDataUrl, exportImageDataUrl } from "../lib/exportImage";
import {
  buildRadiographyStructuredData,
  defaultTemplateData,
  renderDocument,
  type ReportModality,
  type ReportTemplateData,
} from "../lib/reports/engine";
import { buildReportClinicalContext } from "../lib/reports/clinicalContext";
import {
  buildReportFilename,
  buildReportJsonExport,
  buildWordDocument,
  documentHtml,
  downloadTextFile,
  printDocument,
} from "../lib/reports/pdfExport";
import { getLocalDefault } from "../lib/db/templateStore";
import {
  BC_PRESETS,
  WL_PRESETS,
  WL_PRESETS_HU,
  buildImageFilter,
  isShapeVisible,
  useWorkspace,
  type PatientInfo,
  type SectionId,
} from "../state/workspace";
import { AnatomyMapCard } from "./ai/AnatomyMap";
import { PathologyDetectionCard } from "./ai/PathologyDetection";
import { AnatomySegmentationCard } from "./ai/AnatomySegmentation";
import { LandmarksMeasurementsCard } from "./ai/LandmarksMeasurements";
import { FetalCardsBody } from "./fetal/FetalRightPanel";
import { useEditorModality } from "../state/editorModality";
import { Button, Divider, ProgressBar, Section, Segmented, Slider, Toggle } from "./ui";

/* ---------------------------------- Image --------------------------------- */

function SliderRow({
  label,
  value,
  min,
  max,
  onChange,
  inputData,
  onSettle,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  inputData?: string;
  onSettle?: (v: number) => void;
}) {
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const settleTimer = useRef<number | null>(null);
  const settled = (v: number) => {
    if (!onSettle) return;
    if (settleTimer.current !== null) window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => {
      settleTimer.current = null;
      onSettle(v);
    }, 700);
  };
  return (
    <div className="mt-2.5">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[12px] text-ink-2">{label}</span>
        <input
          type="number"
          data-input={inputData}
          min={min}
          max={max}
          value={value}
          onChange={(e) => {
            const v = clamp(Number(e.target.value));
            onChange(v);
            settled(v);
          }}
          className="w-16 rounded-md border border-border bg-btn px-1.5 py-0.5 text-right text-[11px] tabular-nums text-ink outline-none transition-colors duration-150 ease-out focus:border-accent/60"
        />
      </div>
      <Slider
        value={value}
        min={min}
        max={max}
        onChange={(v) => {
          const c = clamp(v);
          onChange(c);
          settled(c);
        }}
      />
    </div>
  );
}

function PresetChips<T extends { label: string }>({
  options,
  isActive,
  onSelect,
}: {
  options: T[];
  isActive: (o: T) => boolean;
  onSelect: (o: T) => void;
}) {
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {options.map((o) => (
        <button
          key={o.label}
          type="button"
          onClick={() => onSelect(o)}
          className={cn(
            "rounded-full border px-2 py-0.5 text-[10.5px] transition-colors duration-150 ease-out",
            isActive(o)
              ? "border-accent/50 bg-accent/15 text-accent"
              : "border-border bg-btn text-ink-3 hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function ImageSection() {
  const w = useWorkspace();
  const native = Boolean(w.dicomLinear);
  const defaultWl = useMemo(() => {
    if (native && w.imageMetadata?.windowWidth && w.imageMetadata.windowWidth > 1) {
      return { window: w.imageMetadata.windowWidth, level: w.imageMetadata.windowCenter ?? 127.5 };
    }
    return { window: 255, level: 127.5 };
  }, [native, w.imageMetadata]);
  const reset = () => {
    w.setBrightness(50);
    w.setContrast(50);
    w.setWl(defaultWl);
    w.setInverted(false);
  };
  return (
    <Section id="image" title="Régler l'image">
      <Segmented
        options={[
          { label: "Fit", value: "fit" },
          { label: "100%", value: "actual" },
        ]}
        value={w.zoomPreset}
        onChange={(v) =>
          v === "fit" ? w.requestFit() : w.setActiveView({ ...(w.activePane === "B" ? w.viewB : w.view), s: 1 })
        }
      />
      <div className="flex items-center justify-between">
        <span className="text-[12px] text-ink-2">Invert</span>
        <Toggle
          checked={w.inverted}
          onChange={(v) => {
            w.setInverted(v);
          }}
        />
      </div>
      <div className="mt-2.5 flex gap-1.5">
        <button
          type="button"
          data-attr="flip-h"
          onClick={() => {
            w.pushHistory();
            w.setFlipH(!w.flipH);
          }}
          className={cn(
            "flex-1 rounded-lg border border-border bg-btn px-2 py-1 text-[11.5px] transition-colors duration-150 ease-out",
            w.flipH
              ? "border-accent/50 bg-accent/15 text-accent"
              : "text-ink-2 hover:text-ink",
          )}
        >
          Flip H
        </button>
        <button
          type="button"
          data-attr="flip-v"
          onClick={() => {
            w.pushHistory();
            w.setFlipV(!w.flipV);
          }}
          className={cn(
            "flex-1 rounded-lg border border-border bg-btn px-2 py-1 text-[11.5px] transition-colors duration-150 ease-out",
            w.flipV
              ? "border-accent/50 bg-accent/15 text-accent"
              : "text-ink-2 hover:text-ink",
          )}
        >
          Flip V
        </button>
      </div>
      <SliderRow
        label="Brightness"
        value={w.brightness}
        min={0}
        max={100}
        onChange={w.setBrightness}
        inputData="brightness-input"
      />
      <SliderRow
        label="Contrast"
        value={w.contrast}
        min={0}
        max={100}
        onChange={w.setContrast}
        inputData="contrast-input"
      />
      <PresetChips
        options={BC_PRESETS}
        isActive={(p) => p.brightness === w.brightness && p.contrast === w.contrast}
        onSelect={(p) => {
          w.setBrightness(p.brightness);
          w.setContrast(p.contrast);
        }}
      />
      <Divider className="mt-3" />
      <SliderRow
        label="Window"
        value={w.wl.window}
        min={native ? 1 : 20}
        max={native ? Math.max(512, Math.round((w.dicomLinear?.max ?? 255) - (w.dicomLinear?.min ?? 0) + 1)) : 512}
        onChange={(v) => w.setWl({ ...w.wl, window: v })}
        inputData="window-input"
      />
      <SliderRow
        label="Level"
        value={w.wl.level}
        min={native ? Math.floor(w.dicomLinear?.min ?? 0) : 0}
        max={native ? Math.ceil(w.dicomLinear?.max ?? 255) : 255}
        onChange={(v) => w.setWl({ ...w.wl, level: v })}
        inputData="level-input"
      />
      <PresetChips
        options={native ? WL_PRESETS_HU : WL_PRESETS}
        isActive={(p) => p.wl.window === w.wl.window && p.wl.level === w.wl.level}
        onSelect={(p) => {
          w.setWl(p.wl);
        }}
      />
      <Divider className="mt-3" />
      <button
        type="button"
        onClick={reset}
        className="text-[12px] text-accent transition-colors duration-150 ease-out hover:text-ink"
      >
        Reset adjustments
      </button>
    </Section>
  );
}

/* -------------------------------- Document -------------------------------- */

/** Champs patient éditables de la carte « Document », dans l'ordre d'affichage. */
const PATIENT_FIELDS: Array<{ key: PatientInfoKey; label: string }> = [
  { key: "name", label: "Patient" },
  { key: "patientId", label: "Patient ID" },
  { key: "age", label: "Age" },
  { key: "sex", label: "Sex" },
  { key: "studyDate", label: "Study date" },
  { key: "modality", label: "Modality" },
  { key: "study", label: "Study" },
];

type PatientInfoKey = keyof PatientInfo;

/** Ligne KV cliquable : un clic passe en édition inline (Enter valide,
 *  Escape annule), exactement comme le renommage du document. */
function PatientFieldRow({
  label,
  value,
  editing,
  draft,
  onStart,
  onDraft,
  onCommit,
  onCancel,
}: {
  label: string;
  value: string;
  editing: boolean;
  draft: string;
  onStart: () => void;
  onDraft: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  if (editing) {
    return (
      <div className="flex items-center gap-2 px-1 py-[3px]">
        <span className="w-[78px] shrink-0 truncate text-[11.5px] text-ink-3">{label}</span>
        <input
          autoFocus
          data-attr={`doc-field-input-${label}`}
          value={draft}
          onChange={(e) => onDraft(e.target.value)}
          onBlur={onCommit}
          onKeyDown={(e) => {
            if (e.key === "Enter") onCommit();
            if (e.key === "Escape") onCancel();
          }}
          className="min-w-0 flex-1 rounded-md border border-border bg-btn px-1.5 py-0.5 text-[12px] text-ink outline-none focus:border-accent/60"
        />
      </div>
    );
  }
  return (
    <button
      type="button"
      data-attr={`doc-field-${label}`}
      title={`Modifier ${label.toLowerCase()}`}
      onClick={onStart}
      className="group flex w-full items-baseline gap-2 rounded-md px-1 py-[3px] text-left transition-colors duration-150 ease-out hover:bg-hover"
    >
      <span className="w-[78px] shrink-0 truncate text-[11.5px] text-ink-3">{label}</span>
      <span className="min-w-0 flex-1 truncate text-right text-[12px] text-ink-2 group-hover:text-ink">
        {value || "—"}
      </span>
      <Pencil
        size={10}
        className="shrink-0 self-center text-transparent transition-colors group-hover:text-ink-3"
      />
    </button>
  );
}

function DocumentSection() {
  const w = useWorkspace();
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState("");
  /* Édition inline des infos patient (une ligne à la fois, pattern rename). */
  const [editingKey, setEditingKey] = useState<PatientInfoKey | null>(null);
  const [fieldDraft, setFieldDraft] = useState("");

  const startFieldEdit = (key: PatientInfoKey) => {
    setFieldDraft(w.patientInfo[key]);
    setEditingKey(key);
  };
  const commitFieldEdit = () => {
    if (editingKey !== null) w.setPatientInfo({ [editingKey]: fieldDraft.trim() });
    setEditingKey(null);
  };
  const cancelFieldEdit = () => setEditingKey(null);

  const startRename = () => {
    setDraft(w.imageName);
    setRenaming(true);
  };
  const commitRename = () => {
    const n = draft.trim();
    if (n) w.setImageName(n);
    setRenaming(false);
  };

  const doExport = async () => {
    if (!w.imageSrc) return;
    const url = await exportImageDataUrl({
      imageSrc: w.dicomLinear ? w.renderSrc : w.imageSrc,
      dims: w.dims,
      shapes: w.shapes.filter((s) => isShapeVisible(s, w.layers)),
      filter: w.dicomLinear ? "none" : buildImageFilter(w.wl, w.brightness, w.contrast, w.inverted),
      pixelSpacingMm: w.pixelSpacingMm,
      format: "png",
    });
    downloadDataUrl(url, `${w.imageName}.png`);
  };

  const printDoc = () => {
    if (!w.imageSrc) return;
    try {
      const win = window.open("", "_blank");
      if (!win) return;
      const filter = w.dicomLinear
        ? "none"
        : buildImageFilter(w.wl, w.brightness, w.contrast, w.inverted);
      const esc = (s: string) =>
        s
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;");
      win.document.write(
        `<!doctype html><html><head><meta charset="utf-8"><title>Print — ${esc(w.imageName)}</title>` +
          `<style>@page{margin:12mm}body{margin:0;background:#fff;font-family:Inter,Arial,sans-serif;display:flex;flex-direction:column;align-items:center;gap:12px;padding:12px}h1{font-size:13px;color:#444;font-weight:600;margin:0}img{max-width:94vw;max-height:84vh;object-fit:contain;filter:${esc(filter)}}p{font-size:10px;color:#999;margin:0}</style></head>` +
          `<body><h1>${esc(w.imageName)}</h1><img src="${esc(w.dicomLinear ? w.renderSrc : w.imageSrc)}" alt=""><p>${w.dims.w} × ${w.dims.h} px</p>` +
          `<script>window.addEventListener('load',function(){window.print();});</scr` +
          `ipt></body></html>`,
      );
      win.document.close();
    } catch {
      /* popup blocked */
    }
  };

  return (
    <Section id="document" title="Document">
      <div className="flex items-center gap-2.5">
        <img
          src={w.renderSrc}
          alt=""
          className="h-12 w-12 shrink-0 rounded-lg border border-border object-cover"
        />
        <div className="min-w-0 flex-1">
          {renaming ? (
            <input
              autoFocus
              data-attr="doc-name-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") setRenaming(false);
              }}
              className="w-full rounded-md border border-border bg-btn px-1.5 py-0.5 text-[12.5px] text-ink outline-none focus:border-accent/60"
            />
          ) : (
            <div className="flex items-center gap-1.5">
              <p data-attr="doc-name" className="truncate text-[13px] font-medium text-ink">
                {w.imageName}
              </p>
              <button
                type="button"
                data-attr="doc-rename"
                onClick={startRename}
                className="shrink-0 text-ink-3 transition-colors duration-150 ease-out hover:text-ink"
                title="Rename document"
              >
                <Pencil size={12} />
              </button>
            </div>
          )}
          <p className="text-[11px] text-ink-3">
            {[w.patientInfo.modality, w.patientInfo.study].filter(Boolean).join(" · ") || "CR · Chest · PA view"}
          </p>
        </div>
      </div>
      <Divider />
      {PATIENT_FIELDS.map(({ key, label }) => (
        <PatientFieldRow
          key={key}
          label={label}
          value={w.patientInfo[key]}
          editing={editingKey === key}
          draft={fieldDraft}
          onStart={() => startFieldEdit(key)}
          onDraft={setFieldDraft}
          onCommit={commitFieldEdit}
          onCancel={cancelFieldEdit}
        />
      ))}
      <Divider />
      <div className="flex gap-2">
        <Button className="flex-1" data="doc-export" disabled={!w.imageSrc} onClick={doExport}>
          Export
        </Button>
        <Button className="flex-1" data="doc-print" disabled={!w.imageSrc} onClick={printDoc}>
          Print
        </Button>
      </div>
    </Section>
  );
}

/* --------------------------------- Grad-CAM ------------------------------- */

function GradCamSection() {
  const w = useWorkspace();
  return (
    <Section id="gradcam" title="Grad-CAM">
      <div className="flex items-center justify-between">
        <span className="text-[12px] text-ink-2">Afficher l'overlay</span>
        <Toggle checked={w.gradcamOn} onChange={w.setGradcamOn} />
      </div>
      <div>
        <span className="mb-1.5 block text-[12px] text-ink-2">Mode</span>
        <div className="flex items-center gap-0.5 rounded-md border border-border bg-btn p-1">
          <button
            type="button"
            data-attr="gradcam-mode-blue"
            onClick={() => w.setGradcamMode("blue")}
            className={`rounded px-2.5 py-1 text-[10.5px] leading-none transition-colors ${w.gradcamMode === "blue" ? "bg-blue-500/25 text-blue-300" : "text-ink-3 hover:text-ink"}`}
          >
            Bleu
          </button>
          <button
            type="button"
            data-attr="gradcam-mode-heatmap"
            onClick={() => w.setGradcamMode("heatmap")}
            className={`rounded px-2.5 py-1 text-[10.5px] leading-none transition-colors ${w.gradcamMode === "heatmap" ? "bg-blue-500/25 text-blue-300" : "text-ink-3 hover:text-ink"}`}
          >
            Chaleur
          </button>
        </div>
      </div>
      <Slider
        label={w.gradcamMode == "blue" ? "Intensité" : "Opacité"}
        value={w.gradcamIntensity}
        onChange={w.setGradcamIntensity}
        disabled={!w.gradcamOn}
        display={`${w.gradcamIntensity}%`}
      />
    </Section>
  );
}

/* -------------------------------- Diagnostics ----------------------------- */

const SEVERITY_STYLE: Record<string, string> = {
  high: "bg-[#f87171]/15 text-[#f87171]",
  medium: "bg-[#facc15]/15 text-[#facc15]",
  low: "bg-[#4ade80]/15 text-[#4ade80]",
};

type MergedSeverity = "low" | "medium" | "high";

interface MergedFinding {
  key: string;
  label: string;
  prob: number;
  severity: MergedSeverity;
  /** Source du finding : ensemble local ou backend Neuro (YOLOv8+DenseNet). */
  source: "ensemble" | "neuro";
  risk?: string;
  region?: { x: number; y: number; w: number; h: number };
}

function riskToSeverity(risk: string): MergedSeverity {
  if (risk === "CRITICAL" || risk === "HIGH") return "high";
  if (risk === "MEDIUM") return "medium";
  return "low";
}

function normalizeLabel(label: string): string {
  return label.replace(/_/g, " ").trim().toLowerCase();
}

/** Fusionne les diagnostics de l'ensemble local et les findings confirmés du
    backend Neuro (détection YOLOv8 filtrée par DenseNet). Un finding Neuro
    dont la classe est déjà signalée par l'ensemble local n'est pas dupliqué :
    l'entrée locale fait foi (elle porte la région du zoom). */
function mergeFindings(w: ReturnType<typeof useWorkspace>): MergedFinding[] {
  const merged: MergedFinding[] = w.aiResults.diagnostics.map((d) => ({
    key: `local-${d.label}`,
    label: d.label,
    prob: d.prob,
    severity: d.severity,
    source: "ensemble" as const,
    region: d.region,
  }));
  const known = new Set(merged.map((f) => normalizeLabel(f.label)));
  const result = w.pathologyResult;
  if (result) {
    for (const finding of result.confirmed_findings) {
      const label = finding.condition.replace(/_/g, " ");
      const norm = normalizeLabel(label);
      if (known.has(norm)) continue;
      const box = result.yolo_boxes.find((b) => normalizeLabel(b.class) === norm);
      merged.push({
        key: `neuro-${finding.condition}`,
        label,
        prob: finding.prob,
        severity: riskToSeverity(finding.risk),
        source: "neuro",
        risk: finding.risk,
        region: box
          ? {
              x: box.xyxy[0],
              y: box.xyxy[1],
              w: Math.max(1, box.xyxy[2] - box.xyxy[0]),
              h: Math.max(1, box.xyxy[3] - box.xyxy[1]),
            }
          : undefined,
      });
    }
  }
  return merged.sort((a, b) => b.prob - a.prob);
}

function DiagnosticsSection() {
  const w = useWorkspace();
  const findings = mergeFindings(w);
  return (
    <Section id="diagnostics" title="Diagnostics">
      <div data-attr="ai-card-diagnostics">
        {findings.length === 0 ? (
          <p className="px-1 text-[11px] text-ink-3">
            Aucune analyse — lancez une commande comme « Analyse cette radiographie. »
          </p>
        ) : (
          <div className="space-y-1">
            {findings.map((d) => (
              <div
                key={d.key}
                className="w-full rounded-lg border border-transparent px-2 py-1.5 text-left"
              >
                <div className="flex items-center gap-2">
                  <span className="truncate text-[11.5px] text-ink">{d.label}</span>
                  <span className="ml-auto shrink-0 text-[11px] tabular-nums text-ink">{Math.round(d.prob * 100)}%</span>
                  <span className={cn("shrink-0 rounded-full px-1.5 py-px text-[9.5px] font-medium", SEVERITY_STYLE[d.severity])}>
                    {d.severity === "high" ? "Élevé" : d.severity === "medium" ? "Modéré" : "Faible"}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-1.5">
                  <div className="min-w-0 flex-1">
                    <ProgressBar value={Math.round(d.prob * 100)} tone={d.prob >= 0.3 ? "accent" : "neutral"} />
                  </div>
                  {d.source === "neuro" && (
                    <span className="shrink-0 rounded-full border border-border/70 px-1.5 py-px text-[8.5px] font-medium uppercase tracking-wide text-ink-3">
                      {d.risk ?? "Neuro"}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Section>
  );
}

/* ----------------------------------- Rapport ------------------------------ */

function ReportSection() {
  const w = useWorkspace();
  const m = useEditorModality();
  const [exportOpen, setExportOpen] = useState(false);
  const modality: ReportModality = m.modality === "fetal_ultrasound" ? "fetal_ultrasound" : "radiography";

  const handleExport = (kind: "pdf" | "word" | "json") => {
    const template =
      getLocalDefault(modality, null)?.data ??
      (defaultTemplateData(modality) as ReportTemplateData);
    /* Infos patient de la carte « Document » : injectées comme variables du
       template (upsert par clé) pour que les tokens `{{patientName}}` etc. des
       blocs libres et les cellules d'en-tête PDF/Word portent les vraies
       valeurs éditées par le praticien — plus jamais les valeurs codées en dur. */
    const p = w.patientInfo;
    const patientTokens: Record<string, string> = {
      patientName: p.name,
      patientId: p.patientId,
      age: p.age,
      sex: p.sex,
      ageSex: [p.age, p.sex].filter((s) => s.length > 0).join(" / "),
      examDate: p.studyDate,
      modality: p.modality,
      study: p.study,
    };
    const existingKeys = new Set(template.variables.map((v) => v.key));
    const withPatient: ReportTemplateData = {
      ...template,
      variables: [
        ...template.variables.map((v) =>
          v.key in patientTokens ? { ...v, value: patientTokens[v.key] ?? v.value } : v,
        ),
        ...Object.entries(patientTokens)
          .filter(([key]) => !existingKeys.has(key))
          .map(([key, value]) => ({
            key,
            label: key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()),
            value,
            visible: true,
          })),
      ],
    };
    /* Défaut §1 : le structured_data doit venir des vraies données collectées
       (champs LLM, diagnostics fusionnés, cohérence, mesures) — jamais du
       texte brut tronqué. `buildRadiographyStructuredData` (engine.ts) est la
       source unique consommée par l'aperçu, le PDF, le Word et le JSON. */
    /* Contexte clinique reconstruit depuis l'état live du workspace :
       détections Neuro confirmées + observations régionales anatomiques
       (éditions praticien prioritaires sur les textes IA). */
    const clinicalCtx = buildReportClinicalContext({
      pathologyResult: w.pathologyResult,
      anatomyRegionTexts: w.anatomyRegionTexts,
      anatomyRegionAnomalies: w.anatomyRegionAnomalies,
      anatomyRegionOverrides: w.anatomyRegionOverrides,
    });
    const structured =
      modality === "radiography"
        ? buildRadiographyStructuredData({
            /* Champs structurés bruts du backend (RadiologyReportFields) ; `{}`
               tant qu'aucune génération LLM n'a réussi (aucune valeur inventée). */
            fields: w.aiResults.reportFields ?? {},
            coherenceIssues: w.aiResults.reportCoherenceIssues,
            renderedText: w.aiResults.report ?? undefined,
            ensemblePrediction: mergeFindings(w)[0]?.label ?? null,
            numModels: w.aiResults.modelCount,
            neuroFindings: clinicalCtx.neuro_findings,
            neuroRiskLevel: clinicalCtx.neuro_risk_level,
            anatomyObservations: clinicalCtx.anatomy_observations,
            /* TODO(§1) : brancher les mesures réellement posées sur le canvas
               (LandmarksMeasurementsCard) — ce composant n'expose pas encore
               ses données au niveau du workspace ; aucune mesure n'est donc
               inventée ici tant que ce câblage n'existe pas. */
            measurements: [],
          })
        : {
            findings: { draft: (w.aiResults.report ?? "").slice(0, 4000) },
            note: "Contenu édité par le praticien.",
          };
    const rendered = renderDocument(modality, structured, withPatient);
    const date = new Date();
    if (kind === "pdf") {
      printDocument(documentHtml(rendered));
    } else if (kind === "word") {
      downloadTextFile(
        buildReportFilename(modality, date, "doc"),
        buildWordDocument(rendered),
        "application/msword",
      );
    } else {
      downloadTextFile(
        buildReportFilename(modality, date, "json"),
        JSON.stringify(buildReportJsonExport(rendered, w.aiResults.report ?? ""), null, 2),
        "application/json",
      );
    }
    setExportOpen(false);
  };

  const validated = w.radioReportValidated === true;
  return (
    <Section id="report" title="Rapport">
      {!w.aiResults.report ? (
        <p className="px-1 text-[11px] text-ink-3">
          Aucun rapport — commande « Génère un rapport ».
        </p>
      ) : (
        <>
          <div className="flex items-center gap-1.5 px-1 pb-1">
            <span
              className={
                validated
                  ? "rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-px text-[10px] font-medium text-emerald-300"
                  : "rounded-full bg-accent/15 px-2 py-px text-[10px] font-medium text-accent"
              }
            >
              {validated ? "Validé" : "Édition"}
            </span>
          </div>
          <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-ink-2">
            {w.aiResults.report}
          </p>
          <div className="mt-2 flex items-center gap-1.5">
            <button
              type="button"
              data-attr="ai-report-edit"
              title="Éditer le rapport"
              onClick={() => w.openReportEditor()}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-border bg-btn text-ink-2 transition-colors duration-150 ease-out hover:bg-hover hover:text-ink"
            >
              <Pencil size={12} />
            </button>
            <div className="relative">
              <button
                type="button"
                data-attr="ai-report-export"
                title="Exporter (PDF / Word / JSON)"
                onClick={() => setExportOpen((v) => !v)}
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-border bg-btn text-ink-2 transition-colors duration-150 ease-out hover:bg-hover hover:text-ink"
              >
                <Download size={12} />
              </button>
              {exportOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setExportOpen(false)} />
                  <div className="absolute left-0 bottom-full z-50 mb-1 min-w-[140px] overflow-hidden rounded-lg border border-border bg-panel shadow-2xl shadow-black/50">
                    <button
                      type="button"
                      onClick={() => handleExport("pdf")}
                      className="block w-full px-2.5 py-1.5 text-left text-[11px] text-ink-2 transition-colors hover:bg-hover hover:text-ink"
                    >
                      PDF · Enregistrer en PDF
                    </button>
                    <button
                      type="button"
                      onClick={() => handleExport("word")}
                      className="block w-full px-2.5 py-1.5 text-left text-[11px] text-ink-2 transition-colors hover:bg-hover hover:text-ink"
                    >
                      Word · .doc
                    </button>
                    <button
                      type="button"
                      onClick={() => handleExport("json")}
                      className="block w-full px-2.5 py-1.5 text-left text-[11px] text-ink-2 transition-colors hover:bg-hover hover:text-ink"
                    >
                      JSON · structuré
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </Section>
  );
}

/* -------------------------------- Right panel ------------------------------ */

const CARD_TITLES: Record<SectionId, string> = {
  document: "Document",
  image: "Régler l'image",
  gradcam: "Grad-CAM",
  anatomy: "Segmentation",
  landmarks: "Mesures landmarks",
  anatomymap: "Carte anatomique",
  pathology: "Détection & Heatmaps",
  diagnostics: "Diagnostics",
  report: "Rapport",
};

function renderCard(id: SectionId) {
  switch (id) {
    case "document":
      return <DocumentSection />;
    case "image":
      return <ImageSection />;
    case "gradcam":
      return <GradCamSection />;
    case "anatomy":
      return (
        <Section id="anatomy" title={CARD_TITLES.anatomy}>
          <AnatomySegmentationCard />
        </Section>
      );
    case "landmarks":
      return (
        <Section id="landmarks" title={CARD_TITLES.landmarks}>
          <LandmarksMeasurementsCard />
        </Section>
      );
    case "anatomymap":
      return (
        <Section id="anatomymap" title={CARD_TITLES.anatomymap}>
          <AnatomyMapCard />
        </Section>
      );
    case "pathology":
      return (
        <Section id="pathology" title={CARD_TITLES.pathology}>
          <PathologyDetectionCard />
        </Section>
      );
    case "diagnostics":
      return <DiagnosticsSection />;
    case "report":
      return <ReportSection />;
  }
}

function isCardVisible(id: SectionId, w: ReturnType<typeof useWorkspace>): boolean {
  switch (id) {
    case "document":
    case "diagnostics":
    case "report":
      return true;
    case "image":
      return w.imageCardOpen;
    case "gradcam":
      return w.gradcamCardOpen;
    case "anatomy":
      return w.anatomyCardOpen;
    case "landmarks":
      return w.landmarkCardOpen;
    case "anatomymap":
      return w.tool === "probe";
    case "pathology":
      return w.pathologyCardOpen;
  }
}

function CardsBody({
  dragId,
  onDragStart,
  onDrop,
  onDragEnd,
}: {
  dragId: SectionId | null;
  onDragStart: (id: SectionId) => void;
  onDrop: (from: SectionId, to: SectionId) => void;
  onDragEnd: () => void;
}) {
  const w = useWorkspace();
  const visibleCards = w.cardOrder.filter((id) => isCardVisible(id, w));
  return (
    <div className="space-y-2.5">
      {visibleCards.map((id) => (
        <div
          key={id}
          data-attr={`right-card-slot-${id}`}
          draggable
          onDragStart={() => onDragStart(id)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (dragId) onDrop(dragId, id);
            onDragEnd();
          }}
          onDragEnd={onDragEnd}
          className={cn("cursor-grab active:cursor-grabbing", dragId === id && "opacity-40")}
        >
          {renderCard(id)}
        </div>
      ))}
    </div>
  );
}

export function RightPanel() {
  const w = useWorkspace();
  const m = useEditorModality();
  const [dragId, setDragId] = useState<SectionId | null>(null);

  const onResizeDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = w.rightWidth;
    const move = (ev: PointerEvent) => {
      w.setRightWidth(Math.min(560, Math.max(280, startW + (startX - ev.clientX))));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const moveCard = (from: SectionId, to: SectionId) => {
    const order = [...w.cardOrder];
    const fromIdx = order.indexOf(from);
    const toIdx = order.indexOf(to);
    if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;
    order.splice(fromIdx, 1);
    order.splice(toIdx, 0, from);
    w.setCardOrder(order);
  };

  return (
    <aside className="relative z-40 shrink-0 border-l border-border bg-panel" style={{ width: w.rightWidth }}>
      <div
        onPointerDown={onResizeDown}
        className="group absolute -left-1.5 top-0 z-50 h-full w-3 cursor-ew-resize"
      >
        <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-transparent transition-colors duration-150 ease-out group-hover:bg-accent/60" />
      </div>
      <div className="h-full overflow-y-auto px-2.5 py-2.5">
        {m.modality === "fetal_ultrasound" ? (
          <FetalCardsBody />
        ) : (
          <CardsBody dragId={dragId} onDragStart={setDragId} onDrop={moveCard} onDragEnd={() => setDragId(null)} />
        )}
      </div>
    </aside>
  );
}

export function RightPanelDrawer() {
  const w = useWorkspace();
  const m = useEditorModality();
  const [dragId, setDragId] = useState<SectionId | null>(null);

  const moveCard = (from: SectionId, to: SectionId) => {
    const order = [...w.cardOrder];
    const fromIdx = order.indexOf(from);
    const toIdx = order.indexOf(to);
    if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;
    order.splice(fromIdx, 1);
    order.splice(toIdx, 0, from);
    w.setCardOrder(order);
  };

  return (
    <div className="fixed inset-y-0 right-0 z-[130] flex max-w-[380px] flex-col border-l border-border bg-panel shadow-2xl shadow-black/60">
      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 py-2.5">
        {m.modality === "fetal_ultrasound" ? (
          <FetalCardsBody />
        ) : (
          <CardsBody dragId={dragId} onDragStart={setDragId} onDrop={moveCard} onDragEnd={() => setDragId(null)} />
        )}
      </div>
    </div>
  );
}