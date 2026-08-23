import { useMemo, useRef, useState } from "react";
import { Download, Pencil } from "lucide-react";
import { cn } from "../lib/cn";
import { downloadDataUrl, downloadJson, exportImageDataUrl } from "../lib/exportImage";
import {
  BC_PRESETS,
  WL_PRESETS,
  WL_PRESETS_HU,
  buildImageFilter,
  isShapeVisible,
  useWorkspace,
  type SectionId,
} from "../state/workspace";
import { AnatomyMapCard } from "./ai/AnatomyMap";
import { AnatomySegmentationCard } from "./ai/AnatomySegmentation";
import { LandmarksMeasurementsCard } from "./ai/LandmarksMeasurements";
import { Button, Divider, KV, ProgressBar, Section, Segmented, Slider, Toggle } from "./ui";

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

function DiagnosticsSection() {
  const w = useWorkspace();
  return (
    <Section id="diagnostics" title="Diagnostics">
      <div data-attr="ai-card-diagnostics">
        {w.aiResults.diagnostics.length === 0 ? (
          <p className="px-1 text-[11px] text-ink-3">
            Aucune analyse — lancez une commande comme « Analyse cette radiographie. »
          </p>
        ) : (
          <div className="space-y-1">
            {w.aiResults.diagnostics.map((d) => (
              <button
                key={d.label}
                type="button"
                onClick={() => d.region && w.focusAiRegion(d.region)}
                className="w-full rounded-lg border border-transparent px-2 py-1.5 text-left transition-colors duration-150 ease-out hover:border-accent/40 hover:bg-accent/5"
                title="Zoom sur la région suspecte"
              >
                <div className="flex items-center gap-2">
                  <span className="truncate text-[11.5px] text-ink">{d.label}</span>
                  <span className="ml-auto shrink-0 text-[11px] tabular-nums text-ink">{Math.round(d.prob * 100)}%</span>
                  <span className={cn("shrink-0 rounded-full px-1.5 py-px text-[9.5px] font-medium", SEVERITY_STYLE[d.severity])}>
                    {d.severity === "high" ? "Élevé" : d.severity === "medium" ? "Modéré" : "Faible"}
                  </span>
                </div>
                <div className="mt-1">
                  <ProgressBar value={Math.round(d.prob * 100)} tone={d.prob >= 0.3 ? "accent" : "neutral"} />
                </div>
              </button>
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
  return (
    <Section id="report" title="Rapport">
      {!w.aiResults.report ? (
        <p className="px-1 text-[11px] text-ink-3">
          Aucun rapport — commande « Génère un rapport ».
        </p>
      ) : (
        <>
          <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-ink-2">
            {w.aiResults.report}
          </p>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            <button
              type="button"
              data-attr="ai-report-edit"
              onClick={() => w.openReportEditor()}
              className="flex items-center justify-center gap-1.5 rounded-lg border border-border bg-btn px-2 py-1.5 text-[11.5px] text-ink-2 transition-colors duration-150 ease-out hover:bg-hover hover:text-ink"
            >
              <Pencil size={12} />
              Éditer
            </button>
            <button
              type="button"
              data-attr="ai-report-export"
              onClick={() =>
                downloadJson(
                  { app: "AImaging", kind: "ai-report", text: w.aiResults.report, exportedAt: new Date().toISOString() },
                  `rapport-ia-${new Date().toISOString().slice(0, 10)}.json`,
                )
              }
              className="flex items-center justify-center gap-1.5 rounded-lg border border-border bg-btn px-2 py-1.5 text-[11.5px] text-ink-2 transition-colors duration-150 ease-out hover:bg-hover hover:text-ink"
            >
              <Download size={12} />
              Exporter
            </button>
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
        <CardsBody dragId={dragId} onDragStart={setDragId} onDrop={moveCard} onDragEnd={() => setDragId(null)} />
      </div>
    </aside>
  );
}

export function RightPanelDrawer() {
  const w = useWorkspace();
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
        <CardsBody dragId={dragId} onDragStart={setDragId} onDrop={moveCard} onDragEnd={() => setDragId(null)} />
      </div>
    </div>
  );
}