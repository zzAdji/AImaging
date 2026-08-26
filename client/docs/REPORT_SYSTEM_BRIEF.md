# BRIEF DE RÉÉCRITURE — Système de Rapport AImaging (client)

> Ce document décrit EXHAUSTIVEMENT
> le système de rapport de l'application client (`client/src`) : collecte des données,
> traitement, personnalisation (templates), édition et impression/export.
> Il énumère chaque fichier concerné, ses spécifications, les structures de données
> et les personnalisations supportées, puis la liste **des défauts connus à corriger**
> lors de la réécriture. Toute valeur affichée dans un rapport doit être une donnée
> réellement collectée : **aucune valeur inventée** (règle transversale du projet).

L'objectif est de réécrire le rapport et son template pour qu'il soit exactement comme l'image
du rapport officiel de l'hopital

---

## 1. Vue d'ensemble du pipeline

```
┌────────────────────────── COLLECTE ──────────────────────────┐
│ Analyse IA (ensemble local + backend Neuro)                  │
│   → aiResults.diagnostics / report                           │
│ Mesures (landmarks HybridGNet/CXAS posées sur le canvas)     │
│ Métadonnées DICOM (ExamImageMetadata)                        │
│ Infos patient éditables (PatientInfo — carte « Document »)   │
└──────────────────────────────┬───────────────────────────────┘
                               ▼
┌────────────────────────── TRAITEMENT ────────────────────────┐
│ Génération LLM : POST /radiography/report (Gemini côté       │
│   backend) → { report, coherence_*, rendered_text }          │
│ Persistance DB : table reports (statut needs_review…)        │
│ Moteur local : renderDocument(modality, data, template)      │
└──────────────────────────────┬───────────────────────────────┘
                               ▼
┌────────────────────── PERSONNALISATION (template) ───────────┐
│ TemplateBuilderModal : blocs libres, variables {{token}},    │
│   en-tête organisation, pied de page, signature, page A4,    │
│   typographie, couleur accent — stockés localStorage ou DB.  │
└──────────────────────────────┬───────────────────────────────┘
                               ▼
┌──────────────────── ÉDITION / IMPRESSION / EXPORT ───────────┤
│ ReportEditorModal (textarea) · printDocument (PDF navigateur)│
│ Word .doc · JSON structuré                                   │
└──────────────────────────────────────────────────────────────┘
```

---

## 2. Inventaire exhaustif des fichiers concernés

### 2.1 État applicatif (React)

#### `client/src/state/workspace.ts`

- **`interface AiResults`** (~ligne 393) : résultat IA exposé aux panneaux.
  - `diagnostics: AiDiagnosis[]` (label, prob, severity low/medium/high, region optionnelle)
  - `report: string | null` — texte du rapport courant (généré puis édité)
  - `modelName`, `modelCount`, `lastWarnings`, `lastLimitations`…
- **`interface PatientInfo`** (~ligne 408) : **infos patient éditables**, source de vérité
  de la carte « Document », injectées dans les rapports :

  | Champ | Token associé | Pré-remplissage DICOM |
  |---|---|---|
  | `name` | `{{patientName}}` | `patientPseudonym` |
  | `patientId` | `{{patientId}}` | — |
  | `age` | `{{age}}` (combiné `{{ageSex}}`) | — |
  | `sex` | `{{sex}}` (M/F, combiné `{{ageSex}}`) | — |
  | `studyDate` | `{{examDate}}` | `studyDate` |
  | `modality` | `{{modality}}` | `modality` |
  | `study` | `{{study}}` | `bodyPartExamined` + `viewPosition`, sinon `studyDescription` |

- **`WorkspaceState`** expose : `reportEditOpen`, `reportDraft`, `setReportDraft`,
  `openReportEditor()`, `saveReportDraft()`, `radioReportValidated`,
  `validateRadioReport()`, `patientInfo`, `setPatientInfo(patch)`.

#### `client/src/state/WorkspaceProvider.tsx`

- **État rapport** (~lignes 1120–1220) :
  - `radioReport` : `{ id, status: "draft"|"generated"|"needs_review"|"validated" } | null`.
  - Effet de chargement : au montage d'un examen persisté, `loadLatestRadioReport()` →
    hydrate `aiResults.report` si vide + `radioReport`.
  - Effet de génération : quand `aiResults.report` change et diffère du dernier texte
    persisté → `persistGeneratedRadioReport(...)` crée un NOUVEAU report `needs_review`
    avec `structured_data` (classe ensemble, nb modèles, findings, limitations,
    `source_analysis_runs`).
  - `validateRadioReport()` : passage explicite en `validated` (jamais automatique).
  - `openReportEditor()` / `saveReportDraft()` : commit du draft dans `aiResults.report`
    + update débounced (800 ms) via `persistReportEdit()` ; éditer un rapport validé le
    repasse en `needs_review`.
- **État patient** (~lignes 602–629) :
  - `patientInfo` initialisé `{ studyDate: aujourd'hui, modality: "CR", study: "CHEST PA" }`.
  - `setPatientInfo(patch)` : fusion partielle.
  - Effet de pré-remplissage depuis `imageMetadata` (DICOM) — **ne remplace jamais**
    un champ déjà saisi par le praticien.

### 2.2 Collecte des données (côté app)

#### `client/src/App.tsx` (résolveur de commandes IA, ~lignes 620–735)

- Voie conversationnelle (`requestTurn`) et voie commandes explicites (`@report`).
- Action plan `generate_report` : **non exécutable localement** ; convertie en
  `replace_report` après appel réussi à `generateRadiographyReport(current.prediction)`.
  - Succès → `warnings += coherence_issues`, texte = `rendered_text`.
  - Échec Gemini → action retirée du plan + warning « Rapport non généré… »
    (**mode dégradé : aucune fausse revendication, aucun rapport inventé**).
- Sans prédiction disponible → warning « Lancez d'abord une analyse. »

#### `client/src/lib/workspaceApi.ts`

- `interface PatientReportContext { nom_prenom: string; prescripteur?: string; date_examen?: string }` (~ligne 206).
- `interface RadiographyReportResponse { report: Record<string,string>; coherence_passed: boolean; coherence_issues: string[]; rendered_text: string }` (~ligne 212).
- `generateRadiographyReport(prediction, patient)` → `POST /radiography/report`
  body `{ prediction, patient }` (~ligne 220). **⚠ Défaut actuel : les deux appels
  d'App.tsx omettent `patient` → le backend reçoit « Patient non renseigné ».**

#### `client/src/lib/examinations.ts`

- `ExamImageMetadata` : métadonnées DICOM réelles (`modality`, `patientPseudonym`,
  `bodyPartExamined`, `viewPosition`, `studyDate`, `studyDescription`, `pixelSpacingMm`,
  `windowCenter/Width`, …). Source du pré-remplissage `PatientInfo`.

### 2.3 Traitement / moteur de rendu

#### `client/src/lib/reports/engine.ts` (cœur du système)

Types principaux :

```ts
type ReportModality = "radiography" | "fetal_ultrasound" | "generic";

interface ReportTemplateData {
  page: { orientation: "portrait"|"landscape"; marginsMm: {top,right,bottom,left} };
  typography: { fontFamily; fontSizePt; lineHeight; color };
  accentColor: string;
  header: { organizationName; subtitle; address; phone; email; logoPath; visible };
  footer: { text; showDate; visible };
  signature: { name; role; imagePath; position: "left"|"center"|"right"; visible };
  sections: Array<{ id; title; enabled }>;
  variables: Array<{ key; label; value; visible }>;   // tokens {{key}}
  customBlocks: Array<{ id; kind:"heading"|"paragraph"|"variable"|"divider"; text; visible }>;
}

interface RadiographyReportInput {
  fields: Record<string,string>;        // champs structurés /radiography/report
  coherenceIssues: string[];
  renderedText?: string;
  ensemblePrediction?: string|null;
  numModels?: number|null;
  measurements?: Array<{ label; value:number|null; unit; source:"ai"|"user" }>;
}
```

Fonctions clés :
- `defaultTemplateData(modality)` : template intégré par modalité (sections FR radio vs fœtal).
- `normalizeTemplateData(template)` : réparation/fusion avec défauts.
- `buildRadiographyStructuredData(input)` : construit le `structured_data`
  (`findings`, `impression.ensemble_prediction`, `confidence: null` **jamais inventé**,
  `ai.{model_count, coherence_issues, assisted}`, `measurements`). **⚠ Actuellement
  défini mais JAMAIS appelé par l'UI d'export** (voir §4).
- `renderDocument(modality, data, template) → RenderedDocument` :
  `{ sections: RenderedSection[], headerFields, blocks (tokens substitués), tokenValues }`.
- `resolveBlocks(template, values)` : substitution `{{key}}` + conversion HTML des blocs libres.
- `substituteTokens(text, values)` : remplacement exact, token inconnu ⇒ conservé tel quel.

#### `client/src/lib/reports/pdfExport.ts`

- `documentHtml(rendered)` : page HTML autonome stylée (CSS inline) consommant
  `template.*` (page, typographie, accent, header org + logo `<img>`, footer,
  signature) + cellules meta d'en-tête pilotées par `tokenValues` :
  `patientName`, `examDate`, `examId`, `examinerName` (affichées si présentes).
- `printDocument(html)` : iframe caché → `window.print()` (PDF = « Enregistrer en PDF »
  navigateur). **Pas de génération PDF côté app.**
- `buildWordDocument(rendered)` : HTML-compatible Word exporté en `.doc`

### 2.4 Personnalisation (templates)

#### `client/src/components/ai/ReportToolsBar.tsx`

- Barre d'outils du rapport : bouton **Template** (ouvre `TemplateBuilderModal`),
  menu export **PDF / Word .doc / JSON structuré**.
- `TemplateBuilderModal` (même fichier, ~ligne 170+) :
  - charge le template par défaut de la modalité via `getLocalDefault` /
    `ensureLocalDefault` ;
  - **blocs libres** : heading / paragraph / variable / divider — ajout, suppression,
    visibilité (œil), glisser-déposer pour réordonner, texte éditable avec tokens `{{…}}` ;
  - **variables personnalisables** : clé/libellé/valeur, ajout/suppression ;
  - chaque modification est persistée immédiatement (`saveLocalTemplate`).

#### `client/src/lib/db/templateStore.ts`

- Persistance des templates avec repli local :
  - clé localStorage `aimaging.<uid>.reportTemplates` (legacy `aimaging.reportTemplates`) ;
  - invariant « **un seul défaut par modalité** » (`isDefault`) ;
  - `listLocalTemplates`, `getLocalDefault`, `saveLocalTemplate`, `deleteLocalTemplate`,
    `ensureLocalDefault` (crée le défaut intégré s'il manque), versioning `version++`.
- ⚠ `isRemoteTemplatesEnabled()` retourne **constamment `false`** (migration 0007 non
  activée) → tout passe par localStorage aujourd'hui.

#### `client/src/lib/db/repositories/reportTemplateRepository.ts`

- CRUD SQL prêt : `createTemplate`, `getTemplate`, `listTemplatesByModality`
  (défaut d'abord), `getDefaultTemplate`, `updateTemplate`, `deleteTemplate`.
- Table `report_templates` : JSONB validé côté app, unicité du défaut par
  (owner, modality) via index unique partiel.

### 2.5 Persistance des rapports (Supabase)

#### `client/src/lib/db/reportService.ts`

Règles métier (§ référencent SUITE.md interne) :
- types autorisés : `radiography_ai` | `fetal_obstetric` ;
- statuts : `draft → generated → needs_review → validated` ; **un rapport IA est
  TOUJOURS créé en `needs_review`, jamais `validated` automatiquement** ;
- génération IA = NOUVELLE ligne ; édition = update du rapport courant ;
- éditer un rapport validé le repasse en `needs_review` ;
- `structured_data` conserve les données réellement utilisées + traçabilité
  `source_analysis_runs` ;
- fonctions : `persistGeneratedRadioReport`, `persistReportEdit`,
  `validateReportById`, `loadLatestRadioReport`, `mapFetalExamToStructuredData`
  (pur mapping, non persisté tant que le provider fœtal est mocké),
  `uploadReportJsonExport` (bucket privé `reports/{…}/exports/`).

#### `client/src/lib/db/repositories/reportRepository.ts`

- CRUD table `reports` : `createReport`, `getReport`, `listReportsByExamination`
  (tri `updated_at desc`), `getLatestReport`, `updateReport`, `deleteReport`.

#### `client/src/lib/db/types.ts` (extraits)

```ts
type ReportRow = { id; examination_id; type; status; content: string|null;
                   structured_data: Json|null; storage_path: string|null;
                   created_by; created_at; updated_at };
type ReportInsert / ReportUpdate // patchs correspondants
// + Database["report_templates"] typé côté client
```

### 2.6 Interface utilisateur

#### `client/src/components/RightPanel.tsx`

- **`DocumentSection`** (carte « Document », ~lignes 258–460) :
  - vignette + renommage inline du document (`doc-name-input`, Enter/Escape) ;
  - **champs patient éditables** : liste `PATIENT_FIELDS`
    (`name→Patient`, `patientId→Patient ID`, `age→Age`, `sex→Sex`,
    `studyDate→Study date`, `modality→Modality`, `study→Study`) rendue par
    `PatientFieldRow` — clic sur la ligne = édition inline (Enter valide,
    Escape annule), style identique au renommage ; attributs E2E :
    `data-attr="doc-field-<Label>"` / `"doc-field-input-<Label>"` ;
  - sous-titre dérivé : `{modality} · {study}` ;
  - Export PNG annoté + Print image (fenêtre dédiée).
  - ⚠ Les anciennes valeurs codées en dur (« P-2048-71 », « ID-4821-993 »…) ont été
    supprimées : toute valeur vient de `w.patientInfo`.
- **`ReportSection`** (carte « Rapport », ~lignes 620–720) :
  - si `aiResults.report` vide → invite « Générez un rapport via @report » ;
  - sinon aperçu texte + boutons **Éditeur** (`openReportEditor`) et **Exporter** :
    - `handleExport(kind)` : template = défaut local (sinon `defaultTemplateData`),
      **injecte les tokens patient** (upsert par clé : `patientName`, `patientId`,
      `age`, `sex`, `ageSex`, `examDate`, `modality`, `study`) puis
      `renderDocument(modality, structured, withPatient)` ;
      `pdf` → `printDocument(documentHtml(rendered))` ; `word` → download `.doc` ;
      `json` → `JSON.stringify(buildReportJsonExport(...))`.
  - `structured` actuel = `{ findings: { draft: texte ≤ 4000 }, note }` (pauvre, cf. §4).

#### `client/src/components/ai/ReportEditor.tsx`

- `ReportEditorModal` : modale plein écran, textarea liée à `reportDraft`,
  compteur de caractères, Enregistrer (`saveReportDraft`) / Annuler, fermeture
  Échap. Montée depuis `App.tsx` (~ligne 1579).

#### `client/src/lib/reports/speechService.ts`

- Dictée du rapport : micro → MediaRecorder → transcription Gemini
  (`POST /voice/transcribe`), repli Web Speech API (fr-FR/en-US), messages
  d'erreur actionnables par navigateur. Transcription toujours proposée en
  preview, jamais appliquée directement.

### 2.7 Backend appelé (contrat, hors repo client)

- `POST /radiography/report` : body `{ prediction, patient: PatientReportContext }`
  → `{ report: Record<string,string>, coherence_passed, coherence_issues, rendered_text }`.
- `POST /voice/transcribe` : audio → texte.

---

## 3. Structures de données de référence

### 3.1 `reports.structured_data` (radiographie, écrit par `persistGeneratedRadioReport`)

```jsonc
{
  "diagnosis": { "class": "<ensemblePrediction>", "confidence": null },
  "models": { "count": <numModels>, "ensemble": true },
  "findings": { /* Record<string,string> renvoyé par /radiography/report */ },
  "limitations": [ /* coherence_issues */ ],
  "coherence_passed": true,
  "source_analysis_runs": ["<analysis_run_id>", "..."]
}
```


---

## 4. Défauts connus — OBJECTIFS DE LA RÉÉCRITURE

Classés par priorité. La structure de fichiers peut être conservée ou réorganisée,
mais **les règles métier (§2.5) et le contrat backend doivent rester inchangés**.

1. **Le rendu d'export ignore les données structurées.** `handleExport` n'envoie que
   `{ findings: { draft: <texte brut> } }` au moteur. Les diagnostics fusionnés
   (`mergeFindings` : probabilités, sévérités, régions), les mesures posées
   (`LandmarksMeasurements`), les résultats Grad-CAM et les métadonnées DICOM ne
   sont ni collectés ni mis en forme. → Construire un vrai `RadiographyReportInput`
   (déjà défini dans `engine.ts`, actuellement orphelin) et utiliser
   `buildRadiographyStructuredData` comme source unique de `structured_data` pour
   l'aperçu, le PDF, le Word et le JSON.
2. **Contexte patient non transmis à la génération LLM.** Les deux appels
   `generateRadiographyReport(current.prediction)` dans `App.tsx` omettent le
   2ᵉ argument. → Passer un `PatientReportContext` construit depuis
   `workspace.patientInfo` (`nom_prenom`, `prescripteur`, `date_examen`).
3. **Décalage template ↔ contenu.** `rendered_text` (texto plat du backend) est
   affiché tel quel ; les `sections` du template ne pilotent pas le contenu réel.
   → Mapper chaque section activée du template vers une brique de données réelle
   (identification patient, technique, findings structurés, impression/diagnostics,
   mesures, limites IA, conclusion) et générer les `lines` depuis ces données.
4. **Éditeur trop rudimentaire.** `ReportEditor` = une textarea sur le texte brut.
   → Édition par section (données + template), avec conservation de la traçabilité
   « champ édité par le praticien » (cf. `edited?: boolean` du draft fœtal).
5. **Templates distants désactivés.** Activer `isRemoteTemplatesEnabled()` derrière
   la migration 0007 avec repli localStorage propre (le repository existe déjà).
6. **Impression/PDF dépendante du navigateur.** `printDocument` repose sur
   `window.print()`. Acceptable, mais l'aperçu avant impression et la pagination
   (`break-inside`) sont à fiabiliser ; garder une seule source HTML
   (`documentHtml`) pour aperçu, impression et Word.
7. **`examId` / `examinerName` non alimentés.** Les cellules meta du PDF
   (`documentHtml`) les affichent si présents dans `tokenValues`, mais rien ne les
   fournit aujourd'hui. → Brancher sur l'examen courant et le profil praticien.
8. **Fusion diagnostics ↔ rapport.** `mergeFindings` (RightPanel) et le texte du
   rapport vivent séparément ; la cohérence (finding présent dans l'un, absent de
   l'autre) n'est vérifiée nulle part côté rendu.

## 5. Contraintes impératives (à ne PAS casser)

- Aucune valeur clinique inventée : `confidence: null` tant que non fournie,
  mode dégradé explicite si Gemini indisponible, `mock_data` côté fœtal.
- Workflow DB : création IA = `needs_review` ; édition d'un rapport validé =
  retour `needs_review` ; validation = action humaine explicite uniquement.
- Un seul template par défaut par modalité (invariant localStorage ET index SQL).
- Tokens inconnus conservés littéralement (`{{foo}}` reste `{{foo}}`).
- Échapper systématiquement le contenu inséré en HTML (`escapeHtml`).
- Attributs `data-attr` E2E existants à préserver (`doc-*`, `ai-report-*`,
  `template-block-*`).

## 6. Commandes de validation

```bash
cd client
npm run dev          # http://localhost:5173
npx tsc -b           # 0 erreur exigée
npx vitest run       # exclure les tests live Supabase réseau
```

Parcours de test manuel : ouvrir une radiographie → modifier les infos patient dans
la carte Document → `@analyze` puis `@report` → éditer → Exporter PDF/Word/JSON →
vérifier que les cellules d'en-tête portent les valeurs saisies.

### 3.2 Export JSON disque (`buildReportJsonExport`)

Objet `RenderedDocument` sérialisé : `modality`, `template`, `sections[]`
(`{id,title,lines[],visible}`), `headerFields[]`, `blocks[]`, `tokenValues`.

### 3.3 Tokens résolus disponibles dans les blocs libres

Toutes les `variables` visibles du template + `organization` (nom d'organisation),
et depuis la dernière évolution : `patientName`, `patientId`, `age`, `sex`,
`ageSex`, `examDate`, `modality`, `study` (injectés par `handleExport`).


  (`application/msword`).
- `buildReportFilename(modality, date, ext)` / `buildReportJsonExport(rendered, rawReport)`
  / `downloadTextFile`.

