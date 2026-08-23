import { useFetalExam } from "../../state/fetalExam";
import { downloadJson } from "../../lib/exportImage";
import type { FetalReportSectionId } from "../../lib/fetal/types";
import { cn } from "../../lib/cn";

const SECTION_IDS: FetalReportSectionId[] = ["header", "observations", "biometry", "conclusion"];

/**
 * Éditeur de compte rendu structuré (INSTRUCTIONS.md §23).
 *
 * Chaque section est éditable individuellement ; Regenerate / Reset
 * reconstruisent UNIQUEMENT la section concernée depuis les données
 * structurées. Save persiste (l'édition est déjà réactive) ; Export produit
 * un JSON structuré complet.
 */
export function FetalReportEditor() {
  const { exam, setReportEditOpen, updateReportSection, resetReportSection, validateReport } = useFetalExam();
  const report = exam.report;
  if (!report || report.state === "generating" || report.state === "idle") return null;

  const exportReport = () => {
    downloadJson(
      { app: "AImaging", kind: "fetal-report", examId: exam.id, state: report.state, exportedAt: new Date().toISOString(), sections: report.sections },
      `compte-rendu-echo-${new Date().toISOString().slice(0, 10)}.json`,
    );
  };

  return (
    <div className="fixed inset-0 z-[160] flex items-start justify-center bg-black/45 px-6 pt-14 backdrop-blur-md">
      <div
        data-attr="fetal-report-editor"
        className="flex max-h-[78vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-panel shadow-2xl shadow-black/60"
      >
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <span className="text-[13px] font-semibold text-ink">Compte rendu obstétrical</span>
          <span
            data-attr="fetal-report-state"
            className={cn(
              "rounded-full border px-2 py-px text-[10px] font-medium",
              report.state === "validated"
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                : "border-orange-500/40 bg-orange-500/10 text-orange-300",
            )}
          >
            {report.state === "validated" ? "Validated" : "Needs review"}
          </span>
          <button
            type="button"
            data-attr="fetal-report-close"
            onClick={() => setReportEditOpen(false)}
            className="ml-auto rounded-lg px-2 py-1 text-[11.5px] text-ink-3 transition-colors duration-100 hover:bg-hover hover:text-ink"
          >
            ✕
          </button>
        </div>

        {/* Sections éditables */}
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {SECTION_IDS.map((sectionId) => {
            const section = report.sections[sectionId];
            if (!section) return null;
            return (
              <div key={sectionId} data-attr={`fetal-report-section-${sectionId}`} className="rounded-xl border border-border bg-card p-2.5">
                <div className="mb-1 flex items-center gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-2">{section.title}</span>
                  {section.edited && <span className="rounded-full bg-sky-500/15 px-1.5 text-[9px] font-medium text-sky-300">édité</span>}
                  <div className="ml-auto flex gap-1">
                    <button
                      type="button"
                      data-attr={`fetal-report-regenerate-${sectionId}`}
                      onClick={() => resetReportSection(sectionId)}
                      className="rounded-md border border-border bg-btn px-2 py-0.5 text-[10px] text-ink-2 transition-colors duration-100 hover:bg-hover hover:text-ink"
                    >
                      Regenerate
                    </button>
                  </div>
                </div>
                <textarea
                  value={section.content}
                  spellCheck={false}
                  onChange={(event) => updateReportSection(sectionId, event.target.value)}
                  rows={sectionId === "biometry" ? 8 : sectionId === "observations" ? 9 : 5}
                  className="w-full resize-y rounded-lg border border-border bg-canvas/40 p-2.5 font-mono text-[11.5px] leading-relaxed text-ink outline-none focus:border-accent/60"
                />
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={exportReport}
            className="rounded-lg border border-border bg-btn px-3 py-1.5 text-[12px] font-medium text-ink transition-colors duration-150 hover:bg-hover"
          >
            Export
          </button>
          {report.state === "needs_review" && (
            <button
              type="button"
              data-attr="fetal-report-validate"
              onClick={validateReport}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-[12px] font-medium text-white transition-colors duration-150 hover:bg-emerald-500"
            >
              Validate
            </button>
          )}
          <button
            type="button"
            data-attr="fetal-report-save"
            onClick={() => setReportEditOpen(false)}
            className="rounded-lg bg-accent px-3.5 py-1.5 text-[12px] font-medium text-white transition-colors duration-150 hover:bg-[#4f8ef7]"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}