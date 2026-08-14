import { motion } from "framer-motion";
import { Activity, Download, FileText, Pencil } from "lucide-react";
import { cn } from "../../lib/cn";
import { downloadJson } from "../../lib/exportImage";
import { useWorkspace, type AiDiagnosis } from "../../state/workspace";
import { ProgressBar } from "../ui";
import { AnatomyMapCard } from "./AnatomyMap";
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
        <span className="ml-auto shrink-0 text-[11px] tabular-nums text-ink">{Math.round(d.prob * 100)}%</span>
        <span className={cn("shrink-0 rounded-full px-1.5 py-px text-[9.5px] font-medium", SEVERITY_STYLE[d.severity])}>
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

  const onResizeDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = w.rightWidth;
    const move = (ev: PointerEvent) => {
      w.setRightWidth(Math.min(560, Math.max(300, startW + (startX - ev.clientX))));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <motion.aside
      initial={drawer ? { x: 340, opacity: 0 } : { x: 40, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={drawer ? { x: 340, opacity: 0 } : { x: 40, opacity: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      data-attr="ai-sidebar-right"
      className={cn(
        "relative flex flex-col border-l border-border bg-panel",
        drawer
          ? "fixed inset-y-0 right-0 z-[130] w-[85vw] max-w-[360px] border-l border-border shadow-2xl shadow-black/60"
          : "shrink-0 pb-0",
      )}
      style={drawer ? undefined : { width: w.rightWidth }}
    >
      {!drawer && (
        <div
          onPointerDown={onResizeDown}
          className="group absolute -left-1.5 top-0 z-50 h-full w-3 cursor-ew-resize"
        >
          <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-transparent transition-colors duration-150 ease-out group-hover:bg-accent/60" />
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
      {/* Carte anatomique — mini-carte de l'organe avec la Sonde */}
      <AnatomyMapCard />

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

      {/* Rapports */}
      <Card title="Rapports" icon={FileText} dataAttr="ai-card-report">
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
      </Card>
      </div>
    </motion.aside>
  );
}