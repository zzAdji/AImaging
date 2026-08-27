# Workflows

Flux métier réels, issus du code.

## Workflow radiographie

```mermaid
flowchart LR
    Import[Import image] --> Val[Validation technique]
    Val --> Sort[OpenCXR sort]
    Sort --> Ens[Ensemble 5 modèles]
    Ens --> GC[Grad-CAM]
    Ens --> Cls[Classification]
    Cls --> Facts[Faits cliniques]
    Ens --> CXAS[CXAS segmentation]
    CXAS --> Meas[Mesures CTR/SCD]
    Ens --> HG[HybridGNet landmarks]
    HG --> Meas2[Landmarks + incertitude]
    Facts --> Repo[Rapport LLM]
    Repo --> Coh[Cohérence → need_review]
```

Ordre effectif côté client (`App.tsx` et `WorkspaceProvider`) :

1. À l'ouverture d'un examen radiographique, chaque image compatible reçoit une
   classification (ensemble) et un tri opencxr, une fois par examen.
2. L'analyse anatomique (CXAS puis HybridGNet, jamais en parallèle) est lancée
   au chargement de chaque image, sauf si l'examen a déjà été entièrement
   évalué.
3. La détection pathologies (backend Neuro) est lancée sur chaque image
   compatible, indépendamment des gardes locales.

## Workflow DICOM

```mermaid
flowchart LR
    Import[Import .dcm] --> Parse[Parsing/Décodage]
    Parse --> Pseudo[Pseudonymisation]
    Pseudo --> Render[Rendu PNG + buffer linéaire]
    Render --> Viewer[Viewer / Analyse]
```

Les DICOM ne sont pas persistés ; un pseudonyme temporaire sert aux contrôles
de cohérence. Le Patient ID/Name ne quitte jamais le serveur en clair.

## Workflow agent IA

```mermaid
flowchart LR
    Cmd[Commande / instruction] --> Proto[Protocole workspace]
    Proto --> Plan[Plan d'actions]
    Plan --> Val[Validation stricte]
    Val --> Exe[Exécution navigateur]
    Exe --> Res[Resultat]
```

Gemini produit une proposition ; le serveur compile et valide chaque action
contre le manifeste avant toute exécution. Toute invalidité annule le lot
(no partial execution).

## Workflow rapport

```mermaid
flowchart LR
    Analyse[Analyse] --> Facts[Faits]
    Facts --> LLM[LLM]
    LLM --> SR[Rapport structuré]
    SR --> Coh[Cohérence]
    Coh --> NR[needs_review]
    NR --> Editor[ReportEditor]
    Editor --> ValR[Validation]
    ValR --> PDF[PDF]
    PDF --> Store[Storage Supabase]
```

## Workflow persistance

Les résultats d'analyse sont persistés par run dans `analysis_runs`/
`classification_results`/`measurements` et rattachés à une image. Les rapports
vivent dans `reports`. Voir `data-model.md`.