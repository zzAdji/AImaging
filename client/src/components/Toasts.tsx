import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { useWorkspace, type NotificationKind } from "../state/workspace";
import { cn } from "../lib/cn";

const KIND_STYLES: Record<NotificationKind, { icon: typeof Info; ring: string; iconColor: string }> = {
  info: { icon: Info, ring: "border-blue-400/40", iconColor: "text-blue-400" },
  success: { icon: CheckCircle2, ring: "border-emerald-500/40", iconColor: "text-emerald-400" },
  warning: { icon: AlertTriangle, ring: "border-amber-500/40", iconColor: "text-amber-400" },
  error: { icon: XCircle, ring: "border-red-500/40", iconColor: "text-red-400" },
};

export function ToastHost() {
  const { notifications, dismissNotification } = useWorkspace();
  return (
    <div className="pointer-events-none fixed inset-x-0 top-14 z-[200] flex flex-col items-center gap-2 px-4">
      {notifications.map((n) => {
        const style = KIND_STYLES[n.kind];
        const Icon = style.icon;
        return (
          <div
            key={n.id}
            role="alert"
            data-kind={n.kind}
            className={cn(
              "pointer-events-auto flex w-full max-w-md items-start gap-2.5 rounded-xl border border-border bg-card/95 px-3.5 py-2.5 shadow-xl shadow-black/50 backdrop-blur-sm animate-pop",
              style.ring,
            )}
          >
            <Icon size={16} strokeWidth={2.2} className={cn("mt-0.5 shrink-0", style.iconColor)} />
            <div className="min-w-0 flex-1">
              <p className="text-[12.5px] font-semibold text-ink">{n.title}</p>
              {n.message && (
                <p className="mt-0.5 whitespace-pre-line text-[11.5px] leading-relaxed text-ink-2">{n.message}</p>
              )}
            </div>
            <button
              type="button"
              aria-label="Fermer"
              onClick={() => dismissNotification(n.id)}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-ink-3 transition-colors duration-100 hover:bg-hover hover:text-ink"
            >
              <X size={13} />
            </button>
          </div>
        );
      })}
    </div>
  );
}