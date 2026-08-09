import { motion } from "framer-motion";
import { FileText, History, Lightbulb, ScanSearch, Sparkles, Wand2, Zap, type LucideIcon } from "lucide-react";
import { AI_PROMPTS } from "../../lib/aiCommands";
import { cn } from "../../lib/cn";
import { useWorkspace } from "../../state/workspace";
import { Divider } from "../ui";

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

function QuickAction({
  label,
  icon: Icon,
  onClick,
  accent,
}: {
  label: string;
  icon: typeof Zap;
  onClick: () => void;
  accent?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-[12px] transition-colors duration-150 ease-out",
        accent
          ? "border-accent/40 bg-accent/10 text-ink hover:bg-accent/20"
          : "border-border bg-card text-ink-2 hover:bg-hover hover:text-ink",
      )}
    >
      <Icon size={13} strokeWidth={2.2} className={accent ? "text-accent" : "text-icon"} />
      {label}
    </button>
  );
}

export function AiSidebarLeft({ variant = "static" }: { variant?: "static" | "drawer" }) {
  const w = useWorkspace();

  const drawer = variant === "drawer";

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
      {/* Historique */}
      <SectionTitle icon={History}>Historique</SectionTitle>
      <div data-attr="ai-history" className="mx-3 mb-2 space-y-1">
        {w.aiHistory.length === 0 ? (
          <p className="px-1 text-[11px] text-ink-3">Aucune commande pour l'instant.</p>
        ) : (
          w.aiHistory.slice(0, 6).map((h) => (
            <div
              key={h.id}
              data-attr={`ai-history-${h.id}`}
              className="rounded-lg border border-border/70 bg-card/60 px-2.5 py-1.5"
            >
              <div className="flex items-center gap-2">
                <span className="truncate text-[11px] text-ink-2">{h.text}</span>
                <span className="ml-auto shrink-0 text-[9.5px] tabular-nums text-ink-3">
                  {new Date(h.at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
              <p className="mt-0.5 text-[10.5px] leading-snug text-ink-3">{h.summary}</p>
            </div>
          ))
        )}
      </div>

      <Divider className="mx-3 my-2" />

      {/* Prompts */}
      <SectionTitle icon={Lightbulb}>Prompts</SectionTitle>
      <div className="mx-3 mb-2 flex flex-wrap gap-1.5">
        {AI_PROMPTS.map((p) => (
          <Chip key={p} label={p} onClick={() => w.runAiCommand(p)} />
        ))}
      </div>

      <Divider className="mx-3 my-2" />

      {/* Outils IA */}
      <SectionTitle icon={Wand2}>Outils IA</SectionTitle>
      <div className="mx-3 mb-2 space-y-1.5">
        <QuickAction label="Analyse complète" icon={ScanSearch} onClick={() => w.runAiCommand("Analyse cette radiographie.")} />
        <QuickAction label="Détection de pathologies" icon={Sparkles} onClick={() => w.runAiCommand("Détecte une pneumonie.")} />
        <QuickAction label="Générer un rapport" icon={FileText} onClick={() => w.runAiCommand("Génère un rapport.")} />
      </div>

      <Divider className="mx-3 my-2" />

      {/* Actions rapides */}
      <SectionTitle icon={Zap}>Actions rapides</SectionTitle>
      <div className="mx-3 mb-3 space-y-1.5">
        <QuickAction label="Afficher la Grad-CAM" icon={Sparkles} accent onClick={() => w.runAiCommand("Affiche la Grad-CAM.")} />
        <QuickAction label="Zoom région suspecte" icon={ScanSearch} onClick={() => w.runAiCommand("Zoom sur la région suspecte.")} />
        <QuickAction label="Fenêtrage Lung" icon={Wand2} onClick={() => w.runAiCommand("Applique le fenêtrage Lung.")} />
      </div>
    </motion.aside>
  );
}
