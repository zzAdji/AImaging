import { useEffect, useMemo, useRef, useState } from "react";
import { Activity } from "lucide-react";
import { useWorkspace } from "../../state/workspace";
import {
  ANATOMY_KEY_INDEX,
  ANATOMY_KEY_LABELS,
  anatomyKeyRgb,
  anatomyMaskSrc,
  decodeMaskToCanvas,
  fitWithinLongSide,
  paintAnatomyMask,
  prepareAnatomyMask,
  type AnatomyMaskGeometry,
} from "../../lib/anatomy";

/* ---------------------------------- UI ----------------------------------- */

function formatValue(measurement?: {
  available?: boolean;
  reason?: string;
  value?: number;
  value_px_512?: number;
  unit?: string;
  value_mm?: number | null;
}) {
  if (!measurement) return { label: "—", note: "" };
  if (!measurement.available) return { label: "n.d.", note: measurement.reason ?? "" };
  if (measurement.value !== undefined) return { label: measurement.value.toFixed(3), note: "" };
  if (measurement.value_px_512 !== undefined) return { label: `${Math.round(measurement.value_px_512 * 10) / 10} px`, note: "" };
  return { label: "—", note: "" };
}

const EMPTY_MASK: Record<string, HTMLCanvasElement | null> = {};

/* Style des structures : un aplat intérieur volontairement discret (la radio
   doit rester lisible en dessous) + un contour net qui porte l'essentiel du
   signal couleur — plutôt que l'aplat unique à 0.51 d'origine, qui donnait
   des taches opaques se mélangeant aux frontières. Survol/sélection montent
   l'aplat et le contour, et ajoutent un halo. */
const FILL_ALPHA = 0.2;
const HOVER_FILL_ALPHA = 0.32;
const SELECTED_FILL_ALPHA = 0.4;
const EDGE_ALPHA = 0.82;
const HOVER_EDGE_ALPHA = 0.95;
const SELECTED_EDGE_ALPHA = 1;
const HOVER_GLOW = { blur: 12, alpha: 0.32 };
const SELECTED_GLOW = { blur: 22, alpha: 0.5 };

/* Résolution de travail du canvas : les radios sources font souvent
   plusieurs milliers de px, alors que la carte n'affiche jamais l'image
   qu'en largeur de sidebar. On plafonne le buffer du canvas pour rester
   net (2x la largeur CSS habituelle suffit largement) sans payer le coût
   d'un composite plein format à chaque survol. */
const MAX_CANVAS_LONG_SIDE = 1200;

/* Couches de l'overlay, dans l'ordre de dessin (fond -> premier plan) :
   spine en couche de fond, poumons, diaphragmes, cœur au-dessus de tout.
   Le hit-test parcourt cet ordre à l'envers : la structure la plus haute
   est identifiée en premier. "lung" (poumons fusionnés) est un blob qui
   couvre la quasi-totalité du thorax : il n'est dessiné qu'en secours,
   quand ni le poumon droit ni le gauche n'ont été détectés. */
const ANATOMY_LAYER_ORDER: ReadonlyArray<string> = [
  "spine",
  "right lung",
  "left lung",
  "right hemidiaphragm",
  "left hemidiaphragm",
  "heart",
];

/* Ordre d'affichage de la légende — fixe, indépendant du z-order et du
   fallback "lung" fusionné, pour que les puces ne se réordonnent jamais
   selon les structures détectées d'une analyse à l'autre. */
const ANATOMY_LEGEND_ORDER: ReadonlyArray<string> = [
  "heart",
  "right lung",
  "left lung",
  "right hemidiaphragm",
  "left hemidiaphragm",
  "spine",
  "lung",
];

/* Douce vignette radiale : assombrit les coins du canvas pour donner du
   relief à la carte (au lieu d'un simple rectangle plat) — dessinée en
   dernier, après l'image et les structures. */
function paintVignette(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const gradient = ctx.createRadialGradient(
    width / 2, height / 2, Math.min(width, height) * 0.38,
    width / 2, height / 2, Math.max(width, height) * 0.75,
  );
  gradient.addColorStop(0, "rgba(0,0,0,0)");
  gradient.addColorStop(1, "rgba(0,0,0,0.32)");
  ctx.save();
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

/* ------------------------------ Composant -------------------------------- */

export function AnatomySegmentationCard() {
  const w = useWorkspace();
  const [hovered, setHovered] = useState<string | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  /* Masques décodés : map valable uniquement pour le résultat marqué (generated_at). */
  const [masks, setMasks] = useState<{ key: string; map: Record<string, HTMLCanvasElement | null> }>({
    key: "",
    map: EMPTY_MASK,
  });

  const result = w.anatomyResult;
  const loading = w.anatomyLoading;
  const error = w.anatomyError;
  const imageReady = Boolean(w.imageId && w.imageSrc);
  const masksKey = result && result.status === "ok" ? result.generated_at : "";
  const activeMasks = masks.key === masksKey ? masks.map : EMPTY_MASK;

  /* Géométrie précalculée (silhouette nette + anneau de contour) par
     structure : coûteuse à produire, bon marché à repeindre. Mise en cache
     ici pour que survoler/sélectionner une structure ne fasse que repeindre
     (paintAnatomyMask) au lieu de tout recalculer (prepareAnatomyMask) à
     chaque déplacement de la souris. Vidée à chaque nouvelle analyse. */
  const geometryCacheRef = useRef<Map<string, AnatomyMaskGeometry>>(new Map());

  /* Couches effectives de l'overlay (fond -> premier plan), + poumons
     fusionnés en secours si aucun poumon latéral n'a été détecté. */
  const layers = useMemo(() => {
    if (!result || result.status !== "ok") return [];
    const present = ANATOMY_LAYER_ORDER.filter((id) =>
      Boolean(anatomyMaskSrc(result.segmentation, id)),
    );
    const hasAnyLung = present.some((id) => id === "right lung" || id === "left lung");
    if (!hasAnyLung && anatomyMaskSrc(result.segmentation, "lung")) {
      return ["lung", ...present];
    }
    return present;
  }, [result]);

  /* Masques décodés (canvas natifs) : hit-test + dessin sans re-décoder. */
  useEffect(() => {
    if (!result || result.status !== "ok") return;
    let cancelled = false;
    const out: Record<string, HTMLCanvasElement | null> = {};
    let pending = 0;
    for (const key of ANATOMY_KEY_LABELS) {
      const src = anatomyMaskSrc(result.segmentation, key.id);
      if (!src) continue;
      pending += 1;
      decodeMaskToCanvas(src).then((canvas) => {
        out[key.id] = canvas;
        pending -= 1;
        if (!cancelled && pending === 0) setMasks({ key: result.generated_at, map: { ...out } });
      });
    }
    return () => {
      cancelled = true;
    };
  }, [result]);

  /* Dessine la carte : base en niveaux de gris, puis chaque structure en
     aplat discret + contour net dans sa couleur CXAS officielle, survol et
     sélection rehaussés (aplat/contour montés + halo), vignette finale pour
     donner du relief. La géométrie de chaque masque (partie coûteuse) est
     mise en cache ; seule la composition (bon marché) rejoue à chaque
     changement de survol/sélection. La base grayscale est elle aussi mise en
     cache : sans cela, chaque survol re-décodait et re-dessinait la radio
     complète (plusieurs Mo), d'où un ralentissement perceptible. */
  const baseCacheRef = useRef<{ key: string; canvas: HTMLCanvasElement } | null>(null);
  useEffect(() => {
    geometryCacheRef.current = new Map();
    baseCacheRef.current = null;
  }, [masksKey]);
  useEffect(() => {
    if (!result || result.status !== "ok" || !overlayRef.current) return;
    const canvas = overlayRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    /* Pas de clearRect ici : il produirait un flash noir entre le survol et
       le re-rendu (le chargement de l'image de base est asynchrone). L'ancien
       frame reste affiché jusqu'à ce que le nouveau soit prêt ; la
       réaffectation de canvas.width/height dans onload réinitialise déjà le
       bitmap juste avant le dessin. */

    const base = new Image();
    base.onload = () => {
      const { width: targetW, height: targetH } = fitWithinLongSide(
        base.width,
        base.height,
        MAX_CANVAS_LONG_SIDE,
      );
      const baseKey = `${masksKey}:${targetW}x${targetH}`;
      let baseCanvas = baseCacheRef.current?.key === baseKey ? baseCacheRef.current.canvas : null;
      if (!baseCanvas) {
        baseCanvas = document.createElement("canvas");
        baseCanvas.width = targetW;
        baseCanvas.height = targetH;
        const bctx = baseCanvas.getContext("2d");
        if (!bctx) return;
        bctx.filter = "grayscale(1) contrast(1.08)";
        bctx.drawImage(base, 0, 0, targetW, targetH);
        bctx.filter = "none";
        baseCacheRef.current = { key: baseKey, canvas: baseCanvas };
      }
      canvas.width = targetW;
      canvas.height = targetH;
      ctx.drawImage(baseCanvas, 0, 0);

      for (const id of layers) {
        const mask = activeMasks[id];
        const rgb = anatomyKeyRgb(id);
        if (!mask || !rgb) continue;

        const cacheKey = `${masksKey}:${id}:${targetW}x${targetH}`;
        let geometry = geometryCacheRef.current.get(cacheKey);
        if (!geometry) {
          const prepared = prepareAnatomyMask(mask, targetW, targetH);
          if (!prepared) continue;
          geometry = prepared;
          geometryCacheRef.current.set(cacheKey, geometry);
        }

        const selected = w.anatomySelected === id;
        const hovering = hovered === id;
        paintAnatomyMask(ctx, geometry, targetW, targetH, rgb, {
          fillAlpha: selected ? SELECTED_FILL_ALPHA : hovering ? HOVER_FILL_ALPHA : FILL_ALPHA,
          edgeAlpha: selected ? SELECTED_EDGE_ALPHA : hovering ? HOVER_EDGE_ALPHA : EDGE_ALPHA,
          glow: selected ? SELECTED_GLOW : hovering ? HOVER_GLOW : undefined,
        });
      }

      paintVignette(ctx, targetW, targetH);
    };
    base.src = w.imageSrc;
  }, [result, layers, activeMasks, masksKey, w.imageSrc, w.anatomySelected, hovered]);

  /* Hit-test : ordre inverse des couches — le dessiné en dernier (le cœur,
     le plus haut) est testé en premier ; spine, en fond, en dernier. */
  const labelAt = (event: { clientX: number; clientY: number }): string | null => {
    const canvas = overlayRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * canvas.width;
    const py = ((event.clientY - rect.top) / rect.height) * canvas.height;
    for (let i = layers.length - 1; i >= 0; i--) {
      const id = layers[i];
      const mask = activeMasks[id];
      if (!mask) continue;
      const mx = Math.min(mask.width - 1, Math.max(0, Math.round((px / canvas.width) * mask.width)));
      const my = Math.min(mask.height - 1, Math.max(0, Math.round((py / canvas.height) * mask.height)));
      const data = mask.getContext("2d")?.getImageData(mx, my, 1, 1).data;
      if (data && data[3] > 24) return id;
    }
    return null;
  };

  const ctr = result?.measurements["Cardio-Thoracic Ratio"];
  const scd = result?.measurements["Spine-Center Distance"];
  const ctrFmt = formatValue(ctr);
  const structures = result?.segmentation.label_ids_available.length ?? 0;
  const overlayLabels = layers.map((id) => id);
  const activeInfo = w.anatomySelected ?? hovered;
  const totalPx = result
    ? result.segmentation.file_size[0] * result.segmentation.file_size[1]
    : 0;
  /* Ordre stable, indépendant du z-order de dessin — la légende ne se
     réordonne jamais d'une analyse à l'autre. */
  const legendItems = ANATOMY_LEGEND_ORDER.filter((id) => layers.includes(id));

  return (
    <div data-attr="ai-card-anatomy-cxas">
        {!imageReady ? (
          <p className="text-[11px] text-ink-3">Chargez une radiographie pour lancer l'analyse.</p>
        ) : (
          <button
            type="button"
            data-attr="ai-anatomy-run"
            onClick={() => void w.runAnatomyAnalysis()}
            disabled={loading}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-accent/40 bg-accent/10 px-2 py-1.5 text-[11.5px] font-medium text-accent transition-colors duration-150 ease-out hover:bg-accent/20 disabled:cursor-wait disabled:opacity-60"
          >
            <Activity size={12} className={loading ? "animate-pulse" : undefined} />
            {loading ? "Segmentation en cours…" : result ? "Relancer l'analyse" : "Segmenter l'anatomie"}
          </button>
        )}

        {error && <p className="mt-1.5 text-[10.5px] text-[#f87171]">{error}</p>}

        {result && result.status === "error" && (
          <p className="mt-1.5 text-[10.5px] text-[#f87171]">{result.error || "Analyse impossible."}</p>
        )}

        {result && result.status === "ok" && (
          <div className="mt-2 space-y-2">
            <div className="grid grid-cols-2 gap-1.5">
              <div className="rounded-lg border border-border/70 bg-canvas/60 px-2 py-1.5">
                <p className="text-[9px] font-semibold uppercase tracking-[0.05em] text-ink-3">CTR</p>
                <p className="text-[12px] tabular-nums text-ink">{ctrFmt.label}</p>
                <p className="text-[9px] text-ink-3">
                  {ctr?.available ? "rapport cardio-thoracique" : (ctrFmt.note || "")}
                </p>
              </div>
              <div className="rounded-lg border border-border/70 bg-canvas/60 px-2 py-1.5">
                <p className="text-[9px] font-semibold uppercase tracking-[0.05em] text-ink-3">SCD</p>
                <p className="text-[12px] tabular-nums text-ink">{formatValue(scd).label}</p>
                <p className="text-[9px] text-ink-3">
                  {scd?.available
                    ? scd.value_mm != null
                      ? `≈ ${scd.value_mm.toFixed(1)} mm (dont ${scd.value_px_original?.toFixed(0) ?? "?"} px source)`
                      : "grille 512 (DICOM requis pour les mm)"
                    : (scd?.reason ?? "")}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between text-[10px] text-ink-2">
              <span>{structures} structures détectées</span>
              <span className="tabular-nums text-ink-3">
                {result.inference_time_ms != null && result.inference_time_ms / 1000 > 3
                  ? `${(result.inference_time_ms / 1000).toFixed(1)} s`
                  : `${Math.round(result.inference_time_ms ?? 0)} ms`}
              </span>
            </div>

            <div
              className="overflow-hidden rounded-lg border border-white/10 bg-black/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-shadow duration-200 ease-out"
            >
              <canvas
                ref={overlayRef}
                data-attr="ai-anatomy-overlay"
                className="block h-auto w-full cursor-pointer touch-none select-none"
                onPointerMove={(e) => setHovered(labelAt(e))}
                onPointerLeave={() => setHovered(null)}
                onClick={(e) => {
                  const label = labelAt(e);
                  w.setAnatomySelected(w.anatomySelected === label ? null : label);
                }}
              />

              {/* Légende : ordre fixe (indépendant du z-order), chaque structure
                  cliquable (sélection) et survolable — pastille + fond teintés
                  dans sa propre couleur officielle, + aire (%). */}
              {legendItems.length > 0 && (
                <div
                  className="flex flex-wrap gap-1 border-t border-white/5 bg-canvas/40 px-1.5 py-1 backdrop-blur-sm"
                  data-attr="ai-anatomy-legend"
                >
                  {legendItems.map((id) => {
                    const area = result.segmentation.areas_px[id];
                    const pct = totalPx > 0 && area !== undefined ? (area / totalPx) * 100 : null;
                    const selected = w.anatomySelected === id;
                    const hovering = hovered === id;
                    const active = selected || hovering;
                    return (
                      <button
                        key={id}
                        type="button"
                        data-attr={`ai-anatomy-chip-${id.replace(/\s+/g, "-")}`}
                        onMouseEnter={() => setHovered(id)}
                        onMouseLeave={() => setHovered((current) => (current === id ? null : current))}
                        onClick={() => w.setAnatomySelected(selected ? null : id)}
                        className={`flex items-center gap-1 rounded-full border px-1.5 py-px text-[9px] transition-colors duration-150 ease-out ${
                          active ? "text-accent border-accent/60 bg-accent/10" : "text-ink-2"
                        }`}
                      >
                        {id}
                        {pct !== null && (
                          <span className={`tabular-nums ${ active ? "text-accent/95" : "text-ink"}`}>{Math.round(pct)}%</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="flex min-h-[22px] items-center justify-between gap-2 border-t border-white/5 bg-canvas/40 px-1.5 py-1 backdrop-blur-sm">
                <p className="truncate text-[9px] text-ink-3" data-attr="ai-anatomy-hover">
                  {activeInfo
                    ? (result.segmentation.labels[ANATOMY_KEY_INDEX[activeInfo]] ?? activeInfo)
                    : overlayLabels.join(" · ")}
                    
                </p>
              </div>
            </div>

            <p className="text-[9.5px] text-ink-3">
              Survolez une structure pour l'identifier ; cliquez pour la selectionner.
            </p>

            {result.warnings.length > 0 && (
              <ul className="space-y-0.5">
                {result.warnings.map((warning) => (
                  <li key={warning} className="text-[9.5px] text-ink-3">
                    {warning}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
    </div>
  );
}