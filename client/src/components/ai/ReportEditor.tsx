import { motion } from "framer-motion";
import { Check, FileText, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { cn } from "../../lib/cn";
import { useWorkspace } from "../../state/workspace";

export function ReportEditorModal({ mobile = false }: { mobile?: boolean }) {
  const w = useWorkspace();
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    taRef.current?.focus();
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className={cn(
        "fixed inset-0 z-30 flex bg-black/45 backdrop-blur-md",
        mobile ? "items-stretch px-0 pt-0" : "items-start justify-center px-6 pt-14",
      )}
    >
      <motion.div
        initial={{ opacity: 0, y: 24, scale: mobile ? 1 : 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 24, scale: mobile ? 1 : 0.98 }}
        transition={{ duration: 0.28, ease: "easeOut" }}
        data-attr="report-modal"
        className={cn(
          "flex flex-col overflow-hidden rounded-2xl border border-border bg-panel shadow-2xl shadow-black/60",
          mobile
            ? "h-screen w-screen rounded-none border-0 pb-[54px]"
            : "h-[70vh] w-full max-w-3xl",
        )}
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <FileText size={15} className="text-accent" strokeWidth={2.2} />
          <span className="text-[13px] font-semibold text-ink">Rapport d'interprétation</span>
          <span className="rounded-full bg-accent/15 px-2 py-px text-[10px] font-medium text-accent">
            Édition
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
          placeholder="Éditez le rapport, ou demandez à l'IA de le modifier avec la barre de commandes ci-dessous…"
        />
        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          <span className="mr-auto text-[10.5px] text-ink-3">
            Astuce : demandez à l'IA « ajoute une conclusion » — par écrit ou à la voix (micro).
          </span>
          <button
            type="button"
            onClick={() => w.setReportEditOpen(false)}
            className="rounded-lg border border-border bg-btn px-3.5 py-1.5 text-[12px] font-medium text-ink-2 transition-colors duration-150 ease-out hover:bg-hover hover:text-ink"
          >
            Annuler
          </button>
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