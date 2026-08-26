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

function formRow(label: string, value: string | undefined): string {
  const v = (value ?? "").trim();
  return `<div class="form-row"><span class="form-label">${escapeHtml(label)} :</span><span class="form-value">${v.length > 0 ? escapeHtml(v) : ""}</span></div>`;
}

/** Génère le HTML A4 complet du document (preview === print === export). */
export function documentHtml(document: RenderedDocument): string {
  const t = document.template;
  const sections = visibleSections(document)
    .map(
      (section) => `
      <section class="report-section" data-section-id="${escapeHtml(section.id)}">
        <h2>${escapeHtml(section.title)}</h2>
        <ul class="report-list">${section.lines.map((line) => lineToHtml(line)).join("")}</ul>
      </section>`,
    )
    .join("\n");

  /* En-tête bilingue façon administration (République/Ministère/Hôpital de part
     et d'autre du logo centré) : actif seulement si le template renseigne au
     moins une des deux colonnes, sinon en-tête simple inchangé (rétrocompat). */
  const hasLetterhead = t.header.letterheadLinesLeft.length > 0 || t.header.letterheadLinesRight.length > 0;
  const headerBlock = t.header.visible
    ? hasLetterhead
      ? `<header class="report-header letterhead-header">
          <div class="letterhead-grid">
            <div class="letterhead-col left">
              ${t.header.letterheadLinesLeft.map((line) => `<div>${escapeHtml(line)}</div>`).join("")}
            </div>
            <div class="letterhead-logo">
              ${t.header.logoPath !== null ? `<img class="logo" src="${escapeHtml(t.header.logoPath)}" alt="logo"/>` : ""}
              ${t.header.organizationName.length > 0 ? `<div class="org-name-small">${escapeHtml(t.header.organizationName)}</div>` : ""}
            </div>
            <div class="letterhead-col right">
              ${t.header.letterheadLinesRight.map((line) => `<div>${escapeHtml(line)}</div>`).join("")}
            </div>
          </div>
        </header>`
      : `<header class="report-header" style="text-align:${t.header.align}">
          <div class="letterhead">
            ${t.header.logoPath !== null ? `<img class="logo" src="${escapeHtml(t.header.logoPath)}" alt="logo"/>` : ""}
            ${t.header.organizationName.length > 0 ? `<div class="org-name">${escapeHtml(t.header.organizationName)}</div>` : ""}
            ${t.header.subtitle !== null && t.header.subtitle.length > 0 ? `<div class="org-sub">${escapeHtml(t.header.subtitle)}</div>` : ""}
            <div class="org-coord muted">
              ${[t.header.address, t.header.phone, t.header.email].filter(Boolean).map((value) => `<span>${escapeHtml(value!)}</span>`).join("")}
            </div>
          </div>
        </header>`
    : "";

  const titleBlock = `<div class="doc-title official">
      <h1 class="official-title">${escapeHtml(
        t.header.documentTitle !== null && t.header.documentTitle.length > 0
          ? t.header.documentTitle
          : "RAPPORT D'EXAMEN",
      )}</h1>
    </div>`;

  const meta = document.tokenValues ?? {};
  /* Bloc identification façon formulaire hospitalier : Nom et Prénom / Sexe /
     Indication / Prescripteur / Type d'examen en colonne gauche, Age / Date en
     colonne droite. Le bloc est toujours affiché (comme un formulaire papier) :
     les valeurs par défaut (tirets) restent visibles tant que la donnée n'a pas
     été saisie, jamais de « — » de substitution. */
  const metaBlock = `<div class="exam-info-grid">
      <div class="exam-info-col">
        ${formRow("Nom et Prénom", meta.patientName)}
        ${formRow("Sexe", meta.sex)}
        ${formRow("Indication", meta.indication)}
        ${formRow("Prescripteur", meta.examinerName)}
        ${formRow("Type d'examen", meta.study)}
      </div>
      <div class="exam-info-col">
        ${formRow("Age", meta.age)}
        ${formRow("Date", meta.examDate)}
      </div>
    </div>`;

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
  h2 { font-size: 1.02em; margin: 18px 0 8px; color: ${t.accentColor};
       text-transform: uppercase; letter-spacing: 0.5px; text-align: center;
       text-decoration: underline; text-underline-offset: 3px; font-weight: 700; }
  h3.custom-heading { font-size: 1em; margin: 14px 0 4px; color: ${t.accentColor}; }
  ul { margin: 0; padding-left: 0; list-style: none; }
  li { margin-bottom: 3px; padding-left: 14px; position: relative; }
  li::before { content: "-"; position: absolute; left: 0; color: ${t.accentColor}; opacity: 0.85; font-weight: 700; }
  li.field::before { content: none; }
  /* Conclusion/Impression : puce losange façon compte-rendu hospitalier. */
  .report-section[data-section-id="conclusion"] li::before,
  .report-section[data-section-id="impression"] li::before { content: "\\2756"; }
  .report-list li.field { display: flex; gap: 12px; padding-left: 0; }
  .field-key { flex: 0 0 42%; font-size: 0.92em; color: #565c6e; }
  .field-value { flex: 1 1 auto; font-weight: 500; }
  .report-section { break-inside: avoid; }
  /* Document hospitalier : aucun trait coloré sous l'en-tête ni sous le titre. */
  .report-header { padding-bottom: 8px; margin-bottom: 4px; }
  .org-name { font-size: 1.35em; font-weight: 700; letter-spacing: 0.6px; }
  .org-sub { font-size: 0.95em; margin-top: 2px; }
  .org-coord { display: flex; gap: 14px; font-size: 0.85em; margin-top: 4px; }
  .logo { max-height: 220px; }
  /* En-tête bilingue façon administration : colonnes gauche/droite (fr/en…)
      centrées, encadrant le logo + nom d'organisation au centre. */
  .letterhead-grid { display: grid; grid-template-columns: 1fr auto 1fr; align-items: start;
                     gap: 10px; text-align: center; }
  .letterhead-col { font-size: 0.66em; line-height: 1.5; color: #333; text-align: center; }
  .letterhead-col div:first-child { font-weight: 700; }
  .letterhead-logo { text-align: center; padding: 0 8px; }
  .org-name-small { font-size: 0.78em; font-weight: 700; margin-top: 4px; letter-spacing: 0.2px; }
  .doc-title { margin: 16px 0 10px; }
  /* Titre officiel façon formulaire imprimé (« RADIOGRAPHIE », centré, souligné). */
  .doc-title.official { text-align: center; }
  .official-title { font-size: 1.55em; font-weight: 800; text-decoration: underline;
                     text-underline-offset: 4px; letter-spacing: 0.6px; text-align: center; }
  /* Bloc identification façon formulaire papier : colonne gauche (identité,
     indication, prescripteur, type d'examen) et colonne droite (âge, date),
     aérées et alignées comme sur un imprimé d'hôpital. */
  .exam-info-grid { display: grid; grid-template-columns: 1.15fr 1fr; gap: 4px 40px;
                    margin: 16px 0 8px; }
  .exam-info-col { display: flex; flex-direction: column; gap: 4px; }
  .form-row { font-size: 0.95em; }
  .form-label { font-weight: 700; margin-right: 6px; }
  .muted { color: #667; font-size: 0.86em; }
  .doc-divider { border: none; border-top: 1px solid ${t.accentColor}44; margin: 14px 0; }
  .signature { margin-top: 30px; padding-top: 10px; border-top: 1px solid #e2e2ee; }
  .signature.pos-center { text-align: center; } .signature.pos-right { text-align: right; }
  .signature .sig-name { font-weight: 700; font-size: 1.05em; }
  .sig-img { max-height: 60px; display: block; margin-bottom: 2px; }
  .report-footer { margin-top: 34px; padding-top: 8px; border-top: 1px solid #d8d8e4;
                   display: flex; justify-content: space-between; font-size: 0.8em; }
  @media print { .no-print { display: none; } }
</style></head>
<body>
  ${headerBlock}
  ${titleBlock}
  ${metaBlock}
  ${customBlocks}
  ${sections}
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