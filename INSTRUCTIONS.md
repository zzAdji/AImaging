# AIMAGING — PHASE DOCUMENTATION & CODE CLEANUP
#
# OBJECTIF :
# produire une documentation technique complète et propre du projet
# AImaging, tout en uniformisant les commentaires du code.
#
# IMPORTANT :
#
# AImaging existe déjà.
#
# Cette phase ne doit PAS ajouter de fonctionnalité.
# Elle ne doit PAS modifier le comportement métier.
# Elle ne doit PAS modifier les modèles.
# Elle ne doit PAS modifier les pipelines IA.
#
# PÉRIMÈTRE :
#
#   client/
#   scripts/
#   server/
#
# EXCLUS DU PÉRIMÈTRE :
#
#   échographie fœtale
#   autres dossiers considérés comme sources externes
#   modèles externes
#   dépôts clonés
#   checkpoints
#   données
#
# La 3D est également définitivement hors périmètre.

==================================================
1. OBJECTIF FINAL
==================================================

Je veux pouvoir donner le repository AImaging à un développeur
et lui permettre de comprendre :

- l'architecture ;
- les responsabilités ;
- les flux ;
- les fonctionnalités ;
- les interactions client/serveur ;
- les scripts IA ;
- les services ;
- les APIs ;
- les données ;
- les dépendances ;
- les points d'entrée ;
- les composants importants.

La documentation doit expliquer le projet à trois niveaux :

NIVEAU 1
→ vue globale

NIVEAU 2
→ architecture par couche

NIVEAU 3
→ fonctionnement détaillé de chaque fonctionnalité importante

==================================================
2. SOURCE DE VÉRITÉ
==================================================

Le CODE ACTUEL est la source de vérité.

Ne pas documenter une fonctionnalité uniquement parce qu'elle
est mentionnée dans un ancien README.

Pour chaque fonctionnalité :

- vérifier son implémentation ;
- identifier son point d'entrée ;
- identifier les fichiers concernés ;
- suivre le flux réel ;
- préciser les dépendances ;
- distinguer les fonctionnalités réelles des fonctionnalités
  expérimentales ou incomplètes.

Ne rien inventer.

==================================================
3. PREMIÈRE ÉTAPE — CARTOGRAPHIE DU REPOSITORY
==================================================

Avant de modifier quoi que ce soit :

inspecter :

client/
scripts/
server/

Créer une carte détaillée.

Exemple :

client/
├── app
├── components
├── state
├── services
├── lib
└── ...

server/
├── API
├── services
├── schemas
├── persistence
└── ...

scripts/
├── radiography
├── opencxr
├── shared
└── ...

Pour chaque dossier important :

- responsabilité ;
- principaux fichiers ;
- dépendances ;
- rôle dans l'application.

==================================================
4. DOCUMENTATION GLOBALE
==================================================

Créer ou restructurer une documentation centrale.

Proposition :

docs/
├── README.md
├── architecture.md
├── client.md
├── server.md
├── scripts.md
├── api.md
├── data-model.md
├── workflows.md
├── configuration.md
└── features/
    ├── radiography.md
    ├── dicom.md
    ├── gradcam.md
    ├── anatomy.md
    ├── measurements.md
    ├── reports.md
    ├── workspace.md
    └── ai-agent.md

Adapter cette structure au repository réel.

Ne pas créer des fichiers inutiles.

==================================================
5. DOCUMENTATION — README GLOBAL
==================================================

Le README principal doit expliquer rapidement :

AImaging
↓
ce que fait le logiciel
↓
architecture générale
↓
technologies
↓
fonctionnalités principales
↓
installation
↓
démarrage
↓
structure du repository
↓
documentation détaillée.

Le README doit rester lisible.

Ne pas y recopier toute la documentation technique.

==================================================
6. DOCUMENTATION — ARCHITECTURE
==================================================

Créer une documentation détaillée de l'architecture :

                    AImaging
                       │
          ┌────────────┼────────────┐
          │            │            │
        Client       Server       Scripts
          │            │            │
          │            │            │
          └────────────┴────────────┘
                       │
                    Supabase

Décrire :

- responsabilités ;
- communication ;
- dépendances ;
- flux de données ;
- appels API ;
- persistance ;
- fichiers lourds ;
- runtime.

==================================================
7. CLIENT — DOCUMENTATION
==================================================

Documenter le frontend.

Inclure :

- architecture ;
- pages ;
- composants ;
- providers ;
- state management ;
- services ;
- repositories ;
- canvas ;
- outils ;
- AI workspace ;
- reports ;
- authentification ;
- persistance.

Ne pas documenter seulement les composants visuels.

Décrire les relations.

Exemple :

App
↓
WorkspaceProvider
↓
Canvas
↓
Tools
↓
API
↓
Server

==================================================
8. CLIENT — OUTILS
==================================================

Documenter le système des outils.

Séparer :

COMMON TOOLS
AI TOOLS
MODALITY TOOLS

Pour chaque outil :

- nom ;
- rôle ;
- composant ;
- état ;
- action déclenchée ;
- données consommées ;
- données produites ;
- backend éventuel.

Pour la radiographie :

documenter les outils spécifiques existants.

Ne pas documenter les outils échographiques dans cette phase.

==================================================
9. CLIENT — CANVAS
==================================================

Documenter :

CanvasViewport
ShapesLayer
annotations
measurements
zoom
pan
selection
rendering
image loading
DICOM rendering
etc.

Expliquer le flux :

image
↓
canvas
↓
interaction
↓
state
↓
persistence

==================================================
10. CLIENT — WORKSPACE
==================================================

Documenter :

WorkspaceProvider
workspace state
runtime state
annotations
measurements
AI state
reports
undo/redo
command bar

Faire la distinction :

PERSISTED STATE
vs
RUNTIME STATE
vs
CACHE
vs
UI PREFERENCES

==================================================
11. CLIENT — PERSISTENCE
==================================================

Documenter précisément :

Supabase
localStorage
Storage
repositories
cache

Expliquer :

quoi est dans PostgreSQL ;
quoi est dans Storage ;
quoi reste local ;
pourquoi.

Ne pas présenter localStorage comme source de vérité
si le code actuel utilise Supabase comme source principale.

==================================================
12. CLIENT — AUTH
==================================================

Documenter :

Login
Session
Logout
Password reset
AuthProvider/authService
Supabase Auth
RLS relation.

Flux :

Login
↓
Supabase Auth
↓
auth.uid()
↓
RLS
↓
user data

==================================================
13. CLIENT — REPORT ENGINE
==================================================

Documenter :

ReportEditor
ReportEngine
ReportTemplate
ReportPreview
Voice
Validation
PDF
Storage

Séparer :

REPORT DATA
REPORT TEMPLATE
REPORT RENDERING
REPORT EXPORT

Expliquer précisément les responsabilités.

==================================================
14. SERVER — DOCUMENTATION
==================================================

Documenter l'architecture FastAPI.

Inclure :

- entry point ;
- routes ;
- schemas ;
- services ;
- dependencies ;
- middleware ;
- configuration ;
- errors ;
- runtime state.

Créer une vue :

Request
↓
Router
↓
Service
↓
Model / external service
↓
Response

==================================================
15. SERVER — API
==================================================

Produire une documentation complète des endpoints existants.

Pour chaque endpoint :

- méthode ;
- chemin ;
- rôle ;
- input ;
- output ;
- erreurs ;
- authentification ;
- dépendances ;
- appel frontend.

Créer un tableau :

| Method | Endpoint | Purpose | Input | Output | Auth | Client |
|---|---|---|---|---|---|---|

Ne pas inventer d'endpoint.

==================================================
16. SERVER — RADIOGRAPHIE
==================================================

Documenter le pipeline réel.

Pipeline cible actuel :

Image
↓
Technical validation
↓
OpenCXR sort
↓
5-model ensemble
↓
Classification
↓
Grad-CAM
↓
CXAS
↓
HybridGNet
↓
Measurements
↓
Report

Pour chaque étape :

- fichier ;
- classe/fonction ;
- input ;
- output ;
- modèle ;
- checkpoint ;
- preprocessing ;
- erreurs ;
- dépendances.

==================================================
17. SERVER — ENSEMBLE RADIO
==================================================

Documenter séparément :

DenseNet121
ResNet50
ResNet101
EfficientNet-B0
EfficientNet-B2

Puis :

Soft voting.

Expliquer :

- poids ;
- input ;
- probabilités ;
- fusion ;
- classes ;
- résultat final.

NE PAS documenter le training comme s'il était encore exécuté
par le serveur si le serveur fait uniquement l'inférence.

==================================================
18. SERVER — OPENCXR
==================================================

Documenter :

- microservice ;
- sort ;
- standardization ;
- communication ;
- ports ;
- dépendances ;
- erreurs ;
- fail-closed.

Inclure le comportement :

invalid image
→ rejected

non-CXR
→ rejected

CXR
→ analysis

==================================================
19. SERVER — DICOM
==================================================

Documenter :

- parsing ;
- metadata ;
- pseudonymization ;
- frames ;
- window/level ;
- pixel spacing ;
- rendu ;
- sécurité.

Ne pas copier des exemples complets de DICOM.

Décrire les flux.

==================================================
20. SERVER — ANATOMY
==================================================

Documenter :

CXAS
HybridGNet
/anatomy-analysis
measurements

Pour chaque composant :

- modèle ;
- checkpoint ;
- input ;
- output ;
- mesures ;
- unités ;
- uncertainty ;
- relation avec analysis_runs.

==================================================
21. SERVER — AI AGENT
==================================================

Documenter :

workspace agent
Gemini
workspace protocol
command execution
validation
fallback
context

Flux :

Command
↓
Protocol
↓
Action plan
↓
Validation
↓
Execution
↓
Result

Ne pas exposer de secrets.

==================================================
22. SERVER — REPORTS
==================================================

Documenter le chemin :

facts
↓
LLM
↓
structured report
↓
coherence
↓
needs_review
↓
ReportEditor
↓
validation
↓
PDF
↓
Storage

==================================================
23. SCRIPTS — DOCUMENTATION
==================================================

Documenter séparément les scripts.

Pour chaque dossier :

- objectif ;
- point d'entrée ;
- commandes ;
- dépendances ;
- input ;
- output ;
- utilisation.

Inclure notamment :

scripts/radiography/
scripts/opencxr/
scripts/shared/

NE PAS documenter les scripts échographiques dans cette phase.

==================================================
24. SCRIPTS — MODÈLES
==================================================

Pour chaque modèle réellement utilisé en radiographie :

- nom ;
- architecture ;
- checkpoint ;
- input size ;
- preprocessing ;
- classes ;
- usage ;
- emplacement du poids.

Ne pas inventer de métriques.

==================================================
25. SCRIPTS — CHECKPOINTS
==================================================

Documenter où les modèles sont chargés.

Identifier :

- chemin ;
- format ;
- taille approximative si disponible ;
- usage.

Ne jamais inclure de checkpoint binaire
dans la documentation.

==================================================
26. WORKFLOWS
==================================================

Créer une documentation des workflows réels.

Au minimum :

WORKFLOW RADIOGRAPHIE

Import
→ Validation
→ OpenCXR
→ Ensemble
→ Grad-CAM
→ Anatomy
→ Measurements
→ Report

WORKFLOW DICOM

Import
→ Parse
→ Pseudonymize
→ Render
→ Analysis

WORKFLOW AI

Command
→ Protocol
→ Action
→ Backend
→ Result

WORKFLOW REPORT

Analysis
→ Facts
→ Report
→ Edit
→ Validate
→ PDF

==================================================
27. DIAGRAMMES
==================================================

Dans la documentation, utiliser des diagrammes Mermaid
lorsqu'ils apportent réellement de la valeur.

Créer notamment :

1. architecture globale ;
2. flux radiographie ;
3. flux DICOM ;
4. flux rapport ;
5. relation client/server ;
6. modèle de persistance.

Ne pas mettre un diagramme partout.

==================================================
28. COMMENTAIRES — OBJECTIF
==================================================

Maintenant, uniformiser les commentaires de :

client/
scripts/
server/

Le style doit être identique dans les trois parties.

Objectif :

commentaires courts ;
directs ;
techniques ;
factuels.

==================================================
29. RÈGLE PRINCIPALE DES COMMENTAIRES
==================================================

COMMENTER :

- pourquoi une décision existe ;
- comportement non évident ;
- contrainte ;
- sécurité ;
- dépendance ;
- format ;
- workaround ;
- invariant.

NE PAS COMMENTER :

- ce que le code dit déjà clairement ;
- chaque variable ;
- chaque ligne ;
- les évidences ;
- les opérations triviales.

==================================================
30. STYLE D'ÉCRITURE
==================================================

Utiliser partout :

- français technique ;
- phrases courtes ;
- présent ;
- vocabulaire stable ;
- une idée par commentaire ;
- pas de ton conversationnel ;
- pas de "IMPORTANT !!!" ;
- pas de commentaires pédagogiques inutiles ;
- pas de répétition.

Exemple acceptable :

# Applique le même preprocessing que l'entraînement.

Exemple non souhaité :

# Cette fonction permet de faire le preprocessing de l'image,
# ce qui est important parce que le modèle a été entraîné avec
# ce preprocessing...

Préférer :

# Reproduit le preprocessing d'entraînement.

==================================================
31. DOCSTRINGS
==================================================

Pour les fonctions et classes publiques importantes :

utiliser des docstrings courtes.

Format recommandé Python :

def analyze_image(...):
    """Analyse une image radiographique."""

Pas de docstring de 30 lignes
pour une fonction de 10 lignes.

Pour TypeScript :

utiliser un commentaire uniquement lorsque
le comportement n'est pas évident.

==================================================
32. HEADERS DE FICHIERS
==================================================

Uniformiser les headers des fichiers importants.

Format :

"""
AImaging · <module>

Rôle :
<description courte>
"""

Uniquement lorsque cela apporte réellement
de la valeur.

NE PAS ajouter un header à chaque fichier trivial.

==================================================
33. COMMENTAIRES TEMPORAIRES
==================================================

Supprimer :

- TODO déjà résolus ;
- commentaires historiques inutiles ;
- commentaires indiquant qu'un fichier vient d'être modifié ;
- commentaires de debugging ;
- longs journaux de développement ;
- commentaires mentionnant des prompts internes ;
- explications obsolètes.

Conserver :

- vrais TODO ;
- contraintes ;
- limitations ;
- dépendances externes ;
- décisions d'architecture utiles.

==================================================
34. NOMMAGE
==================================================

Pendant cette phase :

NE PAS renommer massivement les fonctions/classes.

NE PAS changer les APIs simplement pour améliorer
le style.

Le nettoyage concerne principalement :

- commentaires ;
- docstrings ;
- documentation ;
- cohérence rédactionnelle.

Si un nom est clairement incorrect et risque de tromper
la documentation :

le signaler dans le rapport plutôt que de le renommer
automatiquement.

==================================================
35. COMMENTAIRES MÉDICAUX / IA
==================================================

Pour les composants médicaux :

être précis sur :

- segmentation ;
- classification ;
- confidence ;
- uncertainty ;
- pixel spacing ;
- unités ;
- modèles ;
- résultats.

Ne jamais écrire :

"diagnostic confirmé"

si le code produit seulement :

prediction
ou
suspected finding.

La documentation doit respecter exactement
ce que produit le système.

==================================================
36. FEATURES À DOCUMENTER
==================================================

Créer une fiche pour chaque fonctionnalité majeure existante.

Minimum :

1. Authentication
2. Workspaces
3. Examination management
4. Image import
5. Image viewer
6. DICOM
7. CXR validation
8. OpenCXR
9. Ensemble classification
10. Grad-CAM
11. CXAS
12. HybridGNet
13. Measurements
14. Annotations
15. AI command system
16. AI agent
17. Reports
18. Templates
19. Voice input
20. PDF export
21. Supabase persistence
22. Storage
23. Security/RLS

Pour chaque fiche :

# Fonctionnalité

## Objectif

## Flux

## Entrées

## Traitement

## Sorties

## Fichiers principaux

## Dépendances

## Persistance

## Limites

## Statut

Statuts autorisés :

VERIFIED
PARTIAL
EXPERIMENTAL
MOCKED
BROKEN

==================================================
5 BIS. README — NORMALISATION COMPLÈTE
==================================================

Tous les fichiers README.md présents dans le périmètre :

client/
scripts/
server/

et dans leurs sous-dossiers pertinents doivent être audités.

Objectif :

AUCUN README ne doit rester :

- obsolète ;
- contradictoire avec le code ;
- trop verbeux ;
- rédigé dans un style différent ;
- rempli de détails qui ne correspondent plus au fonctionnement actuel ;
- incomplet sur le rôle réel du dossier/module.

Pour chaque README.md :

1. vérifier son contenu contre le code réel ;
2. supprimer les informations obsolètes ;
3. corriger les chemins ;
4. corriger les commandes ;
5. corriger les noms de modules ;
6. corriger les noms de modèles ;
7. corriger les ports ;
8. corriger les variables d'environnement ;
9. corriger les dépendances ;
10. documenter uniquement ce qui existe réellement.

==================================================
CONVENTION README
==================================================

Tous les README doivent suivre une même philosophie rédactionnelle :

- direct ;
- technique ;
- concis ;
- structuré ;
- factuel ;
- sans marketing ;
- sans répétition.

Éviter les longues introductions.

Éviter les paragraphes génériques.

Commencer directement par le rôle du dossier/module.

==================================================
STRUCTURE README STANDARD
==================================================

Lorsqu'un README est pertinent, utiliser cette structure :

# <Nom>

## Rôle

Description courte du module ou dossier.

## Structure

Présentation concise des sous-dossiers/fichiers importants.

## Fonctionnement

Flux principal du module.

## Entrées

Données ou paramètres attendus.

## Sorties

Résultats produits.

## Utilisation

Commandes réellement disponibles.

## Configuration

Variables d'environnement ou prérequis réellement nécessaires.

## Dépendances

Dépendances importantes uniquement.

## Intégration

Interaction avec le reste d'AImaging.

## Limites

Limitations réellement présentes.

## Statut

VERIFIED / PARTIAL / EXPERIMENTAL / MOCKED / BROKEN

Ne pas utiliser toutes les sections lorsqu'elles sont inutiles.

==================================================
README DES DOSSIERS
==================================================

Pour chaque dossier important :

README.md

doit répondre rapidement à :

"À quoi sert ce dossier ?"

"Quels sont ses fichiers principaux ?"

"Comment fonctionne-t-il ?"

"Comment l'utiliser ?"

"De quoi dépend-il ?"

==================================================
README DES SCRIPTS
==================================================

Pour scripts/ et ses sous-dossiers :

documenter notamment :

- point d'entrée ;
- commande d'exécution ;
- arguments ;
- environnement requis ;
- modèle/checkpoint utilisé ;
- format d'entrée ;
- format de sortie.

Ne pas transformer chaque README en tutoriel complet.

==================================================
README CLIENT
==================================================

Documenter :

- démarrage ;
- build ;
- tests ;
- architecture ;
- composants principaux ;
- providers ;
- services ;
- persistance ;
- intégration API.

==================================================
README SERVER
==================================================

Documenter :

- démarrage FastAPI ;
- port ;
- routes principales ;
- structure ;
- services ;
- dépendances externes ;
- configuration ;
- tests.

==================================================
COHÉRENCE ENTRE README
==================================================

Les README locaux doivent être cohérents avec :

docs/README.md
docs/architecture.md
docs/client.md
docs/server.md
docs/scripts.md
docs/configuration.md

Une information définie comme centrale ne doit pas être contredite
dans un README local.

==================================================
RÈGLE DE STYLE COMMUNE
==================================================

Les README et commentaires doivent avoir la même "main d'écriture".

Même style :

- phrases courtes ;
- vocabulaire stable ;
- présent ;
- formulations directes ;
- titres explicites ;
- aucune sur-explication.

Exemple :

Mauvais :

"Ce dossier contient différents scripts qui sont utilisés
afin de permettre au système de traiter les images..."

Bon :

"Contient les scripts d'inférence et de preprocessing."

Mauvais :

"Dans cette fonction, nous allons essentiellement..."

Bon :

"Charge le modèle et exécute l'inférence."

==================================================
README OBSOLÈTES
==================================================

Si un README décrit une fonctionnalité abandonnée :

ne pas la présenter comme active.

Exemple :

La 3D est abandonnée.

Toute documentation qui la présente comme une fonctionnalité active
doit être corrigée.

Ne pas supprimer automatiquement une documentation historique utile.

Si nécessaire :

"Ancienne fonctionnalité — hors périmètre actuel."

==================================================
README ÉCHOGRAPHIE
==================================================

IMPORTANT :

L'échographie est hors périmètre de cette phase documentaire.

NE PAS développer sa documentation fonctionnelle.

Mais si un README existant dans les dossiers ciblés
contient des références à l'échographie :

ne pas inventer ou étendre cette documentation.

Corriger uniquement les contradictions évidentes
avec l'état actuel du projet.

==================================================
VALIDATION DES README
==================================================

Après réécriture :

1. rechercher tous les README.md ;
2. vérifier qu'aucun README important n'est oublié ;
3. vérifier les liens internes ;
4. vérifier les chemins ;
5. vérifier les commandes ;
6. vérifier les noms de fichiers ;
7. vérifier les variables d'environnement ;
8. vérifier les ports ;
9. vérifier les statuts.

Créer une liste :

README
→ VALIDATED

ou :

README
→ NEEDS_REVIEW

Aucun README ne doit contenir une information
non vérifiée dans le code lorsque cette information
est prés
entée comme actuelle.
==================================================
37. DOCUMENTATION DES LIMITES
==================================================

Une documentation technique sérieuse doit indiquer
les limites connues.

Exemples si confirmés par le code :

- dépendance opencxr ;
- fallback Gemini ;
- données mockées ;
- absence d'anomaly échographique ;
- tests live dépendants des credentials ;
- limitations DICOM.

Ne pas cacher les limitations.

==================================================
38. DOCUMENTATION DE CONFIGURATION
==================================================

Créer un document listant :

- Python ;
- Node ;
- dépendances ;
- variables d'environnement ;
- ports ;
- services ;
- modèles requis ;
- chemins importants.

Ne jamais afficher les secrets.

Exemple :

GEMINI_API_KEY=<required>

et non :

GEMINI_API_KEY=AIza...

==================================================
39. DOCUMENTATION DES COMMANDES
==================================================

Documenter les commandes réellement utilisées.

Exemple :

Frontend

npm install
npm run dev
npm run build
npm run test

Backend

uvicorn ...
pytest

Scripts

commandes réellement présentes

Ne pas inventer de commandes.

==================================================
40. VALIDATION DE LA DOCUMENTATION
==================================================

Une fois la documentation écrite :

vérifier tous les liens relatifs.

Vérifier les chemins de fichiers.

Vérifier les noms de fonctions/classes.

Vérifier les endpoints.

Vérifier les commandes.

Vérifier les noms des modèles.

Aucune référence cassée.

==================================================
41. VALIDATION DU CODE
==================================================

Le nettoyage des commentaires ne doit modifier
aucune logique.

Après modification :

npm run build

vitest

pytest

Comparer les résultats avant/après.

Les 6 problèmes DICOM connus restent séparés
s'ils sont toujours présents.

==================================================
42. GIT DIFF
==================================================

Avant de terminer :

inspecter git diff.

Identifier les modifications :

A. documentation
B. commentaires
C. code fonctionnel

Objectif :

C = 0

ou uniquement des changements absolument nécessaires
pour corriger une référence documentaire cassée.

==================================================
43. RAPPORT FINAL
==================================================

Produire :

1. architecture documentée ;
2. documents créés ;
3. fonctionnalités documentées ;
4. fichiers client documentés ;
5. fichiers server documentés ;
6. scripts documentés ;
7. commentaires nettoyés ;
8. conventions de rédaction utilisées ;
9. tests ;
10. éventuelles incohérences découvertes ;
11. documentation encore manquante.

Créer une matrice :

| Domaine | Documentation | Commentaires | Tests | Statut |
|---|---|---|---|---|
| Client | ✓ | ✓ | ✓ | DONE |
| Server | ✓ | ✓ | ✓ | DONE |
| Scripts | ✓ | ✓ | ✓ | DONE |
| Radiography | ✓ | ✓ | ✓ | DONE |
| DICOM | ✓ | ✓ | ✓ | DONE |
| AI | ✓ | ✓ | ✓ | DONE |
| Reports | ✓ | ✓ | ✓ | DONE |

==================================================
44. RÈGLE FINALE
==================================================

Cette phase est une phase de :

DOCUMENTATION
+
NORMALISATION DES COMMENTAIRES
+
NETTOYAGE RÉDACTIONNEL

Elle ne doit pas devenir une phase de refactoring.

NE PAS :

- modifier l'architecture ;
- changer les modèles ;
- changer les APIs ;
- modifier les résultats ;
- modifier les workflows ;
- ajouter une fonctionnalité ;
- implémenter l'échographie ;
- implémenter anomaly detection ;
- réintroduire la 3D.

Lorsque la documentation et le nettoyage sont terminés :

ARRÊTE-TOI.

Présente le rapport final.