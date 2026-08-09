import { motion } from "framer-motion";
import {
  Activity,
  Download,
  FileText,
  Map,
  Pencil,
  Ruler,
  Sparkles,
} from "lucide-react";
import { cn } from "../../lib/cn";
import { downloadJson } from "../../lib/exportImage";
import { MM_PER_PX, shapeBBox, useWorkspace, type AiDiagnosis } from "../../state/workspace";
import { KV, ProgressBar, Slider } from "../ui";
function Card({
  title,
  icon: Icon,
  children,
  accent,
  dataAttr,
}: {
  title: string;
  icon: typeof Activity;
  children: React.ReactNode;
  accent?: boolean;
  dataAttr?: string;
}) {
  return (
    <section
      data-attr={dataAttr}
      className={cn(
        "mx-3 mt-3 overflow-hidden rounded-xl border bg-card",
        accent ? "border-accent/40" : "border-border",
      )}
    >
      <div className="flex items-center gap-1.5 px-3 pt-2.5">
        <Icon size={13} strokeWidth={2.2} className={accent ? "text-accent" : "text-icon"} />
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-2">
          {title}
        </h3>
      </div>
      <div className="px-3 pb-3 pt-2">{children}</div>
    </section>
  );
}

const SEVERITY_STYLE: Record<AiDiagnosis["severity"], string> = {
  high: "bg-[#f87171]/15 text-[#f87171]",
  medium: "bg-[#facc15]/15 text-[#facc15]",
  low: "bg-[#4ade80]/15 text-[#4ade80]",
};

function DiagnosisRow({ d, onClick }: { d: AiDiagnosis; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-lg border border-transparent px-2 py-1.5 text-left transition-colors duration-150 ease-out hover:border-accent/40 hover:bg-accent/5"
      title="Zoom sur la région suspecte"
    >
      <div className="flex items-center gap-2">
        <span className="truncate text-[11.5px] text-ink">{d.label}</span>
        <span className={cn("ml-auto shrink-0 rounded-full px-1.5 py-px text-[9.5px] font-medium", SEVERITY_STYLE[d.severity])}>
          {d.severity === "high" ? "Élevé" : d.severity === "medium" ? "Modéré" : "Faible"}
        </span>
      </div>
      <div className="mt-1">
        <ProgressBar value={Math.round(d.prob * 100)} tone={d.prob >= 0.3 ? "accent" : "neutral"} />
      </div>
    </button>
  );
}

export function AiSidebarRight({ variant = "static" }: { variant?: "static" | "drawer" }) {
  const w = useWorkspace();

  const drawer = variant === "drawer";
  const measures = w.shapes.filter((s) => s.type === "measure" || s.type === "distance" || s.type === "angle");

  return (
    <motion.aside
      initial={drawer ? { x: 340, opacity: 0 } : { x: 40, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={drawer ? { x: 340, opacity: 0 } : { x: 40, opacity: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      data-attr="ai-sidebar-right"
      className={cn(
        "flex flex-col overflow-y-auto border-l border-border bg-panel",
        drawer
          ? "fixed inset-y-0 right-0 z-[130] w-[85vw] max-w-[320px] border-l border-border shadow-2xl shadow-black/60"
          : "w-72 shrink-0 pb-4",
      )}
    >
      {/* Diagnostics */}
      <Card title="Diagnostics" icon={Activity} dataAttr="ai-card-diagnostics" accent>
        {w.aiResults.diagnostics.length === 0 ? (
          <p className="px-1 text-[11px] text-ink-3">
            Aucune analyse — lancez une commande comme « Analyse cette radiographie. »
          </p>
        ) : (
          <div className="space-y-1">
            {w.aiResults.diagnostics.map((d) => (
              <DiagnosisRow
                key={d.label}
                d={d}
                onClick={() => d.region && w.focusAiRegion(d.region)}
              />
            ))}
          </div>
        )}
      </Card>

      {/* Probabilités */}
      <Card title="Probabilités" icon={Sparkles} dataAttr="ai-card-probabilities">
        {w.aiResults.diagnostics.length === 0 ? (
          <p className="px-1 text-[11px] text-ink-3">En attente d'une analyse.</p>
        ) : (
          <div className="space-y-1.5">
            {w.aiResults.diagnostics.slice(0, 3).map((d) => (
              <div key={d.label} className="flex items-center gap-2 px-1">
                <span className="w-24 truncate text-[11px] text-ink-2">{d.label.split(" — ")[0]}</span>
                <span className="w-7 text-right text-[11px] tabular-nums text-ink">{Math.round(d.prob * 100)}%</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Grad-CAM */}
      <Card title="Grad-CAM" icon={Map} dataAttr="ai-card-gradcam">
        <div className="flex items-center justify-between px-1">
          <span className="text-[11.5px] text-ink-2">Overlay d'activation</span>
          <button
            type="button"
            data-attr="ai-gradcam-toggle"
            onClick={() => w.setGradcamOn(!w.gradcamOn)}
            className={cn(
              "flex h-5 w-9 items-center rounded-full border px-0.5 transition-colors duration-300",
              w.gradcamOn ? "justify-end border-accent/60 bg-accent" : "justify-start border-border bg-hover",
            )}
          >
            <span
              className={cn(
                "h-4 w-4 rounded-full shadow-sm transition-colors duration-300",
                w.gradcamOn ? "bg-white" : "bg-ink-3",
              )}
            />
          </button>
        </div>
        {w.gradcamOn && (
          <div className="mt-2.5">
            <Slider
              label="Intensité"
              value={w.gradcamIntensity}
              onChange={w.setGradcamIntensity}
              display={`${w.gradcamIntensity}%`}
            />
          </div>
        )}
      </Card>

      {/* Rapports */}
      <Card title="Rapports" icon={FileText} dataAttr="ai-card-report">
        {!w.aiResults.report ? (
          <p className="px-1 text-[11px] text-ink-3">
            Aucun rapport — commande « Génère un rapport ».
          </p>
        ) : (
          <>
            <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border/70 bg-canvas/60 p-2 text-[10.5px] leading-relaxed text-ink-2">
              {w.aiResults.report}
            </pre>
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
      </Card>

      {/* Mesures */}
      <Card title="Mesures" icon={Ruler} dataAttr="ai-card-measures">
        {measures.length === 0 ? (
          <p className="px-1 text-[11px] text-ink-3">Aucune mesure — commande « Mesure » ou dessinez avec l'outil Ruler.</p>
        ) : (
          <div className="space-y-1">
            {measures.map((s) => {
              const bb = shapeBBox(s);
              const lenPx = s.type === "angle" ? bb.w : Math.hypot(bb.w, bb.h);
              const mm = (lenPx * MM_PER_PX).toFixed(1);
              return (
                <div key={s.id} className="flex items-center gap-2 px-1">
                  <span className="truncate text-[11px] text-ink-2">
                    {s.type === "measure" ? "Mesure" : s.type === "angle" ? "Angle" : "Distance"}
                  </span>
                  <span className="ml-auto text-[11px] tabular-nums text-ink">{mm} mm</span>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Métadonnées IA */}
      <Card title="Métadonnées IA" icon={Activity} dataAttr="ai-card-metadata">
        <div className="space-y-1 px-1">
          <KV k="Modèle" v="ChestNet v3.1" />
          <KV k="Type" v="Classification · Segmentation" />
          <KV k="Résolution" v={`${w.dims.w} × ${w.dims.h} px`} />
          <KV k="Latence" v="1.2 s" />
          <KV k="Série" v="Study 2026-08 — AImaging" />
        </div>
      </Card>
    </motion.aside>
  );
}
