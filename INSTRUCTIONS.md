# AIMAGING — MODULE ÉCHOGRAPHIE FŒTALE
# PRIORITÉ : UI/UX ET WORKFLOW
#
# IMPORTANT :
# Pour cette tâche, NE PAS commencer par développer les modèles IA.
# NE PAS chercher à reconstruire DeepFetal.
# NE PAS créer d'endpoint complexe.
#
# Nous devons d'abord construire une UX complète et cohérente pour
# l'analyse échographique fœtale dans AImaging.
#
# Le but est de définir et implémenter l'interface et son workflow,
# depuis le chargement des images jusqu'à la génération et l'édition
# du compte rendu échographique.
#
# Les résultats IA peuvent être mockés temporairement avec des données
# structurées réalistes.
#
# L'architecture doit cependant être pensée pour recevoir plus tard
# les vrais résultats DeepFetal, FetalCLIP et les futurs modèles
# de détection d'anomalies.

# ⚠️ CONSIGNE ABSOLUE — NE PAS CRÉER UNE NOUVELLE APPLICATION

AImaging existe déjà.

Le module de RADIOGRAPHIE THORACIQUE existe déjà et fonctionne.

Il possède déjà :

- le shell global de l'application ;
- le TitleBar ;
- le CanvasViewport ;
- la LeftToolbar ;
- le RightPanel ;
- le WorkspaceProvider ;
- les outils d'édition ;
- les outils IA ;
- les outils spécifiques à la radiographie ;
- la command bar ;
- les annotations ;
- les mesures ;
- Grad-CAM ;
- CXAS ;
- HybridGNet ;
- DICOM ;
- les rapports ;
- le système de persistance frontend ;
- le système d'actions IA.

NE CRÉE DONC PAS :

- une nouvelle application ;
- une nouvelle SPA ;
- un deuxième éditeur ;
- un deuxième Canvas ;
- une deuxième Toolbar ;
- une deuxième architecture globale ;
- un deuxième système de navigation ;
- une nouvelle page indépendante pour l'échographie ;
- un nouveau Dashboard.

Tu dois UNIQUEMENT AJOUTER LE MODULE ÉCHOGRAPHIE FŒTALE À L'APPLICATION AIMAGING EXISTANTE.

L'éditeur de radiographie est la référence UX/UI.

Tu dois réutiliser son infrastructure autant que possible.

Le module échographique doit être une NOUVELLE MODALITÉ de l'éditeur existant.

==================================================
ARCHITECTURE À RESPECTER
==================================================

L'application possède déjà un éditeur commun :

AImaging Editor
│
├── Shared Editor Core
│   ├── TitleBar
│   ├── CanvasViewport
│   ├── WorkspaceProvider
│   ├── LeftToolbar
│   ├── RightPanel
│   ├── StatusBar
│   ├── command bar
│   ├── annotations
│   ├── measurements
│   └── history
│
├── Radiography Module
│   ├── outils radio
│   ├── diagnostics
│   ├── Grad-CAM
│   ├── CXAS
│   ├── HybridGNet
│   └── rapport radiologique
│
└── Fetal Ultrasound Module
    ├── outils échographie
    ├── qualité
    ├── plans
    ├── sélection
    ├── biométrie
    ├── findings
    └── rapport obstétrical

L'objectif est donc :

EXISTANT
+
Fetal Ultrasound Module

et NON :

nouvelle application échographique.

==================================================
1. CONTEXTE DU PRODUIT
==================================================

AImaging est un logiciel professionnel d'analyse d'images médicales
avec une interface d'édition inspirée de Figma.

Ce n'est PAS un dashboard.

Ce n'est PAS un logiciel de gestion de patients.

Ce n'est PAS une application de gestion hospitalière.

Le cœur de l'application est un espace de travail centré sur l'image.

L'utilisateur ouvre un examen.

Il travaille sur ses images.

Il utilise des outils d'édition.

Il utilise des outils IA.

Il consulte les résultats.

Il produit ensuite un compte rendu.

La radiographie thoracique possède déjà son propre ensemble d'outils.

Nous allons étendre l'éditeur AImaging existant avec une deuxième modalité : l'échographie fœtale.

==================================================
2. NOUVELLE PHILOSOPHIE DES OUTILS
==================================================

AImaging utilise désormais UNE SEULE interface d'édition.

Il n'y a plus :

NORMAL MODE
AI MODE

Les outils sont regroupés par familles.

Pour chaque modalité :

1. Outils simples
2. Outils IA
3. Outils spécifiques à la modalité

Pour l'échographie fœtale :

OUTILS SIMPLES

- Move
- Hand
- Zoom
- Rotate
- Crop
- Brightness
- Contrast
- Annotation
- Text
- Measure
- Distance
- Angle

OUTILS IA

- Analyze
- Quality
- Plane Detection
- AI Selection
- Biometrics
- Findings
- Anomaly Analysis
- Grad-CAM lorsqu'il est disponible
- Report

OUTILS ÉCHOGRAPHIE

- Examination
- Plan
- Fetal Profile
- Biometry
- Fetus 1
- Fetus 2
- Measurements
- Pregnancy
- Placenta
- Amniotic Fluid
- Cervix
- Report

IMPORTANT :

Ces outils doivent être visibles dans la sidebar gauche sous forme
d'une toolbox professionnelle inspirée de Figma.

Ils ne doivent pas ressembler à des boutons de dashboard.

==================================================
3. STRUCTURE GÉNÉRALE DE L'ÉDITEUR
==================================================

L'écran doit conserver la structure de l'éditeur AImaging.

┌──────────────────────────────────────────────────────────────┐
│                         TITLE BAR                             │
├──────────────┬───────────────────────────────┬───────────────┤
│              │                               │               │
│ LEFT SIDEBAR │            CANVAS             │ RIGHT SIDEBAR │
│              │                               │               │
│ Tools        │       Medical image          │ Context       │
│              │                               │ information   │
│              │                               │ AI results    │
│              │                               │ Measurements  │
│              │                               │ Report        │
│              │                               │               │
├──────────────┴───────────────────────────────┴───────────────┤
│                         STATUS BAR                           │
└──────────────────────────────────────────────────────────────┘

La structure visuelle doit rester très proche de l'éditeur de
radiographie existant.

Même :

- top bar ;
- dark theme ;
- spacing ;
- iconography ;
- typography ;
- card system ;
- interactions ;
- animations ;
- status bar.

La modalité échographique ne doit pas donner l'impression d'être
une autre application.

==================================================
4. CHARGEMENT D'UN EXAMEN ÉCHOGRAPHIQUE
==================================================

Le workflow commence lorsque l'utilisateur crée un nouvel examen.

Il doit pouvoir :

- sélectionner plusieurs images ;
- sélectionner un dossier ;
- glisser-déposer plusieurs images ;
- importer progressivement des images ;
- supprimer une image ;
- réordonner les images.

Les images peuvent être :

- JPG
- PNG
- DICOM si disponible.

Après l'import, ne pas envoyer immédiatement toutes les images
dans le pipeline d'analyse.

Créer d'abord un état :

IMPORTING

puis :

READY FOR ANALYSIS

Chaque image doit posséder une miniature.

Créer une filmstrip ou une zone de vignettes.

Exemple :

┌───────────────────────────────────────────────┐
│ Exam images                                   │
│                                               │
│ [01] [02] [03] [04] [05] [06] [07] [08]     │
│                                               │
└───────────────────────────────────────────────┘

Une image sélectionnée devient l'image principale du canvas.

==================================================
5. STRUCTURE DU DOSSIER D'EXAMEN
==================================================

L'utilisateur ne doit pas penser :

"Je suis en train de gérer des fichiers."

Il doit penser :

"Je suis en train d'analyser un examen."

Créer donc la notion :

EXAMINATION

avec :

- nom de l'examen ;
- date ;
- indication ;
- type d'échographie ;
- nombre d'images ;
- statut de l'analyse.

Le système doit permettre :

Draft
Analyzing
Analyzed
Report ready

Pas de gestion patient pour l'instant.

==================================================
MODALITÉ DE L'EXAMEN
==================================================

Le système possède déjà un mécanisme permettant d'identifier
le type d'examen.

Utilise ce mécanisme existant.

Le système doit déterminer :

exam.modality

Exemples :

"radiography"
"fetal_ultrasound"

Cette information permet uniquement de déterminer quels outils
spécifiques doivent apparaître.

Le cœur de l'éditeur reste identique.

==================================================
OUTILS DYNAMIQUES
==================================================

La sidebar gauche EXISTANTE doit devenir contextuelle.

Pour :

exam.modality === "radiography"

afficher :

COMMON TOOLS
+
AI TOOLS
+
RADIOGRAPHY TOOLS

Pour :

exam.modality === "fetal_ultrasound"

afficher :

COMMON TOOLS
+
AI TOOLS
+
FETAL ULTRASOUND TOOLS

Les COMMON TOOLS sont partagés.

Les AI TOOLS partagent le même système d'exécution.

Seuls les outils spécifiques à la modalité changent.

NE DUPLIQUE PAS LeftToolbar.

NE DUPLIQUE PAS RightPanel.

NE DUPLIQUE PAS CanvasViewport.

Étends les composants existants.

==================================================
6. SIDEBAR GAUCHE — STRUCTURE
==================================================

La sidebar gauche doit être organisée en sections.

------------------------------------------
SECTION : EXAMINATION
------------------------------------------

[ Examination ]

Lorsqu'on clique dessus, la sidebar affiche :

Overview
Images
Selected views
Analysis status

Elle permet de comprendre l'état global de l'examen.

------------------------------------------
SECTION : SIMPLE TOOLS
------------------------------------------

Move
Hand
Zoom
Rotate
Crop
Brightness
Contrast
Annotation
Text
Measure
Distance
Angle

Ces outils se comportent comme ceux de l'éditeur radiographique.

------------------------------------------
SECTION : AI TOOLS
------------------------------------------

Quality
Plane Detection
AI Selection
Analyze
Biometry
Findings
Anomaly Analysis
Report

------------------------------------------
SECTION : ULTRASOUND
------------------------------------------

Plans
Fetus
Biometry
Placenta
Amniotic Fluid
Cervix
Pregnancy

IMPORTANT :

Chaque outil doit ouvrir ou mettre à jour une zone correspondante
dans la sidebar droite.

La sidebar gauche sert à CHOISIR une fonction.

La sidebar droite sert à AFFICHER et MODIFIER son résultat.

==================================================
7. COMPORTEMENT DE LA SIDEBAR GAUCHE
==================================================

Ne transforme pas la sidebar gauche en énorme panneau de texte.

Elle doit rester compacte.

Chaque outil :

- possède une icône ;
- un label court ;
- un tooltip ;
- un état actif ;
- un état disabled si non disponible.

Lorsqu'une section est ouverte :

les outils apparaissent avec animation légère.

Lorsqu'un outil est actif :

il est visuellement sélectionné.

==================================================
8. SIDEBAR DROITE — PRINCIPE
==================================================

La sidebar droite est le panneau contextuel.

Elle ne doit jamais afficher toutes les informations en même temps.

Elle affiche le contenu correspondant à l'outil sélectionné.

Le panneau peut être constitué de cartes repliables.

Chaque carte possède :

- titre ;
- statut ;
- contenu ;
- actions ;
- éventuellement un bouton "Show on image".

==================================================
9. RIGHT PANEL — EXAMINATION OVERVIEW
==================================================

Lorsque l'utilisateur ouvre "Examination", afficher :

EXAMINATION

Status
Ready / Analyzing / Completed

Images
24

Analyzed
18 / 24

Plans detected
12

Images rejected
3

Selected views
9

--------------------------------

Action:

Analyze examination

==================================================
10. RIGHT PANEL — QUALITY
==================================================

Lorsque l'utilisateur clique "Quality" :

AFFICHER :

IMAGE QUALITY

Current image

Quality score
94 %

Status
Good

Puis éventuellement :

Sharpness
Good

Contrast
Good

Visibility
Good

Usability
Accepted

L'utilisateur peut cliquer :

Use image

ou :

Exclude image

Pour une analyse multi-image :

présenter la qualité de chaque image sous forme de liste.

Exemple :

01  ✓ 94 %
02  ✓ 91 %
03  ✕ 32 %
04  ✓ 88 %

==================================================
11. RIGHT PANEL — PLANE DETECTION
==================================================

Lorsque l'utilisateur clique "Plane Detection" :

AFFICHER :

DETECTED PLANE

4CH

Confidence

93 %

--------------------------------

Top predictions

4CH       93 %
3VV        4 %
RVOT       2 %
Other      1 %

--------------------------------

Action :

Show matching images

Puis possibilité :

View all detected planes

Créer une liste :

Brain
Heart
Abdomen
Femur
Spine
Face
etc.

Chaque plan possède :

- nombre d'images ;
- score ;
- miniature représentative.

==================================================
12. RIGHT PANEL — PLANS / GROUPING
==================================================

Lorsque l'utilisateur clique "Plans" :

AFFICHER une organisation par plans.

Exemple :

HEART

4CH
3 images

3VV
2 images

LVOT
1 image

RVOT
2 images

BRAIN

BPD
3 images

Cereb
2 images

L'utilisateur peut cliquer sur un plan.

Le canvas affiche alors une image représentative.

Le filmstrip se filtre sur ce plan.

==================================================
13. RIGHT PANEL — AI SELECTION
==================================================

Cette fonction sert à sélectionner les meilleures images de l'examen.

Afficher :

SELECTED VIEWS

Brain
✓ 3 images

Heart
✓ 3 images

Abdomen
✓ 2 images

Face
✓ 2 images

Total selected
10 images

Pour chaque image :

miniature
plan
quality score
confidence

Bouton :

Replace selection

==================================================
14. RIGHT PANEL — FETUS
==================================================

Cette section est importante pour les grossesses multiples.

Afficher :

FETUS

Fetus 1
Fetus 2

si l'examen est gémellaire.

Chaque fœtus doit pouvoir posséder son propre groupe de données.

Exemple :

FETUS 1

Biometry
Measurements
Position
Heart rate
Estimated weight

FETUS 2

Biometry
Measurements
Position
Heart rate
Estimated weight

IMPORTANT :

Ne créer Fetus 2 que si le contexte de l'examen indique
une grossesse multiple.

==================================================
15. RIGHT PANEL — BIOMETRY
==================================================

Créer une carte dédiée :

BIOMETRY

Pour chaque fœtus :

F1

CRL
15 mm

BPD
28 mm

AC
82 mm

FL
15 mm

CT
105 mm

Gestational age
14 SA + 6 days

EDD / DPA
05/07/2026

F2

CRL
16 mm

BPD
29 mm

AC
92 mm

FL
16 mm

CT
105 mm

Gestational age
15 SA + 1 day

EDD / DPA
03/07/2026

Les valeurs doivent être éditables.

Chaque mesure possède :

- label ;
- valeur ;
- unité ;
- source ;
- éventuellement confidence.

Ajouter :

+ Add measurement

Mais ne jamais inventer une valeur.

==================================================
16. RIGHT PANEL — MEASUREMENTS
==================================================

Cette section doit fonctionner comme un outil d'édition.

Une mesure sélectionnée dans le panneau droit doit pouvoir être
mise en évidence sur l'image.

Exemple :

BPD
28 mm

[Show on image]

Le canvas affiche alors les points / lignes correspondant à la mesure.

Même logique pour :

CRL
BPD
AC
FL
CT
NT
etc.

Les noms exacts doivent dépendre des mesures effectivement disponibles.

==================================================
17. RIGHT PANEL — PLACENTA
==================================================

Créer une carte :

PLACENTA

Position

Anterior
Posterior
Fundal
etc.

Grade

Grade I

Insertion

Normal / information disponible

Confidence si donnée par l'IA.

Ajouter :

Show on image

lorsqu'une localisation visuelle est disponible.

==================================================
18. RIGHT PANEL — AMNIOTIC FLUID
==================================================

Carte :

AMNIOTIC FLUID

Status

Normal / Abnormal / Not assessed

Measurement

si disponible.

Ne jamais générer artificiellement une valeur.

==================================================
19. RIGHT PANEL — CERVIX
==================================================

Carte :

CERVIX

Status

Long / Closed

Cervical length

si disponible

Show measurement

si une mesure existe.

Dans les rapports montrés dans les exemples, le col peut notamment
apparaître sous une formulation du type :

"Col long et fermé."

Le panneau doit donc permettre d'obtenir cette information structurée.

==================================================
20. RIGHT PANEL — FINDINGS
==================================================

Cette section rassemble les observations.

Exemple :

FINDINGS

✓ Fetal morphology appears normal

✓ Amniotic fluid quantity normal

✓ Placental position available

⚠ Finding requiring review

Chaque finding possède :

- statut ;
- confidence ;
- source ;
- éventuellement image associée.

Possibilité :

Show evidence

qui recentre le canvas sur l'image correspondante.

==================================================
21. RIGHT PANEL — ANOMALY ANALYSIS
==================================================

IMPORTANT :

Cette section NE DOIT PAS inventer un diagnostic si le modèle
d'anomalie n'est pas encore disponible.

Si aucun modèle n'est branché :

ANOMALY ANALYSIS

Not available yet

The anomaly detection model is currently not connected.

Aucun faux score.

Aucun faux diagnostic.

Lorsque le modèle sera disponible :

NORMAL
ou
ABNORMAL

puis :

Suspected anomaly
Confidence
Evidence
Affected plane

==================================================
22. RIGHT PANEL — REPORT
==================================================

Le rapport doit être conçu comme un véritable compte rendu
d'échographie obstétricale.

Il ne doit PAS être un simple paragraphe de chatbot.

Le rapport doit reproduire la structure observée dans les exemples
fournis.

STRUCTURE :

------------------------------------------
ÉCHOGRAPHIE OBSTÉTRICALE
------------------------------------------

Nom et Prénom : Mme [...]

Indication : [...]

Prescripteur : [...]

Âge : [...]

Date : [...]

------------------------------------------
COMPTE RENDU
------------------------------------------

Observations générales

- Utérus gravide...
- activité cardiaque...
- présentation...
- morphologie...
- liquide amniotique...
- placenta...
- col...

------------------------------------------
BIOMÉTRIE
------------------------------------------

F1

CRL = ...
BPD = ...
AC = ...
FL = ...
CT = ...

Âge gestationnel = ...
DPA = ...

F2

CRL = ...
BPD = ...
AC = ...
FL = ...
CT = ...

Âge gestationnel = ...
DPA = ...

------------------------------------------
CONCLUSION
------------------------------------------

- Type de grossesse
- Évolution
- DPA
- Poids estimé
- Col
- observations importantes

IMPORTANT :

Le rapport doit être construit à partir des données structurées.

Le texte généré doit être éditable.

Le rapport ne doit jamais inventer une mesure absente.

==================================================
23. REPORT EDITOR
==================================================

Lorsqu'on clique sur "Edit report":

ouvrir un vrai éditeur de compte rendu.

Le contenu doit rester structuré.

Sections :

Header
Findings
Biometry
Fetus 1
Fetus 2
Conclusion

Chaque section peut être éditée.

Ajouter :

Save

Regenerate section

Reset section

Export

Le bouton Regenerate ne doit régénérer que la section concernée.

==================================================
24. GÉNÉRATION DU RAPPORT
==================================================

Le workflow doit être :

IMAGES
↓
QUALITY
↓
PLANS
↓
SELECTED VIEWS
↓
BIOMETRY / FINDINGS
↓
STRUCTURED DATA
↓
GENERATE REPORT
↓
REPORT EDITOR
↓
FINAL REPORT

Ne pas générer un rapport avant que l'utilisateur ait
au minimum les informations nécessaires.

Le bouton doit donc passer par plusieurs états :

Generate

Generating...

Generated

Needs review

Validated

==================================================
25. COMMAND BAR
==================================================

Conserver la barre de commandes flottante de l'éditeur.

Elle reste au centre inférieur du canvas.

Pour l'échographie, elle peut recevoir :

"Analyse cette image"

"Détecte le plan"

"Montre les meilleures vues"

"Affiche la biométrie"

"Montre F1"

"Montre F2"

"Génère le compte rendu"

"Montre les images du cœur"

"Affiche les mesures"

Ce n'est toujours PAS un chatbot.

C'est une barre de commandes.

==================================================
26. CANVAS
==================================================

Le canvas reste le centre absolu de l'interface.

Pour une image échographique :

- zoom ;
- pan ;
- rotation ;
- crop ;
- annotations ;
- mesures.

Pour une sélection de plan :

le canvas affiche l'image sélectionnée.

Pour une mesure :

les lignes et points apparaissent directement sur l'image.

Pour une finding :

l'IA peut centrer le canvas sur l'image correspondante.

==================================================
27. FILMSTRIP
==================================================

La navigation multi-image doit être élégante.

Ajouter une filmstrip discrète.

Chaque vignette peut montrer :

- miniature ;
- numéro ;
- plan ;
- quality score ;
- selected state.

Exemple :

[01] 4CH ✓
[02] BPD ✓
[03] 4CH ✓
[04] Kidney ✓
[05] rejected

L'utilisateur peut cliquer sur une vignette
pour l'afficher dans le canvas.

==================================================
28. ÉTATS DU WORKFLOW
==================================================

Le logiciel doit avoir des états visuels très clairs.

ÉTAT 1

No examination

"Import ultrasound images"

ÉTAT 2

Images imported

"24 images"

ÉTAT 3

Analyzing

Quality...
Plane detection...

ÉTAT 4

Analysis ready

Planes detected
Best views selected

ÉTAT 5

Report ready

Report generated
Needs review

==================================================
29. CHARGEMENT
==================================================

Le chargement doit être élégant.

Ne pas afficher simplement :

"Loading..."

Afficher le pipeline :

Preparing images
✓

Quality analysis
✓

Plane classification
●

Selecting representative views
○

Extracting features
○

Preparing report
○

Utiliser des transitions très discrètes.

==================================================
30. DESIGN
==================================================

Respecter strictement le design system existant AImaging.

Thème sombre.

Inspirations :

Figma
Apple
Anthropic
Linear

Mais ne pas copier leurs interfaces.

Palette très sombre.

Panels légèrement plus clairs que le background.

Bordures discrètes.

Rayons cohérents.

Typographie Inter / Geist / SF-like.

Icônes Lucide.

Très peu de couleurs.

Couleur d'accent :

bleu AImaging.

Les états médicaux peuvent utiliser des couleurs secondaires
uniquement lorsqu'elles ont une signification claire :

vert = validé / normal
orange = attention
rouge = anomalie / erreur

Ne pas multiplier les couleurs.

==================================================
31. CE QUI DOIT ÊTRE IMPLÉMENTÉ MAINTENANT
==================================================

Cette tâche concerne principalement l'UI.

Tu peux utiliser des données mockées réalistes.

Créer les composants nécessaires si les composants n'existent pas encore.

Par exemple :

FetalExaminationPanel

FetalQualityPanel

FetalPlanePanel

FetalSelectionPanel

FetalFetusPanel

FetalBiometryPanel

FetalFindingsPanel

FetalAnomalyPanel

FetalPlacentaPanel

FetalFluidPanel

FetalCervixPanel

FetalReportPanel

FetalReportEditor

FetalFilmstrip

FetalAnalysisProgress

FetalToolbox

Adapte les noms à l'architecture actuelle.

==================================================
32. IMPORTANT — NE PAS CASSER LA RADIOGRAPHIE
==================================================

Le module radiographie existe déjà.

Ne remplace pas :

- LeftToolbar ;
- RightPanel ;
- WorkspaceProvider ;
- CanvasViewport ;

si leurs abstractions peuvent être réutilisées.

Étends-les proprement.

L'idée est :

EDITOR
│
├── common tools
│
├── modality-specific tools
│
└── modality-specific panels

Ainsi :

Radiography
→ outils radio

Fetal Ultrasound
→ outils écho

Même éditeur.

Même philosophie.

==================================================
33. RESPONSABILITÉ UI / BACKEND
==================================================

Pour cette phase :

Les résultats IA peuvent être MOCKÉS.

Mais les données mockées doivent respecter exactement les schémas
que les futurs services backend devront renvoyer.

Créer des types TypeScript structurés.

Exemple :

FetalExam

FetalImage

PlaneResult

QualityResult

FetusData

BiometryData

Finding

FetalReport

Ne mélanger pas les données UI avec les données backend.

==================================================
34. PAS DE FAUSSE IA
==================================================

Même avec des mocks :

tout ce qui concerne l'anomalie doit être clairement identifié.

Exemple :

anomaly.status = "not_implemented"

et jamais :

anomaly.confidence = 0.94

si aucun véritable modèle n'existe.

Pour la qualité et les plans :

les mocks peuvent simuler les résultats du futur backend.

==================================================
35. OBJECTIF UX FINAL
==================================================

Le résultat final doit donner l'impression d'utiliser :

"Figma pour l'échographie obstétricale."

L'utilisateur :

1. crée un examen ;
2. importe ses images ;
3. visualise toutes ses images ;
4. laisse AImaging analyser la qualité ;
5. voit les plans détectés ;
6. voit les meilleures images sélectionnées ;
7. peut naviguer entre les plans ;
8. peut consulter la biométrie ;
9. peut analyser les findings ;
10. prépare les données du compte rendu ;
11. génère le rapport ;
12. relit et modifie le rapport ;
13. exporte le rapport.

Tout doit se passer dans le même espace de travail.

Pas de dashboard.

Pas de page patient.

Pas de gestion hospitalière.

Pas de chatbot séparé.

==================================================
36. AVANT DE CODER
==================================================

Avant d'implémenter quoi que ce soit :

1. inspecte l'architecture frontend actuelle ;
2. identifie les composants réutilisables ;
3. identifie comment les outils radio sont actuellement organisés ;
4. identifie comment RightPanel gère les sections ;
5. identifie comment le provider stocke la modalité actuelle ;
6. propose l'architecture des composants échographie ;
7. propose les nouveaux types TypeScript ;
8. explique comment la modalité détermine les outils affichés.

NE PAS MODIFIER LE CODE AVANT DE PRÉSENTER CE PLAN.

Après validation du plan, implémente uniquement l'UI et le workflow mocké.

==================================================
37. FIN
==================================================

À la fin :

- l'éditeur radiographie doit continuer de fonctionner ;
- un examen échographique mocké doit pouvoir être ouvert ;
- plusieurs images doivent pouvoir être affichées ;
- les plans doivent être représentés ;
- les panneaux doivent fonctionner ;
- la biométrie doit pouvoir être affichée ;
- le rapport doit pouvoir être généré avec les données mockées ;
- le rapport doit pouvoir être édité ;
- le build frontend doit fonctionner.

Ne commence PAS encore :

- l'entraînement du modèle d'anomalies ;
- le vrai pipeline FetalCLIP ;
- la reconstruction de DeepFetal exam ;
- PostgreSQL ;
- l'authentification ;
- Docker.

Cette phase est une phase UI/UX et workflow.

==================================================
RÈGLE DE NON-RÉGRESSION
==================================================

Après chaque modification du module échographique :

1. ouvrir un examen radiographique existant ;
2. vérifier que son interface est inchangée ;
3. vérifier que les outils radiographiques fonctionnent ;
4. vérifier Grad-CAM ;
5. vérifier CXAS ;
6. vérifier HybridGNet ;
7. vérifier le rapport ;
8. vérifier la command bar ;
9. lancer le build frontend.

Le développement du module échographique ne doit provoquer aucune
régression sur le module radiographie.

À aucun moment, ne remplacer une fonctionnalité radiographique
par une version générique ou échographique.

Le module radiographie est déjà la première modalité de référence.

L'échographie est la deuxième modalité ajoutée à la même plateforme.