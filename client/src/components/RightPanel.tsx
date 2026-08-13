import { useMemo, useState } from "react";
import {
  Eye,
  EyeOff,
  GripVertical,
  Highlighter,
  Image as ImageIcon,
  Lock,
  LockOpen,
  Map,
  Pencil,
  Plus,
  RefreshCw,
  Ruler,
  Trash2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "../lib/cn";
import { downloadDataUrl, exportImageDataUrl } from "../lib/exportImage";
import { deriveMetadata } from "../lib/metadata";
import {
  BC_PRESETS,
  formatDistance,
  WL_PRESETS,
  buildImageFilter,
  isShapeVisible,
  shapeLayerId,
  useWorkspace,
  type LayerDef,
  type LayerId,
  type Shape,
} from "../state/workspace";
import { Badge, Button, Divider, KV, ProgressBar, Section, Segmented, Slider, Toggle } from "./ui";

/* ---------------------------------- Image --------------------------------- */

function SliderRow({
  label,
  value,
  min,
  max,
  onChange,
  inputData,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  inputData?: string;
}) {
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
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
          onChange={(e) => onChange(clamp(Number(e.target.value)))}
          className="w-16 rounded-md border border-border bg-btn px-1.5 py-0.5 text-right text-[11px] tabular-nums text-ink outline-none transition-colors duration-150 ease-out focus:border-accent/60"
        />
      </div>
      <Slider value={value} min={min} max={max} onChange={onChange} />
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
  const reset = () => {
    w.setBrightness(50);
    w.setContrast(50);
    w.setWl({ window: 255, level: 127.5 });
    w.setInverted(false);
  };
  return (
    <Section id="image" title="Image">
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
            w.recordAiAction(v ? "Image inversée" : "Image réinversée");
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
        min={20}
        max={512}
        onChange={(v) => w.setWl({ ...w.wl, window: v })}
        inputData="window-input"
      />
      <SliderRow
        label="Level"
        value={w.wl.level}
        min={0}
        max={255}
        onChange={(v) => w.setWl({ ...w.wl, level: v })}
        inputData="level-input"
      />
      <PresetChips
        options={WL_PRESETS}
        isActive={(p) => p.wl.window === w.wl.window && p.wl.level === w.wl.level}
        onSelect={(p) => {
          w.recordAiAction(`Fenêtrage ${p.label} appliqué`);
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

function DocumentSection() {
  const w = useWorkspace();
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState("");

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
      imageSrc: w.imageSrc,
      dims: w.dims,
      shapes: w.shapes.filter((s) => isShapeVisible(s, w.layers)),
      filter: buildImageFilter(w.wl, w.brightness, w.contrast, w.inverted),
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
      const filter = buildImageFilter(w.wl, w.brightness, w.contrast, w.inverted);
      const esc = (s: string) =>
        s
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;");
      win.document.write(
        `<!doctype html><html><head><meta charset="utf-8"><title>Print — ${esc(w.imageName)}</title>` +
          `<style>@page{margin:12mm}body{margin:0;background:#fff;font-family:Inter,Arial,sans-serif;display:flex;flex-direction:column;align-items:center;gap:12px;padding:12px}h1{font-size:13px;color:#444;font-weight:600;margin:0}img{max-width:94vw;max-height:84vh;object-fit:contain;filter:${esc(filter)}}p{font-size:10px;color:#999;margin:0}</style></head>` +
          `<body><h1>${esc(w.imageName)}</h1><img src="${esc(w.imageSrc)}" alt=""><p>${w.dims.w} × ${w.dims.h} px</p>` +
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
          src={w.imageSrc}
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
          <p className="text-[11px] text-ink-3">CR · Chest · PA view</p>
        </div>
      </div>
      <Divider />
      <KV k="Patient" v="P-2048-71" />
      <KV k="Patient ID" v="ID-4821-993" />
      <KV k="Age / Sex" v="57 / M" />
      <KV k="Study date" v="2026-04-12" />
      <KV k="Modality" v="CR" />
      <KV k="Study" v="CHEST PA" />
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

/* ------------------------------- AI Analysis ------------------------------ */

interface Finding {
  label: string;
  score: number;
}

const FINDINGS: Finding[] = [
  { label: "Lung fields clear", score: 98 },
  { label: "Cardiac silhouette normal", score: 95 },
  { label: "No pleural effusion", score: 94 },
  { label: "Bony structures intact", score: 91 },
];

function AiAnalysisSection() {
  const w = useWorkspace();
  const [model, setModel] = useState("ChestNet v3.1");
  return (
    <Section id="aianalysis" title="AI Analysis">
      <label className="block">
        <span className="mb-1.5 block text-[12px] text-ink-2">Model</span>
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="w-full rounded-xl border border-border bg-btn px-2.5 py-1.5 text-[12.5px] text-ink outline-none transition-colors duration-150 ease-out hover:bg-hover focus:border-accent/60"
        >
          <option>ChestNet v3.1</option>
          <option>FetalBrain v2.1</option>
          <option>Radiomics v1.2</option>
        </select>
      </label>

      {w.analysis === "idle" && (
        <>
          <Button variant="primary" className="w-full" onClick={w.runAnalysis}>
            Run Analysis
          </Button>
          <p className="text-[11px] leading-relaxed text-ink-3">
            Analyze the image with the selected model. Results appear here.
          </p>
        </>
      )}

      {w.analysis === "running" && (
        <div className="rounded-xl border border-border bg-btn p-3">
          <div className="mb-2 flex items-center gap-2 text-[12.5px] text-ink-2">
            <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse-soft" />
            Analyzing study…
          </div>
          <ProgressBar />
        </div>
      )}

      {w.analysis === "done" && (
        <div className="space-y-3 animate-fade">
          <div className="rounded-xl border border-accent/30 bg-btn p-3">
            <p className="text-[15px] font-semibold text-ink">
              No significant abnormality
            </p>
            <div className="mt-2 flex items-center justify-between text-[11px]">
              <span className="text-ink-3">Confidence</span>
              <span className="font-medium tabular-nums text-accent">96.2%</span>
            </div>
            <ProgressBar value={96.2} className="mt-1.5" />
          </div>
          <Divider />
          {FINDINGS.map((f) => (
            <div key={f.label} className="flex items-center gap-2">
              <span className="w-40 truncate text-[12px] text-ink-2">{f.label}</span>
              <ProgressBar value={f.score} className="flex-1" tone="neutral" />
              <span className="w-9 text-right text-[11px] tabular-nums text-ink-3">
                {f.score}%
              </span>
            </div>
          ))}
          <Divider />
          <KV k="Model" v="ChestNet v3.1" />
          <KV k="Inference time" v="1.8 s" />
          <Button className="w-full" onClick={w.runAnalysis}>
            <RefreshCw size={13} />
            Re-run
          </Button>
        </div>
      )}
    </Section>
  );
}

/* --------------------------------- Grad-CAM ------------------------------- */

function GradCamSection() {
  const w = useWorkspace();
  const [focus, setFocus] = useState("Emphysema");
  return (
    <Section id="gradcam" title="Grad-CAM">
      <div className="flex items-center justify-between">
        <span className="text-[12px] text-ink-2">Show overlay</span>
        <Toggle checked={w.gradcamOn} onChange={w.setGradcamOn} />
      </div>
      <Slider
        label="Intensity"
        value={w.gradcamIntensity}
        onChange={w.setGradcamIntensity}
        disabled={!w.gradcamOn}
        display={`${w.gradcamIntensity}%`}
      />
      <label className="block">
        <span className="mb-1.5 block text-[12px] text-ink-2">Focus class</span>
        <select
          value={focus}
          onChange={(e) => setFocus(e.target.value)}
          className="w-full rounded-xl border border-border bg-btn px-2.5 py-1.5 text-[12.5px] text-ink outline-none transition-colors duration-150 ease-out hover:bg-hover focus:border-accent/60"
        >
          <option>Emphysema</option>
          <option>Pneumothorax</option>
          <option>Cardiomegaly</option>
        </select>
      </label>
      <Divider />
      <KV k="Peak activation" v="0.87" />
      <KV k="Active area" v="12.4%" />
    </Section>
  );
}

/* ------------------------------- Measurements ----------------------------- */

function measureValue(s: Shape, pixelSpacingMm: ReturnType<typeof useWorkspace>["pixelSpacingMm"]): string {
  if (s.type === "measure" || s.type === "distance") {
    return formatDistance(s.w, s.h, pixelSpacingMm);
  }
  if (s.type === "angle") {
    const p2 = s.points[0] ?? { x: s.x, y: s.y };
    const len1 = Math.hypot(s.w, s.h);
    const len2 = Math.hypot(p2.x - s.x, p2.y - s.y);
    const cos = Math.max(-1, Math.min(1, (s.w * (p2.x - s.x) + s.h * (p2.y - s.y)) / ((len1 || 1) * (len2 || 1))));
    return `${((Math.acos(cos) * 180) / Math.PI).toFixed(1)}°`;
  }
  return "";
}

function measureLabel(s: Shape): string {
  return s.type === "angle" ? "Angle" : "Distance";
}

function MeasurementsSection() {
  const w = useWorkspace();
  const items = w.shapes.filter((s) => shapeLayerId(s) === "measurements");
  return (
    <Section id="measurements" title="Measurements">
      {items.length === 0 && (
        <p className="text-[11.5px] text-ink-3">No measurements yet — draw one on the canvas.</p>
      )}
      {items.map((s) => (
        <div
          key={s.id}
          data-attr={`measure-row-${s.id}`}
          className="flex items-center justify-between gap-2 rounded-lg px-1 py-0.5 transition-colors duration-150 ease-out hover:bg-hover"
        >
          <button
            type="button"
            data-attr={`measure-eye-${s.id}`}
            onClick={() => w.updateShape(s.id, { visible: s.visible === false })}
            className="shrink-0 text-ink-3 transition-colors duration-150 ease-out hover:text-ink"
            title="Toggle visibility"
          >
            {s.visible === false ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-[12px]",
              s.visible === false ? "text-ink-3/60 line-through" : "text-ink-2",
            )}
          >
            {measureLabel(s)}
          </span>
          <span className="shrink-0 text-[11px] tabular-nums text-ink">{measureValue(s, w.pixelSpacingMm)}</span>
          <button
            type="button"
            data-attr={`measure-delete-${s.id}`}
            onClick={() => {
              w.pushHistory();
              w.removeShape(s.id);
            }}
            className="shrink-0 text-ink-3 transition-colors duration-150 ease-out hover:text-ink"
            title="Remove measurement"
          >
            <Trash2 size={13} />
          </button>
        </div>
      ))}
      <div className="flex gap-1.5">
        <Button className="flex-1" data="measure-add-distance" onClick={() => w.setTool("measure")}>
          <Plus size={13} />
          Distance
        </Button>
        <Button className="flex-1" data="measure-add-angle" onClick={() => w.setTool("angle")}>
          Angle
        </Button>
      </div>
    </Section>
  );
}

/* -------------------------------- Annotations ----------------------------- */

function AnnotationsSection() {
  const w = useWorkspace();
  const items = w.shapes.filter((s) => s.type === "annotation");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const startEdit = (s: Shape) => {
    setDraft(s.label ?? "");
    setEditingId(s.id);
    w.setSelection(s.id);
  };
  const commitEdit = (id: string) => {
    const n = draft.trim();
    if (n) w.updateShape(id, { label: n });
    setEditingId(null);
  };

  return (
    <Section id="annotations" title="Annotations">
      {items.length === 0 && (
        <p className="text-[11.5px] text-ink-3">No annotations yet — draw one on the canvas.</p>
      )}
      {items.map((s) => (
        <div
          key={s.id}
          data-attr={`annotation-row-${s.id}`}
          className="flex items-center justify-between gap-2 rounded-lg px-1 py-0.5 transition-colors duration-150 ease-out hover:bg-hover"
        >
          <button
            type="button"
            data-attr={`annotation-eye-${s.id}`}
            onClick={() => w.updateShape(s.id, { visible: s.visible === false })}
            className="shrink-0 text-ink-3 transition-colors duration-150 ease-out hover:text-ink"
            title="Toggle visibility"
          >
            {s.visible === false ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
          {editingId === s.id ? (
            <input
              autoFocus
              data-attr={`annotation-edit-${s.id}`}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => commitEdit(s.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitEdit(s.id);
                if (e.key === "Escape") setEditingId(null);
              }}
              className="min-w-0 flex-1 rounded-md border border-border bg-btn px-1.5 py-0.5 text-[12px] text-ink outline-none focus:border-accent/60"
            />
          ) : (
            <button
              type="button"
              data-attr={`annotation-label-${s.id}`}
              onClick={() => startEdit(s)}
              className={cn(
                "min-w-0 flex-1 truncate text-left text-[12px] transition-colors duration-150 ease-out hover:text-ink",
                s.visible === false ? "text-ink-3/60 line-through" : "text-ink-2",
              )}
              title="Click to edit"
            >
              {s.label || "Note"}
            </button>
          )}
          <button
            type="button"
            data-attr={`annotation-delete-${s.id}`}
            onClick={() => {
              w.pushHistory();
              w.removeShape(s.id);
              if (w.selection === s.id) w.setSelection(null);
            }}
            className="shrink-0 text-ink-3 transition-colors duration-150 ease-out hover:text-ink"
            title="Remove annotation"
          >
            <Trash2 size={13} />
          </button>
        </div>
      ))}
      <Button className="w-full" data="annotation-add" onClick={() => w.setTool("annotation")}>
        <Plus size={13} />
        Add annotation
      </Button>
    </Section>
  );
}

/* ---------------------------------- Layers -------------------------------- */

const LAYER_ICONS: Record<LayerId, LucideIcon> = {
  image: ImageIcon,
  annotations: Highlighter,
  measurements: Ruler,
  gradcam: Map,
};

function LayersSection() {
  const w = useWorkspace();
  const [dragId, setDragId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<LayerId | null>(null);
  const [draft, setDraft] = useState("");

  const counts: Record<LayerId, number> = {
    image: 1,
    annotations: w.shapes.filter((s) => shapeLayerId(s) === "annotations").length,
    measurements: w.shapes.filter((s) => shapeLayerId(s) === "measurements").length,
    gradcam: w.gradcamOn ? 1 : 0,
  };

  const startRename = (l: LayerDef) => {
    setRenaming(l.id);
    setDraft(l.name);
  };
  const commitRename = (id: LayerId) => {
    const n = draft.trim();
    if (n) w.setLayerName(id, n);
    setRenaming(null);
  };

  return (
    <Section id="layers" title="Layers">
      {w.layers.map((l, i) => {
        const Icon = LAYER_ICONS[l.id];
        return (
          <div key={l.id} className="space-y-1">
            <div
              data-attr={`layer-row-${l.id}`}
              data-layer-order={i}
              draggable
              onDragStart={(e) => {
                setDragId(l.id);
                e.dataTransfer.setData("text/plain", l.id);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const src = (dragId || e.dataTransfer.getData("text/plain")) as LayerId | "";
                if (src && src !== l.id) w.moveLayer(src, i);
                setDragId(null);
              }}
              onDragEnd={() => setDragId(null)}
              className={cn(
                "flex cursor-grab items-center gap-1.5 rounded-lg px-1 py-0.5 transition-colors duration-150 ease-out hover:bg-hover active:cursor-grabbing",
                dragId === l.id && "opacity-40",
              )}
            >
              <GripVertical size={12} className="shrink-0 text-ink-3/60" />
              <button
                type="button"
                data-attr={`layer-eye-${l.id}`}
                onClick={() => w.setLayerVisible(l.id, !l.visible)}
                className="shrink-0 text-ink-3 transition-colors duration-150 ease-out hover:text-ink"
                title="Toggle visibility"
              >
                {l.visible ? <Eye size={13} /> : <EyeOff size={13} />}
              </button>
              <Icon size={13} className="shrink-0 text-ink-3" />
              {renaming === l.id ? (
                <input
                  autoFocus
                  data-attr={`layer-name-input-${l.id}`}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => commitRename(l.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename(l.id);
                    if (e.key === "Escape") setRenaming(null);
                  }}
                  className="min-w-0 flex-1 rounded-md border border-border bg-btn px-1.5 py-0.5 text-[12px] text-ink outline-none focus:border-accent/60"
                />
              ) : (
                <button
                  type="button"
                  data-attr={`layer-name-${l.id}`}
                  onClick={() => startRename(l)}
                  className="min-w-0 flex-1 truncate text-left text-[12px] text-ink transition-colors duration-150 ease-out hover:text-ink"
                  title="Click to rename"
                >
                  {l.name}
                </button>
              )}
              <Badge data={`layer-count-${l.id}`}>{counts[l.id]}</Badge>
              <button
                type="button"
                data-attr={`layer-lock-${l.id}`}
                onClick={() => w.setLayerLocked(l.id, !l.locked)}
                className={cn(
                  "shrink-0 transition-colors duration-150 ease-out hover:text-ink",
                  l.locked ? "text-accent" : "text-ink-3/60",
                )}
                title="Lock / unlock layer"
              >
                {l.locked ? <Lock size={12} /> : <LockOpen size={12} />}
              </button>
              {l.id !== "image" && (
                <button
                  type="button"
                  data-attr={`layer-delete-${l.id}`}
                  onClick={() => w.deleteLayerContent(l.id)}
                  className="shrink-0 text-ink-3/60 transition-colors duration-150 ease-out hover:text-ink"
                  title="Delete layer content"
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
            <div className="px-6">
              <Slider
                data={`layer-opacity-${l.id}`}
                label="Opacity"
                value={l.opacity}
                onChange={(v) => w.setLayerOpacity(l.id, v)}
                display={`${l.opacity}%`}
              />
            </div>
          </div>
        );
      })}
    </Section>
  );
}

/* --------------------------------- Metadata ------------------------------- */

function MetadataSection() {
  const w = useWorkspace();
  const tags = useMemo(
    () => deriveMetadata({ name: w.imageName, dims: w.dims, metadata: w.imageMetadata, wl: w.wl }),
    [w.imageName, w.dims, w.imageMetadata, w.wl],
  );
  return (
    <Section id="metadata" title="Metadata">
      {tags.map(([k, v]) => (
        <div key={k} data-attr={`meta-${k.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>
          <KV k={k} v={v} />
        </div>
      ))}
    </Section>
  );
}

/* -------------------------------- Right panel ------------------------------ */

export function RightPanel() {
  const w = useWorkspace();

  const onResizeDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = w.rightWidth;
    const move = (ev: PointerEvent) => {
      w.setRightWidth(Math.min(520, Math.max(264, startW + (startX - ev.clientX))));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <aside
      className="relative z-40 shrink-0 border-l border-border bg-panel"
      style={{ width: w.rightWidth }}
    >
      <div
        onPointerDown={onResizeDown}
        className="group absolute -left-1.5 top-0 z-50 h-full w-3 cursor-ew-resize"
      >
        <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-transparent transition-colors duration-150 ease-out group-hover:bg-accent/60" />
      </div>
      <div className="h-full overflow-y-auto px-2.5 py-2.5">
        <div className="space-y-2.5">
          <DocumentSection />
          <ImageSection />
          <AiAnalysisSection />
          <GradCamSection />
          <MeasurementsSection />
          <AnnotationsSection />
          <LayersSection />
          <MetadataSection />
        </div>
      </div>
    </aside>
  );
}
