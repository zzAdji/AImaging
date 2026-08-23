import { useEditorModality } from "../../state/editorModality";
import { useFetalExam } from "../../state/fetalExam";
import { cn } from "../../lib/cn";

/**
 * Filmstrip fœtale (INSTRUCTIONS.md §27) — navigation multi-image discrète.
 * Chaque vignette : numéro, plan, quality score, état sélection/rejet.
 * Le clic définit l'image active (partagée avec les cartes Quality / Plane /
 * Findings). Rendu UNIQUEMENT en modalité fœtale via {@link FetalFilmstripHost}.
 */
function FetalFilmstrip() {
  const { exam, activeImageId, setActiveImageId } = useFetalExam();
  const analyzed = exam.images;
  if (analyzed.length === 0) return null;

  return (
    <div
      data-attr="fetal-filmstrip"
      className="flex h-16 shrink-0 items-center gap-1.5 overflow-x-auto border-t border-border bg-panel px-2"
    >
      {analyzed.map((image, index) => {
        const isActive = image.id === (activeImageId ?? analyzed[0]?.id);
        return (
          <button
            key={image.id}
            type="button"
            data-attr={`fetal-filmstrip-${index + 1}`}
            title={`${image.name}${image.plane ? ` · ${image.plane.label}` : ""}${image.quality ? ` · ${image.quality.score} %` : ""}`}
            onClick={() => setActiveImageId(image.id)}
            className={cn(
              "relative flex h-12 w-16 shrink-0 flex-col items-center justify-center rounded-lg border transition-colors duration-100",
              isActive
                ? "border-accent bg-accent/10"
                : "border-border bg-card hover:border-accent/60",
              image.rejected && "opacity-55",
            )}
          >
            <span className="absolute left-1 top-0.5 text-[8.5px] tabular-nums text-ink-3">
              {String(index + 1).padStart(2, "0")}
            </span>
            {image.selected && (
              <span className="absolute right-1 top-0.5 text-[9px] text-accent" title="Vue sélectionnée">★</span>
            )}
            <span className={cn("text-[10.5px] font-semibold leading-none", image.rejected ? "text-red-400 line-through" : "text-ink")}>
              {image.plane?.label ?? "—"}
            </span>
            <span className="mt-0.5 text-[8.5px] leading-none tabular-nums text-ink-3">
              {image.rejected ? "rejected" : image.quality ? `${image.quality.score} %` : "—"}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Hôte : ne rend rien hors modalité fœtale (zéro impact radiographie). */
export function FetalFilmstripHost() {
  const m = useEditorModality();
  if (m.modality !== "fetal_ultrasound") return null;
  return <FetalFilmstrip />;
}