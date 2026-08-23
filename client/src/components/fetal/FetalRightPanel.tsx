import { Badge, Button, KV } from "../ui";
import { useEditorModality } from "../../state/editorModality";
import { ANALYSIS_PHASES, useFetalExam } from "../../state/fetalExam";
import { examOverview, groupPlanesByRegion } from "../../lib/fetal/selectors";
import { cn } from "../../lib/cn";
import { randomId, useWorkspace, type Shape } from "../../state/workspace";
import { checkReportReadiness } from "../../lib/fetal/report";
import { FetalReportEditor } from "./FetalReportEditor";
import type { ComponentType } from "react";
import { useState } from "react";

/**
 * Panneau droit du module échographie fœtale.
 *
 * Contrairement au panneau radiographique (pile de cartes réordonnables), le
 * panneau fœtal est CONTEXTUEL : il affiche la carte correspondant à l'outil
 * actif de la sidebar gauche (INSTRUCTIONS.md §8 — « il ne doit jamais
 * afficher toutes les informations en même temps »).
 *
 * Les renderers sont branchés progressivement (étapes 5-8) ; en leur absence,
 * une carte explicite « à connecter » est rendue — jamais de fausse donnée IA.
 * L'anomalie fait exception : son état « non disponible » est le comportement
 * final demandé tant qu'aucun modèle n'est branché (§21 / §34).
 */

const FETAL_CARD_TITLES: Record<string, string> = {
  "fetal-examination": "Examination",
  "fetal-quality": "Image Quality",
  "fetal-plane-detection": "Detected Plane",
  "fetal-plans": "Plans",
  "fetal-selection": "Selected Views",
  "fetal-fetus": "Fetus",
  "fetal-biometry": "Biometry",
  "fetal-measurements": "Measurements",
  "fetal-placenta": "Placenta",
  "fetal-fluid": "Amniotic Fluid",
  "fetal-cervix": "Cervix",
  "fetal-findings": "Findings",
  "fetal-anomaly": "Anomaly Analysis",
  "fetal-report": "Report",
};

/** Carte affichée quand aucun outil n'est actif (vue d'ensemble de l'examen). */
const DEFAULT_CARD_ID = "fetal-examination";

type CardRenderer = ComponentType;

/** Rendu du statut d'examen (§5 / §28) — palette médicale restreinte (§30). */
const STATUS_META: Record<string, { label: string; className: string }> = {
  draft: { label: "Draft", className: "border-border bg-btn text-ink-2" },
  analyzing: { label: "Analyzing", className: "border-orange-500/40 bg-orange-500/10 text-orange-300" },
  analyzed: { label: "Analyzed", className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" },
  report_ready: { label: "Report ready", className: "border-accent/50 bg-accent/15 text-accent" },
};

/** Carte EXAMINATION — vue d'ensemble (INSTRUCTIONS.md §9). */
function ExaminationOverview() {
  const { exam, analysisPhase, startAnalysis, resetExam } = useFetalExam();
  const overview = examOverview(exam);
  const status = STATUS_META[exam.status] ?? STATUS_META.draft;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span data-attr="fetal-exam-status" className={cn("rounded-full border px-2 py-px text-[10.5px] font-medium", status.className)}>
          {status.label}
        </span>
        <span className="truncate text-[10.5px] text-ink-3">{exam.name}</span>
      </div>

      <div className="space-y-1">
        <KV k="Images" v={String(overview.total)} />
        <KV k="Analyzed" v={`${overview.analyzed} / ${overview.total}`} />
        <KV k="Plans detected" v={String(overview.plansDetected)} />
        <KV k="Images rejected" v={String(overview.rejected)} />
        <KV k="Selected views" v={String(overview.selected)} />
      </div>

      {/* Pipeline visuel pendant l'analyse (§29) — transitions discrètes. */}
      {analysisPhase !== null && (
        <div data-attr="fetal-analysis-progress" className="rounded-lg border border-border bg-btn/50 px-2 py-1.5">
          {ANALYSIS_PHASES.map((phase, index) => {
            const done = index < analysisPhase;
            const active = index === analysisPhase;
            return (
              <div key={phase} className="flex items-center gap-1.5 py-[2px] text-[11px]">
                <span
                  className={cn(
                    "inline-flex h-3 w-3 items-center justify-center rounded-full text-[8px]",
                    done && "bg-emerald-500/20 text-emerald-400",
                    active && "bg-accent/25 text-accent",
                    !done && !active && "bg-hover text-ink-3",
                  )}
                >
                  {done ? "✓" : active ? "●" : "○"}
                </span>
                <span className={cn(active ? "text-ink" : done ? "text-ink-2" : "text-ink-3")}>{phase}</span>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex gap-1.5 pt-0.5">
        <Button
          className="flex-1"
          data="fetal-analyze-exam"
          variant="primary"
          disabled={analysisPhase !== null}
          onClick={startAnalysis}
        >
          {analysisPhase !== null ? "Analyzing…" : exam.status === "draft" ? "Analyze examination" : "Re-run analysis"}
        </Button>
        <Button className="shrink-0" data="fetal-reset-mock" onClick={resetExam}>Reset</Button>
      </div>
      <p className="text-[10px] leading-snug text-ink-3/80">
        Données mockées (<code>source.kind = "mock"</code>) — remplacées plus tard par DeepFetal / FetalCLIP.
      </p>
    </div>
  );
}

/**
 * Registre de rendu des cartes fœtales. Une entrée manquante ⇒ carte
 * « à connecter ». Branchées aux étapes suivantes :
 * qualité/planes/sélection (étape 6), biometry/fetus/findings/fluid/placenta/
 * cervix (étape 7), report (étape 8).
 */
const RENDERERS: Record<string, CardRenderer> = {
  /* §9 — vue d'ensemble de l'examen + déclenchement de l'analyse mockée. */
  "fetal-examination": ExaminationOverview,
  /* §10 — qualité d'image (détail + liste multi-image + Use/Exclude). */
  "fetal-quality": QualityCard,
  /* §11 — plan détecté + top prédictions + images correspondantes. */
  "fetal-plane-detection": PlaneDetectionCard,
  /* §12 — regroupement par plans / régions. */
  "fetal-plans": PlansCard,
  /* §13 — meilleures vues retenues par la sélection IA. */
  "fetal-selection": SelectionCard,
  /* §14/§15/§16 — fœtus, biométrie éditable, mesures sur image. */
  "fetal-fetus": FetusCard,
  "fetal-biometry": BiometryCard,
  "fetal-measurements": MeasurementsCard,
  /* §17-§20 — placenta, liquide amniotique, col, findings. */
  "fetal-placenta": PlacentaCard,
  "fetal-fluid": FluidCard,
  "fetal-cervix": CervixCard,
  "fetal-findings": FindingsCard,
  /* §21 — comportement FINAL tant qu'aucun modèle d'anomalie n'existe. */
  "fetal-anomaly": () => (
    <div className="space-y-1.5">
      <p className="text-[12px] font-medium text-ink">Not available yet</p>
      <p className="text-[11px] leading-relaxed text-ink-3">
        The anomaly detection model is currently not connected.
      </p>
      <Badge className="border-orange-500/30 bg-orange-500/10 text-orange-300">not_implemented</Badge>
    </div>
  ),
  /* §22-§24 — génération et workflow du compte rendu obstétrical. */
  "fetal-report": ReportCard,
};

function FetalCard({ cardId }: { cardId: string }) {
  const title = FETAL_CARD_TITLES[cardId] ?? cardId;
  const Renderer = RENDERERS[cardId];
  return (
    <div data-attr={`fetal-card-${cardId}`} className="rounded-xl border border-border bg-card p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[12.5px] font-semibold text-ink">{title}</span>
        {!Renderer && <Badge>bientôt</Badge>}
      </div>
      {Renderer ? (
        <Renderer />
      ) : (
        <p className="text-[11px] leading-relaxed text-ink-3">
          Ce panneau sera alimenté par le module d'analyse échographique (données mockées puis résultats réels).
        </p>
      )}
    </div>
  );
}

/** Corps du panneau droit en modalité fœtale (utilisé par RightPanel et RightPanelDrawer). */
export function FetalCardsBody() {
  const m = useEditorModality();
  const { reportEditOpen } = useFetalExam();
  const requested = m.activeToolId;
  const cardId =
    requested && m.module.rightCards.includes(requested)
      ? requested
      : DEFAULT_CARD_ID in RENDERERS || FETAL_CARD_TITLES[DEFAULT_CARD_ID]
        ? DEFAULT_CARD_ID
        : m.module.rightCards[0];
  return (
    <div className="space-y-2.5" data-attr="fetal-right-panel">
      <FetalCard cardId={cardId} />
      {reportEditOpen && <FetalReportEditor />}
    </div>
  );
}

/* ---------------------------- §22-§24 REPORT -------------------------------- */

function ReportCard() {
  const { exam, analysisPhase, generateReport, setReportEditOpen, validateReport } = useFetalExam();
  const report = exam.report;
  const readiness = checkReportReadiness(exam);

  /* État Generate / Generating / Generated / Needs review / Validated (§24). */
  const stateChip =
    !report || report.state === "idle" ? (
      <Badge>Generate</Badge>
    ) : report.state === "generating" ? (
      <Badge className="border-accent/40 bg-accent/10 text-accent">Generating…</Badge>
    ) : report.state === "validated" ? (
      <Badge className="border-emerald-500/40 bg-emerald-500/10 text-emerald-300">Validated</Badge>
    ) : (
      <Badge className="border-orange-500/40 bg-orange-500/10 text-orange-300">Needs review</Badge>
    );

  return (
    <div className="space-y-2" data-attr="fetal-report-card">
      <div className="flex items-center justify-between">
        {stateChip}
        {report?.updatedAt && (
          <span className="text-[9.5px] tabular-nums text-ink-3">
            {new Date(report.updatedAt).toLocaleTimeString("fr-FR")}
          </span>
        )}
      </div>

      {!report || report.state === "idle" ? (
        <>
          {!readiness.ok && (
            <ul className="space-y-0.5 rounded-lg border border-orange-500/30 bg-orange-500/5 px-2 py-1.5">
              {readiness.missing.map((missing) => (
                <li key={missing} className="text-[10.5px] leading-snug text-orange-300">• {missing}</li>
              ))}
            </ul>
          )}
          <Button
            className="w-full"
            variant="primary"
            data="fetal-generate-report"
            disabled={!readiness.ok || analysisPhase !== null}
            onClick={() => generateReport()}
          >
            {analysisPhase !== null ? "Analyzing…" : "Generate"}
          </Button>
          {!readiness.ok && (
            <p className="text-[10px] leading-snug text-ink-3/80">
              Le rapport n'est jamais généré sans les informations minimales (§24).
            </p>
          )}
        </>
      ) : report.state === "generating" ? (
        <p className="text-[11px] text-ink-3">Construction du compte rendu à partir des données structurées…</p>
      ) : (
        <>
          {/* Aperçu compact */}
          <pre className="max-h-36 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-btn/30 p-2 font-mono text-[10px] leading-relaxed text-ink-2">
{Object.values(report.sections).map((section) => section.content).join("\n\n")}
          </pre>
          <div className="grid grid-cols-2 gap-1.5">
            <Button data="fetal-edit-report" onClick={() => setReportEditOpen(true)}>Edit report</Button>
            {report.state === "needs_review" && (
              <Button variant="primary" data="fetal-validate-report" onClick={validateReport}>Validate</Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* ═══════════════════════ Cartes d'analyse (étape 6) ═══════════════════════ */

/** État commun « pas encore analysé » — guide vers la carte Examination. */
function AnalysisPending() {
  return (
    <p className="text-[11px] leading-relaxed text-ink-3">
      Aucun résultat d'analyse. Lancez « Analyze examination » depuis le panneau Examination.
    </p>
  );
}

/** Pastille de score qualité — palette médicale restreinte (§30). */
function ScoreChip({ score }: { score: number }) {
  const tone =
    score >= 85
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
      : score >= 70
        ? "border-border bg-btn text-ink-2"
        : "border-red-500/40 bg-red-500/10 text-red-300";
  return (
    <span className={cn("inline-flex items-center rounded-full border px-1.5 py-px text-[10px] font-medium tabular-nums", tone)}>
      {score} %
    </span>
  );
}

/** Barre de confiance horizontale (0-100 %). */
function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  return (
    <div className="flex items-center gap-1.5">
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-hover">
        <div className="h-full rounded-full bg-accent/70" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 text-right text-[10px] tabular-nums text-ink-3">{pct} %</span>
    </div>
  );
}

/* ------------------------------- §10 QUALITY -------------------------------- */

function QualityCard() {
  const { exam, updateImage, activeImageId, setActiveImageId } = useFetalExam();
  const analyzed = exam.images.filter((image) => image.quality);
  if (analyzed.length === 0) return <AnalysisPending />;
  const current = analyzed.find((image) => image.id === activeImageId) ?? analyzed[0];
  const q = current.quality!;
  const gradeLabel: Record<string, string> = { good: "Good", fair: "Fair", poor: "Poor" };

  return (
    <div className="space-y-2" data-attr="fetal-quality-card">
      <div className="rounded-lg border border-border bg-btn/40 p-2">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-[11.5px] font-medium text-ink">{current.name}</span>
          <ScoreChip score={q.score} />
        </div>
        <div className="mt-1 space-y-0.5">
          <KV k="Status" v={gradeLabel[q.status]} />
          <KV k="Sharpness" v={gradeLabel[q.sharpness]} />
          <KV k="Contrast" v={gradeLabel[q.contrast]} />
          <KV k="Visibility" v={gradeLabel[q.visibility]} />
          <KV k="Usability" v={q.usability === "accepted" ? "Accepted" : q.usability === "rejected" ? "Rejected" : "Review"} />
        </div>
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          <Button
            data="fetal-quality-use"
            disabled={!current.rejected && q.usability === "accepted"}
            onClick={() => updateImage(current.id, { rejected: false, quality: { ...q, usability: "accepted" } })}
          >
            Use image
          </Button>
          <Button
            data="fetal-quality-exclude"
            variant="primary"
            className="!bg-red-500/80 hover:!bg-red-500 active:!bg-red-600"
            disabled={q.usability === "rejected"}
            onClick={() =>
              updateImage(current.id, {
                rejected: true,
                selected: false,
                quality: { ...q, usability: "rejected" },
              })
            }
          >
            Exclude image
          </Button>
        </div>
      </div>

      {/* Liste multi-image (§10) */}
      <div className="max-h-44 overflow-y-auto rounded-lg border border-border bg-btn/20 px-1.5 py-1">
        {analyzed.map((image, index) => (
          <button
            key={image.id}
            type="button"
            data-attr={`fetal-quality-row-${index + 1}`}
            onClick={() => setActiveImageId(image.id)}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-1 py-[3px] text-left text-[11px] transition-colors duration-100",
              image.id === current.id ? "bg-accent/15 text-accent" : "text-ink-2 hover:bg-hover hover:text-ink",
            )}
          >
            <span className="w-5 tabular-nums text-ink-3">{String(index + 1).padStart(2, "0")}</span>
            <span className={cn("font-medium", image.rejected ? "text-red-400" : "text-emerald-400")}>
              {image.rejected ? "✕" : "✓"}
            </span>
            <span className="ml-auto tabular-nums">{image.quality!.score} %</span>
            {image.selected && <span title="Vue sélectionnée" className="text-accent">★</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

/* --------------------------- §11 PLANE DETECTION ---------------------------- */

function PlaneDetectionCard() {
  const { exam, activeImageId, setActiveImageId } = useFetalExam();
  const analyzed = exam.images.filter((image) => image.plane);
  const [matchingPlane, setMatchingPlane] = useState<string | null>(null);
  if (analyzed.length === 0) return <AnalysisPending />;
  const current = analyzed.find((image) => image.id === activeImageId) ?? analyzed[0];
  const plane = current.plane!;
  const matching = matchingPlane ? analyzed.filter((image) => image.plane!.planeId === matchingPlane) : [];

  return (
    <div className="space-y-2" data-attr="fetal-plane-detection-card">
      <select
        value={current.id}
        onChange={(event) => setActiveImageId(event.target.value)}
        className="w-full rounded-md border border-border bg-btn px-1.5 py-1 text-[11px] text-ink outline-none focus:border-accent/60"
      >
        {analyzed.map((image) => (
          <option key={image.id} value={image.id}>
            {image.name}
          </option>
        ))}
      </select>

      <div className="rounded-lg border border-border bg-btn/40 p-2">
        <p className="text-[10px] uppercase tracking-[0.08em] text-ink-3">Detected plane</p>
        <div className="mt-0.5 flex items-baseline justify-between">
          <span className="text-[16px] font-semibold text-accent">{plane.label}</span>
          <span className="text-[10.5px] text-ink-3">
            confidence <span className="tabular-nums text-ink-2">{Math.round(plane.confidence * 100)} %</span>
          </span>
        </div>
      </div>

      <div>
        <p className="mb-1 text-[10px] uppercase tracking-[0.08em] text-ink-3">Top predictions</p>
        <div className="space-y-1">
          {plane.topPredictions.map((prediction) => (
            <button
              key={prediction.planeId}
              type="button"
              data-attr={`fetal-prediction-${prediction.planeId}`}
              onClick={() => setMatchingPlane(prediction.planeId)}
              className={cn(
                "block w-full rounded-md px-1 py-0.5 text-left transition-colors duration-100",
                matchingPlane === prediction.planeId ? "bg-accent/15" : "hover:bg-hover",
              )}
            >
              <div className="flex items-center justify-between text-[11px]">
                <span className={matchingPlane === prediction.planeId ? "text-accent" : "text-ink-2"}>
                  {prediction.label}
                </span>
              </div>
              <ConfidenceBar value={prediction.confidence} />
            </button>
          ))}
        </div>
      </div>

      {matchingPlane ? (
        <div className="rounded-lg border border-border bg-btn/20 px-1.5 py-1" data-attr="fetal-matching-images">
          <div className="mb-0.5 flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-[0.08em] text-ink-3">Matching images ({matching.length})</span>
            <button type="button" onClick={() => setMatchingPlane(null)} className="text-[10px] text-accent hover:text-accent-2">
              View all detected planes
            </button>
          </div>
          {matching.map((image) => (
            <div key={image.id} className="flex items-center justify-between px-1 py-[2px] text-[11px] text-ink-2">
              <span>{image.name}</span>
              <span className="tabular-nums text-ink-3">{image.quality?.score ?? "—"} %</span>
            </div>
          ))}
        </div>
      ) : (
        <Button className="w-full" data="fetal-show-matching" onClick={() => setMatchingPlane(plane.planeId)}>
          Show matching images
        </Button>
      )}
    </div>
  );
}

/* ------------------------------- §12 PLANS ---------------------------------- */

const REGION_LABELS: Record<string, string> = {
  brain: "Brain",
  heart: "Heart",
  abdomen: "Abdomen",
  femur: "Femur",
  spine: "Spine",
  face: "Face",
  kidney: "Kidney",
  other: "Other",
};

function PlansCard() {
  const { exam } = useFetalExam();
  const groups = groupPlanesByRegion(exam);
  const [expanded, setExpanded] = useState<string | null>(null);
  if (groups.length === 0) return <AnalysisPending />;

  return (
    <div className="space-y-2" data-attr="fetal-plans-card">
      {groups.map((group) => (
        <div key={group.region}>
          <p className="mb-0.5 text-[10px] uppercase tracking-[0.08em] text-ink-3">
            {REGION_LABELS[group.region] ?? group.region}
          </p>
          <div className="space-y-0.5">
            {group.planes.map((planeGroup) => {
              const isOpen = expanded === planeGroup.planeId;
              return (
                <div key={planeGroup.planeId} className="rounded-md border border-border bg-btn/30">
                  <button
                    type="button"
                    data-attr={`fetal-plan-${planeGroup.planeId}`}
                    onClick={() => setExpanded(isOpen ? null : planeGroup.planeId)}
                    className="flex w-full items-center justify-between px-1.5 py-1 text-left transition-colors duration-100 hover:bg-hover"
                  >
                    <span className="text-[11.5px] font-medium text-ink">{planeGroup.label}</span>
                    <span className="text-[10.5px] tabular-nums text-ink-3">
                      {planeGroup.count} image{planeGroup.count > 1 ? "s" : ""}
                    </span>
                  </button>
                  {isOpen && planeGroup.bestImage && (
                    <div className="space-y-0.5 border-t border-border px-1.5 py-1">
                      {exam.images
                        .filter((image) => image.plane?.planeId === planeGroup.planeId)
                        .map((image) => (
                          <div key={image.id} className="flex items-center justify-between text-[10.5px] text-ink-2">
                            <span className={cn(image.rejected && "line-through opacity-60")}>{image.name}</span>
                            <span className="flex items-center gap-1.5">
                              {image.selected && <span className="text-accent">★</span>}
                              <span className="tabular-nums text-ink-3">{image.quality?.score ?? "—"}</span>
                            </span>
                          </div>
                        ))}
                      <p className="pt-0.5 text-[9.5px] text-ink-3/80">
                        ★ meilleure vue retenue · best : {planeGroup.bestImage.name}
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ----------------------------- §13 AI SELECTION ----------------------------- */

function SelectionCard() {
  const { exam, replaceSelection } = useFetalExam();
  const selected = exam.images.filter((image) => image.selected);
  const byRegion = new Map<string, typeof selected>();
  for (const image of selected) {
    const region = image.plane?.region ?? "other";
    const list = byRegion.get(region) ?? [];
    list.push(image);
    byRegion.set(region, list);
  }

  return (
    <div className="space-y-2" data-attr="fetal-selection-card">
      {selected.length === 0 ? (
        <AnalysisPending />
      ) : (
        <>
          {[...byRegion.entries()].map(([region, images]) => (
            <div key={region}>
              <p className="flex items-center gap-1.5 text-[11px]">
                <span className="text-emerald-400">✓</span>
                <span className="font-medium text-ink">{REGION_LABELS[region] ?? region}</span>
                <span className="tabular-nums text-ink-3">
                  {images.length} image{images.length > 1 ? "s" : ""}
                </span>
              </p>
              {/* Miniatures placeholder (les vignettes réelles arriveront avec
                  le filmstrip — les images mockées n'ont pas de src). */}
              <div className="mt-1 grid grid-cols-4 gap-1">
                {images.map((image) => (
                  <div
                    key={image.id}
                    data-attr={`fetal-selection-tile-${image.id}`}
                    title={`${image.name} · ${image.quality?.score ?? "?"} %`}
                    className="flex aspect-square flex-col items-center justify-center rounded-lg border border-accent/30 bg-gradient-to-br from-accent/15 to-transparent"
                  >
                    <span className="text-[9.5px] font-semibold leading-none text-accent">{image.plane!.label}</span>
                    <span className="mt-0.5 text-[8.5px] leading-none tabular-nums text-ink-3">
                      {Math.round((image.plane!.confidence ?? 0) * 100)} %
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}

          <KV k="Total selected" v={`${selected.length} images`} />

          <Button className="w-full" data="fetal-replace-selection" onClick={replaceSelection}>
            Replace selection
          </Button>
        </>
      )}
    </div>
  );
}

/* ═════════════════════ Cartes obstétricales (étape 7) ══════════════════════ */

const formatGA = (ga: { weeks: number; days: number } | null): string =>
  ga ? `${ga.weeks} SA + ${ga.days} day${ga.days > 1 ? "s" : ""}` : "—";

const formatEdd = (edd: string | null): string =>
  edd ? new Date(edd).toLocaleDateString("fr-FR") : "—";

/** Onglets fœtus partagés par Biometry / Fetus (§14). */
function FetusTabs({
  fetuses,
  activeId,
  onSelect,
}: {
  fetuses: Array<{ id: string; label: string }>;
  activeId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex gap-1">
      {fetuses.map((fetus) => (
        <button
          key={fetus.id}
          type="button"
          data-attr={`fetal-fetus-tab-${fetus.id}`}
          onClick={() => onSelect(fetus.id)}
          className={cn(
            "rounded-full border px-2 py-px text-[10.5px] font-medium transition-colors duration-100",
            fetus.id === activeId
              ? "border-accent/50 bg-accent/15 text-accent"
              : "border-border bg-btn text-ink-3 hover:text-ink",
          )}
        >
          {fetus.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------ §15 BIOMETRY -------------------------------- */

/** Mesures additionnelles proposées à l'ajout (+ Add measurement). */
const EXTRA_MEASUREMENT_KEYS: Array<{ key: string; label: string }> = [
  { key: "NT", label: "NT" },
  { key: "HC", label: "HC (PC)" },
];

function BiometryCard() {
  const { exam, updateMeasurement, addMeasurement } = useFetalExam();
  const [activeId, setActiveId] = useState<string>(exam.fetuses[0]?.id ?? "");
  const fetus = exam.fetuses.find((f) => f.id === activeId) ?? exam.fetuses[0];
  if (!fetus) return <AnalysisPending />;
  const missingExtras = EXTRA_MEASUREMENT_KEYS.filter(
    (extra) => !fetus.measurements.some((m) => m.key === extra.key),
  );

  return (
    <div className="space-y-2" data-attr="fetal-biometry-card">
      <FetusTabs fetuses={exam.fetuses} activeId={fetus.id} onSelect={setActiveId} />

      <div className="space-y-1">
        {fetus.measurements.map((measurement) => (
          <div
            key={measurement.key}
            data-attr={`fetal-biometry-${measurement.key}`}
            className="flex items-center gap-1.5"
          >
            <span className="w-8 shrink-0 text-[11.5px] font-medium text-ink">{measurement.label}</span>
            <input
              type="number"
              min={0}
              step="0.5"
              data-input={`fetal-biometry-value-${measurement.key}`}
              value={measurement.valueMm ?? ""}
              placeholder="—"
              onChange={(event) =>
                updateMeasurement(fetus.id, measurement.key, event.target.value === "" ? null : Number(event.target.value))
              }
              className="ml-auto w-16 rounded-md border border-border bg-btn px-1.5 py-0.5 text-right text-[11px] tabular-nums text-ink outline-none transition-colors duration-150 focus:border-accent/60"
            />
            <span className="text-[10px] text-ink-3">mm</span>
            {/* Provenance : IA (confiance) ou saisie praticien — jamais masquée. */}
            {measurement.source.kind === "user" ? (
              <span title="Saisie manuelle" className="text-[9px] font-medium text-sky-300">✎</span>
            ) : (
              <span title="Valeur IA mockée" className="text-[9px] tabular-nums text-ink-3">
                {measurement.confidence != null ? `${Math.round(measurement.confidence * 100)}%` : ""}
              </span>
            )}
          </div>
        ))}
      </div>

      <KV k="Gestational age" v={formatGA(fetus.gestationalAge)} />
      <KV k="EDD / DPA" v={formatEdd(fetus.edd)} />

      <Button
        className="w-full"
        data="fetal-add-measurement"
        disabled={missingExtras.length === 0}
        onClick={() => {
          const extra = missingExtras[0];
          if (extra) addMeasurement(fetus.id, extra.key, extra.label);
        }}
      >
        + Add measurement
      </Button>
    </div>
  );
}

/* -------------------------------- §14 FETUS --------------------------------- */

function FetusCard() {
  const { exam } = useFetalExam();
  const [activeId, setActiveId] = useState<string>(exam.fetuses[0]?.id ?? "");
  const fetus = exam.fetuses.find((f) => f.id === activeId) ?? exam.fetuses[0];
  if (!fetus) return <AnalysisPending />;

  return (
    <div className="space-y-2" data-attr="fetal-fetus-card">
      <FetusTabs fetuses={exam.fetuses} activeId={fetus.id} onSelect={setActiveId} />
      <div className="space-y-0.5">
        <KV k="Measurements" v={`${fetus.measurements.filter((m) => m.valueMm != null).length} / ${fetus.measurements.length}`} />
        <KV k="Position" v={fetus.position ?? "Not assessed"} />
        <KV k="Heart rate" v={fetus.heartRateBpm != null ? `${fetus.heartRateBpm} bpm` : "Not assessed"} />
        <KV k="Estimated weight" v={fetus.estimatedWeightG != null ? `${fetus.estimatedWeightG} g` : "Not assessed"} />
        <KV k="Gestational age" v={formatGA(fetus.gestationalAge)} />
        <KV k="EDD / DPA" v={formatEdd(fetus.edd)} />
      </div>
      {exam.fetuses.length > 1 && (
        <p className="text-[10px] leading-snug text-ink-3/80">
          Grossesse multiple — chaque fœtus possède son propre groupe de données (§14).
        </p>
      )}
    </div>
  );
}

/* ---------------------------- §16 MEASUREMENTS ------------------------------ */

/**
 * « Show on image » : pose la droite de mesure sur le canvas via le système
 * de formes existant (calque Measurements), exactement comme une mesure posée
 * à la main — l'édition/unredo restent donc fonctionnels (§16 / §26).
 */
function MeasurementsCard() {
  const { exam } = useFetalExam();
  const w = useWorkspace();

  const placeOnImage = (fetusLabel: string, key: string, label: string, valueMm: number | null) => {
    if (!w.imageSrc || w.dims.w <= 0) {
      w.notify("Aucune image ouverte", "warning", "Ouvrez une image de l'examen pour y poser la mesure.");
      return;
    }
    /* Placement centré déterministe (démo mock) ; le vrai pipeline DeepFetal
       fournira les coordonnées réelles des points de mesure. */
    const x0 = Math.round(w.dims.w * 0.3);
    const y0 = Math.round(w.dims.h * 0.45);
    const x1 = Math.round(w.dims.w * 0.62);
    const y1 = Math.round(w.dims.h * 0.55);
    const shape: Shape = {
      id: randomId(),
      type: "measure",
      x: x0,
      y: y0,
      w: x1 - x0,
      h: y1 - y0,
      points: [],
      strokeWidth: 2,
      strokeColor: "#3b82f6",
      fontSize: 12,
      label: `${label} ${valueMm != null ? `${valueMm} mm` : "—"} (${fetusLabel})`,
      createdBy: "ai",
      actionId: `fetal-measure-${key}`,
    };
    w.pushHistory();
    w.addShape(shape);
    w.notify("Mesure posée sur l'image", "success", `${fetusLabel} · ${label}`);
  };

  return (
    <div className="space-y-2" data-attr="fetal-measurements-card">
      {exam.fetuses.flatMap((fetus) =>
        fetus.measurements.map((measurement) => (
          <div
            key={`${fetus.id}-${measurement.key}`}
            data-attr={`fetal-measurement-${measurement.key}`}
            className="flex items-center gap-2 rounded-lg border border-border bg-btn/30 px-2 py-1"
          >
            <span className="w-6 shrink-0 text-[10px] font-semibold text-accent">{fetus.label}</span>
            <span className="text-[11.5px] font-medium text-ink">{measurement.label}</span>
            <span className="ml-auto text-[11.5px] tabular-nums text-ink-2">
              {measurement.valueMm != null ? `${measurement.valueMm} mm` : "—"}
            </span>
            <Button
              data={`fetal-show-on-image-${fetus.id}-${measurement.key}`}
              onClick={() => placeOnImage(fetus.label, measurement.key, measurement.label, measurement.valueMm)}
            >
              Show on image
            </Button>
          </div>
        )),
      )}
    </div>
  );
}

/* ------------------------------ §17 PLACENTA -------------------------------- */

function PlacentaCard() {
  const { exam } = useFetalExam();
  const placenta = exam.placenta;
  if (!placenta) return <AnalysisPending />;

  return (
    <div className="space-y-0.5" data-attr="fetal-placenta-card">
      <KV k="Position" v={placenta.position ? placenta.position.charAt(0).toUpperCase() + placenta.position.slice(1) : "Not assessed"} />
      <KV k="Grade" v={placenta.grade ?? "—"} />
      <KV k="Insertion" v={placenta.insertion ?? "Information non disponible"} />
      {placenta.confidence != null && (
        <KV k="Confidence" v={`${Math.round(placenta.confidence * 100)} %`} />
      )}
      {/* §17 : « Show on image » uniquement lorsqu'une localisation visuelle
         existe — aucune donnée de localisation mockée : pas de bouton. */}
    </div>
  );
}

/* --------------------------- §18 AMNIOTIC FLUID ----------------------------- */

function FluidCard() {
  const { exam } = useFetalExam();
  const fluid = exam.amnioticFluid;
  if (!fluid) return <AnalysisPending />;
  const statusTone =
    fluid.status === "normal"
      ? "text-emerald-300"
      : fluid.status === "abnormal"
        ? "text-red-300"
        : "text-ink-3";

  return (
    <div className="space-y-0.5" data-attr="fetal-fluid-card">
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-[12px] text-ink-3">Status</span>
        <span className={cn("truncate text-right text-[12px]", statusTone)}>
          {fluid.status === "not_assessed" ? "Not assessed" : fluid.status === "normal" ? "Normal" : "Abnormal"}
        </span>
      </div>
      <KV k="Measurement" v={fluid.measurementMm != null ? `${fluid.measurementMm} mm` : "—"} />
      {fluid.status === "not_assessed" && (
        <p className="text-[10px] leading-snug text-ink-3/80">Quantité non évaluée — aucune valeur générée.</p>
      )}
    </div>
  );
}

/* -------------------------------- §19 CERVIX -------------------------------- */

function CervixCard() {
  const { exam } = useFetalExam();
  const cervix = exam.cervix;
  if (!cervix) return <AnalysisPending />;
  const label =
    cervix.status === "long_closed"
      ? "Long / Closed"
      : cervix.status === "shortened"
        ? "Shortened"
        : cervix.status === "open"
          ? "Open"
          : "Not assessed";

  return (
    <div className="space-y-1" data-attr="fetal-cervix-card">
      <KV k="Status" v={label} />
      <KV k="Cervical length" v={cervix.lengthMm != null ? `${cervix.lengthMm} mm` : "—"} />
      {cervix.status === "long_closed" && (
        <p className="text-[10.5px] text-ink-3">« Col long et fermé. »</p>
      )}
    </div>
  );
}

/* ------------------------------- §20 FINDINGS ------------------------------- */

const FINDING_ICON: Record<string, string> = {
  positive: "✓",
  neutral: "•",
  attention: "⚠",
};

/** « Show evidence » : active l'image associée dans la filmstrip (§20). */
function ShowEvidenceButton({ imageId }: { imageId: string }) {
  const { setActiveImageId } = useFetalExam();
  const { exam } = useFetalExam();
  const image = exam.images.find((item) => item.id === imageId);
  return (
    <button
      type="button"
      data-attr={`fetal-show-evidence-${imageId}`}
      onClick={() => {
        setActiveImageId(imageId);
      }}
      title={image ? `Afficher ${image.name} dans la filmstrip` : "Image associée"}
      className="text-accent underline decoration-dotted transition-colors duration-100 hover:text-accent-2"
    >
      Show evidence
    </button>
  );
}

function FindingsCard() {
  const { exam } = useFetalExam();
  if (exam.findings.length === 0) return <AnalysisPending />;
  return (
    <div className="space-y-1.5" data-attr="fetal-findings-card">
      {exam.findings.map((finding) => (
        <div key={finding.id} data-attr={`fetal-finding-${finding.id}`} className="space-y-0.5">
          <p className="flex items-start gap-1.5 text-[11.5px] leading-snug">
            <span
              className={cn(
                finding.status === "positive" && "text-emerald-400",
                finding.status === "neutral" && "text-ink-2",
                finding.status === "attention" && "text-orange-400",
              )}
            >
              {FINDING_ICON[finding.status]}
            </span>
            <span className={cn(finding.status === "attention" ? "text-orange-200" : "text-ink-2")}>
              {finding.text}
            </span>
          </p>
          <div className="flex items-center gap-2 pl-4 text-[9.5px] text-ink-3">
            <span>{finding.source.kind}</span>
            {finding.confidence != null && <span className="tabular-nums">{Math.round(finding.confidence * 100)} %</span>}
            {/* §20 « Show evidence » : sélectionne l'image associée dans la
                filmstrip (image active partagée). */}
            {finding.imageId && (
              <ShowEvidenceButton imageId={finding.imageId} />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
