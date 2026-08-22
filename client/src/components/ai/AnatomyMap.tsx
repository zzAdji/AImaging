import { useEffect, useMemo, useRef, useState } from "react";
import { MapPin, RefreshCw } from "lucide-react";
import { useWorkspace } from "../../state/workspace";
import {
  ANATOMY_MAP_HEIGHT,
  ANATOMY_MAP_WIDTH,
  ANATOMY_REGIONS,
  OVERVIEW_DESC,
  regionAtImage,
  type AnatomyRegion,
} from "../../lib/anatomyMap";

/* Carte interactive anatomique v2 : le schéma SVG tracé à la main est
   remplacé par le fond statique `anatomy_map.png` (1122×1402) recouvert
   d'un <canvas> qui dessine les régions polygonales (survol, sélection) et
   projette les points d'intérêt (diagnostics, annotations, sonde). */

const MAP_W = 132;
const MAP_H = (MAP_W * ANATOMY_MAP_HEIGHT) / ANATOMY_MAP_WIDTH;

type ActionPoint = {
  kind: "diagnosis" | "annotation" | "probe";
  id: string;
  label: string;
  /** Position en fraction de l'image (0..1), projetée 1:1 sur la carte. */
  x: number;
  y: number;
};

const POINT_COLOR: Record<ActionPoint["kind"], string> = {
  diagnosis: "#f87171",
  annotation: "#38bdf8",
  probe: "#f59e0b",
};

function hexToRgba(hex: string, alpha: number): string {
  const m = hex.replace("#", "");
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function AnatomyMapCard() {
  const w = useWorkspace();
  const [selected, setSelected] = useState<{ kind: "region" | "point"; id: string } | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const points = useMemo<ActionPoint[]>(() => {
    const out: ActionPoint[] = [];
    for (const d of w.aiResults.diagnostics) {
      if (!d.region) continue;
      out.push({
        kind: "diagnosis",
        id: `d-${d.label}`,
        label: d.label,
        x: (d.region.x + d.region.w / 2) / (w.dims.w || 1),
        y: (d.region.y + d.region.h / 2) / (w.dims.h || 1),
      });
    }
    for (const s of w.shapes) {
      if (s.type !== "annotation" && s.type !== "text") continue;
      const x = s.x + (s.points?.[0]?.x ?? 0);
      const y = s.y + (s.points?.[0]?.y ?? 0);
      out.push({
        kind: "annotation",
        id: s.id,
        label: s.label || "Annotation",
        x: x / (w.dims.w || 1),
        y: y / (w.dims.h || 1),
      });
    }
    if (w.probe) out.push({ kind: "probe", id: "probe", label: "Sonde anatomique", x: w.probe.x, y: w.probe.y });
    return out;
  }, [w.aiResults.diagnostics, w.shapes, w.probe, w.dims]);

  const effectiveRegion = useMemo<AnatomyRegion | null>(() => {
    if (selected?.kind === "point") {
      const pt = points.find((p) => p.id === selected.id);
      if (pt) return regionAtImage(pt.x, pt.y);
    }
    if (selected?.kind === "region") {
      return ANATOMY_REGIONS.find((r) => r.id === selected.id) ?? null;
    }
    if (w.probe) return regionAtImage(w.probe.x, w.probe.y);
    for (const d of w.aiResults.diagnostics) {
      if (!d.region) continue;
      const reg = regionAtImage(
        (d.region.x + d.region.w / 2) / (w.dims.w || 1),
        (d.region.y + d.region.h / 2) / (w.dims.h || 1),
      );
      if (reg) return reg;
    }
    return null;
  }, [selected, points, w.probe, w.aiResults.diagnostics, w.dims]);

  /* Rendu des régions + points sur le canvas superposé. */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = MAP_W;
    const cssH = MAP_H;
    if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    for (const region of ANATOMY_REGIONS) {
      const isSel = effectiveRegion?.id === region.id;
      const isHov = hovered === region.id;
      if (!isSel && !isHov) continue;
      ctx.beginPath();
      region.polygon.forEach((p, i) => {
        const px = (p.x / ANATOMY_MAP_WIDTH) * cssW;
        const py = (p.y / ANATOMY_MAP_HEIGHT) * cssH;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.closePath();
      ctx.fillStyle = hexToRgba(region.color, isSel ? 0.28 : 0.18);
      ctx.fill();
      ctx.strokeStyle = hexToRgba(region.color, isSel ? 0.85 : 0.5);
      ctx.lineWidth = isSel ? 2.5 : 1.5;
      ctx.stroke();
    }

    for (const pt of points) {
      const px = pt.x * cssW;
      const py = pt.y * cssH;
      const isSel = selected?.kind === "point" && selected.id === pt.id;
      ctx.beginPath();
      ctx.arc(px, py, 5.5, 0, Math.PI * 2);
      ctx.fillStyle = POINT_COLOR[pt.kind];
      ctx.globalAlpha = 0.22;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(px, py, 2.6, 0, Math.PI * 2);
      ctx.fillStyle = POINT_COLOR[pt.kind];
      ctx.fill();
      if (isSel) {
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
    }
  }, [hovered, selected, effectiveRegion, points]);

  function pointerAt(e: { clientX: number; clientY: number }, el: HTMLElement): { xF: number; yF: number } {
    const rect = el.getBoundingClientRect();
    return {
      xF: (e.clientX - rect.left) / rect.width,
      yF: (e.clientY - rect.top) / rect.height,
    };
  }

  const pointAt = (xF: number, yF: number): ActionPoint | null => {
    const px = xF * MAP_W;
    const py = yF * MAP_H;
    let best: ActionPoint | null = null;
    let bestDist = 7;
    for (const pt of points) {
      const dist = Math.hypot(pt.x * MAP_W - px, pt.y * MAP_H - py);
      if (dist < bestDist) {
        bestDist = dist;
        best = pt;
      }
    }
    return best;
  };

  const regionTexts = w.anatomyRegionTexts;
  const regionText = effectiveRegion ? regionTexts[effectiveRegion.id] : null;
  const findings = effectiveRegion
    ? w.aiResults.diagnostics.filter((d) => {
        if (!d.region) return false;
        return regionAtImage(
          (d.region.x + d.region.w / 2) / (w.dims.w || 1),
          (d.region.y + d.region.h / 2) / (w.dims.h || 1),
        )?.id === effectiveRegion.id;
      })
    : w.aiResults.diagnostics;

  return (
    <section data-attr="ai-card-anatomy" className="mx-3 mt-3 overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center gap-1.5 px-3 pt-2.5">
        <MapPin size={13} strokeWidth={2.2} className="text-icon" />
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-2">Carte anatomique</h3>
      </div>

      <div className="flex items-start gap-2.5 px-3 pb-3 pt-2">
        {/* Minimap — gauche (fond statique + canvas interactif) */}
        <div
          data-attr="ai-anatomy-minimap"
          className="relative shrink-0 select-none"
          style={{ width: MAP_W, height: MAP_H }}
          onPointerMove={(e) => {
            const { xF, yF } = pointerAt(e, e.currentTarget);
            const reg = regionAtImage(xF, yF);
            setHovered(reg?.id ?? null);
          }}
          onPointerLeave={() => setHovered(null)}
          onClick={(e) => {
            const { xF, yF } = pointerAt(e, e.currentTarget);
            const pt = pointAt(xF, yF);
            if (pt) {
              setSelected((cur) => (cur?.kind === "point" && cur.id === pt.id ? null : { kind: "point", id: pt.id }));
              return;
            }
            const reg = regionAtImage(xF, yF);
            if (reg) {
              setSelected((cur) => (cur?.kind === "region" && cur.id === reg.id ? null : { kind: "region", id: reg.id }));
            }
          }}
        >
          <img
            src="/anatomy_map.png"
            alt="Carte anatomique du thorax"
            draggable={false}
            className="rounded-lg"
            style={{ width: MAP_W, height: MAP_H }}
          />
          <canvas
            ref={canvasRef}
            data-attr="ai-anatomy-canvas"
            className="absolute inset-0 h-full w-full cursor-pointer touch-none"
          />
        </div>

        {/* Texte — droite */}
        <div data-attr="ai-anatomy-text" className="min-w-0 flex-1 space-y-1.5">
          <p className="text-[10.5px] font-semibold leading-relaxed text-ink-2">
            {effectiveRegion ? effectiveRegion.label : "Vue d'ensemble"}
          </p>

          {/* Référence (normale) */}
          <p className="whitespace-pre-wrap text-[10px] leading-relaxed text-ink-3">
            {effectiveRegion ? effectiveRegion.reference : OVERVIEW_DESC}
          </p>

          <div className="border-t border-border/70 pt-1.5">
            <p className="text-[9.5px] font-semibold uppercase tracking-[0.05em] text-ink-3">
              Observation
            </p>

            {/* Interprétation IA (ex-« Votre image (IA) ») — générée à l'ouverture */}
            {effectiveRegion ? (
              regionText ? (
                <p className="mt-0.5 whitespace-pre-wrap text-[10px] leading-relaxed text-ink">
                  {regionText}
                </p>
              ) : w.anatomyRegionTextsLoading ? (
                <p className="mt-0.5 text-[10px] italic text-ink-3">Génération de l'interprétation IA…</p>
              ) : w.anatomyRegionTextsError ? (
                <div className="mt-0.5 space-y-1">
                  <p className="text-[10px] italic text-[#f87171]">{w.anatomyRegionTextsError}</p>
                  <button
                    type="button"
                    data-attr="ai-anatomy-retry"
                    onClick={() => void w.loadAnatomyRegionTexts()}
                    className="inline-flex items-center gap-1 rounded-lg border border-accent/40 bg-accent/10 px-2 py-1 text-[9.5px] font-medium text-accent transition-colors duration-150 ease-out hover:bg-accent/20"
                  >
                    <RefreshCw size={10} />
                    Réessayer
                  </button>
                </div>
              ) : (
                <p className="mt-0.5 text-[10px] italic text-ink-3">
                  {w.anatomyResult?.status === "ok"
                    ? "Interprétation non générée pour cette région."
                    : "Lancez la segmentation anatomique (CXAS) pour obtenir les interprétations par région."}
                </p>
              )
            ) : (
              <p className="mt-0.5 text-[10px] italic text-ink-3">
                Survolez une région de la carte (ou posez la sonde) pour afficher son observation.
              </p>
            )}

            {/* Constats IA (fusionnés dans l'Observation) */}
            <div className="mt-1 space-y-0.5">
              {findings.length === 0 ? (
                <p className="mt-0.5 text-[10px] italic text-ink-3">
                  Rien d'anormal signalé {effectiveRegion ? "dans cette région" : "pour l'instant"}.
                </p>
              ) : (
                <></>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}