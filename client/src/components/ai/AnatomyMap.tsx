import { useMemo, useState } from "react";
import { MapPin } from "lucide-react";
import { cn } from "../../lib/cn";
import { useWorkspace } from "../../state/workspace";

/* --------------------------------- Zones -------------------------------- */

export interface AnatomyZone {
  id: string;
  label: string;
  /** Description anatomique normale de la zone (savoir existant). */
  desc: string;
  /** Zone en fractions de l'image (0..1). */
  fx: number;
  fy: number;
  fw: number;
  fh: number;
}

const THORAX_ZONES: AnatomyZone[] = [
  {
    id: "apex-droit",
    label: "Apex droit",
    desc:
      "Sommet pulmonaire clair, parcouru de fines opacités vasculaires qui s'amenuisent vers le rebord supérieur. " +
      "La plèvre apicale reste fine et régulière, sans opacité en calotte.",
    fx: 0.14, fy: 0.04, fw: 0.3, fh: 0.2,
  },
  {
    id: "apex-gauche",
    label: "Apex gauche",
    desc:
      "Transparence symétrique au côté droit. Le sommet s'efface partiellement derrière la clé de voûte aortique " +
      "en incidence de face, ce qui est habituel.",
    fx: 0.56, fy: 0.04, fw: 0.3, fh: 0.2,
  },
  {
    id: "champ-sup-droit",
    label: "Champ supérieur droit",
    desc:
      "Réseau vasculaire de calibre progressivement décroissant vers la périphérie, clarté homogène, " +
      "sans opacité nodulaire ni ligne de pneumothorax.",
    fx: 0.1, fy: 0.24, fw: 0.34, fh: 0.22,
  },
  {
    id: "champ-sup-gauche",
    label: "Champ supérieur gauche",
    desc:
      "Parenchyme clair en regard de la région sous-clavière. La crosse aortique dessine un liseré médiastinal " +
      "régulier, sans élargissement.",
    fx: 0.56, fy: 0.24, fw: 0.34, fh: 0.22,
  },
  {
    id: "hile-droit",
    label: "Hile droit",
    desc:
      "Opacité hilaire triangulaire à base médiastinale, vaisseaux sectionnés de calibre normal (< 15 mm de section), " +
      "angle hilaire supérieur ouvert.",
    fx: 0.32, fy: 0.48, fw: 0.2, fh: 0.16,
  },
  {
    id: "hile-gauche",
    label: "Hile gauche",
    desc:
      "Hile physiologiquement plus haut que le droit. Absence de masse, d'adénopathie ou de calcification " +
      "juxta-hilaire.",
    fx: 0.48, fy: 0.48, fw: 0.2, fh: 0.16,
  },
  {
    id: "silhouette-cardiaque",
    label: "Silhouette cardiaque",
    desc:
      "Index cardio-thoracique < 50 % en incidence PA, contours nets, bord droit régulier, " +
      "apex gauche basculé sous la coupole. Pas de double contour ni de signe du ménisque.",
    fx: 0.22, fy: 0.5, fw: 0.5, fh: 0.3,
  },
  {
    id: "base-droite",
    label: "Base droite",
    desc:
      "Parenchyme clair jusqu'à la coupole droite, qui se projette au niveau de la 10e arcade postérieure. " +
      "Cul-de-sac latéral ouvert, pas d'épanchement pleural.",
    fx: 0.14, fy: 0.7, fw: 0.34, fh: 0.2,
  },
  {
    id: "base-gauche",
    label: "Base gauche",
    desc:
      "La poche à air gastrique sous la coupole gauche est une opacité de référence normale. " +
      "Pas d'épanchement, pas d'opacité rétro-cardiaque anormale.",
    fx: 0.52, fy: 0.7, fw: 0.34, fh: 0.2,
  },
  {
    id: "sinus",
    label: "Sinus costodiaphragmatiques",
    desc:
      "Angles costo-phréniques pointus et clairs, ouverture supérieure à 30°, sans niveau liquide " +
      "ni symphyse pleurale.",
    fx: 0.1, fy: 0.88, fw: 0.8, fh: 0.1,
  },
];

const OVERVIEW_DESC =
  "Radiographie thoracique de face : structures osseuses, silhouette médiastinale, hiles et parenchymes " +
  "sont examinés zone par zone. En l'absence d'anomalie signalée, chaque secteur est décrit comme normal.";

/* ------------------------------- Silhouette ------------------------------- */

/* La vue suit celle de l'image (aucune sélection AP/PA). */
const SILHOUETTE_AP = {
  body:
    "M17 18 C21 4 47 2 60 3 C73 2 99 4 103 18 C109 38 112 66 109 97 C106 128 100 147 60 148 " +
    "C20 147 14 128 11 97 C8 66 11 38 17 18 Z",
  heart:
    "M58 66 C72 62 84 66 88 74 C92 82 89 94 82 103 C75 111 66 112 60 107 C55 101 54 78 58 66 Z",
  lungR: "M20 22 C16 52 14 92 22 124 C34 138 46 138 52 130 C58 118 52 44 20 22 Z",
  lungL: "M100 22 C104 52 106 92 98 124 C86 138 74 138 68 130 C62 118 68 44 100 22 Z",
};

/* --------------------------------- Card ---------------------------------- */

type ActionPoint = {
  kind: "diagnosis" | "annotation" | "probe";
  id: string;
  label: string;
  x: number;
  y: number;
};

function zoneAt(xF: number, yF: number): AnatomyZone | null {
  return (
    THORAX_ZONES.find((z) => xF >= z.fx && xF <= z.fx + z.fw && yF >= z.fy && yF <= z.fy + z.fh) ?? null
  );
}

const POINT_COLOR: Record<ActionPoint["kind"], string> = {
  diagnosis: "#f87171",
  annotation: "#38bdf8",
  probe: "#f59e0b",
};

export function AnatomyMapCard() {
  const w = useWorkspace();
  const [selected, setSelected] = useState<{ kind: "zone" | "point"; id: string } | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);

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

  const sil = SILHOUETTE_AP;
  const toSvg = (xF: number, yF: number) => ({ x: xF * 120, y: yF * 160 });

  function computeEffective() {
    if (selected?.kind === "point") {
      const pt = points.find((p) => p.id === selected.id);
      if (pt) return zoneAt(pt.x, pt.y);
    }
    if (selected?.kind === "zone") {
      return THORAX_ZONES.find((z) => z.id === selected.id) ?? null;
    }
    if (w.probe) return zoneAt(w.probe.x, w.probe.y);
    for (const d of w.aiResults.diagnostics) {
      if (!d.region) continue;
      const cx = (d.region.x + d.region.w / 2) / (w.dims.w || 1);
      const cy = (d.region.y + d.region.h / 2) / (w.dims.h || 1);
      const zone = zoneAt(cx, cy);
      if (zone) return zone;
    }
    return null;
  }
  const effectiveZone = computeEffective();

  const zoneFindings = (zone: AnatomyZone | null) =>
    zone
      ? w.aiResults.diagnostics.filter((d) => {
          if (!d.region) return false;
          const cx = (d.region.x + d.region.w / 2) / (w.dims.w || 1);
          const cy = (d.region.y + d.region.h / 2) / (w.dims.h || 1);
          return cx >= zone.fx && cx <= zone.fx + zone.fw && cy >= zone.fy && cy <= zone.fy + zone.fh;
        })
      : w.aiResults.diagnostics;

  const findings = zoneFindings(effectiveZone);

  return (
    <section data-attr="ai-card-anatomy" className="mx-3 mt-3 overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center gap-1.5 px-3 pt-2.5">
        <MapPin size={13} strokeWidth={2.2} className="text-icon" />
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-2">Carte anatomique</h3>
      </div>

      <div className="flex items-start gap-2.5 px-3 pb-3 pt-2">
        {/* Minimap — gauche */}
        <div className="relative shrink-0 select-none">
          <svg
            data-attr="ai-anatomy-minimap"
            viewBox="0 0 120 160"
            className="h-[176px] w-[132px]"
          >
            <rect width="120" height="160" rx="8" className="fill-canvas" />
            <path d={sil.body} className="fill-[#3d4a5c] stroke-[#5b6b81]" strokeWidth="1.5" />
            <path d={sil.lungR} className="fill-[#151c26]" fillOpacity="0.5" />
            <path d={sil.lungL} className="fill-[#151c26]" fillOpacity="0.5" />
            <path d={sil.heart} className="fill-[#6b7280]" fillOpacity="0.85" />
            <path d="M33 30 L46 36 M87 30 L74 36" stroke="#5b6b81" strokeWidth="1.4" fill="none" />
            <path d="M60 27 L59.6 42 M60 42 Q55 62 60 88 M60 88 Q66 106 60 128" stroke="#5b6b81" strokeWidth="1" fill="none" fillOpacity="0.6" />
            <path d="M21 117 Q40 130 59 128 M61 128 Q80 130 99 117" stroke="#5b6b81" strokeWidth="1.4" fill="none" />
            <path d="M38 20 L52 26 L59 24 M82 20 L68 26 L61 24" stroke="#5b6b81" strokeWidth="1.1" fill="none" />

            {THORAX_ZONES.map((z) => {
              const r = toSvg(z.fx + z.fw / 2, z.fy + z.fh / 2);
              const isSel = effectiveZone?.id === z.id;
              const isHov = hovered === z.id;
              return (
                <ellipse
                  key={z.id}
                  data-attr={`ai-anatomy-zone-${z.id}`}
                  cx={r.x}
                  cy={r.y}
                  rx={(z.fw * 120) / 2}
                  ry={(z.fh * 160) / 2}
                  fill={isSel ? "rgba(59,130,246,0.18)" : "rgba(59,130,246,0.06)"}
                  stroke={isSel ? "rgba(59,130,246,0.85)" : isHov ? "rgba(59,130,246,0.5)" : "rgba(59,130,246,0.18)"}
                  strokeWidth={isSel ? 1.4 : 0.8}
                  className="cursor-pointer"
                  onClick={() => setSelected({ kind: "zone", id: z.id })}
                  onMouseEnter={() => setHovered(z.id)}
                  onMouseLeave={() => setHovered(null)}
                />
              );
            })}

            {points.map((pt, i) => {
              const r = toSvg(pt.x, pt.y);
              const isSel = selected?.kind === "point" && selected.id === pt.id;
              return (
                <g key={`${pt.kind}-${i}`}>
                  <circle
                    data-attr={`ai-anatomy-point-${pt.kind}-${i}`}
                    cx={r.x}
                    cy={r.y}
                    r={5.5}
                    fill={POINT_COLOR[pt.kind]}
                    fillOpacity={0.22}
                  />
                  <circle
                    cx={r.x}
                    cy={r.y}
                    r={2.6}
                    fill={POINT_COLOR[pt.kind]}
                    stroke={isSel ? "#fff" : "rgba(0,0,0,0.6)"}
                    strokeWidth={isSel ? 1.2 : 0.6}
                    className="cursor-pointer"
                    onClick={() => setSelected({ kind: "point", id: pt.id })}
                  />
                </g>
              );
            })}
          </svg>
        </div>

        {/* Texte — droite */}
        <div data-attr="ai-anatomy-text" className="min-w-0 flex-1 space-y-1.5">
          <p className="whitespace-pre-wrap text-[10.5px] leading-relaxed text-ink-2">
            {effectiveZone ? effectiveZone.desc : OVERVIEW_DESC}
          </p>
          <div className="border-t border-border/70 pt-1.5">
            <p className="text-[9.5px] font-semibold uppercase tracking-[0.05em] text-ink-3">
              {effectiveZone ? "Ce que montre votre image — cette zone" : "Résultats sur l'ensemble"}
            </p>
            {findings.length === 0 ? (
              <p className="mt-0.5 text-[10px] italic text-ink-3">
                Rien d'anormal signalé {effectiveZone ? "dans cette zone" : "pour l'instant"}.
              </p>
            ) : (
              <ul className="mt-0.5 space-y-0.5">
                {findings.map((d) => (
                  <li key={d.label} className="flex items-center gap-1 text-[10px] text-ink">
                    <span
                      className={cn(
                        "h-1.5 w-1.5 shrink-0 rounded-full",
                        d.severity === "high" ? "bg-[#f87171]" : d.severity === "medium" ? "bg-[#facc15]" : "bg-[#4ade80]",
                      )}
                    />
                    <span className="truncate">{d.label}</span>
                    <span className="ml-auto shrink-0 tabular-nums text-ink-3">{Math.round(d.prob * 100)} %</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}