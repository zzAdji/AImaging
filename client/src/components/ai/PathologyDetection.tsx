/** Carte « Détection & Heatmaps » — simple sélecteur de vue.
 *
 *  La détection (backend « Neuro » distant : YOLOv8s + DenseNet-121) est
 *  lancée automatiquement à l'ouverture de l'espace de travail. Cette carte
 *  ne montre ni image ni findings : elle bascule l'affichage du canvas entre
 *  les boxes YOLO (posées comme formes rectangles éditables) et la heatmap
 *  Grad-CAM DenseNet. Les findings sont fusionnés dans la carte Diagnostics.
 */

import { Brain, Crosshair, RefreshCw, TriangleAlert } from "lucide-react";
import { useWorkspace } from "../../state/workspace";
import { cn } from "../../lib/cn";

export function PathologyDetectionCard() {
  const w = useWorkspace();
  const result = w.pathologyResult;
  const loading = w.pathologyLoading;
  const error = w.pathologyError;
  const imageReady = Boolean(w.imageId && w.imageSrc);

  if (!imageReady && !loading && !error) {
    return (
      <p className="text-[10px] italic text-ink-3">
        Chargez une radiographie thoracique pour lancer la détection.
      </p>
    );
  }

  return (
    <div data-attr="ai-card-pathology" className="space-y-2">
      {/* Bascule de la vue affichée sur le canvas */}
      <div className="flex items-center gap-1">
        <ViewBtn
          active={w.pathologyView === "detection"}
          onClick={() => w.setPathologyView("detection")}
          label="Détections"
          icon={<Crosshair size={10} />}
          disabled={!result}
        />
        <ViewBtn
          active={w.pathologyView === "heatmap"}
          onClick={() => w.setPathologyView("heatmap")}
          label="Heatmap"
          icon={<Brain size={10} />}
          disabled={!result?.images.heatmap_b64}
        />
        <button
          type="button"
          data-attr="ai-pathology-retry"
          onClick={() => void w.runPathologyAnalysis()}
          disabled={loading || !imageReady}
          title="Relancer l'analyse"
          className="ml-auto inline-flex items-center gap-1 rounded-lg border border-border/70 bg-card px-1.5 py-1 text-[9.5px] font-medium text-ink-2 transition-colors duration-150 ease-out hover:bg-hover hover:text-ink disabled:opacity-40"
        >
          <RefreshCw size={9} className={cn(loading && "animate-spin")} />
        </button>
      </div>

      <p className="text-[9.5px] leading-relaxed text-ink-3">
        {w.pathologyView === "detection"
          ? "Boxes YOLOv8 posées sur le canvas : déplacez, redimensionnez, supprimez ; double-clic pour renommer."
          : "Heatmap Grad-CAM (DenseNet-121) superposée au canvas."}
      </p>

      {/* Choix de la heatmap affichée (vue Heatmap uniquement) */}
      {w.pathologyView === "heatmap" && Object.keys(result?.images.individual_heatmaps ?? {}).length > 0 && (
        <div className="space-y-1">
          <p className="text-[9px] font-semibold uppercase tracking-[0.05em] text-ink-3">
            Heatmap affichée
          </p>
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              data-attr="ai-pathology-heatmap-global"
              onClick={() => w.setPathologyHeatmapKey(null)}
              className={cn(
                "rounded-md border px-1.5 py-0.5 text-[9px] font-medium transition-colors duration-150 ease-out",
                w.pathologyHeatmapKey === null
                  ? "border-accent/60 bg-accent/15 text-accent"
                  : "border-border/70 bg-card text-ink-2 hover:bg-hover",
              )}
            >
              Globale
            </button>
            {Object.keys(result?.images.individual_heatmaps ?? {}).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => w.setPathologyHeatmapKey(key)}
                className={cn(
                  "rounded-md border px-1.5 py-0.5 text-[9px] font-medium transition-colors duration-150 ease-out",
                  w.pathologyHeatmapKey === key
                    ? "border-accent/60 bg-accent/15 text-accent"
                    : "border-border/70 bg-card text-ink-2 hover:bg-hover",
                )}
              >
                {key.replace(/_/g, " ")}
              </button>
            ))}
          </div>
        </div>
      )}

      {loading && (
        <p className="text-[10px] italic text-ink-3">
          Analyse en cours sur le backend distant (cold start possible ~30 s)…
        </p>
      )}
      {error && (
        <p className="flex items-start gap-1 text-[10px] italic text-[#f87171]">
          <TriangleAlert size={11} className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}

function ViewBtn({
  active,
  onClick,
  label,
  icon,
  disabled = false,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[9.5px] font-medium transition-colors duration-150 ease-out",
        active
          ? "border-accent/60 bg-accent/15 text-accent"
          : "border-border/70 bg-card text-ink-2 hover:bg-hover hover:text-ink",
        disabled && "cursor-not-allowed opacity-40 grayscale",
      )}
    >
      {icon}
      {label}
    </button>
  );
}