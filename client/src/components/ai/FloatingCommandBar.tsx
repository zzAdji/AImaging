import { AnimatePresence, motion } from "framer-motion";
import { Loader2, Mic, Paperclip, Send, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "../../lib/cn";
import { commandSuggestions, completeCommand } from "../../lib/aiCommandSyntax";
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

export function FloatingCommandBar({ mobile = false }: { mobile?: boolean }) {
  const w = useWorkspace();
  const [value, setValue] = useState("");
  const [voice, setVoice] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const waveProfile = mobile ? WAVE_PROFILE.filter((_, i) => i % 3 === 0) : WAVE_PROFILE;
  const suggestions = commandSuggestions(value);

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
    setValue("");
    w.runAiCommand(t);
  };

  const toggleVoice = () => {
    if (voice) {
      /* Stop listening — submit the (simulated) transcription */
      setVoice(false);
      submit(w.reportEditOpen ? "Ajoute une conclusion au rapport." : "Analyse cette radiographie.");
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
        <div
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
                data-attr="ai-command-attach"
                title="Joindre un fichier (bientôt disponible)"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-icon transition-colors duration-150 ease-out hover:bg-hover hover:text-ink"
              >
                <Paperclip size={16} strokeWidth={2} />
              </button>
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
                  } else if (suggestions.length > 0 && (e.key === "Tab" || e.key === "Enter") && !/\s/.test(value.trimStart().slice(1))) {
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
        {!voice && suggestions.length > 0 && (
          <div data-attr="ai-command-suggestions" className="border-t border-border bg-panel/95 p-1.5">
            {suggestions.map((suggestion, index) => (
              <button
                key={suggestion.name}
                type="button"
                data-attr={`ai-command-suggestion-${suggestion.name}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setValue(completeCommand(value, suggestion));
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
          </div>
        )}
        </div>
      </div>
    </motion.div>
  );
}
