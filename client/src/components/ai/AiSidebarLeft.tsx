import { motion } from "framer-motion";
import {
  Activity,
  ArrowLeft,
  Baby,
  Crosshair,
  Droplets,
  FileText,
  Gauge,
  Heart,
  History,
  Images,
  LayoutGrid,
  Layers,
  List,
  ListChecks,
  Lock,
  LockOpen,
  Map,
  MoveVertical,
  Pencil,
  Ruler,
  Save,
  Scan,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  Star,
  Stethoscope,
  Terminal,
  Trash2,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { COMMAND_SUGGESTIONS } from "../../lib/aiCommandSyntax";
import { cn } from "../../lib/cn";
import { useEditorModality } from "../../state/editorModality";
import { useWorkspace } from "../../state/workspace";
import { Divider } from "../ui";

/** Icônes des outils fœtaux (résolution UI : le registre reste pur données). */
const FETAL_TOOL_ICONS: Record<string, LucideIcon> = {
  "fetal-analyze": Activity,
  "fetal-quality": Gauge,
  "fetal-plane-detection": Crosshair,
  "fetal-ai-selection": Star,
  "fetal-biometry": Ruler,
  "fetal-findings": ListChecks,
  "fetal-anomaly": ShieldAlert,
  "fetal-report": FileText,
  "fetal-examination": Images,
  "fetal-plans": LayoutGrid,
  "fetal-fetus": Baby,
  "fetal-measurements": Ruler,
  "fetal-placenta": Layers,
  "fetal-fluid": Droplets,
  "fetal-cervix": MoveVertical,
  "fetal-pregnancy": Heart,
};

type View = "main" | "history" | "commands" | "command-form";

/** État du formulaire de création / modification d'une commande. */
interface CommandFormState {
  /** id de la commande modifiée, null pour une nouvelle commande. */
  id: string | null;
  name: string;
  command: string;
}

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
  const saveAsCommand = (text: string) => {
    const base = text.trim().replace(/^@/, "").split(/\s/, 1)[0]?.toLowerCase() || "commande";
    let name = base;
    let n = 2;
    while (w.aiCustomCommands.some((cmd) => cmd.name === name)) name = `${base}-${n++}`;
    w.addAiCustomCommand(name, text);
    onBack();
  };
  return (
    <div className="flex h-full min-h-0 flex-col" data-attr="ai-history-view">
      <BackHeader onBack={onBack} title="Historique" dataBack="ai-history-back">
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
                    onClick={() => saveAsCommand(h.text)}
                    title="Enregistrer comme commande personnalisée"
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

/* --------------------- Vue créer / modifier une commande --------------------- */

function CommandFormView({ initial, onBack }: { initial: CommandFormState; onBack: () => void }) {
  const w = useWorkspace();
  const [name, setName] = useState(initial.name);
  const [command, setCommand] = useState(initial.command);
  const [error, setError] = useState<string | null>(null);
  const save = () => {
    const n = name.trim().replace(/^@/, "").toLowerCase();
    const c = command.trim();
    if (!n || !c) {
      setError("Le nom et la commande sont requis.");
      return;
    }
    if (!c.startsWith("@")) {
      setError("La commande doit commencer par « @ » (ex. @wl preset:lung).");
      return;
    }
    if (w.aiCustomCommands.some((cmd) => cmd.name === n && cmd.id !== initial.id)) {
      setError(`Une commande « @${n} » existe déjà.`);
      return;
    }
    if (initial.id) w.updateAiCustomCommand(initial.id, n, c);
    else w.addAiCustomCommand(n, c);
    onBack();
  };
  return (
    <div className="flex h-full min-h-0 flex-col" data-attr="ai-command-form-view">
      <BackHeader
        onBack={onBack}
        title={initial.id ? "Modifier la commande" : "Nouvelle commande"}
        dataBack="ai-command-form-back"
      />
      <Divider className="mx-3 my-2" />
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-3 pb-3">
        <label className="block">
          <span className="mb-1 block px-1 text-[10.5px] uppercase tracking-[0.08em] text-ink-3">Nom</span>
          <input
            data-attr="ai-command-name-input"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            placeholder="mon-fenetrage"
            spellCheck={false}
            className="w-full rounded-lg border border-border bg-canvas px-2.5 py-1.5 text-[12px] text-ink outline-none transition-colors duration-150 ease-out focus:border-accent/60"
          />
        </label>
        <label className="block">
          <span className="mb-1 block px-1 text-[10.5px] uppercase tracking-[0.08em] text-ink-3">Commande</span>
          <textarea
            data-attr="ai-command-value-input"
            value={command}
            onChange={(e) => {
              setCommand(e.target.value);
              setError(null);
            }}
            placeholder="@wl preset:lung"
            rows={3}
            spellCheck={false}
            className="w-full resize-none rounded-lg border border-border bg-canvas px-2.5 py-1.5 font-mono text-[12px] text-ink outline-none transition-colors duration-150 ease-out focus:border-accent/60"
          />
        </label>
        {error && <p className="px-1 text-[11px] text-red-400">{error}</p>}
        <p className="px-1 text-[10.5px] leading-snug text-ink-3">
          La commande sera exécutable depuis la barre de commandes et cette liste.
        </p>
      </div>
      <div className="border-t border-border px-3 py-2.5">
        <button
          type="button"
          data-attr="ai-command-save"
          onClick={save}
          disabled={!name.trim() || !command.trim()}
          className="w-full rounded-lg bg-accent py-1.5 text-[12px] font-medium text-white transition-colors duration-150 ease-out hover:bg-accent/90 disabled:opacity-40"
        >
          {initial.id ? "Mettre à jour" : "Enregistrer"}
        </button>
      </div>
    </div>
  );
}

/* --------------------------- Vue toutes les commandes --------------------------- */

function CommandsView({
  onBack,
  onNew,
  onEdit,
}: {
  onBack: () => void;
  onNew: () => void;
  onEdit: (id: string) => void;
}) {
  const w = useWorkspace();
  return (
    <div className="flex h-full min-h-0 flex-col" data-attr="ai-commands-view">
      <BackHeader onBack={onBack} title="Commandes" dataBack="ai-commands-back">
        <button
          type="button"
          data-attr="ai-commands-new"
          onClick={onNew}
          title="Créer une nouvelle commande"
          className="ml-auto flex items-center gap-1 rounded-md border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[10.5px] text-accent transition-colors duration-150 ease-out hover:bg-accent/20"
        >
          Nouvelle
        </button>
      </BackHeader>
      <Divider className="mx-3 my-2" />
      <div className="flex-1 overflow-y-auto px-3 pb-3">
        <div className="mb-1.5 px-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-3">
          Mes commandes ({w.aiCustomCommands.length})
        </div>
        {w.aiCustomCommands.length === 0 ? (
          <p className="mb-3 px-1 text-[11px] text-ink-3">Aucune commande enregistrée.</p>
        ) : (
          <div className="mb-3 space-y-1">
            {w.aiCustomCommands.map((cmd, i) => (
              <div
                key={cmd.id}
                data-attr={`ai-custom-command-row-${i}`}
                className="flex items-center gap-1.5 rounded-lg border border-accent/30 bg-accent/10 px-2 py-1.5"
              >
                <button
                  type="button"
                  onClick={() => w.runAiCommand(cmd.command)}
                  title="Exécuter cette commande"
                  className="min-w-0 flex-1 truncate text-left text-[11px] text-accent transition-colors duration-150 ease-out hover:text-ink"
                >
                  @{cmd.name}
                  <span className="ml-1.5 font-mono text-[9.5px] text-accent/60">{cmd.command}</span>
                </button>
                <button
                  type="button"
                  data-attr={`ai-custom-command-edit-${i}`}
                  onClick={() => onEdit(cmd.id)}
                  title="Modifier cette commande"
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-accent/60 transition-colors duration-150 ease-out hover:bg-accent/20 hover:text-accent"
                >
                  <Pencil size={11} strokeWidth={2.2} />
                </button>
                <button
                  type="button"
                  data-attr={`ai-custom-command-remove-${i}`}
                  onClick={() => w.removeAiCustomCommand(cmd.id)}
                  title="Supprimer cette commande"
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-accent/60 transition-colors duration-150 ease-out hover:bg-accent/20 hover:text-accent"
                >
                  <X size={11} strokeWidth={2.5} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="mb-1.5 px-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-3">
          Commandes intégrées
        </div>
        <div className="flex flex-wrap gap-1.5">
          {COMMAND_SUGGESTIONS.map((s) => (
            <Chip key={s.name} label={`@${s.name}`} onClick={() => w.runAiCommand(s.usage)} />
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

/* --------------------------------- Sidebar ---------------------------------- */

export function AiSidebarLeft({
  variant = "static",
}: {
  variant?: "static" | "drawer";
}) {
  const w = useWorkspace();
  const m = useEditorModality();
  const [view, setView] = useState<View>("main");
  const [form, setForm] = useState<CommandFormState | null>(null);

  const drawer = variant === "drawer";

  const openNewCommand = () => {
    setForm({ id: null, name: "", command: "" });
    setView("command-form");
  };

  const openEditCommand = (id: string) => {
    const cmd = w.aiCustomCommands.find((c) => c.id === id);
    if (!cmd) return;
    setForm({ id: cmd.id, name: cmd.name, command: cmd.command });
    setView("command-form");
  };

  const toggleGradcam = () => {
    /* Le clic ouvre toujours la carte Grad-CAM du panneau droit. */
    w.setGradcamCardOpen(true);
    if (w.gradcamResult) {
      w.setGradcamOn(!w.gradcamOn);
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
      {view === "command-form" && form && <CommandFormView initial={form} onBack={() => setView("main")} />}
      {view === "commands" && (
        <CommandsView onBack={() => setView("main")} onNew={openNewCommand} onEdit={openEditCommand} />
      )}

      {view === "main" && (
        <div className="flex min-h-0 flex-col overflow-y-auto">
          {/* Header : historique + nouvelle commande */}
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
              data-attr="ai-new-command-open"
              onClick={openNewCommand}
              title="Créer une nouvelle commande"
              className="flex items-center gap-1.5 rounded-lg border border-accent/40 bg-accent/10 px-2.5 py-1.5 text-[11.5px] text-accent transition-colors duration-150 ease-out hover:bg-accent/20"
            >
              <Save size={13} strokeWidth={2.2} />
              Nouvelle commande
            </button>
          </div>

          <Divider className="mx-3 my-2" />

          {/* Commandes */}
          <SectionTitle icon={Terminal}>Commandes</SectionTitle>
          <div className="mx-3 mb-2 space-y-1.5">
            {w.aiCustomCommands.length > 0 && (
              <div data-attr="ai-custom-commands" className="space-y-1">
                {w.aiCustomCommands.slice(0, 8).map((cmd, i) => (
                  <div
                    key={cmd.id}
                    data-attr={`ai-custom-command-${i}`}
                    className="flex items-center gap-1 rounded-lg border border-accent/30 bg-accent/10 px-2 py-1"
                  >
                    <button
                      type="button"
                      onClick={() => w.runAiCommand(cmd.command)}
                      title={`Exécute ${cmd.command}`}
                      className="min-w-0 truncate text-left text-[11px] text-accent transition-colors duration-150 ease-out hover:text-ink"
                    >
                      @{cmd.name}
                    </button>
                    <button
                      type="button"
                      data-attr={`ai-custom-command-edit-${i}`}
                      onClick={() => openEditCommand(cmd.id)}
                      title="Modifier cette commande"
                      className="ml-auto flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-accent/60 transition-colors duration-150 ease-out hover:bg-accent/20 hover:text-accent"
                    >
                      <Pencil size={10} strokeWidth={2.2} />
                    </button>
                    <button
                      type="button"
                      data-attr={`ai-custom-command-remove-${i}`}
                      onClick={() => w.removeAiCustomCommand(cmd.id)}
                      title="Supprimer cette commande"
                      className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-accent/60 transition-colors duration-150 ease-out hover:bg-accent/20 hover:text-accent"
                    >
                      <X size={10} strokeWidth={2.5} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-1.5">
              {COMMAND_SUGGESTIONS.map((s) => (
                <Chip key={s.name} label={`@${s.name}`} onClick={() => w.runAiCommand(s.usage)} />
              ))}
            </div>
            <button
              type="button"
              data-attr="ai-commands-see-all"
              onClick={() => setView("commands")}
              className="flex items-center gap-1 rounded-md border border-border bg-btn px-2 py-1 text-[10.5px] text-ink-3 transition-colors duration-150 ease-out hover:bg-hover hover:text-ink"
            >
              <List size={11} strokeWidth={2.2} />
              Voir tout ({w.aiCustomCommands.length + COMMAND_SUGGESTIONS.length})
            </button>
          </div>

          <Divider className="mx-3 my-2" />

          {m.modality === "fetal_ultrasound" ? (
            <>
              {/* Outils IA fœtaux (registre) + Verrou, générique à l'éditeur.
                  Grad-CAM est un modèle radiographique : masqué hors radio. */}
              <SectionTitle icon={Zap}>Outils IA</SectionTitle>
              <div className="mx-3 grid grid-cols-2 gap-2">
                <RadioToolButton
                  label="Verrou"
                  icon={w.imageLocked ? Lock : LockOpen}
                  active={w.imageLocked}
                  dataAttr="ai-tool-lock"
                  onClick={() => w.setImageLocked(!w.imageLocked)}
                />
                {m.module.aiTools.map((tool) => (
                  <RadioToolButton
                    key={tool.id}
                    label={tool.label}
                    icon={FETAL_TOOL_ICONS[tool.id] ?? Sparkles}
                    active={m.activeToolId === tool.id}
                    dataAttr={`fetal-tool-${tool.id}`}
                    onClick={() => m.setActiveToolId(m.activeToolId === tool.id ? null : tool.id)}
                  />
                ))}
              </div>

              <Divider className="mx-3 my-2" />

              {/* Outils spécifiques à la modalité échographie */}
              <SectionTitle icon={Stethoscope}>Outils échographie</SectionTitle>
              <div className="mx-3 mb-3 grid grid-cols-2 gap-2">
                {m.module.modalityTools.map((tool) => (
                  <RadioToolButton
                    key={tool.id}
                    label={tool.label}
                    icon={FETAL_TOOL_ICONS[tool.id] ?? Sparkles}
                    active={m.activeToolId === tool.id}
                    dataAttr={`fetal-tool-${tool.id}`}
                    onClick={() => m.setActiveToolId(m.activeToolId === tool.id ? null : tool.id)}
                  />
                ))}
              </div>
            </>
          ) : (
            <>
              {/* Outils IA — section historique (radiographie / référence) */}
              <SectionTitle icon={Zap}>Outils IA</SectionTitle>
              <div className="mx-3 grid grid-cols-2 gap-2">
                <RadioToolButton
                  label="Grad-CAM"
                  icon={Map}
                  active={w.gradcamOn && Boolean(w.gradcamResult)}
                  dataAttr="ai-tool-gradcam"
                  onClick={toggleGradcam}
                />
                <RadioToolButton
                  label="Verrou"
                  icon={w.imageLocked ? Lock : LockOpen}
                  active={w.imageLocked}
                  dataAttr="ai-tool-lock"
                  onClick={() => w.setImageLocked(!w.imageLocked)}
                />
              </div>

              {/* Outils radio */}
              <SectionTitle icon={Stethoscope}>Outils radio</SectionTitle>
              <div className="mx-3 mb-3 grid grid-cols-2 gap-2">
                <RadioToolButton
                  label="Sonde"
                  icon={Crosshair}
                  active={w.tool === "probe"}
                  dataAttr="ai-tool-sonde"
                  onClick={() => w.setTool(w.tool === "probe" ? "move" : "probe")}
                />
                <RadioToolButton
                  label="Régler l'image"
                  icon={SlidersHorizontal}
                  active={w.imageCardOpen}
                  dataAttr="ai-tool-fenetrage"
                  onClick={() => w.setImageCardOpen(!w.imageCardOpen)}
                />
                <RadioToolButton
                  label="Segmentation"
                  icon={Scan}
                  active={w.anatomyCardOpen}
                  dataAttr="ai-tool-anatomie"
                  onClick={() => w.toggleAnatomyCard()}
                />
                <RadioToolButton
                  label="Mesures"
                  icon={Ruler}
                  active={w.landmarkCardOpen}
                  dataAttr="ai-tool-landmarks"
                  onClick={() => w.toggleLandmarksCard()}
                />
              </div>
            </>
          )}
        </div>
      )}
    </motion.aside>
  );
}




