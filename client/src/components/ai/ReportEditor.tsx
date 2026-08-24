import { motion } from "framer-motion";
import { Check, FileText, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { cn } from "../../lib/cn";
import { useWorkspace } from "../../state/workspace";
import { ReportActionsBar } from "./ReportToolsBar";

export function ReportEditorModal({
  mobile = false,
  insideWorkspace = false,
}: {
  mobile?: boolean;
  insideWorkspace?: boolean;
}) {
  const w = useWorkspace();
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    taRef.current?.focus();
  }, []);

  /* Statut du rapport : « Édition » tant que non validé, « Validé » ensuite. */
  const status = w.radioReportValidated === true ? "Validé" : "Édition";
  const statusClass =
    w.radioReportValidated === true
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
      : "bg-accent/15 text-accent";

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className={cn(
        insideWorkspace
          ? "absolute inset-0 z-30 flex bg-black/45 backdrop-blur-md"
          : "fixed inset-0 z-30 flex bg-black/45 backdrop-blur-md",
        mobile ? "items-stretch px-0 pt-0" : "items-end justify-center pb-[7rem] px-6",
      )}
    >
      <motion.div
        initial={{ opacity: 0, y: 24, scale: mobile ? 1 : 0.995 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 24, scale: mobile ? 1 : 0.995 }}
        transition={{ duration: 0.28, ease: "easeOut" }}
        data-attr="report-modal"
        className={cn(
          "flex flex-col overflow-hidden rounded-2xl border border-border bg-panel shadow-2xl shadow-black/60",
          mobile
            ? "h-[80vh] w-screen rounded-none border-0 pb-[100px]"
            : "h-[70vh] w-full max-w-3xl",
        )}
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <FileText size={15} className="text-accent" strokeWidth={2.2} />
          <span className="text-[13px] font-semibold text-ink">Rapport d'interprétation</span>
          <span className={cn("rounded-full px-2 py-px text-[10px] font-medium", statusClass)}>
            {status}
          </span>
          <button
            type="button"
            data-attr="report-close"
            title="Annuler et fermer"
            onClick={() => w.setReportEditOpen(false)}
            className="ml-auto flex h-7 w-7 items-center justify-center rounded-lg text-icon transition-colors duration-150 ease-out hover:bg-hover hover:text-ink"
          >
            <X size={15} />
          </button>
        </div>
        <textarea
          ref={taRef}
          data-attr="report-draft"
          value={w.reportDraft}
          onChange={(e) => w.setReportDraft(e.target.value)}
          spellCheck={false}
          className="h-full w-full flex-1 resize-none bg-canvas/40 p-4 font-mono text-[12.5px] leading-relaxed text-ink outline-none placeholder:text-ink-3/70"
          placeholder="Éditez le rapport, ou dictéez-le avec la barre de commandes…"
        />
        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          <ReportActionsBar draft={w.reportDraft} />
          <button
            type="button"
            onClick={() => w.setReportEditOpen(false)}
            className="rounded-lg border border-border bg-btn px-3.5 py-1.5 text-[12px] font-medium text-ink-2 transition-colors duration-150 ease-out hover:bg-hover hover:text-ink"
          >
            Annuler
          </button>
          {w.validateRadioReport !== undefined && !w.radioReportValidated && (
            <button
              type="button"
              data-attr="report-validate"
              title="Valider le rapport (action explicite du professionnel)"
              onClick={() => w.validateRadioReport?.()}
              className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3.5 py-1.5 text-[12px] font-medium text-emerald-300 transition-colors duration-150 ease-out hover:bg-emerald-500/20"
            >
              <Check size={13} strokeWidth={2.4} className="mr-1 inline" />
              Valider
            </button>
          )}
          {w.radioReportValidated === true && (
            <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-px text-[10px] font-medium text-emerald-300">
              Validé
            </span>
          )}
          <button
            type="button"
            data-attr="report-save"
            onClick={() => w.saveReportDraft()}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-1.5 text-[12px] font-medium text-white transition-colors duration-150 ease-out hover:bg-[#4f8ef7] active:bg-[#2563eb]"
          >
            <Check size={13} strokeWidth={2.4} />
            Enregistrer
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}