import { useEffect, useRef, useState } from "react";
import { Ruler } from "lucide-react";
import { useWorkspace } from "../../state/workspace";
import { fitWithinLongSide } from "../../lib/anatomy";
import { smoothClosedSvgPath } from "../../lib/landmarkMeasure";
import type { LandmarkContour, WorkspaceLandmarksResult } from "../../lib/workspaceApi";

/* Contours poumons + cœur issus des landmarks HybridGNet : tracés vectoriels
   (polylignes) — à la différence des masques CXAS, il n'y a rien à décoder,
   les points sont en coordonnées pixels de la grille 1024×1024 du modèle. */

const LANDMARK_ORGAN_STYLE: Record<string, { rgb: string; label: string }> = {
  right_lung: { rgb: "184,0,91", label: "Poumon droit" },
  left_lung: { rgb: "255,128,61", label: "Poumon gauche" },
  heart: { rgb: "0,236,2", label: "Cœur" },
};

const LANDMARK_ORGAN_ORDER: ReadonlyArray<string> = ["right_lung", "left_lung", "heart"];

const GRID = 1024; // grille d'inférence du modèle (landmarks prédits en px)
const MAX_CANVAS_LONG_SIDE = 1200;
const HIT_TOLERANCE_PX = 8;

/* Distance pointeur -> polyligne (au plus près du segment parcouru) : c'est le
   hit-test des contours, plus naturel qu'une boîte englobante pour un tracé. */
function distanceToPolyline(px: number, py: number, xs: number[], ys: number[]): number {
  let best = Infinity;
  for (let i = 0; i < xs.length; i++) {
    const j = (i + 1) % xs.length;
    const x1 = xs[i], y1 = ys[i], x2 = xs[j], y2 = ys[j];
    const dx = x2 - x1, dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((px - x1) * dx + (py - y1) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = x1 + t * dx - px;
    const cy = y1 + t * dy - py;
    best = Math.min(best, Math.hypot(cx, cy));
  }
  return best;
}

function meanStd(contour: LandmarkContour): number {
  if (contour.std.length === 0) return 0;
  return contour.std.reduce((a, b) => a + b, 0) / contour.std.length;
}

function maxStd(contour: LandmarkContour): number {
  return contour.std.length > 0 ? Math.max(...contour.std) : 0;
}

function formatUnit(value: number, unit: string): string {
  if (unit === "ratio") return value.toFixed(3);
  if (unit.includes("m")) return `${value.toFixed(1)} ${unit}`;
  return `${Math.round(value)} ${unit}`;
}

export function LandmarksMeasurementsCard() {
  const w = useWorkspace();
  const [hovered, setHovered] = useState<string | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);

  const result = w.landmarkResult;
  const loading = w.landmarkLoading;
  const error = w.landmarkError;
  const imageReady = Boolean(w.imageId && w.imageSrc);
  const ok = result && result.status === "ok" ? result : null;
  /* Contours édités s'il y en a, sinon sortie modèle (affichage carte + canvas). */
  const contours = w.landmarkContours ?? ok?.contours ?? null;
  const placedCount = w.shapes.filter((shape) => shape.actionId?.startsWith("landmarks:")).length;

  useEffect(() => {
    if (!ok || !overlayRef.current) return;
    const canvas = overlayRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    /* Pas de clearRect ici : il produirait un flash noir entre le survol et
       le re-rendu (chargement asynchrone de l'image de base). L'ancien frame
       reste visible ; canvas.width/height réinitialise le bitmap dans onload
       juste avant le dessin. */

    const base = new Image();
    base.onload = () => {
      const { width: targetW, height: targetH } = fitWithinLongSide(base.width, base.height, MAX_CANVAS_LONG_SIDE);
      canvas.width = targetW;
      canvas.height = targetH;
      ctx.filter = "grayscale(1) contrast(1.08)";
      ctx.drawImage(base, 0, 0, targetW, targetH);
      ctx.filter = "none";

      for (const organ of LANDMARK_ORGAN_ORDER) {
        const contour = contours?.[organ as keyof WorkspaceLandmarksResult["contours"]];
        const style = LANDMARK_ORGAN_STYLE[organ];
        if (!contour || !style) continue;

        const xs = contour.x.map((x) => (x / GRID) * targetW);
        const ys = contour.y.map((y) => (y / GRID) * targetH);

        const selected = w.landmarksSelected === organ;
        const hovering = hovered === organ;
        const lineWidth = selected ? 3.5 : hovering ? 3 : 2;
        const alpha = selected ? 1 : hovering ? 0.95 : 0.75;

        ctx.save();
        if (selected || hovering) {
          ctx.shadowColor = `rgba(${style.rgb},${selected ? 0.5 : 0.3})`;
          ctx.shadowBlur = selected ? 16 : 10;
        }
        /* Tracé lissé (Catmull-Rom -> Bézier) identique à l'overlay du canvas. */
        ctx.strokeStyle = `rgba(${style.rgb},${alpha})`;
        ctx.lineWidth = lineWidth;
        ctx.stroke(new Path2D(smoothClosedSvgPath(xs, ys)));
        ctx.restore();
      }
    };
    base.src = w.imageSrc;
  }, [ok, contours, w.imageSrc, w.landmarksSelected, hovered]);

  const organAt = (event: { clientX: number; clientY: number }): string | null => {
    const canvas = overlayRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * canvas.width;
    const py = ((event.clientY - rect.top) / rect.height) * canvas.height;
    let best = HIT_TOLERANCE_PX;
    let found: string | null = null;
    for (const organ of LANDMARK_ORGAN_ORDER) {
      const contour = contours?.[organ as keyof WorkspaceLandmarksResult["contours"]];
      if (!contour) continue;
      const d = distanceToPolyline(px, py, contour.x.map((x) => (x / GRID) * canvas.width), contour.y.map((y) => (y / GRID) * canvas.height));
      if (d < best) {
        best = d;
        found = organ;
      }
    }
    return found;
  };

  /* Mesures temps réel pendant l'édition des contours, sinon sortie modèle. */
  const m = w.landmarkLive?.measurements ?? ok?.measurements;
  const ctr = m?.ctr;
  const activeInfo = w.landmarksSelected ?? hovered;
  const highUncertainty = ok && ok.uncertainty.max_node_std_px > 12;

  return (
    <section data-attr="ai-card-landmarks" className="mx-3 mt-3 overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center gap-1.5 px-3 pt-2.5">
        <Ruler size={13} strokeWidth={2.2} className="text-icon" />
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-2">
          Mesures landmarks
        </h3>
      </div>

      <div className="px-3 pb-3 pt-2">
        {!imageReady ? (
          <p className="text-[11px] text-ink-3">Chargez une radiographie pour lancer les mesures.</p>
        ) : (
          <button
            type="button"
            data-attr="ai-landmarks-run"
            onClick={() => void w.runLandmarksAnalysis()}
            disabled={loading}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-accent/40 bg-accent/10 px-2 py-1.5 text-[11.5px] font-medium text-accent transition-colors duration-150 ease-out hover:bg-accent/20 disabled:cursor-wait disabled:opacity-60"
          >
            <Ruler size={12} className={loading ? "animate-pulse" : undefined} />
            {loading ? "Mesures en cours…" : result ? "Relancer les mesures" : "Mesurer le cœur et les poumons"}
          </button>
        )}

        {error && <p className="mt-1.5 text-[10.5px] text-[#f87171]">{error}</p>}
        {result && result.status === "error" && (
          <p className="mt-1.5 text-[10.5px] text-[#f87171]">{result.error || "Analyse impossible."}</p>
        )}

        {ok && m && (
          <div className="mt-2 space-y-2">
            {highUncertainty && (
              <p className="rounded-lg border border-[#facc15]/40 bg-[#facc15]/10 px-2 py-1.5 text-[10px] text-[#facc15]">
                Incertitude élevée sur les landmarks (σ max {ok.uncertainty.max_node_std_px.toFixed(1)} px) : mesures à interpréter avec prudence.
              </p>
            )}

            <div className="grid grid-cols-2 gap-1.5">
              <div className="rounded-lg border border-border/70 bg-canvas/60 px-2 py-1.5">
                <p className="text-[9px] font-semibold uppercase tracking-[0.05em] text-ink-3">CTR</p>
                <p className="text-[12px] tabular-nums text-ink">
                  {ctr ? `${ctr.value.toFixed(3)} ± ${ctr.std.toFixed(3)}` : "—"}
                </p>
                <p className="text-[9px] text-ink-3">rapport cardio-thoracique</p>
              </div>
              <div className="rounded-lg border border-border/70 bg-canvas/60 px-2 py-1.5">
                <p className="text-[9px] font-semibold uppercase tracking-[0.05em] text-ink-3">Cœur</p>
                <p className="text-[12px] tabular-nums text-ink">
                  {m.heart_transverse_diameter ? formatUnit(m.heart_transverse_diameter.value, m.heart_transverse_diameter.unit) : "—"}
                </p>
                <p className="text-[9px] text-ink-3">diamètre transverse</p>
              </div>
              <div className="rounded-lg border border-border/70 bg-canvas/60 px-2 py-1.5">
                <p className="text-[9px] font-semibold uppercase tracking-[0.05em] text-ink-3">Thorax</p>
                <p className="text-[12px] tabular-nums text-ink">
                  {m.thorax_transverse_diameter ? formatUnit(m.thorax_transverse_diameter.value, m.thorax_transverse_diameter.unit) : "—"}
                </p>
                <p className="text-[9px] text-ink-3">diamètre transverse</p>
              </div>
              <div className="rounded-lg border border-border/70 bg-canvas/60 px-2 py-1.5">
                <p className="text-[9px] font-semibold uppercase tracking-[0.05em] text-ink-3">Surface cœur</p>
                <p className="text-[12px] tabular-nums text-ink">
                  {m.heart_surface ? formatUnit(m.heart_surface.value, m.heart_surface.unit) : "—"}
                </p>
                <p className="text-[9px] text-ink-3">silhouette cardiomédiastinale</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              {(["right_lung_surface", "left_lung_surface"] as const).map((key) => (
                <div key={key} className="rounded-lg border border-border/70 bg-canvas/60 px-2 py-1.5">
                  <p className="text-[9px] font-semibold uppercase tracking-[0.05em] text-ink-3">
                    {key === "right_lung_surface" ? "Poumon droit" : "Poumon gauche"}
                  </p>
                  <p className="text-[12px] tabular-nums text-ink">
                    {m[key] ? formatUnit(m[key].value, m[key].unit) : "—"}
                  </p>
                  <p className="text-[9px] text-ink-3">surface</p>
                </div>
              ))}
            </div>

            {ok.custom.length > 0 && (
              <ul className="space-y-0.5 rounded-lg border border-border/70 bg-canvas/60 px-2 py-1.5">
                {ok.custom.map((measure) => (
                  <li key={measure.label} className="flex items-center justify-between text-[10px]">
                    <span className="text-ink-2">{measure.label}</span>
                    <span className="tabular-nums text-ink">
                      {formatUnit(measure.value, measure.unit)} ± {measure.std.toFixed(1)}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex items-center justify-between text-[10px] text-ink-2">
              <span>
                σ moyen {ok.uncertainty.mean_node_std_px.toFixed(1)} px · grille {GRID}
              </span>
              <span className="tabular-nums text-ink-3">
                {ok.inference_time_ms != null && ok.inference_time_ms / 1000 > 3
                  ? `${(ok.inference_time_ms / 1000).toFixed(1)} s`
                  : `${Math.round(ok.inference_time_ms ?? 0)} ms`}
              </span>
            </div>

            <div className="overflow-hidden rounded-lg border border-white/10 bg-black/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-shadow duration-200 ease-out">
              <canvas
                ref={overlayRef}
                data-attr="ai-landmarks-overlay"
                className="block h-auto w-full cursor-pointer touch-none select-none"
                onPointerMove={(e) => setHovered(organAt(e))}
                onPointerLeave={() => setHovered(null)}
                onClick={(e) => {
                  const organ = organAt(e);
                  w.setLandmarksSelected(w.landmarksSelected === organ ? null : organ);
                }}
              />

              {LANDMARK_ORGAN_ORDER.length > 0 && (
                <div
                  className="flex flex-wrap gap-1 border-t border-white/5 bg-canvas/40 px-1.5 py-1 backdrop-blur-sm"
                  data-attr="ai-landmarks-legend"
                >
                  {LANDMARK_ORGAN_ORDER.map((organ) => {
                    const contour = ok.contours[organ as keyof WorkspaceLandmarksResult["contours"]];
                    const style = LANDMARK_ORGAN_STYLE[organ];
                    if (!contour || !style) return null;
                    const selected = w.landmarksSelected === organ;
                    const hovering = hovered === organ;
                    const active = selected || hovering;
                    return (
                      <button
                        key={organ}
                        type="button"
                        data-attr={`ai-landmarks-chip-${organ}`}
                        onMouseEnter={() => setHovered(organ)}
                        onMouseLeave={() => setHovered((current) => (current === organ ? null : current))}
                        onClick={() => w.setLandmarksSelected(selected ? null : organ)}
                        className={`flex items-center gap-1 rounded-full border px-1.5 py-px text-[9px] transition-colors duration-150 ease-out ${
                          active ? "text-accent border-accent/60 bg-accent/10" : "text-ink-2"
                        }`}
                      >
                        {style.label}
                        <span className={`tabular-nums ${active ? "text-accent/95" : "text-ink"}`}>
                          σ {meanStd(contour).toFixed(1)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="flex min-h-[22px] items-center justify-between gap-2 border-t border-white/5 bg-canvas/40 px-1.5 py-1 backdrop-blur-sm">
                <p className="truncate text-[9px] text-ink-3" data-attr="ai-landmarks-hover">
                  {activeInfo
                    ? `${LANDMARK_ORGAN_STYLE[activeInfo]?.label ?? activeInfo} — σ max ${ok.contours[activeInfo as keyof WorkspaceLandmarksResult["contours"]] ? maxStd(ok.contours[activeInfo as keyof WorkspaceLandmarksResult["contours"]])?.toFixed(1) : ""} px`
                    : LANDMARK_ORGAN_ORDER.map((organ) => LANDMARK_ORGAN_STYLE[organ]?.label ?? organ).join(" · ")}
                </p>
              </div>
            </div>

            <p className="text-[9.5px] text-ink-3">
              Survolez un contour pour l'identifier ; cliquez : il s'affiche sur
              l'image où vous pouvez le modeler (poignées aux sommets), les
              mesures se recalculant en direct.
            </p>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                data-attr="ai-landmarks-place"
                onClick={() => w.placeLandmarkMeasurements()}
                className="flex-1 rounded-lg border border-accent/40 bg-accent/10 px-2 py-1.5 text-[10px] font-medium text-accent transition-colors duration-150 ease-out hover:bg-accent/20"
              >
                Poser les mesures sur l'image
              </button>
              {placedCount > 0 && (
                <button
                  type="button"
                  data-attr="ai-landmarks-unplace"
                  onClick={() => w.removeLandmarkMeasurements()}
                  className="rounded-lg border border-border/70 bg-canvas/60 px-2 py-1.5 text-[10px] text-ink-2 transition-colors duration-150 ease-out hover:bg-canvas/80 hover:text-ink"
                >
                  Retirer ({placedCount})
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}