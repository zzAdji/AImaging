# AIMAGING — FINALISATION DU SYSTÈME DE RAPPORTS
# RAPPORTS MULTI-MODALITÉS + SAISIE VOCALE + TEMPLATES + EXPORT PDF
#
# IMPORTANT :
# AImaging existe déjà.
#
# Il existe déjà :
# - éditeur Figma-like ;
# - module radiographie ;
# - module échographie fœtale ;
# - annotations ;
# - mesures ;
# - résultats IA ;
# - analysis_runs ;
# - rapports persistants dans Supabase ;
# - ReportEditor ;
# - Supabase Storage ;
# - Supabase Auth.
#
# Cette phase doit FINALISER le système de rapports.
#
# NE CRÉE PAS une nouvelle application.
# NE CRÉE PAS un dashboard séparé.
# NE CRÉE PAS une page de gestion hospitalière.
# NE CRÉE PAS une seconde interface d'édition.
#
# Le système de rapports doit être intégré dans l'éditeur AImaging existant.

==================================================
1. OBJECTIF GLOBAL
==================================================

Nous voulons passer de :

"un texte de rapport généré"

à :

"un véritable Report Builder médical intégré à AImaging."

Le système doit permettre :

1. générer un rapport à partir des données structurées ;
2. éditer le rapport ;
3. saisir ou modifier des éléments au clavier ;
4. utiliser la voix ;
5. générer/reformuler une section ;
6. choisir un template ;
7. modifier le template ;
8. ajouter logo ;
9. configurer en-tête ;
10. configurer pied de page ;
11. configurer signature ;
12. gérer les informations de l'établissement ;
13. prévisualiser ;
14. valider ;
15. exporter en PDF ;
16. retrouver le rapport plus tard.

==================================================
2. DEUX TYPES DE RAPPORTS
==================================================

AImaging possède au minimum :

A. RADIOGRAPHIE THORACIQUE

B. ÉCHOGRAPHIE OBSTÉTRICALE / FŒTALE

Les deux doivent utiliser le même moteur de rapports.

Mais chacun possède son propre contenu métier.

Architecture :

ReportEngine
│
├── ReportTemplate
├── ReportEditor
├── ReportPreview
├── ReportVoiceInput
├── ReportValidation
└── ReportExport
       │
       ├── RadiographyReportBuilder
       └── FetalUltrasoundReportBuilder

NE DUPLIQUE PAS tout le système pour chaque modalité.

==================================================
3. PRINCIPLE IMPORTANT — STRUCTURED DATA FIRST
==================================================

Le rapport doit toujours être construit à partir de données
structurées.

Exemple :

analysis_runs
measurements
findings
annotations
metadata

↓
structured report data
↓
template
↓
rendered report

NE PAS demander au LLM de "deviner" les valeurs.

NE PAS inventer :

- mesures ;
- scores ;
- findings ;
- biométrie ;
- diagnostic.

Une donnée absente doit rester absente.

==================================================
4. RAPPORT RADIOGRAPHIE
==================================================

Le rapport radiographique doit être structuré.

Conserver les éléments déjà présents dans le système.

Architecture minimale :

HEADER

- établissement
- service
- identité affichable si autorisée
- indication
- date
- prescripteur
- autres champs existants

FINDINGS

- observations
- anomalies
- éléments normaux pertinents
- résultats IA
- mesures

IMAGING / EVIDENCE

- image référencée
- Grad-CAM si pertinent
- segmentation si pertinente
- mesures

IMPRESSION

- synthèse
- diagnostic ou suspicion
- degré de confiance lorsque disponible
- limites

FOOTER

- auteur
- validation
- date
- signature

Conserver les champs déjà utilisés par le projet.

==================================================
5. RAPPORT ÉCHOGRAPHIE OBSTÉTRICALE
==================================================

Le rapport doit suivre la structure des comptes rendus
obstétricaux utilisés comme référence dans le projet.

Structure :

EN-TÊTE

ÉCHOGRAPHIE OBSTÉTRICALE

Nom et prénom
Âge
Indication
Prescripteur
Date
etc.

COMPTE RENDU

Observations générales :

- utérus gravide
- activité cardiaque
- présentation
- morphologie
- liquide amniotique
- placenta
- col

BIOMÉTRIE

Fetus 1
- CRL
- BPD
- AC
- FL
- CT
- âge gestationnel
- DPA

Fetus 2 si applicable
- mêmes données

Autres données réellement disponibles.

CONCLUSION

- type de grossesse
- évolution
- DPA
- poids estimé si disponible
- col
- observations importantes

IMPORTANT :

Ne jamais afficher Fetus 2 si l'examen n'est pas multiple.

Ne jamais afficher une mesure absente.

Ne jamais convertir un mock en donnée médicale réelle.

==================================================
6. SYSTÈME DE TEMPLATE
==================================================

Nous voulons un système de templates.

Un template doit être un objet persistant.

Conceptuellement :

ReportTemplate

- id
- name
- modality
- description
- version
- page_size
- orientation
- margins
- header
- footer
- typography
- sections
- logo
- signature
- metadata

Ajouter les champs réellement nécessaires au projet.

Ne pas transformer le template en HTML arbitraire non contrôlé.

Préférer une structure JSONB définie et validée.

==================================================
7. TEMPLATES PAR MODALITÉ
==================================================

Un template peut être :

radiography
fetal_ultrasound
generic

Un template spécifique à la radiographie ne doit pas être
automatiquement utilisé pour l'échographie.

Lors de la création d'un rapport :

exam.modality
↓
templates disponibles
↓
template sélectionné

Prévoir un template par défaut pour chaque modalité.

==================================================
8. TEMPLATE BUILDER
==================================================

Créer un éditeur de template intégré à AImaging.

Ce n'est PAS un nouveau dashboard.

Il doit fonctionner comme un petit éditeur visuel.

L'utilisateur doit pouvoir configurer :

HEADER

- logo
- nom établissement
- sous-titre
- adresse
- téléphone
- email
- couleur d'accent
- alignement
- taille
- visibilité

DOCUMENT

- taille page
- portrait / paysage
- marges
- largeur de colonne

TYPOGRAPHIE

- famille
- taille
- poids
- interligne
- couleur

SECTIONS

- ordre
- titre
- visibilité
- espacement

FOOTER

- informations
- pagination
- date

SIGNATURE

- nom
- fonction
- image signature
- position
- taille

==================================================
9. PREVIEW LIVE
==================================================

Le template editor doit afficher un aperçu en temps réel.

Architecture :

Template Editor
        │
        ├── configuration
        │
        └── Live Preview

Le preview doit être proche du rendu PDF.

Ne pas construire deux renderers complètement différents
si cela peut être évité.

Utiliser un modèle de document commun.

==================================================
10. LOGO
==================================================

Permettre d'uploader un logo.

Le logo doit être stocké dans Supabase Storage.

Prévoir un emplacement dédié, par exemple :

profile-assets/
ou
organization-assets/

NE PAS stocker le logo en base64.

Le template conserve uniquement :

storage_path
ou
asset_id.

Le logo doit pouvoir être :

- ajouté
- remplacé
- supprimé
- redimensionné
- aligné

==================================================
11. SIGNATURE
==================================================

Permettre une signature graphique.

Formats possibles :

PNG
JPEG
SVG si support sûr.

Stockage :

Supabase Storage.

Ne pas stocker en base64 dans PostgreSQL.

La signature doit être liée au profil ou au template
selon le comportement métier réel.

Prévoir :

- nom du signataire
- fonction
- image
- visibilité

La validation du rapport reste une action explicite.

==================================================
12. INFORMATIONS DE L'ÉTABLISSEMENT
==================================================

Créer une notion réutilisable d'informations de rapport.

Exemple :

OrganizationProfile

- name
- logo
- address
- phone
- email
- website
- department

L'objectif est de ne pas répéter ces informations
dans chaque rapport.

Le template référence l'organisation.

==================================================
13. DATABASE — TEMPLATES
==================================================

Inspecter la base actuelle.

Si aucune table de templates n'existe :

proposer une migration dédiée.

Exemple :

report_templates

id
owner_id
organization_id
name
modality
version
is_default
template_data JSONB
created_at
updated_at

Adapter à l'architecture réelle.

IMPORTANT :

Ne pas créer une nouvelle base.

Utiliser la base Supabase existante.

==================================================
14. DATABASE — ORGANIZATION
==================================================

Si nécessaire, proposer une table dédiée :

organizations

ou une extension de :

profiles

avant implémentation.

Ne pas créer plusieurs structures concurrentes.

Un utilisateur doit pouvoir avoir un contexte d'établissement
réutilisable.

Si le projet reste mono-utilisateur/mono-établissement pour le prototype,
préférer une structure simple plutôt qu'une architecture multi-tenant
complexe.

==================================================
15. VERSIONING DES TEMPLATES
==================================================

Un template utilisé dans un rapport doit être traçable.

Lors de la génération :

report
→ template_id
→ template_version

Ajouter ces références au modèle de rapport si nécessaire.

Un changement futur du template ne doit pas modifier
rétroactivement les anciens rapports.

IMPORTANT :

Le rapport validé doit rester reproductible.

==================================================
16. REPORT DATA + TEMPLATE
==================================================

Séparer :

DATA

de :

PRESENTATION

Data :

structured_data

Template :

template_data

Le rendu final :

structured_data
+
template_data
=
document

Cela permet :

- changer le template ;
- conserver les mêmes données ;
- créer plusieurs modèles ;
- exporter plusieurs styles.

==================================================
17. ÉDITION DU RAPPORT
==================================================

Le ReportEditor doit permettre :

- édition libre ;
- édition par section ;
- réordonner si autorisé ;
- masquer une section ;
- afficher une section ;
- modifier un texte ;
- restaurer une section générée ;
- verrouiller certaines données IA si nécessaire.

IMPORTANT :

Les valeurs médicales importantes ne doivent pas être modifiées
silencieusement par une génération libre.

Si une mesure change :

indiquer clairement :

Original AI value
Edited value

La provenance doit être conservée.

==================================================
18. SAISIE VOCALE
==================================================

Nous voulons une fonction de saisie vocale.

La voix doit servir principalement à :

- dicter du texte ;
- ajouter une observation ;
- modifier une section ;
- lancer une commande de rapport.

Exemples :

"Ajoute dans les observations absence de foyer alvéolaire."

"Ajoute une conclusion normale."

"Remplace la conclusion par..."

"Pour F1, ajoute BPD 28 millimètres."

"Ajoute une observation sur le placenta."

IMPORTANT :

La voix ne doit PAS écrire automatiquement
une donnée médicale importante sans possibilité de validation.

Pipeline :

MICROPHONE
↓
Speech-to-Text
↓
transcription
↓
preview / confirmation
↓
appliquer au rapport

==================================================
19. VOICE UI
==================================================

Dans ReportEditor :

bouton micro discret.

États :

Idle
Listening
Processing
Preview
Applied
Error

Pendant l'écoute :

afficher :

Listening…

niveau audio visuel discret.

Après transcription :

afficher :

"Texte reconnu"

avec :

Apply
Edit
Cancel

Ne jamais remplacer immédiatement le contenu
sans confirmation pour une action importante.

==================================================
20. COMMAND BAR + VOICE
==================================================

La command bar d'AImaging existe déjà.

Elle doit également pouvoir contrôler le rapport.

Exemples :

"Génère le rapport"

"Ajoute cette observation au rapport"

"Montre-moi la conclusion"

"Modifie la conclusion"

"Ajoute la mesure dans la biométrie de F1"

"Valide le rapport"

La différence :

Command
→ action structurée

Dictation
→ texte à insérer.

Ne pas mélanger les deux comportements.

==================================================
21. SPEECH ENGINE
==================================================

Avant d'ajouter une dépendance :

inspecter l'environnement actuel.

Déterminer si le projet utilise déjà :

Web Speech API
SpeechRecognition
service externe
autre solution.

Si aucune solution robuste n'existe :

créer une abstraction :

SpeechService

avec :

start()
stop()
cancel()
onTranscript()

Le provider réel pourra être branché plus tard.

NE PAS coupler ReportEditor directement
à une API spécifique.

==================================================
22. LANGUES
==================================================

Le logiciel doit être capable de gérer au minimum :

français
anglais

La langue du rapport doit pouvoir être configurée.

Le contenu médical ne doit pas être traduit automatiquement
sans contrôle si cela change les termes médicaux.

Prévoir :

report.language

avec :

fr
en

ou l'énumération appropriée.

==================================================
23. GÉNÉRATION IA DU RAPPORT
==================================================

Conserver Gemini et le mécanisme actuel.

Le LLM reçoit uniquement les faits structurés autorisés.

Pipeline :

analysis
↓
facts
↓
LLM
↓
structured report
↓
coherence check
↓
needs_review
↓
editor

NE PAS laisser le LLM écrire directement en base.

NE PAS laisser le LLM modifier directement le template.

==================================================
24. VALIDATION
==================================================

Le workflow doit être :

DRAFT
↓
GENERATED
↓
NEEDS REVIEW
↓
EDITED
↓
VALIDATED

Le bouton "Valider" doit être explicite.

Après validation :

- afficher un badge Validé ;
- conserver date ;
- utilisateur ;
- template version.

Une modification après validation doit revenir :

needs_review

et ne doit pas rester "validated".

==================================================
25. SIGNATURE
==================================================

Après validation :

le rapport peut afficher :

Signature
Nom
Fonction
Date

Le système doit distinguer :

- signature visuelle
- validation applicative

Une image de signature ne doit pas automatiquement signifier
que le rapport a été validé.

==================================================
26. EXPORT PDF
==================================================

Créer un vrai pipeline :

Report Data
+
Template
↓
Document Renderer
↓
PDF
↓
Preview
↓
Export

Le PDF doit reproduire :

- en-tête ;
- logo ;
- corps ;
- sections ;
- tableaux ;
- biométrie ;
- conclusion ;
- pied de page ;
- signature ;
- pagination.

Ne pas créer un PDF simplifié uniquement avec du texte brut.

==================================================
27. PDF PREVIEW
==================================================

Avant téléchargement/export :

afficher un aperçu fidèle.

Actions :

Preview
Export PDF
Print
Back to editor

L'utilisateur doit pouvoir revenir modifier le rapport.

==================================================
28. PDF STORAGE
==================================================

Après export :

uploader le PDF vers :

reports

Structure :

reports/
{user_id}/
{workspace_id}/
{examination_id}/
{report_id}/
exports/
report-v{version}.pdf

Stocker uniquement :

storage_path

dans PostgreSQL.

Le fichier reste dans Storage privé.

==================================================
29. FORMAT DE NOM DE FICHIER
==================================================

Le nom doit être propre et stable.

Exemple :

AImaging_Report_2026-08-24.pdf

ou selon les données disponibles :

AImaging_Radiography_2026-08-24.pdf

Ne pas exposer de données sensibles inutiles dans le nom du fichier.

==================================================
30. PRINT
==================================================

Prévoir un mode impression.

Le rendu print doit respecter :

A4
marges
header
footer
pagination

Le moteur doit éviter que les tableaux/sections
soient coupés arbitrairement entre pages.

==================================================
31. RAPPORT RADIOGRAPHIE — UI
==================================================

Dans la sidebar droite existante :

REPORT

Sections :

Overview
Findings
AI Results
Measurements
Impression
Template
Validation

Actions :

Generate
Edit
Voice
Preview
Validate
Export PDF

Le contenu reste dans le même workspace.

==================================================
32. RAPPORT ÉCHOGRAPHIE — UI
==================================================

Dans la sidebar droite :

REPORT

Sections :

Patient / Exam Header
Observations
Fetus 1
Fetus 2
Biometry
Placenta
Amniotic Fluid
Cervix
Findings
Conclusion
Template
Validation

Actions :

Generate
Edit
Voice
Preview
Validate
Export PDF

Ne pas afficher F2 si grossesse unique.

==================================================
33. REPORT TEMPLATE TOOL
==================================================

Ajouter un outil :

Template

dans les outils de rapport.

Lorsque l'utilisateur ouvre Template :

Right Sidebar
→ Template settings

avec :

- Header
- Logo
- Organization
- Typography
- Sections
- Footer
- Signature
- Page
- Colors

Le canvas/report preview se met à jour en direct.

==================================================
34. TEMPLATE PER MODALITY
==================================================

Radiographie :

template radio.

Échographie :

template obstétrical.

Ne pas appliquer automatiquement la structure
échographique à la radiographie.

==================================================
35. RESPONSIVE REPORT EDITOR
==================================================

L'éditeur principal reste le canvas AImaging.

Le rapport peut apparaître :

- dans la sidebar droite ;
- en panneau plus large ;
- en preview plein écran
si cette infrastructure existe déjà.

Mais ne crée pas une application séparée.

==================================================
36. PERSISTENCE
==================================================

Les reports sont déjà persistés.

Compléter la persistance avec :

- template_id
- template_version
- language
- validation data
- PDF storage path
- signature reference
- organization reference

Uniquement si le schéma actuel ne permet pas déjà
de stocker ces informations.

Créer une migration Supabase si nécessaire.

==================================================
37. AUDIT TRAIL
==================================================

Conserver les informations importantes :

generated_at
generated_by
validated_at
validated_by
template_version

Ne pas créer une usine à logs.

Ajouter uniquement ce qui est nécessaire à la traçabilité.

==================================================
38. SÉCURITÉ
==================================================

Les rapports sont sensibles.

Les PDFs doivent rester privés.

Les logos/signatures doivent rester privés si nécessaire.

Ne jamais :

- créer un bucket public ;
- exposer une service_role ;
- mettre des données sensibles dans des URLs publiques.

Utiliser les mécanismes Supabase existants.

==================================================
39. RÉSULTATS IA
==================================================

Un rapport ne doit jamais être considéré comme un résultat
médical autonome.

Le système doit afficher clairement :

AI-generated / AI-assisted

et :

Needs review

jusqu'à validation explicite.

==================================================
40. TESTS REPORT
==================================================

Créer des tests :

RADIO

- generate
- edit
- regenerate
- validate
- edit after validation
- export PDF
- load existing report

ECHOGRAPHIE

- structured data mapping
- F1
- F2
- biometry
- placenta
- fluid
- cervix
- conclusion
- report persistence

VOICE

- transcription mock
- preview
- apply
- cancel
- command vs dictation

TEMPLATE

- create
- update
- logo
- signature
- sections
- version
- modality

PDF

- render
- export
- storage
- download

RLS

- USER A access
- USER B denied

==================================================
41. LIVE TESTS
==================================================

Si les credentials Supabase sont disponibles :

tester réellement :

USER A
→ crée report
→ export PDF
→ download

USER B
→ impossible de lire
→ impossible de modifier
→ impossible de supprimer

Tester également :

logo
signature
template

==================================================
42. NON-RÉGRESSION
==================================================

Après implémentation :

- npm run build ;
- vitest ;
- pytest ;
- tests Supabase live.

Vérifier :

Radiography
Fetal Ultrasound
DICOM
Annotations
Measurements
AI Workspace
Reports

==================================================
43. IMPORTANT — NE PAS CASSER LES RAPPORTS EXISTANTS
==================================================

Les rapports radiographiques existants doivent rester lisibles.

Les rapports déjà persistés doivent être migrables
vers le nouveau modèle sans perte de contenu.

Ne pas supprimer les anciens rapports.

Créer un mapping de compatibilité si nécessaire.

==================================================
44. RAPPORT FINAL DE PHASE
==================================================

À la fin, produire :

1. architecture Report Engine ;
2. templates ;
3. database changes ;
4. Storage changes ;
5. voice architecture ;
6. report editor ;
7. validation ;
8. PDF pipeline ;
9. radiography report ;
10. fetal report ;
11. tests ;
12. live tests ;
13. problèmes ;
14. recommandations.

Créer cette matrice :

| Fonction | Radio | Échographie | Persisté | Testé | Statut |
|---|---|---|---|---|---|
| Generate | ✓ | ✓ | ✓ | ✓ | DONE |
| Edit | ✓ | ✓ | ✓ | ✓ | DONE |
| Voice | ✓ | ✓ | ✓ | ✓ | DONE |
| Template | ✓ | ✓ | ✓ | ✓ | DONE |
| Logo | ✓ | ✓ | ✓ | ✓ | DONE |
| Signature | ✓ | ✓ | ✓ | ✓ | DONE |
| Validation | ✓ | ✓ | ✓ | ✓ | DONE |
| Preview | ✓ | ✓ | ✓ | ✓ | DONE |
| PDF | ✓ | ✓ | ✓ | ✓ | DONE |
| Storage | ✓ | ✓ | ✓ | ✓ | DONE |

==================================================
45. RÈGLE FINALE
==================================================

Cette phase concerne UNIQUEMENT :

REPORT SYSTEM

+

VOICE INPUT

+

TEMPLATE BUILDER

+

PDF EXPORT

+

RADIOGRAPHY REPORT

+

FETAL ULTRASOUND REPORT

NE PAS commencer :

- nouvelle modalité ;
- anomaly detection ;
- multimodal DeepFetal ;
- PACS ;
- RAG ;
- production ;
- 3D.

Lorsque tout est terminé :

ARRÊTE-TOI.

Présente le rapport final.