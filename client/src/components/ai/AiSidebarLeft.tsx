import { motion } from "framer-motion";
import {
  Boxes, History, Lightbulb, Map, Save, Stethoscope, X, Zap,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { AI_PROMPTS } from "../../lib/aiCommands";
import { cn } from "../../lib/cn";
import { useWorkspace } from "../../state/workspace";
import { Divider, Modal } from "../ui";

function SectionTitle({ icon: Icon, children }: { icon: LucideIcon; children: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-center gap-1.5 px-3 pt-3 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-3">
      <Icon size={12} strokeWidth={2.2} />
      {children}
    </div>
  );
}

function Chip({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full border border-border bg-card px-2.5 py-1 text-[11px] text-ink-2 transition-colors duration-150 ease-out hover:border-accent/50 hover:text-ink"
    >
      {label}
    </button>
  );
}

/* ------------------------------ Outils radio ------------------------------ */

function RadioToolButton({
  label,
  icon: Icon,
  active = false,
  onClick,
  dataAttr,
}: {
  label: string;
  icon: typeof Zap;
  active?: boolean;
  onClick: () => void;
  dataAttr: string;
}) {
  return (
    <button
      type="button"
      data-attr={dataAttr}
      onClick={onClick}
      title={label}
      className={cn(
        "flex flex-col items-center justify-center gap-1.5 rounded-xl border px-1 py-3 transition-colors duration-150 ease-out",
        active
          ? "border-accent/60 bg-accent/10 text-accent"
          : "border-border bg-card text-ink-2 hover:border-accent/50 hover:text-ink",
      )}
    >
      <Icon size={22} strokeWidth={2} className={active ? "text-accent" : "text-icon"} />
      <span className="text-[10px] font-medium leading-none">{label}</span>
    </button>
  );
}

/* ------------------------------ Historique modal ------------------------------ */

function HistoryModal({ onClose }: { onClose: () => void }) {
  const w = useWorkspace();
  return (
    <Modal title="Historique" onClose={onClose} data="ai-history-dialog" width="w-[380px]">
      {w.aiHistory.length === 0 ? (
        <p className="px-1 text-[11px] text-ink-3">Aucune commande pour l'instant.</p>
      ) : (
        <div className="space-y-1.5">
          {w.aiHistory.map((h) => (
            <div
              key={h.id}
              data-attr={`ai-history-${h.id}`}
              className="rounded-lg border border-border/70 bg-card/60 px-2.5 py-2"
            >
              <div className="flex items-center gap-2">
                <span className="truncate text-[11px] text-ink">{h.text}</span>
                <span className="ml-auto shrink-0 text-[9.5px] tabular-nums text-ink-3">
                  {new Date(h.at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
              {h.answer && <p className="mt-1 whitespace-pre-wrap text-[11px] leading-snug text-ink-2">{h.answer}</p>}
              <p className="mt-0.5 text-[10.5px] leading-snug text-ink-3">{h.summary}</p>
              {h.limitations && h.limitations.length > 0 && (
                <p className="mt-1 text-[10px] leading-snug text-ink-3">Limites : {h.limitations.join(" ")}</p>
              )}
              {h.warnings && h.warnings.length > 0 && (
                <p className="mt-1 text-[10px] leading-snug text-amber-300">{h.warnings.join(" ")}</p>
              )}
              <div className="mt-1.5 flex gap-1.5">
                <button
                  type="button"
                  data-attr={`ai-history-rerun-${h.id}`}
                  onClick={() => w.runAiCommand(h.text)}
                  className="flex-1 rounded-md border border-border bg-btn px-2 py-1 text-[11px] text-ink-2 transition-colors duration-150 ease-out hover:bg-hover hover:text-ink"
                >
                  Relancer
                </button>
                <button
                  type="button"
                  data-attr={`ai-history-save-${h.id}`}
                  onClick={() => w.addAiCustomPrompt(h.text)}
                  className="flex-1 rounded-md border border-accent/40 bg-accent/10 px-2 py-1 text-[11px] text-accent transition-colors duration-150 ease-out hover:bg-accent/20"
                >
                  Enregistrer en prompt
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="mt-4 flex justify-end">
        <button
          type="button"
          data-attr="ai-history-close"
          onClick={onClose}
          className="rounded-lg border border-border bg-btn px-3 py-1.5 text-[11.5px] text-ink-2 transition-colors duration-150 ease-out hover:bg-hover hover:text-ink"
        >
          Fermer
        </button>
      </div>
    </Modal>
  );
}

/* --------------------------- Enregistrer un prompt --------------------------- */

function SavePromptModal({ onClose }: { onClose: () => void }) {
  const w = useWorkspace();
  const [text, setText] = useState("");
  const save = (t: string) => {
    w.addAiCustomPrompt(t);
    onClose();
  };
  return (
    <Modal title="Créer un prompt" onClose={onClose} data="ai-save-prompt-dialog" width="w-[380px]">
      <div className="flex gap-2">
        <input
          data-attr="ai-prompt-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Texte du prompt…"
          onKeyDown={(e) => {
            if (e.key === "Enter") save(text);
          }}
          className="min-w-0 flex-1 rounded-lg border border-border bg-canvas px-2.5 py-1.5 text-[12px] text-ink outline-none transition-colors duration-150 ease-out focus:border-accent/60"
        />
        <button
          type="button"
          data-attr="ai-prompt-save"
          onClick={() => save(text)}
          className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-white transition-colors duration-150 ease-out hover:bg-accent/90"
        >
          Enregistrer
        </button>
      </div>

      {w.aiActionLog.length > 0 && (
        <>
          <Divider className="my-3" />
          <div className="mb-2 flex items-center gap-1.5 px-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-3">
            <Zap size={12} strokeWidth={2.2} />
            Actions récentes
          </div>
          <div className="space-y-1">
            {w.aiActionLog.map((a, i) => (
              <div key={a + i} className="flex items-center gap-2 rounded-lg border border-border/70 bg-card/60 px-2.5 py-1.5">
                <span className="min-w-0 flex-1 truncate text-[11px] text-ink-2">{a}</span>
                <button
                  type="button"
                  data-attr={`ai-action-save-${i}`}
                  onClick={() => save(a)}
                  className="shrink-0 rounded-md border border-accent/40 bg-accent/10 px-2 py-0.5 text-[10.5px] text-accent transition-colors duration-150 ease-out hover:bg-accent/20"
                >
                  Enregistrer
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {w.aiHistory.length > 0 && (
        <>
          <Divider className="my-3" />
          <div className="mb-2 flex items-center gap-1.5 px-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-3">
            <History size={12} strokeWidth={2.2} />
            Historique
          </div>
          <div className="max-h-44 space-y-1 overflow-y-auto">
            {w.aiHistory.map((h) => (
              <div key={h.id} className="flex items-center gap-2 rounded-lg border border-border/70 bg-card/60 px-2.5 py-1.5">
                <span className="min-w-0 flex-1 truncate text-[11px] text-ink-2">{h.text}</span>
                <button
                  type="button"
                  data-attr={`ai-history-save-${h.id}`}
                  onClick={() => save(h.text)}
                  className="shrink-0 rounded-md border border-accent/40 bg-accent/10 px-2 py-0.5 text-[10.5px] text-accent transition-colors duration-150 ease-out hover:bg-accent/20"
                >
                  Enregistrer
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}

/* --------------------------------- Sidebar ---------------------------------- */

export function AiSidebarLeft({
  variant = "static",
}: {
  variant?: "static" | "drawer";
}) {
  const w = useWorkspace();
  const [showHistory, setShowHistory] = useState(false);
  const [showSavePrompt, setShowSavePrompt] = useState(false);

  const drawer = variant === "drawer";

  const toggleGradcam = () => {
    if (w.gradcamResult) w.setGradcamOn(!w.gradcamOn);
    else w.runAiCommand("@gradcam");
  };

  return (
    <motion.aside
      initial={drawer ? { x: -320, opacity: 0 } : { x: -40, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={drawer ? { x: -320, opacity: 0 } : { x: -40, opacity: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      data-attr="ai-sidebar-left"
      className={cn(
        "flex flex-col overflow-y-auto border-r border-border bg-panel",
        drawer
          ? "fixed inset-y-0 left-0 z-[130] w-[85vw] max-w-[300px] border-r border-border shadow-2xl shadow-black/60"
          : "w-64 shrink-0",
      )}
    >
      {/* Header: history + save prompt */}
      <div className="flex items-center gap-1.5 px-3 pb-1 pt-3">
        <button
          type="button"
          data-attr="ai-history-open"
          onClick={() => setShowHistory(true)}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-[11.5px] text-ink-2 transition-colors duration-150 ease-out hover:bg-hover hover:text-ink"
        >
          <History size={13} strokeWidth={2.2} />
          Historique
        </button>
        <button
          type="button"
          data-attr="ai-save-prompt-open"
          onClick={() => setShowSavePrompt(true)}
          className="flex items-center gap-1.5 rounded-lg border border-accent/40 bg-accent/10 px-2.5 py-1.5 text-[11.5px] text-accent transition-colors duration-150 ease-out hover:bg-accent/20"
        >
          <Save size={13} strokeWidth={2.2} />
          New prompt
        </button>
      </div>

      <Divider className="mx-3 my-2" />

      {/* Prompts */}
      <SectionTitle icon={Lightbulb}>Prompts</SectionTitle>
      <div className="mx-3 mb-2 space-y-1.5">
        {w.aiCustomPrompts.length > 0 && (
          <div data-attr="ai-custom-prompts" className="flex flex-wrap gap-1.5">
            {w.aiCustomPrompts.map((p, i) => (
              <span
                key={p + i}
                data-attr={`ai-custom-prompt-${i}`}
                className="inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent/10 py-1 pl-2.5 pr-1 text-[11px] text-accent"
              >
                <button type="button" onClick={() => w.runAiCommand(p)} className="transition-colors duration-150 ease-out hover:text-ink">
                  {p}
                </button>
                <button
                  type="button"
                  data-attr={`ai-custom-prompt-remove-${i}`}
                  onClick={() => w.removeAiCustomPrompt(p)}
                  title="Supprimer ce prompt"
                  className="flex h-4 w-4 items-center justify-center rounded-full text-accent/60 transition-colors duration-150 ease-out hover:bg-accent/20 hover:text-accent"
                >
                  <X size={10} strokeWidth={2.5} />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-1.5">
          {AI_PROMPTS.map((p) => (
            <Chip key={p} label={p} onClick={() => w.runAiCommand(p)} />
          ))}
        </div>
      </div>

      <Divider className="mx-3 my-2" />

      {/* Outils radio */}
      <SectionTitle icon={Stethoscope}>Outils radio</SectionTitle>
      <div className="mx-3 mb-3 grid grid-cols-2 gap-2">
        <RadioToolButton
          label="3D"
          icon={Boxes}
          dataAttr="ai-tool-3d"
          onClick={() => w.recordAiAction("Rendu 3D : nécessite un volume DICOM (multi-frame) — indisponible pour cette image.")}
        />
        <RadioToolButton
          label="Grad-CAM"
          icon={Map}
          active={w.gradcamOn}
          dataAttr="ai-tool-gradcam"
          onClick={toggleGradcam}
        />
      </div>

      {showHistory && <HistoryModal onClose={() => setShowHistory(false)} />}
      {showSavePrompt && <SavePromptModal onClose={() => setShowSavePrompt(false)} />}
    </motion.aside>
  );
}
