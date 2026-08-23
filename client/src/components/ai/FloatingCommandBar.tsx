import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, ChevronUp, Loader2, Mic, Send, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "../../lib/cn";
import { commandSuggestions, completeCommand, type CommandSuggestion } from "../../lib/aiCommandSyntax";
import { useEditorModality } from "../../state/editorModality";
import { useFetalExam } from "../../state/fetalExam";
import { useWorkspace } from "../../state/workspace";

/**
 * Waveform profile covering the whole bar (GPT-mobile style):
 * a sound-like envelope with slight per-bar phase drift so the wave ripples.
 */
/** Centered waveform: each bar grows up AND down from the mid-line,
 *  so silence reads as a flat line and sound as a symmetric ripple. */
const WAVE_PROFILE = Array.from({ length: 96 }, (_, i) => {
  const t = i / 96;
  const env =
    0.3 +
    0.55 * Math.abs(Math.sin(t * Math.PI * 5)) +
    0.22 * Math.sin(t * Math.PI * 11) +
    0.12 * Math.sin(t * Math.PI * 23);
  return {
    h: Math.round(8 + env * 32),
    d: 0.85 + ((i * 13) % 7) / 10,
    delay: -i * 0.06,
  };
});

const THINK_DOTS = [0, 0.18, 0.36];

export function FloatingCommandBar({ mobile = false }: { mobile?: boolean }) {
  const w = useWorkspace();
  const m = useEditorModality();
  const fetal = useFetalExam();
  const usingFetal = m.modality === "fetal_ultrasound";
  const [value, setValue] = useState("");
  const [voice, setVoice] = useState(false);
  const [open, setOpen] = useState(true);
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const waveProfile = mobile ? WAVE_PROFILE.filter((_, i) => i % 3 === 0) : WAVE_PROFILE;

  /* §25 — commandes contextuelles : exécution LOCALE (panneaux/workflow),
     jamais routées vers les endpoints radiographiques. */
  const fetalCommands: CommandSuggestion[] = usingFetal
    ? m.module.commands.map((command) => ({
        name: command.name,
        usage: command.usage,
        description: command.usage,
      }))
    : [];
  const typed = value.trim().toLowerCase();
  const suggestions =
    usingFetal && typed.length > 0
      ? fetalCommands.filter((command) => command.usage.toLowerCase().includes(typed))
      : commandSuggestions(value);

  const runFetalCommand = (usage: string): boolean => {
    if (!usingFetal) return false;
    const normalized = usage.trim().toLowerCase();
    const matched = m.module.commands.find(
      (command) =>
        command.usage.toLowerCase() === normalized ||
        command.name.toLowerCase() === normalized.replace(/^@/, ""),
    );
    if (!matched) return false;
    switch (matched.name) {
      case "analyze_image":
        if (fetal.exam.status === "draft") fetal.startAnalysis();
        m.setActiveToolId("fetal-quality");
        break;
      case "detect_plane":
        m.setActiveToolId("fetal-plane-detection");
        break;
      case "best_views":
        m.setActiveToolId("fetal-selection");
        break;
      case "biometry":
      case "measurements":
        m.setActiveToolId(matched.name === "biometry" ? "fetal-biometry" : "fetal-measurements");
        break;
      case "show_f1":
      case "show_f2":
        m.setActiveToolId("fetal-fetus");
        w.notify("Fœtus affiché", "info", matched.usage);
        break;
      case "heart_images":
        m.setActiveToolId("fetal-plans");
        w.notify("Plans cardiaques", "info", "Ouvrez le plan 4CH / 3VV dans la carte Plans.");
        break;
      case "generate_report": {
        const started = fetal.generateReport();
        m.setActiveToolId("fetal-report");
        if (!started) w.notify("Rapport non lancé", "warning", "Analysez d'abord l'examen.");
        break;
      }
      default:
        return false;
    }
    return true;
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement !== inputRef.current) {
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const submit = (text = value) => {
    const t = text.trim();
    if (!t || w.aiBusy) return;
    /* Commandes fœtales : exécution locale, sans passer par le resolver radio. */
    if (runFetalCommand(t)) {
      setValue("");
      return;
    }
    setValue("");
    w.runAiCommand(t);
  };

  const toggleVoice = () => {
    if (voice) {
      /* Stop listening — submit the (simulated) transcription */
      setVoice(false);
      submit(
        usingFetal
          ? "Génère le compte rendu"
          : w.reportEditOpen
            ? "Ajoute une conclusion au rapport."
            : "Analyse cette radiographie.",
      );
    } else {
      setVoice(true);
    }
  };

  const fade = { duration: 0.22, ease: "easeOut" } as const;

  return (
    <motion.div
      initial={{ y: 24, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 24, opacity: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      data-attr="ai-command-bar"
      className={cn(
        "pointer-events-none absolute inset-x-0 z-40 flex justify-center",
        mobile
          ? "bottom-[calc(env(safe-area-inset-bottom,0px)+10px)] px-3"
          : "bottom-4 px-6",
      )}
    >
      <div
        className={cn(
          "flex w-full flex-col items-center gap-2",
          mobile ? "max-w-none" : "max-w-[700px]",
        )}
      >
        {/* Suggestions open ABOVE the bar so the bar itself never moves */}
        <AnimatePresence initial={false}>
          {open && !voice && suggestions.length > 0 && (
            <motion.div
              key="suggestions"
              data-attr="ai-command-suggestions"
              initial={{ opacity: 0, y: 14, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.98 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="pointer-events-auto w-full overflow-hidden rounded-2xl border border-border bg-panel/95 p-1.5 shadow-2xl shadow-black/50 backdrop-blur"
            >
              {suggestions.map((suggestion, index) => (
                <button
                  key={suggestion.name}
                  type="button"
                  data-attr={`ai-command-suggestion-${suggestion.name}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    setValue(usingFetal ? suggestion.usage : completeCommand(value, suggestion));
                    inputRef.current?.focus();
                  }}
                  className={cn(
                    "flex w-full items-start gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors",
                    index === activeSuggestion ? "bg-accent/15" : "hover:bg-hover",
                  )}
                >
                  <code className="shrink-0 text-[11px] font-semibold text-accent">@{suggestion.name}</code>
                  <span className="min-w-0 text-[10.5px] text-ink-3">{suggestion.description}</span>
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
        <AnimatePresence initial={false}>
          {w.aiThought ? (
            <motion.div
              key={w.aiThought.id}
              data-attr="ai-thought"
              initial={{ opacity: 0, y: 14, scale: 0.96 }}
              animate={{ opacity: 0.62, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.96 }}
              transition={{ duration: 0.26, ease: "easeOut" }}
              className="rounded-full border border-border bg-card/85 px-3.5 py-1 text-[11px] text-ink shadow-lg shadow-black/40 backdrop-blur"
            >
              {w.aiThought.text}
            </motion.div>
          ) : null}
        </AnimatePresence>
        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              key="ai-input-card"
              initial={{ y: 180, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 180, opacity: 0 }}
              transition={{ type: "spring", stiffness: 300, damping: 33, mass: 1 }}
              className={cn(
                "pointer-events-auto w-full overflow-hidden rounded-2xl border border-border bg-card/95 shadow-2xl shadow-black/50 backdrop-blur",
                mobile ? "max-w-none" : "max-w-[700px]",
              )}
            >
        <AnimatePresence mode="popLayout" initial={false}>
          {!voice ? (
            <motion.div
              key="input-row"
              initial={{ opacity: 0, y: 8, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.985 }}
              transition={fade}
              className="flex h-12 w-full items-center gap-2 px-3"
            >
              <button
                type="button"
                data-attr="ai-command-toggle"
                onClick={() => setOpen(false)}
                title="Masquer la barre de saisie"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-icon transition-colors duration-150 ease-out hover:bg-hover hover:text-ink"
              >
                <ChevronDown size={18} strokeWidth={2} />
              </button>
              {w.aiBusy ? (
                <div className="flex min-w-0 flex-1 items-center gap-1.5">
                  {THINK_DOTS.map((delay, index) => (
                    <span
                      key={index}
                      className="aim-think-dot"
                      style={{ animationDelay: `${delay}s` }}
                    />
                  ))}
                </div>
              ) : (
                <input
                  ref={inputRef}
                  data-attr="ai-command-input"
                  value={value}
                  onChange={(e) => {
                    setValue(e.target.value);
                    setActiveSuggestion(0);
                  }}
                  onKeyDown={(e) => {
                    if (suggestions.length > 0 && e.key === "ArrowDown") {
                      e.preventDefault();
                      setActiveSuggestion((index) => (index + 1) % suggestions.length);
                    } else if (suggestions.length > 0 && e.key === "ArrowUp") {
                      e.preventDefault();
                      setActiveSuggestion((index) => (index - 1 + suggestions.length) % suggestions.length);
                    } else if (!usingFetal && suggestions.length > 0 && (e.key === "Tab" || e.key === "Enter") && !/\s/.test(value.trimStart().slice(1))) {
                      e.preventDefault();
                      setValue(completeCommand(value, suggestions[activeSuggestion]));
                    } else if (e.key === "Enter") {
                      submit();
                    }
                  }}
                  placeholder="Demandez une analyse ou exécutez une commande…"
                  spellCheck={false}
                  className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-3/70"
                />
              )}
              <button
                type="button"
                data-attr="ai-command-mic"
                onClick={() => setVoice(true)}
                title="Entrée vocale"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-icon transition-colors duration-150 ease-out hover:bg-hover hover:text-ink"
              >
                <Mic size={16} strokeWidth={2} />
              </button>
              <button
                type="button"
                data-attr="ai-command-send"
                onClick={() => submit()}
                disabled={!value.trim() || w.aiBusy}
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors duration-150 ease-out",
                  value.trim() && !w.aiBusy
                    ? "bg-accent text-white hover:bg-[#4f8ef7] active:bg-[#2563eb]"
                    : "cursor-default bg-hover text-ink-3",
                )}
              >
                {w.aiBusy ? (
                  <Loader2 size={15} className="animate-spin text-accent" />
                ) : (
                  <Send size={15} strokeWidth={2.2} />
                )}
              </button>
            </motion.div>
          ) : (
            <motion.div
              key="voice-row"
              data-attr="ai-command-voice"
              initial={{ opacity: 0, y: -8, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.985 }}
              transition={fade}
              className="relative flex h-12 w-full items-center overflow-hidden"
            >
              {/* Full-width live waveform — bars stretch up AND down from the midline */}
              <div
                data-attr="ai-voice-bars"
                className="absolute inset-0 flex items-center justify-center gap-[3px] px-16"
              >
                {waveProfile.map((b, i) => (
                  <span
                    key={i}
                    className="voice-bar"
                    style={{
                      height: b.h,
                      width: i % 4 === 0 ? 4 : 3,
                      opacity: 0.85 + (i % 7) * 0.02,
                      animationDuration: `${b.d}s`,
                      animationDelay: `${b.delay}s`,
                      borderRadius: 3,
                    }}
                  />
                ))}
              </div>
              {/* Recording dot */}
              <span className="absolute left-3.5 top-1/2 z-10 h-3 w-3 -translate-y-1/2 animate-pulse rounded-full bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.9)]" />
              {/* Stop — perfect circle replacing the controls */}
              <div className="absolute right-3 top-1/2 z-10 -translate-y-1/2">
                <button
                  type="button"
                  data-attr="ai-command-mic"
                  title="Arrêter l'écoute"
                  onClick={toggleVoice}
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-white shadow-lg shadow-black/30 transition-all duration-150 ease-out hover:bg-[#4f8ef7] active:scale-90"
                >
                  <Square size={13} fill="currentColor" strokeWidth={0} />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
        {!open && (
          <motion.button
            key="ai-command-reopen"
            type="button"
            data-attr="ai-command-reopen"
            onClick={() => setOpen(true)}
            title="Afficher la barre de saisie"
            initial={{ opacity: 0, y: 12, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="pointer-events-auto flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card/95 text-icon shadow-lg shadow-black/40 backdrop-blur transition-colors duration-150 ease-out hover:bg-hover hover:text-ink"
          >
            <ChevronUp size={18} strokeWidth={2} />
          </motion.button>
        )}
      </div>
    </motion.div>
  );
}