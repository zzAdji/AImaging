import { useEffect, useState } from "react";
import { computeHistogram, type HistogramResult } from "../lib/histogram";
import { deriveMetadata } from "../lib/metadata";
import { SHORTCUTS } from "../lib/shortcuts";
import { useWorkspace } from "../state/workspace";
import { Button, Divider, KV, Modal, Segmented } from "./ui";

/* ------------------------------- Histogram ------------------------------- */

export function HistogramModal({ onClose }: { onClose: () => void }) {
  const w = useWorkspace();
  const [hist, setHist] = useState<HistogramResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    computeHistogram(w.imageSrc)
      .then((h) => {
        if (alive) setHist(h);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : "failed");
      });
    return () => {
      alive = false;
    };
  }, [w.imageSrc]);

  const peak = hist ? Math.max(1, ...hist.bins) : 1;

  return (
    <Modal title="Histogram" onClose={onClose} width="w-[480px]">
      <div data-histogram className="space-y-3">
        {error && <p className="text-[12px] text-red-400">{error}</p>}
        {hist && (
          <>
            <svg data-histogram-svg width="440" height="132" viewBox="0 0 440 132" className="block w-full rounded-lg border border-border bg-btn">
              {hist.bins.map((b, i) => (
                <rect
                  key={i}
                  x={i * (440 / 256)}
                  y={128 - (b / peak) * 126}
                  width={Math.max(1, 440 / 256)}
                  height={(b / peak) * 126}
                  fill="var(--color-accent)"
                  opacity={0.75}
                />
              ))}
            </svg>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              <KV k="Samples" v={hist.sampled.toLocaleString()} />
              <KV k="Range" v={`${hist.min} – ${hist.max}`} />
              <KV k="Mean luminance" v={hist.mean.toFixed(1)} />
              <KV k="Std dev" v={hist.std.toFixed(1)} />
            </div>
            <p className="text-[11px] leading-relaxed text-ink-3">
              256 bins · luminance of the original pixel data (W/L, brightness and contrast do not alter the
              histogram). Computed locally — no data leaves the browser.
            </p>
          </>
        )}
        {!hist && !error && <p className="py-6 text-center text-[12px] text-ink-3">Computing histogram…</p>}
      </div>
      <div className="mt-4 flex justify-end">
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      </div>
    </Modal>
  );
}

/* ------------------------------- Image info ------------------------------ */

export function ImageInfoModal({ onClose }: { onClose: () => void }) {
  const w = useWorkspace();
  const [tab, setTab] = useState<"General" | "DICOM">("General");
  const mb = ((w.dims.w * w.dims.h * 4) / 1048576).toFixed(1);
  const format = w.imageMetadata ? "DICOM rendered as PNG" : w.imageSrc.startsWith("data:image/jpeg") ? "JPEG" : "PNG";
  const dicomRows = deriveMetadata({ name: w.imageName, dims: w.dims, metadata: w.imageMetadata, wl: w.wl });

  return (
    <Modal title="Image Info" onClose={onClose} width="w-[420px]">
      <div data-imageinfo className="space-y-3">
        <Segmented<"General" | "DICOM">
          options={[
            { label: "General", value: "General" },
            { label: "DICOM", value: "DICOM" },
          ]}
          value={tab}
          onChange={setTab}
        />
        <div className="space-y-1.5">
          {tab === "General" ? (
            <>
              <KV k="Name" v={w.imageName} />
              <KV k="Dimensions" v={`${w.dims.w} × ${w.dims.h} px`} />
              <KV k="File format" v={format} />
              <KV k="File size" v={`${mb} MB`} />
              <KV k="Bit depth" v={w.imageMetadata?.bitsStored ? `${w.imageMetadata.bitsStored}-bit source` : "8-bit rendered"} />
              <KV k="Modality" v={w.imageMetadata?.modality ?? "Unknown"} />
              <KV k="Calibration" v={w.pixelSpacingMm ? "DICOM active" : "None — measurements in pixels"} />
              <KV k="Window / Level" v={`${Math.round(w.wl.window)} / ${Math.round(w.wl.level)}`} />
              <KV k="Brightness / Contrast" v={`${Math.round(w.brightness)} / ${Math.round(w.contrast)}`} />
              <KV k="Zoom" v={`${Math.round((w.activePane === "B" ? w.viewB : w.view).s * 100)}%`} />
              <KV k="Rotation" v={`${w.rotation}°`} />
              <KV k="Flip" v={w.flipH || w.flipV ? `${w.flipH ? "H" : ""}${w.flipV ? "V" : ""}` : "None"} />
              <KV k="Annotations" v={`${w.shapes.length}`} />
            </>
          ) : (
            w.imageMetadata
              ? dicomRows.map(([k, v]) => <KV key={k} k={k} v={v} />)
              : <p className="text-[12px] text-ink-3">No real DICOM metadata is available for this image.</p>
          )}
        </div>
      </div>
      <div className="mt-4 flex justify-end">
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      </div>
    </Modal>
  );
}

/* ------------------------------ Documentation ----------------------------- */

const DOC_SECTIONS: [string, string][] = [
  [
    "Getting started",
    "Open an image with File &gt; Open Image… (Ctrl+O) or by dropping a file in the workspace. Recent files are listed under File &gt; Open Recent.",
  ],
  [
    "Drawing tools",
    "Pick a tool from the left toolbar (rectangle, ellipse, arrow, line, free draw, angle, measure, distance, annotation, text). Drag on the canvas to draw; most shapes can be resized afterwards with the Move tool.",
  ],
  [
    "Image adjustments",
    "Brightness, Contrast and Window/Level presets are available from the Image menu or the right panel. Drag vertically on the image with the W/L or brightness tool to adjust. Invert, Rotate and Flip are also under the Image menu.",
  ],
  [
    "Selection & editing",
    "Ctrl+A selects every annotation, Ctrl+D duplicates, and Ctrl+X / C / V cut, copy and paste. Undo / Redo (Ctrl+Z / Ctrl+Shift+Z) covers drawings, transforms and image adjustments.",
  ],
  [
    "View options",
    "Zoom with Ctrl+= / Ctrl+- or the presets in the View menu. The Grid, Pixel Grid, Rulers and Status Bar can be toggled from the View menu. Window &gt; 2 Windows opens a second canvas pane for side-by-side comparison.",
  ],
  [
    "AI tools",
    "Run Analysis (Ctrl+Enter) classifies the study, Grad-CAM highlights the most relevant regions, and the magic wand / AI selection tools assist with segmentation.",
  ],
];

export function DocumentationModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Documentation" onClose={onClose} width="w-[460px]">
      <div data-docs className="max-h-[65vh] space-y-3.5 overflow-y-auto pr-1">
        {DOC_SECTIONS.map(([title, body]) => (
          <div key={title}>
            <p className="mb-1 text-[12.5px] font-medium text-ink">{title}</p>
            <p className="text-[12px] leading-relaxed text-ink-2">{body}</p>
          </div>
        ))}
        <Divider />
        <p className="text-[11px] text-ink-3">
          Full keyboard shortcuts are listed in Help &gt; Keyboard Shortcuts (press ? from anywhere).
        </p>
      </div>
      <div className="mt-4 flex justify-end">
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      </div>
    </Modal>
  );
}

/* --------------------------- Keyboard shortcuts --------------------------- */

export function ShortcutsModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Keyboard Shortcuts" onClose={onClose} width="w-[420px]">
      <div data-shortcuts className="max-h-[65vh] grid grid-cols-1 gap-x-6 gap-y-1.5 overflow-y-auto pr-1">
        {SHORTCUTS.map(([k, s]) => (
          <div key={k} className="flex items-center justify-between">
            <span className="text-[12px] text-ink-2">{k}</span>
            <kbd className="rounded border border-border bg-btn px-1.5 py-px font-mono text-[10px] text-ink-2">
              {s}
            </kbd>
          </div>
        ))}
      </div>
      <div className="mt-4 flex justify-end">
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      </div>
    </Modal>
  );
}

/* ---------------------------------- About --------------------------------- */

export function AboutModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="About AImaging" onClose={onClose} width="w-80">
      <div data-about className="flex flex-col items-center gap-2 text-center">
        <img src="/logo_dark_transparent.png" alt="AImaging" data-attr="about-logo" className="app-logo h-12 w-auto" />
        <p className="text-[11px] tabular-nums text-ink-3">Version 1.0.0</p>
        <p className="text-[12px] leading-relaxed text-ink-2">
          Medical image annotation and review workspace for the HGG AI internship project.
        </p>
        <Divider />
        <div className="w-full space-y-0.5 text-[11px] text-ink-3">
          <p>Built with React · TypeScript · Vite</p>
          <p>Icons by Lucide · Demo data: synthetic chest radiograph</p>
          <p>© 2026 HGG AI — Internship project</p>
        </div>
      </div>
      <div className="mt-4 flex justify-end">
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      </div>
    </Modal>
  );
}
