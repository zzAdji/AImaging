import { useState } from "react";
import { cn } from "../lib/cn";
import { useWorkspace } from "../state/workspace";
import { MenuItemRow } from "./ui";

const ZOOM_PRESETS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];

export function StatusBar() {
  const w = useWorkspace();
  const [zoomOpen, setZoomOpen] = useState(false);
  const zoomPct = Math.round(w.view.s * 100);

  return (
    <footer data-statusbar className="relative z-[70] flex h-6 shrink-0 items-center border-t border-border bg-titlebar px-2 text-[11px] tabular-nums text-ink-2">
      <div className="relative">
        <button
          type="button"
          onClick={() => setZoomOpen((o) => !o)}
          className={cn(
            "rounded px-1.5 py-px text-[11px] tabular-nums transition-colors duration-100",
            zoomOpen ? "bg-hover text-ink" : "text-ink-2 hover:bg-hover hover:text-ink",
          )}
        >
          {zoomPct}%
        </button>
        {zoomOpen && (
          <>
            <div className="fixed inset-0 z-[90]" onClick={() => setZoomOpen(false)} />
            <div className="absolute bottom-full left-0 z-[100] mb-0.5 w-36 rounded-xl border border-border bg-[#222222] p-1 shadow-xl shadow-black/40 animate-pop">
              <MenuItemRow entry={{ label: "Fit to Screen", shortcut: "Ctrl+1", onSelect: w.requestFit }} onClose={() => setZoomOpen(false)} />
              {ZOOM_PRESETS.map((z) => (
                <MenuItemRow
                  key={z}
                  entry={{
                    label: `${Math.round(z * 100)}%`,
                    selected: Math.abs(z - w.view.s) < 0.001,
                    onSelect: () => {
                      w.setZoomPreset("actual");
                      w.setView({ ...w.viewRef.current, s: z });
                    },
                  }}
                  onClose={() => setZoomOpen(false)}
                />
              ))}
            </div>
          </>
        )}
      </div>

      <button
        type="button"
        data-attr="zoom-fit"
        onClick={() => w.requestFit()}
        className="ml-1 rounded px-1.5 py-px text-[11px] text-ink-2 transition-colors duration-100 hover:bg-hover hover:text-ink"
      >
        Fit
      </button>

      <div className="mx-2 h-3 w-px bg-border" />

      <span className="hidden text-ink-3 md:inline">
        x: {w.cursorPos ? w.cursorPos.x : "—"} · y: {w.cursorPos ? w.cursorPos.y : "—"}
      </span>

      <div className="mx-2 hidden h-3 w-px bg-border md:block" />

      <span className="hidden sm:inline">{w.dims.w > 0 ? `${w.dims.w} × ${w.dims.h} px` : "No image"}</span>

      {w.dims.w > 0 && (
        <>
          <div className="mx-2 hidden h-3 w-px bg-border sm:block" />

          <span className="hidden text-ink-3 lg:inline">72 DPI</span>

          <div className="mx-2 hidden h-3 w-px bg-border lg:block" />

          <span className="hidden text-ink-3 lg:inline">
            Raster · 8-bit · {((w.dims.w * w.dims.h * 4) / 1048576).toFixed(1)} MB
          </span>
        </>
      )}

      <span className="ml-auto hidden text-ink-3/50 sm:inline">AImaging 1.0</span>
    </footer>
  );
}
