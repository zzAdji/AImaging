import { type CSSProperties, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "../lib/cn";
import { useWorkspace, type SectionId } from "../state/workspace";

/* ---------------------------------- Tooltip --------------------------------- */

export function Tooltip({
  label,
  shortcut,
  side = "bottom",
  children,
}: {
  label: string;
  shortcut?: string;
  side?: "bottom" | "right";
  children: ReactNode;
}) {
  return (
    <span className="group/tip relative inline-flex">
      {children}
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute z-[120] whitespace-nowrap rounded-md border border-border bg-[#0e0e0e] px-2 py-[5px] text-[11px] font-normal text-ink opacity-0 shadow-lg shadow-black/40 transition-opacity duration-150 [transition-delay:300ms] group-hover/tip:opacity-100",
          side === "bottom" && "left-1/2 top-full mt-1.5 -translate-x-1/2",
          side === "right" && "left-full top-1/2 ml-2 -translate-y-1/2",
        )}
      >
        {label}
        {shortcut && <span className="ml-1.5 text-ink-3">{shortcut}</span>}
      </span>
    </span>
  );
}

/* -------------------------------- Icon button ------------------------------- */

export function IconButton({
  icon: Icon,
  label,
  onClick,
  active,
  disabled,
  className,
}: {
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-icon transition-colors duration-150 ease-out",
        !disabled && !active && "hover:bg-hover hover:text-ink",
        active && "text-accent",
        disabled && "cursor-default opacity-50",
        className,
      )}
    >
      <Icon size={16} strokeWidth={2} />
    </button>
  );
}

/* ---------------------------------- Button ---------------------------------- */

export function Button({
  children,
  onClick,
  variant = "secondary",
  disabled,
  className,
  data,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary";
  disabled?: boolean;
  className?: string;
  data?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-attr={data}
      className={cn(
        "rounded-xl px-3 py-1.5 text-[12.5px] font-medium transition-colors duration-150 ease-out disabled:cursor-default disabled:opacity-50",
        variant === "primary" &&
          "bg-accent text-white hover:bg-[#4f8ef7] active:bg-[#2563eb]",
        variant === "secondary" &&
          "border border-border bg-btn text-ink hover:bg-hover active:bg-btn-pressed",
        className,
      )}
    >
      {children}
    </button>
  );
}

/* ---------------------------------- Slider ---------------------------------- */

export function Slider({
  label,
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  display,
  disabled,
  data,
}: {
  label?: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  display?: string;
  disabled?: boolean;
  data?: string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className={cn("w-full", disabled && "pointer-events-none opacity-50")}>
      {label && (
        <div className="mb-1.5 flex items-baseline justify-between">
          <span className="text-[12px] text-ink-2">{label}</span>
          <span className="text-[11px] tabular-nums text-ink-3">{display ?? value}</span>
        </div>
      )}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        data-attr={data}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ "--fill": `linear-gradient(to right, var(--color-accent) ${pct}%, #2f2f2f ${pct}%)` } as CSSProperties}
      />
    </div>
  );
}

/* ---------------------------------- Toggle ---------------------------------- */

export function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-[18px] w-8 shrink-0 rounded-full p-[2px] transition-colors duration-150 ease-out",
        checked ? "bg-accent" : "bg-active",
        disabled && "cursor-default opacity-50",
      )}
    >
      <span
        className={cn(
          "block h-full aspect-square rounded-full bg-white transition-transform duration-150 ease-out",
          checked && "translate-x-3.5",
        )}
      />
    </button>
  );
}

/* -------------------------------- Segmented --------------------------------- */

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: { label: string; value: T }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex w-full rounded-xl border border-border bg-btn p-0.5", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "flex-1 rounded-[10px] px-2 py-[3px] text-[12px] transition-colors duration-150 ease-out",
            o.value === value
              ? "bg-active font-medium text-ink"
              : "text-ink-2 hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* --------------------------------- Section ---------------------------------- */

export function Section({
  id,
  title,
  children,
  right,
}: {
  id: SectionId;
  title: string;
  children: ReactNode;
  right?: ReactNode;
}) {
  const { collapsed, toggleSection } = useWorkspace();
  const isCollapsed = collapsed[id];
  return (
    <div className="overflow-hidden rounded-[14px] border border-border bg-card">
      <button
        type="button"
        onClick={() => toggleSection(id)}
        className={cn(
          "flex h-9 w-full items-center justify-between gap-2 px-3 transition-colors duration-150 ease-out hover:bg-hover",
          !isCollapsed && "border-b border-border",
        )}
      >
        <span className="flex items-center gap-1.5">
          <ChevronDown
            size={14}
            strokeWidth={2}
            className={cn(
              "text-ink-3 transition-transform duration-150 ease-out",
              isCollapsed && "-rotate-90",
            )}
          />
          <span className="text-[12px] font-medium tracking-[0.01em] text-ink-2">{title}</span>
        </span>
        {right}
      </button>
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-150 ease-out",
          isCollapsed ? "grid-rows-[0fr]" : "grid-rows-[1fr]",
        )}
      >
        <div className="overflow-hidden">
          <div className="space-y-3 p-3">{children}</div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------- Progress ---------------------------------- */

export function ProgressBar({
  value,
  className,
  tone = "accent",
}: {
  value?: number;
  className?: string;
  tone?: "accent" | "neutral";
}) {
  if (value === undefined) {
    return (
      <div className={cn("h-1 w-full overflow-hidden rounded-full bg-active", className)}>
        <div
          className={cn(
            "h-full w-2/5 rounded-full bg-gradient-to-r from-accent/40 via-accent to-accent/40 aim-indeterminate-bar",
            tone === "accent" ? "" : "opacity-60",
          )}
        />
      </div>
    );
  }
  return (
    <div className={cn("h-1 w-full overflow-hidden rounded-full bg-active", className)}>
      <div
        className={cn(
          "relative h-full overflow-hidden rounded-full transition-[width] duration-500 ease-out",
          tone === "accent" ? "bg-accent" : "bg-ink-3",
        )}
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      >
        <span className="absolute inset-0 aim-progress-shimmer bg-[linear-gradient(100deg,transparent_30%,rgba(255,255,255,0.35)_50%,transparent_70%)]" />
      </div>
    </div>
  );
}

/* ------------------------------- Key / value -------------------------------- */

export function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="truncate text-[12px] text-ink-3">{k}</span>
      <span className="truncate text-right text-[12px] text-ink-2">{v}</span>
    </div>
  );
}

export function Divider({ className }: { className?: string }) {
  return <div className={cn("h-px w-full bg-border", className)} />;
}

export function Badge({
  children,
  className,
  data,
}: {
  children: ReactNode;
  className?: string;
  data?: string;
}) {
  return (
    <span
      data-attr={data}
      className={cn(
        "inline-flex items-center gap-1 rounded-md border border-border bg-btn px-1.5 py-[2px] text-[11px] text-ink-2",
        className,
      )}
    >
      {children}
    </span>
  );
}

/* ---------------------------------- Modal ---------------------------------- */

export function Modal({
  title,
  onClose,
  children,
  footer,
  width = "w-80",
  data,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
  data?: string;
}) {
  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div
        data-attr={data}
        className={cn("relative max-h-[88vh] w-auto max-w-[92vw] overflow-y-auto rounded-xl border border-border bg-card p-4 shadow-2xl shadow-black/50 animate-pop", width)}
      >
        <h2 className="mb-3 text-[13px] font-semibold text-ink">{title}</h2>
        {children}
        {footer && <div className="mt-4 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

/* -------------------------------- Menu bar ---------------------------------- */

export interface MenuEntry {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  dividerBefore?: boolean;
  onSelect?: () => void;
  children?: MenuEntry[];
  selected?: boolean;
}

export function MenuItemRow({
  entry,
  onClose,
}: {
  entry: MenuEntry;
  onClose: () => void;
}) {
  const hasSub = !!entry.children && entry.children.length > 0;
  return (
    <div className="group/menu relative">
      {entry.dividerBefore && <div className="mx-2 my-1 h-px bg-border" />}
      <button
        type="button"
        disabled={entry.disabled}
        onClick={() => {
          if (!hasSub && entry.onSelect) {
            entry.onSelect();
            onClose();
          }
        }}
        className={cn(
          "relative flex w-full items-center justify-between gap-6 rounded-lg px-2.5 py-[5px] text-left text-[12.5px] transition-colors duration-100",
          entry.disabled
            ? "cursor-default text-ink-3/70"
            : "text-ink hover:bg-hover",
        )}
      >
        <span className={cn("truncate", entry.selected && "text-accent")}>
          {entry.label}
        </span>
        <span className="flex items-center gap-2">
          {entry.shortcut && (
            <span className="text-[11px] text-ink-3">{entry.shortcut}</span>
          )}
          {hasSub && <ChevronRight size={13} className="text-ink-3" />}
        </span>
      </button>
      {hasSub && (
        <div className="invisible absolute left-full top-0 z-[110] pl-0.5 opacity-0 transition-opacity duration-100 group-hover/menu:visible group-hover/menu:opacity-100">
          <div className="min-w-52 rounded-xl border border-border bg-[#222222] p-1 shadow-xl shadow-black/40 animate-pop">
            {entry.children!.map((sub, i) => (
              <MenuItemRow key={i} entry={sub} onClose={onClose} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
