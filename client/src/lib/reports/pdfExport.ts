/**
 * Pipeline d'export PDF/Word/JSON — INSTRUCTIONS.md §26-§30.
 *
 * UN SEUL renderer : le modèle du document du ReportEngine est converti en
 * HTML A4 paginé façon document d'hôpital (en-tête lettre, mentions patient,
 * sections numérotées, signataire, pied de page) utilisé à la fois par :
 *   - la preview live (iframe srcdoc) ;
 *   - l'impression / « Enregistrer en PDF » (moteur natif sans dépendance) ;
 *   - l'export Word (.doc HTML avec namespace Word) ;
 *   - l'export JSON structuré.
 *
 * Le nom de fichier est stable et sans donnée sensible (§29) :
 * AImaging_<Modality>_<YYYY-MM-DD>.<ext>
 */

import type { RenderedDocument } from "./engine";
import { visibleSections } from "./engine";

export function buildReportFilename(modality: string, date = new Date(), extension = "pdf"): string {
  const label =
    modality === "fetal_ultrasound"
      ? "Fetal_Ultrasound"
      : modality === "radiography"
        ? "Radiography"
        : "Report";
  const iso = date.toISOString().slice(0, 10);
  return `AImaging_${label}_${iso}.${extension}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function lineToHtml(line: string): string {
  /* Rendu « champ : valeur » d'hôpital : la clé ressort grisée, la valeur noire. */
  const colon = line.indexOf(":");
  if (colon > 0 && colon < 40) {
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (key.length > 0 && value.length > 0) {
      return `<li class="field"><span class="field-key">${escapeHtml(key)}</span><span class="field-value">${escapeHtml(value)}</span></li>`;
    }
  }
  return `<li>${escapeHtml(line)}</li>`;
}

function vline(value: string): string {
  const plain = value.replace(/_/g, " ").trim();
  return `<div class="meta-value">${escapeHtml(plain.length > 0 ? value : "\u2014")}</div>`;
}

/** Génère le HTML A4 complet du document (preview === print === export). */
export function documentHtml(document: RenderedDocument): string {
  const t = document.template;
  const sections = visibleSections(document)
    .map(
      (section, index) => `
      <section class="report-section">
        <h2><span class="sec-num">${index + 1}.</span> ${escapeHtml(section.title)}</h2>
        <ul class="report-list">${section.lines.map((line) => lineToHtml(line)).join("")}</ul>
      </section>`,
    )
    .join("\n");

  const headerBlock = t.header.visible
    ? `<header class="report-header" style="text-align:${t.header.align}">
        <div class="letterhead">
          ${t.header.logoPath !== null ? `<img class="logo" src="${escapeHtml(t.header.logoPath)}" alt="logo"/>` : ""}
          <div class="org-name">${escapeHtml(t.header.organizationName || "ÉTABLISSEMENT DE SANTÉ")}</div>
          ${t.header.subtitle !== null && t.header.subtitle.length > 0 ? `<div class="org-sub">${escapeHtml(t.header.subtitle)}</div>` : ""}
          <div class="org-coord muted">
            ${[t.header.address, t.header.phone, t.header.email].filter(Boolean).map((value) => `<span>${escapeHtml(value!)}</span>`).join("")}
          </div>
        </div>
      </header>`
    : "";

  const meta = document.tokenValues ?? {};
  const metaCells: string[] = [];
  if (meta.patientName) metaCells.push(`<div class="meta-cell"><span class="meta-label">Patient</span>${vline(meta.patientName)}</div>`);
  if (meta.examDate) metaCells.push(`<div class="meta-cell"><span class="meta-label">Date</span>${vline(meta.examDate)}</div>`);
  if (meta.examId) metaCells.push(`<div class="meta-cell"><span class="meta-label">N° examen</span>${vline(meta.examId)}</div>`);
  if (meta.examinerName) metaCells.push(`<div class="meta-cell"><span class="meta-label">Médecin</span>${vline(meta.examinerName)}</div>`);
  const metaBlock = metaCells.length > 0 ? `<div class="meta-row">${metaCells.join("")}</div>` : "";

  const customBlocks = (document.blocks ?? []).map((block) => block.html).join("\n");

  const signatureBlock = t.signature.visible
    ? `<footer class="signature pos-${t.signature.position}">
        ${t.signature.imagePath !== null ? `<img class="sig-img" src="${escapeHtml(t.signature.imagePath)}" alt="signature"/>` : ""}
        ${t.signature.name !== null && t.signature.name.length > 0 ? `<div class="sig-name">${escapeHtml(t.signature.name)}</div>` : ""}
        ${t.signature.role !== null && t.signature.role.length > 0 ? `<div class="muted">${escapeHtml(t.signature.role)}</div>` : ""}
      </footer>`
    : "";

  const footerText = t.footer.visible
    ? `<footer class="report-footer muted">
        ${t.footer.showDate ? `<span>${new Date().toLocaleDateString("fr-FR")}</span>` : ""}
        ${t.footer.text !== null && t.footer.text.length > 0 ? `<span>${escapeHtml(t.footer.text)}</span>` : ""}
        <span class="confidential">Document confidentiel — réservé aux professionnels habilités</span>
      </footer>`
    : "";
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"/>
<style>
  @page { size: A4 ${t.page.orientation}; margin: ${t.page.marginsMm.top}mm ${t.page.marginsMm.right}mm ${t.page.marginsMm.bottom}mm ${t.page.marginsMm.left}mm; }
  * { box-sizing: border-box; }
  body { font-family: ${t.typography.fontFamily}; font-size: ${t.typography.fontSizePt}pt;
         line-height: ${t.typography.lineHeight}; color: ${t.typography.color}; margin: 0; padding: 0; }
  h1 { font-size: 1.4em; margin: 0; letter-spacing: 0.2px; }
  h2 { font-size: 1em; margin: 16px 0 6px; color: ${t.accentColor};
       text-transform: uppercase; letter-spacing: 0.4px; }
  h3.custom-heading { font-size: 1em; margin: 14px 0 4px; color: ${t.accentColor}; }
  .sec-num { color: ${t.accentColor}; font-weight: 700; margin-right: 6px; }
  ul { margin: 0; padding-left: 0; list-style: none; }
  li { margin-bottom: 3px; padding-left: 14px; position: relative; }
  li::before { content: "•"; position: absolute; left: 0; color: ${t.accentColor}; opacity: 0.65; }
  li.field::before { content: none; }
  .report-list li.field { display: flex; gap: 12px; padding-left: 0; }
  .field-key { flex: 0 0 42%; font-size: 0.92em; color: #565c6e; }
  .field-value { flex: 1 1 auto; font-weight: 500; }
  .report-section { break-inside: avoid; }
  .report-header { border-bottom: 2.5px solid ${t.accentColor}; padding-bottom: 8px; margin-bottom: 4px; }
  .org-name { font-size: 1.35em; font-weight: 700; letter-spacing: 0.6px; }
  .org-sub { font-size: 0.95em; margin-top: 2px; }
  .org-coord { display: flex; gap: 14px; font-size: 0.85em; margin-top: 4px; }
  .logo { max-height: 52px; }
  .doc-title { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between;
               gap: 8px; margin: 12px 0 4px; padding-bottom: 8px;
               border-bottom: 1px solid ${t.accentColor}55; }
  .ai-badge { display:inline-block; border:1px solid #f59e0b55; background:#f59e0b15;
              color:#92400e; padding:2px 10px; border-radius:999px; font-size:0.72em;
              font-weight:600; letter-spacing:0.3px; }
  .meta-row { display: table; width: 100%; margin: 10px 0 2px; }
  .meta-cell { display: table-cell; padding: 6px 12px 6px 0; vertical-align: top;
               border-right: 1px solid #e4e4ef; }
  .meta-cell:last-child { border-right: none; }
  .meta-label { display: block; font-size: 0.72em; text-transform: uppercase;
                letter-spacing: 0.5px; color: #8a8aa0; margin-bottom: 2px; }
  .meta-value { font-weight: 600; }
  .muted { color: #667; font-size: 0.86em; }
  .doc-divider { border: none; border-top: 1px solid ${t.accentColor}44; margin: 14px 0; }
  .signature { margin-top: 30px; padding-top: 10px; border-top: 1px solid #e2e2ee; }
  .signature.pos-center { text-align: center; } .signature.pos-right { text-align: right; }
  .signature .sig-name { font-weight: 700; font-size: 1.05em; }
  .sig-img { max-height: 60px; display: block; margin-bottom: 2px; }
  .report-footer { margin-top: 34px; padding-top: 8px; border-top: 1px solid #d8d8e4;
                   display: flex; justify-content: space-between; font-size: 0.8em; }
  .report-footer .confidential { font-style: italic; }
  @media print { .no-print { display: none; } }
</style></head>
<body>
  ${headerBlock}
  <div class="doc-title">
    <h1>Rapport d'examen — ${escapeHtml(document.modality)}
      <span class="ai-badge">Assisté IA · à relire</span>
    </h1>
  </div>
  ${metaBlock}
  ${customBlocks}
  ${sections}
  ${signatureBlock}
  ${footerText}
</body></html>`;
}

/**
 * Export Word : HTML avec namespace Word + styles mso ; le fichier s'ouvre
 * dans Word comme un document .doc (mise en page conservée).
 */
export function buildWordDocument(document: RenderedDocument): string {
  const html = documentHtml(document);
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office"
                xmlns:w="urn:schemas-microsoft-com:office:word"
                xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"/>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->
</head>
<body>${html.replace(/^<!doctype html>/, "").replace(/<html.*?>/i, "").replace(/<head>.*?<\/head>/is, "")}</body></html>`;
}

/** Export JSON structuré : template + sections + texte complet + horodatage. */
export function buildReportJsonExport(
  document: RenderedDocument,
  rawText: string,
): { app: string; kind: string; exportedAt: string; modality: string; template: unknown; sections: unknown[]; text: string } {
  return {
    app: "AImaging",
    kind: "report-export",
    exportedAt: new Date().toISOString(),
    modality: document.modality,
    template: document.template,
    sections: visibleSections(document),
    text: rawText,
  };
}

/**
 * Télécharge un fichier texte/blob côté navigateur.
 * Utilisé par le menu déroulant PDF / Word / JSON.
 */
export function downloadTextFile(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Imprime / génère le PDF via le moteur natif du navigateur dans un iframe
 * caché (l'utilisateur choisit « Enregistrer au format PDF »).
 */
export function printDocument(html: string): void {
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument;
  if (doc === null) throw new Error("[reports] Impossible de créer l'iframe d'impression.");
  doc.open();
  doc.write(html);
  doc.close();
  iframe.contentWindow?.focus();
  iframe.contentWindow?.print();
  window.setTimeout(() => iframe.remove(), 1000);
}
