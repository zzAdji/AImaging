import { motion } from "framer-motion";
import { MousePointer2, Sparkles } from "lucide-react";
import { cn } from "../../lib/cn";

const TRANSITION = { type: "spring" as const, stiffness: 500, damping: 40, mass: 0.6 };

function Option({
  active,
  onClick,
  children,
  dataAttr,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  dataAttr: string;
}) {
  return (
    <button
      type="button"
      data-attr={dataAttr}
      onClick={onClick}
      className={cn(
        "relative z-10 flex h-[26px] flex-1 items-center justify-center gap-1 rounded-full text-[11.5px] font-medium transition-colors duration-300",
        active ? "text-ink" : "text-ink-3 hover:text-ink-2",
      )}
    >
      {children}
    </button>
  );
}

export function ModeSwitch({
  aiMode,
  onChange,
  className,
}: {
  aiMode: boolean;
  onChange: (v: boolean) => void;
  className?: string;
}) {
  return (
    <div
      data-attr="ai-mode-toggle"
      className={cn(
        "flex h-7 w-[148px] shrink-0 items-center rounded-full border border-border bg-hover/70 p-[3px]",
        className,
      )}
    >
      <Option active={!aiMode} onClick={() => onChange(false)} dataAttr="ai-mode-normal">
        {!aiMode && (
          <motion.span
            layout
            transition={TRANSITION}
            className="absolute inset-0 -z-10 rounded-full bg-card shadow-sm shadow-black/30 ring-1 ring-border"
          />
        )}
        <MousePointer2 size={12} strokeWidth={2.2} />
        Normal
      </Option>
      <Option active={aiMode} onClick={() => onChange(true)} dataAttr="ai-mode-ai">
        {aiMode && (
          <motion.span
            layout
            transition={TRANSITION}
            className="absolute inset-0 -z-10 rounded-full bg-card shadow-sm shadow-black/30 ring-1 ring-border"
          />
        )}
        <Sparkles size={12} strokeWidth={2.2} className="text-accent" />
        AI
      </Option>
    </div>
  );
}
