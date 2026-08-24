/**
 * ReportActionsBar — barre d'actions du rapport (INSTRUCTIONS.md §26/§27/§31/§33).
 *
 * UI épurée :
 *   - icône Template (sans texte) → TemplateBuilderModal : document « type Word »
 *     éditable par drag & drop de blocs, variables personnalisables, aperçu live ;
 *   - icône Téléchargement (sans texte) → menu déroulant PDF / Word / JSON.
 *
 * L'aperçu vit DANS le builder (jamais de bouton « Aperçu » séparé) et la
 * voix vit dans la floating command bar (jamais ici).
 */

import { useMemo, useRef, useState } from "react";
import {
  Braces,
  Download,
  Eye,
  GripVertical,
  Heading2,
  LayoutTemplate,
  Minus,
  Plus,
  Trash2,
  Type,
  type LucideIcon,
} from "lucide-react";
import {
  defaultTemplateData,
  renderDocument,
  type ReportModality,
  type ReportTemplateData,
  type TemplateBlock,
  type TemplateBlockKind,
  type TemplateVariable,
} from "../../lib/reports/engine";
import {
  buildReportFilename,
  buildReportJsonExport,
  buildWordDocument,
  documentHtml,
  downloadTextFile,
  printDocument,
} from "../../lib/reports/pdfExport";
import {
  ensureLocalDefault,
  getLocalDefault,
  saveLocalTemplate,
} from "../../lib/db/templateStore";

export function ReportActionsBar({
  modality = "radiography",
  userId = null,
  draft,
}: {
  modality?: ReportModality;
  userId?: string | null;
  draft: string;
}) {
  const [showTemplate, setShowTemplate] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

  const template = useMemo<ReportTemplateData>(
    () => getLocalDefault(modality, userId)?.data ?? ensureLocalDefault(modality, userId).data,
    [modality, userId],
  );

  const handleExport = (kind: "pdf" | "word" | "json") => {
    const rendered = renderDocument(
      modality,
      draft.trim().length > 0 ? { findings: { draft: draft.slice(0, 4000) } } : {},
      template,
    );
    const date = new Date();
    if (kind === "pdf") {
      printDocument(documentHtml(rendered));
    } else if (kind === "word") {
      downloadTextFile(
        buildReportFilename(modality, date, "doc"),
        buildWordDocument(rendered),
        "application/msword",
      );
    } else {
      downloadTextFile(
        buildReportFilename(modality, date, "json"),
        JSON.stringify(buildReportJsonExport(rendered, draft), null, 2),
        "application/json",
      );
    }
    setExportOpen(false);
  };

  return (
    <div className="relative flex items-center gap-2">
      <button
        type="button"
        data-attr="report-template"
        title="Template — personnaliser le document"
        onClick={() => setShowTemplate(true)}
        className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-btn text-ink-2 transition-colors duration-150 ease-out hover:bg-hover hover:text-ink"
      >
        <LayoutTemplate size={15} strokeWidth={2} />
      </button>

      <div ref={exportRef} className="relative">
        <button
          type="button"
          data-attr="report-export"
          title="Exporter (PDF / Word / JSON)"
          onClick={() => setExportOpen((v) => !v)}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-btn text-ink-2 transition-colors duration-150 ease-out hover:bg-hover hover:text-ink"
        >
          <Download size={15} strokeWidth={2} />
        </button>
        {exportOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setExportOpen(false)} />
            <div className="absolute right-0 top-full z-50 mt-1.5 min-w-[150px] overflow-hidden rounded-xl border border-border bg-panel shadow-2xl shadow-black/50">
              <button type="button"
                        onClick={() => handleExport("pdf")}
                        className="block w-full px-2.5 py-1.5 text-left text-[11px] text-ink-2 transition-colors hover:bg-hover hover:text-ink"
                      >
                        PDF · Enregistrer en PDF
                      </button>
              <button type="button"
                        onClick={() => handleExport("word")}
                        className="block w-full px-2.5 py-1.5 text-left text-[11px] text-ink-2 transition-colors hover:bg-hover hover:text-ink"
                      >
                        Word · .doc
                      </button>
              <button type="button"
                        onClick={() => handleExport("json")}
                        className="block w-full px-2.5 py-1.5 text-left text-[11px] text-ink-2 transition-colors hover:bg-hover hover:text-ink"
                      >
                        JSON · structuré
                      </button>
            </div>
          </>
        )}
      </div>

      {showTemplate && (
        <TemplateBuilderModal modality={modality} userId={userId} draft={draft} onClose={() => setShowTemplate(false)} />
      )}
    </div>
  );
}

/* ------------------------------ Petit utilitaire ------------------------------ */

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const BLOCK_DEFAULT_TEXT: Record<TemplateBlockKind, string> = {
  heading: "Titre du document",
  paragraph: "Paragraphe de texte…",
  variable: "{{patientName}}",
  divider: "",
};
/* ============================== Modal Builder de template ============================== */

function TemplateBuilderModal({
  modality,
  userId,
  draft,
  onClose,
}: {
  modality: ReportModality;
  userId: string | null;
  draft: string;
  onClose: () => void;
}) {
  const [, force] = useState(0);
  const template =
    getLocalDefault(modality, userId)?.data ?? ensureLocalDefault(modality, userId).data;
  const update = (next: ReportTemplateData) => {
    saveLocalTemplate({ userId, name: `${modality}-template`, modality, data: next });
    force((v) => v + 1);
  };

  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [newVar, setNewVar] = useState<{ key: string; label: string; value: string }>({
    key: "",
    label: "",
    value: "",
  });

  const blocks = template.customBlocks;
  const variables = template.variables;

  const insertBlock = (kind: TemplateBlockKind, afterId: string | null = null) => {
    const block: TemplateBlock = {
      id: newId(),
      kind,
      text: BLOCK_DEFAULT_TEXT[kind],
      visible: true,
    };
    const next = [...blocks];
    const idx = afterId === null ? -1 : next.findIndex((b) => b.id === afterId);
    if (idx >= 0) next.splice(idx + 1, 0, block);
    else next.push(block);
    update({ ...template, customBlocks: next });
  };

  const moveBlock = (blockId: string, afterId: string | null) => {
    const next = [...blocks];
    const fromIdx = next.findIndex((b) => b.id === blockId);
    if (fromIdx < 0) return;
    const [moved] = next.splice(fromIdx, 1);
    let toIdx = afterId === null ? -1 : next.findIndex((b) => b.id === afterId);
    const insertAt = toIdx < 0 ? next.length : toIdx + 1;
    next.splice(insertAt, 0, moved);
    update({ ...template, customBlocks: next });
  };

  const onDrop = (e: React.DragEvent, afterId: string | null) => {
    e.preventDefault();
    const kind = e.dataTransfer.getData("text/block-kind") as TemplateBlockKind | "";
    const blockId = e.dataTransfer.getData("text/block-id");
    if (kind) insertBlock(kind, afterId);
    else if (blockId) moveBlock(blockId, afterId);
    setDragOverId(null);
  };

  const addVariable = () => {
    const key = newVar.key.trim();
    if (!key) return;
    const next: TemplateVariable[] = [...variables, { ...newVar, key, visible: true }];
    update({ ...template, variables: next });
    setNewVar({ key: "", label: "", value: "" });
  };

  const structured =
    draft.trim().length > 0
      ? { findings: { draft: draft.slice(0, 4000) }, note: "Contenu édité par le praticien." }
      : {};

  const previewHtml = useMemo(
    () => documentHtml(renderDocument(modality, structured, template)),
    [modality, draft, template],
  );

  const blockPalette: { kind: TemplateBlockKind; label: string; icon: LucideIcon }[] = [
    { kind: "heading", label: "Titre", icon: Heading2 },
    { kind: "paragraph", label: "Paragraphe", icon: Type },
    { kind: "variable", label: "Variable", icon: Braces },
    { kind: "divider", label: "Séparateur", icon: Minus },
  ];

  return (
    <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/60 p-6">
      <div className="flex h-[88vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-border bg-panel shadow-2xl">
        {/* En-tête */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-ink">
            <LayoutTemplate size={14} strokeWidth={2} />
            Template — {modality}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => update(defaultTemplateData(modality))}
              className="rounded-md border border-border px-2 py-1 text-[11px] text-ink-3 transition-colors hover:bg-hover hover:text-ink"
            >
              Réinitialiser
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border px-2 py-1 text-[11px] text-ink-3 transition-colors hover:bg-hover hover:text-ink"
            >
              Fermer
            </button>
          </div>
        </div>
{/* Corps : éditeur (blocs/variables) + aperçu live */}
        <div className="grid min-h-0 flex-1 grid-cols-[1fr_1.1fr] gap-3 overflow-hidden p-3">
          {/* ——— Colonne d'édition ——— */}
          <div className="min-h-0 space-y-3 overflow-y-auto pr-1">
            {/* Palettes de blocs */}
            <div className="rounded-lg border border-border bg-canvas/30 p-2">
              <p className="mb-1.5 text-[10.5px] font-medium uppercase tracking-wide text-ink-3">
                Ajouter un bloc — glissez ou cliquez
              </p>
              <div className="flex flex-wrap gap-1.5">
                {blockPalette.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.kind}
                      type="button"
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/block-kind", item.kind);
                        e.dataTransfer.effectAllowed = "copy";
                      }}
                      onClick={() => insertBlock(item.kind)}
                      className="flex items-center gap-1.5 rounded-md border border-border bg-btn px-2 py-1 text-[11px] text-ink-2 transition-colors hover:bg-hover hover:text-ink"
                    >
                      <Icon size={12} />
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Liste des blocs (drag & drop de réordonnancement) */}
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => onDrop(e, null)}
              className="space-y-1.5 rounded-lg border border-border bg-canvas/30 p-2"
            >
              <p className="text-[10.5px] font-medium uppercase tracking-wide text-ink-3">
                Document — {blocks.length} bloc{blocks.length > 1 ? "s" : ""}
              </p>
              {blocks.length === 0 && (
                <p className="rounded-md border border-dashed border-border px-2 py-4 text-center text-[11px] text-ink-3">
                  Aucun bloc — ajoutez-en depuis la palette ci-dessus.
                </p>
              )}
              {blocks.map((block) => (
                <div
                  key={block.id}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOverId(block.id);
                  }}
                  onDragLeave={() => setDragOverId((id) => (id === block.id ? null : id))}
                  onDrop={(e) => onDrop(e, block.id)}
                  className={`group flex items-center gap-1.5 rounded-md border bg-panel px-1.5 py-1 transition-colors ${
                    dragOverId === block.id ? "border-accent bg-accent/10" : "border-border"
                  } ${!block.visible ? "opacity-55" : ""}`}
                >
                  <span
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/block-id", block.id);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    title="Déplacer"
                    className="cursor-grab text-icon active:cursor-grabbing"
                  >
                    <GripVertical size={13} />
                  </span>
                  <span className="text-icon">
                    {block.kind === "heading" ? <Heading2 size={13} /> : block.kind === "variable" ? <Braces size={13} /> : block.kind === "divider" ? <Minus size={13} /> : <Type size={13} />}
                  </span>
                  <input
                    value={block.text}
                    onChange={(e) =>
                      update({
                        ...template,
                        customBlocks: blocks.map((b) => (b.id === block.id ? { ...b, text: e.target.value } : b)),
                      })
                    }
                    placeholder={block.kind === "variable" ? "{{maVariable}}" : "Texte du bloc"}
                    className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-[11.5px] text-ink outline-none focus:border-accent/50"
                  />
                  <button
                    type="button"
                    data-attr={`template-block-vis-${block.id}`}
                    title={block.visible ? "Masquer" : "Afficher"}
                    onClick={() =>
                      update({
                        ...template,
                        customBlocks: blocks.map((b) => (b.id === block.id ? { ...b, visible: !b.visible } : b)),
                      })
                    }
                    className="text-icon transition-colors hover:text-ink"
                  >
                    <Eye size={13} />
                  </button>
                  <button
                    type="button"
                    data-attr={`template-block-del-${block.id}`}
                    title="Supprimer"
                    onClick={() =>
                      update({ ...template, customBlocks: blocks.filter((b) => b.id !== block.id) })
                    }
                    className="text-icon transition-colors hover:text-red-400"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
{/* ————— Variables personnalisables ————— */}
            <div className="rounded-lg border border-border bg-canvas/30 p-2">
              <p className="mb-1.5 text-[10.5px] font-medium uppercase tracking-wide text-ink-3">
                Variables — utilisez {'{{clé}}'} dans les blocs
              </p>
              <div className="space-y-1.5">
                {template.variables.map((variable) => (
                  <div key={variable.key} className="grid grid-cols-[1fr_1fr] gap-1.5">
                    <input
                      value={variable.key}
                      onChange={(e) =>
                        update({
                          ...template,
                          variables: template.variables.map((v) =>
                            v.key === variable.key ? { ...v, key: e.target.value } : v,
                          ),
                        })
                      }
                      className="rounded border border-border bg-btn px-1.5 py-1 text-[11px] text-accent outline-none focus:border-accent/60"
                    />
                    <input
                      value={variable.value}
                      onChange={(e) =>
                        update({
                          ...template,
                          variables: template.variables.map((v) =>
                            v.key === variable.key ? { ...v, value: e.target.value } : v,
                          ),
                        })
                      }
                      className="rounded border border-border bg-btn px-1.5 py-1 text-[11px] text-ink outline-none focus:border-accent/60"
                    />
                  </div>
                ))}
              </div>
              <div className="mt-1.5 rounded-md border border-dashed border-border bg-btn/40 p-1.5">
                <div className="mb-1 text-[10.5px] text-ink-3">Nouvelle variable</div>
                <div className="flex items-center gap-1">
                  <input
                    value={newVar.key}
                    onChange={(e) => setNewVar((v) => ({ ...v, key: e.target.value }))}
                    placeholder="clé"
                    className="w-16 rounded border border-border bg-panel px-1 py-1 text-[11px] text-ink outline-none focus:border-accent/60"
                  />
                  <input
                    value={newVar.value}
                    onChange={(e) => setNewVar((v) => ({ ...v, value: e.target.value }))}
                    placeholder="valeur par défaut"
                    className="min-w-0 flex-1 rounded border border-border bg-panel px-1 py-1 text-[11px] text-ink outline-none focus:border-accent/60"
                  />
                  <button
                    type="button"
                    data-attr="template-variable-add"
                    onClick={addVariable}
                    disabled={!newVar.key.trim()}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-accent/40 bg-accent/15 text-accent transition-colors hover:bg-accent/25 disabled:cursor-default disabled:opacity-40"
                  >
                    <Plus size={12} />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* ——— Aperçu live ——— */}
      <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-white">
        <div className="flex items-center gap-2 border-b border-neutral-200 px-3 py-1.5">
          <Eye size={12} className="text-neutral-500" />
          <span className="text-[11px] font-medium text-neutral-700">
            Aperçu A4 — fidèle à l'impression
          </span>
        </div>
        <iframe
          title="template-preview"
          srcDoc={previewHtml}
          className="min-h-0 w-full flex-1 bg-white"
        />
      </div>
    </div>
  </div>
</div>
);
}
