import { motion } from "framer-motion";
import { useState } from "react";
import { Button } from "../ui";

export function AiDisclaimer({
  onContinue,
  onBack,
}: {
  onContinue: (ack: boolean) => void;
  onBack?: () => void;
}) {
  const [ack, setAck] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/55 backdrop-blur-[3px]"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 6 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        data-attr="ai-disclaimer"
        className="w-[430px] max-w-[92vw] rounded-2xl border border-border bg-panel p-6 shadow-2xl shadow-black/60"
      >
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent">
            <img
              src="/icon_dark.ico"
              alt="AImaging"
              data-attr="editor-logo"
              className="h-min w-min animate-fade z-10 rounded-md"
              style={{ animationDelay: "0ms" }}
            />
          </span>
          <div>
            <h2 className="text-[15px] font-semibold tracking-tight text-ink">
              Mode IA : Aide à l'interprétation
            </h2>
            <p className="mt-0.5 text-[11.5px] text-ink-3">
              AImaging · Assistant médical
            </p>
          </div>
        </div>

        <div className="mt-4 space-y-2.5 rounded-xl border border-border bg-canvas/60 p-4 text-[12.5px] leading-relaxed text-ink-2">
          <p>
            Les analyses générées par l'intelligence artificielle sont
            uniquement des aides à l'interprétation.
          </p>
          <p>
            Les résultats doivent toujours être validés par un professionnel de
            santé.
          </p>
          <p>Le mode IA peut produire des erreurs ou des faux positifs.</p>
        </div>

        <label className="mt-4 flex cursor-pointer items-center gap-2 text-[12px] text-ink-2 select-none">
          <input
            type="checkbox"
            checked={ack}
            onChange={(e) => setAck(e.target.checked)}
            data-attr="ai-disclaimer-ack"
            className="h-3.5 w-3.5 accent-[var(--color-accent)]"
          />
          Ne plus afficher pendant cette session
        </label>

        <div className="mt-5 flex justify-end gap-2">
          {onBack && (
            <Button
              variant="secondary"
              data="ai-disclaimer-back"
              onClick={onBack}
            >
              Retour
            </Button>
          )}
          <Button
            variant="primary"
            data="ai-disclaimer-continue"
            onClick={() => onContinue(ack)}
          >
            Continuer
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}
