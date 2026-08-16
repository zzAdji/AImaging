import { motion } from "framer-motion";
import {
  ArrowLeft, Boxes, Crosshair, Cpu, History, Lightbulb, List, Map, Save, Settings2, Stethoscope, Trash2, X, Zap,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { AI_PROMPTS } from "../../lib/aiCommands";
import { THREE_D_FEATURE_ENABLED } from "../../lib/examinations";
import { cn } from "../../lib/cn";
import { getWorkspaceThreeDBackend, updateWorkspaceThreeDBackend } from "../../lib/workspaceApi";
import { useWorkspace } from "../../state/workspace";
import { Divider } from "../ui";

type View = "main" | "history" | "prompts" | "new-prompt";

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

function BackHeader({ onBack, title, dataBack, children }: {
  onBack: () => void;
  title: string;
  dataBack: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-1.5 px-3 pb-1 pt-3">
      <button
        type="button"
        data-attr={dataBack}
        onClick={onBack}
        title="Retour"
        className="flex h-6 w-6 items-center justify-center rounded-md border border-border bg-card text-ink-2 transition-colors duration-150 ease-out hover:bg-hover hover:text-ink"
      >
        <ArrowLeft size={13} strokeWidth={2.2} />
      </button>
      <span className="text-[12px] font-semibold text-ink">{title}</span>
      {children}
    </div>
  );
}

/* ------------------------------ Vue historique ------------------------------ */

function HistoryView({ onBack }: { onBack: () => void }) {
  const w = useWorkspace();
  return (
    <div className="flex h-full min-h-0 flex-col" data-attr="ai-history-view">
      <BackHeader
        onBack={onBack}
        title="Historique"
        dataBack="ai-history-back"
      >
        {w.aiHistory.length > 0 && (
          <button
            type="button"
            data-attr="ai-history-clear"
            onClick={() => w.clearAiHistory()}
            title="Tout effacer"
            className="ml-auto flex items-center gap-1 rounded-md border border-border bg-btn px-1.5 py-0.5 text-[10.5px] text-ink-3 transition-colors duration-150 ease-out hover:border-red-400/40 hover:text-red-400"
          >
            <Trash2 size={11} strokeWidth={2.2} />
            Tout effacer
          </button>
        )}
      </BackHeader>
      <Divider className="mx-3 my-2" />
      <div className="flex-1 overflow-y-auto px-3 pb-3">
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
                <div className="mt-1.5 flex items-center gap-1.5">
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
                    onClick={() => {
                      w.addAiCustomPrompt(h.text);
                      onBack();
                    }}
                    className="flex-1 rounded-md border border-accent/40 bg-accent/10 px-2 py-1 text-[11px] text-accent transition-colors duration-150 ease-out hover:bg-accent/20"
                  >
                    Enregistrer
                  </button>
                  <button
                    type="button"
                    data-attr={`ai-history-delete-${h.id}`}
                    onClick={() => w.removeAiHistory(h.id)}
                    title="Supprimer cette entrée"
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-btn text-ink-3 transition-colors duration-150 ease-out hover:border-red-400/40 hover:text-red-400"
                  >
                    <Trash2 size={12} strokeWidth={2.2} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ----------------------------- Vue créer un prompt ---------------------------- */

function NewPromptView({ onBack }: { onBack: () => void }) {
  const w = useWorkspace();
  const [text, setText] = useState("");
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(w.aiActionLog.filter((a) => a.type).map((a) => a.id)),
  );
  const toggle = (id: string) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const save = () => {
    const t = text.trim();
    if (!t) return;
    w.addAiCustomPrompt(t, w.aiActionLog.filter((a) => selected.has(a.id)));
    onBack();
  };
  return (
    <div className="flex h-full min-h-0 flex-col" data-attr="ai-new-prompt-view">
      <BackHeader onBack={onBack} title="Créer un prompt" dataBack="ai-new-prompt-back" />
      <Divider className="mx-3 my-2" />
      <div className="flex-1 overflow-y-auto px-3 pb-3">
        <p className="mb-2 px-1 text-[10.5px] leading-snug text-ink-3">
          Sélectionnez les actions réalisées, puis attribuez-leur une phrase.
        </p>
        <input
          data-attr="ai-prompt-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Phrase associée aux actions…"
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
          }}
          className="w-full rounded-lg border border-border bg-canvas px-2.5 py-1.5 text-[12px] text-ink outline-none transition-colors duration-150 ease-out focus:border-accent/60"
        />
        <div className="mb-2 mt-3 flex items-center gap-1.5 px-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-3">
          <Zap size={12} strokeWidth={2.2} />
          Actions récentes ({w.aiActionLog.length})
        </div>
        {w.aiActionLog.length === 0 ? (
          <p className="px-1 text-[11px] text-ink-3">
            Aucune action enregistrée pour l'instant. Réalisez des réglages (fenêtrage, inversion, dessin…) en mode normal
            pour les retrouver ici.
          </p>
        ) : (
          <div className="space-y-1">
            {w.aiActionLog.map((a) => (
              <label
                key={a.id}
                data-attr={`ai-action-select-${a.id}`}
                className="flex cursor-pointer items-center gap-2 rounded-lg border border-border/70 bg-card/60 px-2.5 py-1.5 transition-colors duration-150 ease-out hover:border-accent/40"
              >
                <input
                  type="checkbox"
                  checked={selected.has(a.id)}
                  onChange={() => toggle(a.id)}
                  className="h-3 w-3 shrink-0 accent-blue-500"
                />
                <span className={cn("min-w-0 flex-1 truncate text-[11px]", selected.has(a.id) ? "text-ink" : "text-ink-2")}>
                  {a.label}
                </span>
                {!a.type && <span className="shrink-0 text-[9px] text-ink-3">non rejouable</span>}
              </label>
            ))}
          </div>
        )}
      </div>
      <div className="border-t border-border px-3 py-2.5">
        <button
          type="button"
          data-attr="ai-prompt-save"
          onClick={save}
          disabled={!text.trim()}
          className="w-full rounded-lg bg-accent py-1.5 text-[12px] font-medium text-white transition-colors duration-150 ease-out hover:bg-accent/90 disabled:opacity-40"
        >
          Enregistrer{selected.size > 0 ? ` · ${selected.size} action${selected.size > 1 ? "s" : ""}` : ""}
        </button>
      </div>
    </div>
  );
}

/* --------------------------- Vue tous les prompts --------------------------- */

function PromptsView({ onBack }: { onBack: () => void }) {
  const w = useWorkspace();
  return (
    <div className="flex h-full min-h-0 flex-col" data-attr="ai-prompts-view">
      <BackHeader onBack={onBack} title="Prompts & commandes" dataBack="ai-prompts-back" />
      <Divider className="mx-3 my-2" />
      <div className="flex-1 overflow-y-auto px-3 pb-3">
        <div className="mb-1.5 px-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-3">
          Mes prompts ({w.aiCustomPrompts.length})
        </div>
        {w.aiCustomPrompts.length === 0 ? (
          <p className="mb-3 px-1 text-[11px] text-ink-3">Aucun prompt enregistré.</p>
        ) : (
          <div className="mb-3 space-y-1">
            {w.aiCustomPrompts.map((p, i) => (
              <div
                key={p.id}
                data-attr={`ai-custom-prompt-${i}`}
                className="flex items-center gap-1.5 rounded-lg border border-accent/30 bg-accent/10 px-2 py-1.5"
              >
                <button
                  type="button"
                  onClick={() => w.runAiPrompt(p)}
                  title="Exécuter ce prompt"
                  className="min-w-0 flex-1 truncate text-left text-[11px] text-accent transition-colors duration-150 ease-out hover:text-ink"
                >
                  {p.text}
                  {p.actions.length > 0 && (
                    <span className="ml-1.5 text-[9.5px] text-accent/60">
                      · {p.actions.length} action{p.actions.length > 1 ? "s" : ""}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  data-attr={`ai-custom-prompt-remove-${i}`}
                  onClick={() => w.removeAiCustomPrompt(p.id)}
                  title="Supprimer ce prompt"
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-accent/60 transition-colors duration-150 ease-out hover:bg-accent/20 hover:text-accent"
                >
                  <X size={11} strokeWidth={2.5} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="mb-1.5 px-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-3">
          Commandes IA
        </div>
        <div className="flex flex-wrap gap-1.5">
          {AI_PROMPTS.map((p) => (
            <Chip key={p} label={p} onClick={() => w.runAiCommand(p)} />
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ Outils radio ------------------------------ */

function RadioToolButton({
  label,
  icon: Icon,
  active = false,
  onClick,
  dataAttr,
  disabled = false,
}: {
  label: string;
  icon: typeof Zap;
  active?: boolean;
  onClick: () => void;
  dataAttr: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      data-attr={dataAttr}
      onClick={disabled ? undefined : onClick}
      title={label}
      disabled={disabled}
      aria-disabled={disabled}
      className={cn(
        "flex flex-col items-center justify-center gap-1.5 rounded-xl border px-1 py-3 transition-colors duration-150 ease-out",
        disabled
          ? "cursor-not-allowed border-border/60 bg-card text-ink-3 opacity-45 grayscale"
          : active
            ? "border-accent/60 bg-accent/10 text-accent"
            : "border-border bg-card text-ink-2 hover:border-accent/50 hover:text-ink",
      )}
    >
      <Icon size={22} strokeWidth={2} className={disabled ? "text-ink-3" : active ? "text-accent" : "text-icon"} />
      <span className="text-[10px] font-medium leading-none">{label}</span>
    </button>
  );
}

/* ------------------------------ Backend 3D ------------------------------- */

function ThreeDBackendPanel() {
  const [info, setInfo] = useState<{ mode: "local" | "remote"; remote_url: string | null; reachable: boolean | null; backend: { gpu?: string | null } | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const next = await getWorkspaceThreeDBackend();
        if (cancelled) return;
        setInfo(next);
        setDraft(next.remote_url ?? "");
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Impossible d'interroger le backend 3D.");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const apply = async (value: string) => {
    try {
      const next = await updateWorkspaceThreeDBackend(value);
      setInfo(next);
      setDraft(next.remote_url ?? "");
      setError(null);
      if (next.mode === "remote") {
        if (next.reachable) {
          setOpen(false);
        } else {
          setError("Service distant injoignable — vérifiez l'URL du tunnel (session Kaggle active ?).");
        }
      } else {
        setOpen(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Mise à jour refusée.");
    }
  };

  const statusLabel = !info
    ? "Chargement…"
    : info.mode === "local"
      ? "CPU local"
      : info.reachable
        ? `GPU distant${info.backend?.gpu ? ` (${info.backend.gpu})` : ""}`
        : "GPU distant (injoignable)";
  const dotClass = !info
    ? "bg-ink-3"
    : info.mode === "local"
      ? "bg-ink-3"
      : info.reachable
        ? "bg-emerald-400"
        : "bg-amber-400";

  return (
    <div className="mx-3 mb-3">
      <button
        type="button"
        data-attr="ai-3d-backend-toggle"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-2 text-left transition-colors duration-150 ease-out hover:border-accent/40"
        title="Backend de la reconstruction 3D"
      >
        <Cpu size={14} strokeWidth={2} className="shrink-0 text-icon" />
        <span className="truncate text-[11px] text-ink-2">{statusLabel}</span>
        <span className={`ml-auto h-2 w-2 shrink-0 rounded-full ${dotClass}`} />
        <Settings2 size={13} strokeWidth={2} className="shrink-0 text-ink-3" />
      </button>

      {open && (
        <div className="mt-1.5 rounded-lg border border-border bg-card p-2.5" data-attr="ai-3d-backend-editor">
          <p className="mb-1.5 text-[10.5px] leading-snug text-ink-3">
            Collez l'URL du tunnel Kaggle (<span className="font-mono">https://…trycloudflare.com</span>) pour
            déléguer la reconstruction au GPU, ou videz pour revenir au CPU local.
          </p>
          <div className="flex gap-1.5">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="https://xxx.trycloudflare.com"
              spellCheck={false}
              className="min-w-0 flex-1 rounded border border-border bg-panel px-2 py-1.5 font-mono text-[11px] text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
            />
            <button
              type="button"
              data-attr="ai-3d-backend-apply"
              onClick={() => void apply(draft.trim())}
              className="shrink-0 rounded border border-accent/40 bg-accent/10 px-2 py-1 text-[11px] text-accent hover:bg-accent/20"
            >
              App
            </button>
          </div>
          <div className="mt-1.5 flex items-center justify-between">
            <button
              type="button"
              data-attr="ai-3d-backend-local"
              onClick={() => void apply("")}
              className="rounded px-1.5 py-0.5 text-[10.5px] text-ink-3 underline-offset-2 hover:text-ink hover:underline"
            >
              Utiliser le CPU local
            </button>
            <button
              type="button"
              data-attr="ai-3d-backend-close"
              onClick={() => { setOpen(false); setError(null); }}
              className="rounded px-1.5 py-0.5 text-[10.5px] text-ink-3 hover:text-ink"
            >
              Fermer
            </button>
          </div>
          {error && <p className="mt-1.5 text-[10.5px] leading-snug text-red-400">{error}</p>}
        </div>
      )}
    </div>
  );
}

/* --------------------------------- Sidebar ---------------------------------- */

export function AiSidebarLeft({
  variant = "static",
}: {
  variant?: "static" | "drawer";
}) {
  const w = useWorkspace();
  const [view, setView] = useState<View>("main");

  const drawer = variant === "drawer";

  const toggleGradcam = () => {
    if (w.gradcamResult) {
      const next = !w.gradcamOn;
      w.recordAiAction(next ? "Grad-CAM affichée" : "Grad-CAM masquée", {
        type: "show_gradcam",
        payload: { visible: next, opacity: w.gradcamIntensity / 100 },
      });
      w.setGradcamOn(next);
    } else {
      w.runAiCommand("@gradcam");
    }
  };

  return (
    <motion.aside
      initial={drawer ? { x: -320, opacity: 0 } : { x: -40, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={drawer ? { x: -320, opacity: 0 } : { x: -40, opacity: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      data-attr="ai-sidebar-left"
      className={cn(
        "flex flex-col overflow-hidden border-r border-border bg-panel",
        drawer
          ? "fixed inset-y-0 left-0 z-[130] w-[85vw] max-w-[300px] border-r border-border shadow-2xl shadow-black/60"
          : "w-64 shrink-0",
      )}
    >
      {view === "history" && <HistoryView onBack={() => setView("main")} />}
      {view === "new-prompt" && <NewPromptView onBack={() => setView("main")} />}
      {view === "prompts" && <PromptsView onBack={() => setView("main")} />}

      {view === "main" && (
        <div className="flex min-h-0 flex-col overflow-y-auto">
          {/* Header: history + save prompt */}
          <div className="flex items-center gap-1.5 px-3 pb-1 pt-3">
            <button
              type="button"
              data-attr="ai-history-open"
              onClick={() => setView("history")}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-[11.5px] text-ink-2 transition-colors duration-150 ease-out hover:bg-hover hover:text-ink"
            >
              <History size={13} strokeWidth={2.2} />
              Historique
            </button>
            <button
              type="button"
              data-attr="ai-save-prompt-open"
              onClick={() => setView("new-prompt")}
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
                {w.aiCustomPrompts.slice(0, 8).map((p, i) => (
                  <span
                    key={p.id}
                    data-attr={`ai-custom-prompt-${i}`}
                    className="inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent/10 py-1 pl-2.5 pr-1 text-[11px] text-accent"
                  >
                    <button
                      type="button"
                      onClick={() => w.runAiPrompt(p)}
                      title={p.actions.length > 0 ? `Rejoue ${p.actions.length} action(s)` : "Envoyer la phrase"}
                      className="transition-colors duration-150 ease-out hover:text-ink"
                    >
                      {p.text}
                      {p.actions.length > 0 && (
                        <span className="ml-1 text-[9.5px] text-accent/60">· {p.actions.length}</span>
                      )}
                    </button>
                    <button
                      type="button"
                      data-attr={`ai-custom-prompt-remove-${i}`}
                      onClick={() => w.removeAiCustomPrompt(p.id)}
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
              {AI_PROMPTS.slice(0, 8).map((p) => (
                <Chip key={p} label={p} onClick={() => w.runAiCommand(p)} />
              ))}
            </div>
            <button
              type="button"
              data-attr="ai-prompts-see-all"
              onClick={() => setView("prompts")}
              className="flex items-center gap-1 rounded-md border border-border bg-btn px-2 py-1 text-[10.5px] text-ink-3 transition-colors duration-150 ease-out hover:bg-hover hover:text-ink"
            >
              <List size={11} strokeWidth={2.2} />
              Voir tout ({w.aiCustomPrompts.length + AI_PROMPTS.length})
            </button>
          </div>

          <Divider className="mx-3 my-2" />

          {/* Outils radio */}
          <SectionTitle icon={Stethoscope}>Outils radio</SectionTitle>
          <div className="mx-3 mb-3 grid grid-cols-2 gap-2">
            <RadioToolButton
              label="3D"
              icon={Boxes}
              active={w.threeDOn || w.threeDRunning}
              disabled={!THREE_D_FEATURE_ENABLED}
              dataAttr="ai-tool-3d"
              onClick={() => {
                if (w.threeDRunning) return;
                if (w.threeDResult) {
                  w.setThreeDOn(!w.threeDOn);
                  return;
                }
                w.runAiCommand("@3d");
              }}
            />
            <RadioToolButton
              label="Sonde"
              icon={Crosshair}
              active={w.tool === "probe"}
              dataAttr="ai-tool-sonde"
              onClick={() => w.setTool(w.tool === "probe" ? "move" : "probe")}
            />
            <RadioToolButton
              label="Grad-CAM"
              icon={Map}
              active={w.gradcamOn}
              dataAttr="ai-tool-gradcam"
              onClick={toggleGradcam}
            />
          </div>

          <ThreeDBackendPanel />
        </div>
      )}
    </motion.aside>
  );
}
