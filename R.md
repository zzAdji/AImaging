CONTEXTE
==================
On a terminé la partie sur la radiographie.

Je développe une pipeline complète d'analyse automatique d'échographies fœtales.

Le projet possède déjà une architecture et du code existant. NE PAS repartir de zéro et NE PAS réécrire inutilement les parties déjà fonctionnelles.

IMPORTANT :
La classification des plans échographiques est déjà implémentée et opérationnelle.
Je me suis arrêté à cette étape.

Je veux maintenant continuer le développement à partir de l'état actuel du projet en intégrant une nouvelle architecture basée sur FetalCLIP, l'analyse multi-images/multi-plans, l'ensemble learning, le soft voting, l'XAI et la génération d'un rapport structuré AVANT l'intervention éventuelle d'un LLM final.

Avant toute modification du code, tu dois :
1. inspecter toute l'architecture existante ;
2. inspecter les dossiers et fichiers déjà créés ;
3. identifier les scripts actuellement fonctionnels ;
4. identifier précisément où s'arrête le pipeline actuel ;
5. identifier les formats JSON/CSV actuellement produits ;
6. identifier comment sont représentés les examens, images, plans et scores ;
7. réutiliser au maximum le code existant ;
8. ne pas casser les fonctionnalités déjà opérationnelles ;
9. proposer un plan d'implémentation avant de modifier les fichiers.

============================================================
ARCHITECTURE CIBLE
============================================================

L'architecture finale visée est :

                         EXAMEN ÉCHOGRAPHIQUE
                                  │
                                  ▼
                      Plusieurs images d'un examen
                                  │
                                  ▼
                        Quality Filtering
                                  │
                                  ▼
                       Sélection des images
                         de bonne qualité
                                  │
                                  ▼
                       Plane Classification
                                  │
                                  ▼
                Images classées et regroupées par plan
                                  │
              ┌───────────────────┴───────────────────┐
              │                                       │
              ▼                                       ▼
        Image individuelle                       Plan échographique
              │                                       │
              └───────────────────┬───────────────────┘
                                  │
                                  ▼
                              FetalCLIP
                                  │
                                  ▼
                   Extraction des caractéristiques
                                  │
                    ┌─────────────┴─────────────┐
                    │                           │
                    ▼                           ▼
            Image Embedding              Plan Embedding
        caractéristiques visuelles      représentation du plan
                    │                           │
                    └─────────────┬─────────────┘
                                  │
                                  ▼
                     Fusion image + information plan
                                  │
                                  ▼
                    Représentation de chaque image
                                  │
                                  ▼
                       Fusion multi-images
                                  │
                                  ▼
                     Représentation de l'examen
                                  │
                                  ▼
                   Classifieurs d'anomalies
                                  │
             ┌────────────────────┴────────────────────┐
             │                                         │
             ▼                                         ▼
          NORMAL                              ANOMALIE SUSPECTÉE
                                                     │
                                                     ▼
                                      Classification de l'anomalie
                                                     │
                                                     ▼
                                          Ensemble Learning
                                                     │
                                                     ▼
                                               Soft Voting
                                                     │
                                                     ▼
                                       Prédiction finale agrégée
                                                     │
                                                     ▼
                                                   XAI
                                                     │
                                    ┌────────────────┴──────────────┐
                                    │                               │
                                    ▼                               ▼
                              Grad-CAM / XAI              Importance des plans
                                    │                               │
                                    └────────────────┬──────────────┘
                                                     ▼
                                          Résultats structurés
                                                     │
                                                     ▼
                                          Rapport / Diagnostic IA
                                                     │
                                                     ▼
                                        VALIDATION / STRUCTURATION
                                                     │
                                                     ▼
                                               LLM FINAL
                                                     │
                                                     ▼
                                      Rapport médical textuel final


============================================================
ÉTAPE 0 — INSPECTION DU PROJET EXISTANT
============================================================

Avant de coder quoi que ce soit :

- inspecter l'arborescence complète du projet ;
- identifier les modules de :
  - chargement des images ;
  - gestion des examens ;
  - quality filtering ;
  - plane classification ;
  - inférence ;
  - génération JSON ;
  - génération CSV ;
  - modèles ;
  - entraînement ;
  - évaluation ;
  - XAI si déjà présent.

Identifier notamment :

- le point d'entrée actuel de l'inférence ;
- le script actuel d'inférence sur une image ;
- le script actuel d'inférence sur un dossier ;
- le code de classification des plans ;
- le fichier de mapping des plans ;
- le format de sortie actuel.

La classification des plans est déjà considérée comme fonctionnelle.

NE PAS la réimplémenter inutilement.

Produire d'abord un résumé clair :

1. ce qui fonctionne ;
2. ce qui est partiellement fonctionnel ;
3. ce qui manque ;
4. où intégrer FetalCLIP ;
5. quelles modifications sont nécessaires.


============================================================
ÉTAPE 1 — STRUCTURE D'UN EXAMEN
============================================================

Le pipeline doit désormais considérer une échographie comme un EXAMEN contenant plusieurs images.

Exemple conceptuel :

exam_001/
    image_001.jpg
    image_002.jpg
    image_003.jpg
    image_004.jpg

Chaque image doit avoir un identifiant unique.

Le système doit construire une représentation logique :

Exam
 ├── image_001
 ├── image_002
 ├── image_003
 └── image_004

Chaque image doit pouvoir être associée à :

- chemin ;
- qualité ;
- statut retenue/rejetée ;
- score qualité ;
- plan prédit ;
- score de confiance du plan ;
- embedding FetalCLIP ;
- représentation du plan ;
- prédictions des classifieurs ;
- scores de confiance ;
- résultats XAI.

Créer une structure de données claire et stable.

Par exemple :

ExamResult
ImageResult
PlaneResult
QualityResult
EmbeddingResult
PredictionResult
EnsembleResult
XAIResult

Adapter les noms à l'architecture existante si des classes similaires existent déjà.


============================================================
ÉTAPE 2 — QUALITY FILTERING
============================================================

Le Quality Filtering doit être appliqué à chaque image avant la classification des plans.

Objectif :

Exam
  │
  ▼
Images
  │
  ▼
Quality Filter
  │
  ├── Rejected
  │
  └── Accepted
          │
          ▼
    Plane Classification

Pour chaque image :

- calculer le score de qualité ;
- déterminer accepted/rejected ;
- enregistrer le motif du rejet si disponible.

Le pipeline ne doit pas supprimer physiquement les images.

Il doit uniquement les marquer.

Exemple :

{
  "image": "image_001.jpg",
  "quality": {
    "score": 0.92,
    "accepted": true
  }
}

Si l'image est rejetée :

{
  "image": "image_002.jpg",
  "quality": {
    "score": 0.21,
    "accepted": false,
    "reason": "low_quality"
  }
}

Si la dépendance nécessaire au quality filtering n'est pas installée, ne pas contourner silencieusement le problème.

Créer une gestion propre :

- dépendance absente ;
- modèle absent ;
- fallback éventuel explicitement indiqué ;
- statut "quality_filter_unavailable".

NE PAS faire croire que le filtrage qualité fonctionne s'il n'est pas réellement actif.


============================================================
ÉTAPE 3 — PLANE CLASSIFICATION
============================================================

Cette partie existe déjà.

Le pipeline doit utiliser les images ACCEPTÉES par Quality Filtering.

Pour chaque image :

image
  │
  ▼
Plane Classifier
  │
  ▼
Predicted Plane
  │
  ├── plane_name
  ├── plane_id
  └── confidence

Exemple :

{
  "image": "image_001.jpg",
  "plane": {
    "id": 3,
    "name": "4CH",
    "confidence": 0.94
  }
}

Conserver les top-k prédictions si le modèle actuel les fournit.

NE PAS perdre les scores.


============================================================
ÉTAPE 4 — REGROUPEMENT PAR PLAN
============================================================

Après classification :

Exam
 │
 ├── 4CH
 │    ├── image_001
 │    └── image_014
 │
 ├── 3VV
 │    └── image_002
 │
 ├── Abdomen
 │    ├── image_003
 │    └── image_015
 │
 └── Head
      └── image_004

Créer une représentation structurée permettant :

- d'accéder aux images par plan ;
- de conserver le score de classification ;
- de gérer plusieurs images appartenant au même plan ;
- de gérer les plans absents ;
- de gérer les plans avec plusieurs images.

IMPORTANT :

La présence de plusieurs images pour un même plan ne doit pas entraîner une duplication artificielle du diagnostic.

Il faudra prévoir ultérieurement une agrégation intra-plan.


============================================================
ÉTAPE 5 — INTÉGRATION DE FETALCLIP
============================================================

Intégrer FetalCLIP comme modèle d'extraction de caractéristiques visuelles.

IMPORTANT :

FetalCLIP ne doit pas être utilisé uniquement comme un système de prompts zero-shot.

Dans le pipeline principal, l'utilisation recommandée est :

Image
  │
  ▼
FetalCLIP Image Encoder
  │
  ▼
Visual Embedding

Le système doit :

1. charger FetalCLIP ;
2. charger sa configuration ;
3. charger ses poids ;
4. charger le preprocessing ;
5. vérifier automatiquement CUDA/CPU ;
6. vérifier la compatibilité avec la version de PyTorch/OpenCLIP ;
7. permettre de geler ou dégeler FetalCLIP ;
8. extraire les embeddings.

Le pipeline doit fonctionner avec :

- FetalCLIP frozen ;
- FetalCLIP fine-tuning partiel ;
- FetalCLIP fine-tuning complet.

Prévoir une configuration :

freeze_backbone = true/false

ou un équivalent propre.


============================================================
ÉTAPE 6 — EMBEDDING VISUEL DE CHAQUE IMAGE
============================================================

Pour chaque image acceptée :

Image
  │
  ▼
FetalCLIP
  │
  ▼
Image Embedding

Conserver :

- embedding ;
- dimension ;
- image_id ;
- plane_id ;
- plane_name ;
- qualité ;
- score de classification du plan.

Ne pas stocker inutilement les embeddings dans les JSON si leur taille est importante.

Prévoir un format adapté :

- .pt ;
- .npy ;
- parquet ;
- ou autre format adapté.

Le JSON doit plutôt conserver :

embedding_path
embedding_dimension

Exemple :

{
  "image_id": "image_001",
  "plane": "4CH",
  "embedding": {
    "path": "embeddings/exam_001/image_001.pt",
    "dimension": 768
  }
}


============================================================
ÉTAPE 7 — REPRÉSENTATION DU PLAN
============================================================

Le plan déjà prédit doit être représenté explicitement.

Exemple :

4CH
3VV
Abdomen
Head
Femur

Créer une représentation numérique du plan.

Deux possibilités à comparer :

A. One-hot encoding

B. Trainable Plane Embedding

Architecture conceptuelle :

Image Embedding
        +
Plane Embedding
        │
        ▼
Fusion
        │
        ▼
Image-Plane Representation

Le système doit permettre de conserver la relation :

"Cette représentation visuelle appartient au plan 4CH."

IMPORTANT :

Ne pas confondre :

- FetalCLIP Image Embedding ;
- Plane Classification ;
- Plane Embedding.

Ce sont trois informations différentes.

Le Plane Classifier prédit le plan.

Le Plane Embedding représente le plan sous forme numérique.

FetalCLIP fournit les caractéristiques visuelles de l'image.


============================================================
ÉTAPE 8 — FUSION IMAGE + PLAN
============================================================

Créer une représentation par image :

Visual Embedding
        +
Plane Embedding
        │
        ▼
Fusion Layer
        │
        ▼
Image-Plane Feature

Tester au minimum une fusion simple par concaténation.

Exemple :

combined = torch.cat(
    [visual_embedding, plane_embedding],
    dim=-1
)

Puis projection :

Linear
ReLU
Dropout

Prévoir également une architecture extensible pour une fusion plus avancée.


============================================================
ÉTAPE 9 — AGRÉGATION INTRA-PLAN
============================================================

Si plusieurs images appartiennent au même plan :

4CH
 ├── image_001
 ├── image_002
 └── image_003

Créer une agrégation.

Commencer avec :

- mean pooling.

Puis prévoir éventuellement :

- max pooling ;
- attention pooling.

Objectif :

Plusieurs images du même plan
        │
        ▼
Agrégation
        │
        ▼
Une représentation du plan

Exemple :

4CH
  │
  ▼
4CH Feature

3VV
  │
  ▼
3VV Feature

Abdomen
  │
  ▼
Abdomen Feature


============================================================
ÉTAPE 10 — FUSION MULTI-PLANS / MULTI-IMAGES
============================================================

Une fois les représentations par plan obtenues :

4CH Feature
3VV Feature
Abdomen Feature
Head Feature
Femur Feature
...

Créer une fusion représentant l'ensemble de l'examen.

Commencer avec une méthode simple et robuste :

- mean pooling des plan features.

Puis prévoir une approche attentionnelle :

Plan Features
      │
      ▼
Attention / Transformer
      │
      ▼
Exam Embedding

IMPORTANT :

La fusion doit gérer les plans absents.

Un examen peut ne pas contenir tous les plans.

Ne jamais supposer que les 41 plans sont toujours présents.


============================================================
ÉTAPE 11 — CLASSIFICATION NORMAL / ANOMALIE
============================================================

Créer un premier classifieur :

Exam Embedding
      │
      ▼
Classifier
      │
      ├── Normal
      └── Anormal

Ce modèle doit être entraînable.

Prévoir :

- train ;
- validation ;
- test ;
- checkpoints ;
- early stopping ;
- learning rate scheduler ;
- class weights si déséquilibre ;
- métriques.

Calculer :

- accuracy ;
- precision ;
- recall ;
- F1 ;
- AUROC ;
- AUPRC si pertinent ;
- matrice de confusion.

IMPORTANT :

Ne pas entraîner un modèle sur des labels inexistants.

Avant l'entraînement :

- inspecter les labels ;
- détecter le niveau du label :
  - image ;
  - plan ;
  - examen ;
- vérifier la cohérence.

Le niveau cible pour la prédiction clinique finale doit être l'EXAMEN lorsque plusieurs images appartiennent au même examen.


============================================================
ÉTAPE 12 — CLASSIFICATION DES ANOMALIES
============================================================

Après Normal / Anormal :

Si anormal :

Exam Embedding
      │
      ▼
Anomaly Classifier
      │
      ├── Cardiopathie
      ├── Anomalie cérébrale
      ├── Anomalie abdominale
      ├── Anomalie osseuse
      └── Autre

Cette partie doit être configurable selon les labels réellement disponibles.

NE PAS inventer des classes si elles n'existent pas dans le dataset.

Prévoir :

- binary classification ;
- multiclass classification ;
- éventuellement multilabel classification si un examen peut contenir plusieurs anomalies.

Le choix doit dépendre de la structure réelle des annotations.


============================================================
ÉTAPE 13 — ENSEMBLE LEARNING
============================================================

Une fois le pipeline de base fonctionnel, créer plusieurs modèles indépendants.

Exemple :

Model 1 :
FetalCLIP + fusion simple

Model 2 :
FetalCLIP + attention pooling

Model 3 :
FetalCLIP + autre stratégie de fusion

Model 4 :
CNN spécialisé

Model 5 :
modèle fine-tuné

Chaque modèle produit :

{
  "prediction": "abnormal",
  "probabilities": {
    "normal": 0.18,
    "abnormal": 0.82
  }
}

L'ensemble doit récupérer les probabilités de tous les modèles.


============================================================
ÉTAPE 14 — SOFT VOTING
============================================================

Implémenter le Soft Voting.

Exemple :

Model 1 :
Normal = 0.20
Abnormal = 0.80

Model 2 :
Normal = 0.10
Abnormal = 0.90

Model 3 :
Normal = 0.30
Abnormal = 0.70

Soft Voting :

Normal =
(0.20 + 0.10 + 0.30) / 3

Abnormal =
(0.80 + 0.90 + 0.70) / 3

Résultat final :

Abnormal = 0.80

Prévoir :

- voting uniforme ;
- voting pondéré par performance validation.

Exemple :

Model 1 weight = 0.4
Model 2 weight = 0.3
Model 3 weight = 0.3

Les poids doivent être configurables.

Ne pas choisir les poids arbitrairement sans justification.


============================================================
ÉTAPE 15 — FINE-TUNING
============================================================

Prévoir une stratégie de fine-tuning progressive.

Phase 1 :

FetalCLIP frozen
      │
      ▼
Entraîner uniquement :
- Plane Embedding
- Fusion
- Classifier

Phase 2 :

Dégeler les dernières couches de FetalCLIP.

Phase 3 :

Fine-tuning complet uniquement si les données sont suffisantes.

Utiliser :

- learning rate faible pour FetalCLIP ;
- learning rate plus élevé pour les nouvelles couches.

Éviter le surapprentissage.

Documenter chaque configuration.


============================================================
ÉTAPE 16 — XAI
============================================================

Après la prédiction finale, produire une explication.

Pour chaque image importante :

- Grad-CAM ou méthode compatible ;
- heatmap ;
- score d'importance.

Produire également une importance au niveau des plans.

Exemple :

Plan importance :

4CH       0.82
3VV       0.71
Abdomen   0.24
Head      0.18

Le résultat doit permettre de comprendre :

- quels plans ont contribué à la décision ;
- quelles images ont contribué ;
- quelles zones de l'image ont été importantes.

IMPORTANT :

L'XAI ne doit pas être présenté comme une preuve médicale.

Elle doit être présentée comme une explication du comportement du modèle.


============================================================
ÉTAPE 17 — RÉSULTATS STRUCTURÉS
============================================================

Avant tout LLM, créer un objet de sortie structuré.

Exemple conceptuel :

{
  "exam_id": "exam_001",

  "quality": {
    "images_total": 20,
    "images_accepted": 15,
    "images_rejected": 5
  },

  "planes": {
    "4CH": {
      "images": 3,
      "confidence": 0.94
    },
    "3VV": {
      "images": 2,
      "confidence": 0.91
    }
  },

  "prediction": {
    "normal_probability": 0.18,
    "abnormal_probability": 0.82,
    "label": "abnormal"
  },

  "anomalies": [
    {
      "label": "suspected_cardiac_anomaly",
      "probability": 0.76
    }
  ],

  "ensemble": {
    "models": 5,
    "method": "soft_voting"
  },

  "xai": {
    "important_planes": [
      "4CH",
      "3VV"
    ],
    "heatmaps": []
  }
}

Cette structure est la sortie de l'IA.

Elle doit être indépendante du LLM.


============================================================
ÉTAPE 18 — RAPPORT / DIAGNOSTIC IA
============================================================

Créer un module qui transforme les résultats structurés en un rapport technique structuré.

Le rapport doit contenir :

1. Informations sur l'examen ;
2. Nombre d'images ;
3. Images rejetées/acceptées ;
4. Plans détectés ;
5. Plans manquants ;
6. Scores de confiance ;
7. Prédiction Normal/Anormal ;
8. Probabilités ;
9. Anomalies suspectées ;
10. Importance des plans ;
11. Résultats de l'ensemble learning ;
12. Résultats XAI.

IMPORTANT :

À ce stade, il ne faut PAS utiliser un LLM pour inventer ou interpréter les résultats.

Le rapport doit être généré directement à partir des sorties des modèles.


============================================================
ÉTAPE 19 — LLM FINAL
============================================================

Le LLM intervient UNIQUEMENT après toutes les étapes précédentes.

Pipeline :

Images
 ↓
Quality Filtering
 ↓
Plane Classification
 ↓
FetalCLIP
 ↓
Embeddings
 ↓
Fusion
 ↓
Classifieurs
 ↓
Ensemble Learning
 ↓
Soft Voting
 ↓
XAI
 ↓
Résultats structurés
 ↓
Rapport technique structuré
 ↓
LLM
 ↓
Rapport final lisible

Le LLM ne doit PAS recevoir directement les images pour prendre seul la décision médicale.

Il reçoit les résultats structurés produits par les modèles.

Exemple :

{
  "prediction": "abnormal",
  "probability": 0.82,
  "suspected_anomaly": "cardiac",
  "important_planes": ["4CH", "3VV"],
  "xai": {...}
}

Le LLM peut ensuite générer :

- un résumé ;
- les résultats ;
- les éléments suspects ;
- les plans analysés ;
- les limites ;
- une recommandation de vérification par un professionnel.

Le LLM doit clairement distinguer :

- observation IA ;
- suspicion ;
- diagnostic confirmé.

Ne jamais transformer automatiquement "suspected anomaly" en diagnostic médical confirmé.


============================================================
ÉTAPE 20 — ORGANISATION DU CODE
============================================================

Organiser le code de façon modulaire.

Proposer une structure proche de :

src/
├── data/
│   ├── exam_dataset.py
│   ├── image_dataset.py
│   └── manifest.py
│
├── quality/
│   └── quality_filter.py
│
├── planes/
│   ├── plane_classifier.py
│   └── plane_grouping.py
│
├── fetalclip/
│   ├── model.py
│   ├── loader.py
│   ├── embeddings.py
│   └── preprocessing.py
│
├── fusion/
│   ├── image_plane_fusion.py
│   ├── intra_plane.py
│   └── multi_plane.py
│
├── models/
│   ├── normal_anomaly.py
│   ├── anomaly_classifier.py
│   └── ensemble.py
│
├── training/
│   ├── train_classifier.py
│   ├── fine_tune_fetalclip.py
│   └── evaluate.py
│
├── xai/
│   ├── gradcam.py
│   └── plane_importance.py
│
├── reporting/
│   └── structured_report.py
│
└── llm/
    └── report_generator.py

Adapter cette structure à l'architecture existante au lieu de déplacer massivement les fichiers sans nécessité.


============================================================
ÉTAPE 21 — ÉVALUATION
============================================================

Créer des scripts d'évaluation séparés.

Évaluer au minimum :

1. Plane Classification
2. Quality Filtering
3. Normal vs Abnormal
4. Classification des anomalies
5. Ensemble Learning
6. Soft Voting

Comparer :

- modèle individuel ;
- ensemble ;
- soft voting uniforme ;
- soft voting pondéré.

Produire :

- Accuracy ;
- Precision ;
- Recall ;
- F1 ;
- AUROC ;
- AUPRC ;
- confusion matrix.

Si le dataset est déséquilibré, privilégier les métriques adaptées et ne pas se limiter à l'accuracy.


============================================================
RÈGLES IMPORTANTES
============================================================

1. NE PAS coder toute la pipeline en une seule fois.

2. Procéder par étapes.

3. Après chaque étape :
   - tester ;
   - vérifier les sorties ;
   - documenter ;
   - corriger les erreurs.

4. Ne pas modifier les modules déjà fonctionnels sans nécessité.

5. Toujours vérifier les dimensions des embeddings.

6. Toujours vérifier le device :
   - CUDA ;
   - CPU.

7. Ne jamais supposer que tous les plans sont présents dans chaque examen.

8. Ne jamais supposer qu'un examen possède le même nombre d'images.

9. Gérer les images rejetées.

10. Gérer les examens incomplets.

11. Éviter les data leakage :
    - split train/validation/test au niveau PATIENT ou EXAMEN ;
    - jamais au niveau image si plusieurs images appartiennent au même examen.

12. Tous les modèles doivent être sauvegardés avec :
    - configuration ;
    - poids ;
    - classes ;
    - mapping des plans ;
    - version du modèle.

13. Les prédictions doivent être reproductibles.

14. Ajouter des logs détaillés.

15. Chaque étape doit produire des sorties vérifiables.

16. Les embeddings doivent pouvoir être sauvegardés et rechargés afin d'éviter de recalculer FetalCLIP à chaque entraînement.

17. Prévoir un mode :
    - extract_embeddings ;
    - train ;
    - evaluate ;
    - inference.

18. Ne pas intégrer le LLM tant que :
    - le modèle Normal/Anormal n'est pas évalué ;
    - l'ensemble learning n'est pas évalué ;
    - le soft voting n'est pas validé ;
    - l'XAI n'est pas fonctionnel ;
    - les sorties structurées ne sont pas stables.

19. Le système doit être conçu pour la recherche et l'expérimentation.

20. Ne jamais présenter les prédictions comme un diagnostic médical définitif.


============================================================
ORDRE D'IMPLÉMENTATION OBLIGATOIRE
============================================================

Commencer par :

PHASE A
Inspection du projet existant.

PHASE B
Inspection du dataset réel et de la structure des examens.

PHASE C
Créer ou adapter la représentation Exam/Image/Plane.

PHASE D
Finaliser Quality Filtering.

PHASE E
Connecter Quality Filtering → Plane Classification.

PHASE F
Créer le regroupement des images par plan.

PHASE G
Intégrer FetalCLIP.

PHASE H
Extraire et sauvegarder les embeddings.

PHASE I
Créer Plane Embedding.

PHASE J
Fusion Image Embedding + Plane Embedding.

PHASE K
Agrégation intra-plan.

PHASE L
Fusion multi-plans pour créer Exam Embedding.

PHASE M
Créer le classifieur Normal/Anormal.

PHASE N
Entraîner et évaluer.

PHASE O
Créer le classifieur d'anomalies si les labels existent.

PHASE P
Fine-tuning progressif de FetalCLIP.

PHASE Q
Créer plusieurs modèles.

PHASE R
Ensemble Learning.

PHASE S
Soft Voting uniforme.

PHASE T
Soft Voting pondéré.

PHASE U
XAI :
- Grad-CAM ;
- importance des plans.

PHASE V
Sortie structurée.

PHASE W
Rapport technique.

PHASE X
Seulement ensuite :
intégration du LLM final.

============================================================
PREMIÈRE ACTION DEMANDÉE
============================================================

NE CODE PAS IMMÉDIATEMENT FetalCLIP.

Commence par inspecter l'état actuel du projet.

Identifie précisément :

1. le dernier module fonctionnel ;
2. le script de classification des plans ;
3. le format exact de ses sorties ;
4. la structure actuelle du dataset ;
5. comment sont regroupées les images d'un même examen ;
6. si les labels d'anomalies existent ;
7. à quel niveau se trouvent les labels :
   - image ;
   - plan ;
   - examen ;
   - patient.

Ensuite, propose un PLAN D'IMPLÉMENTATION adapté au code réellement présent.

Ne modifie aucun fichier avant d'avoir présenté ce plan.

Après validation du plan, implémente UNE SEULE PHASE À LA FOIS.

À chaque phase :

- expliquer ce qui est modifié ;
- afficher les fichiers modifiés ;
- fournir le code complet des nouveaux fichiers ;
- fournir les modifications précises des fichiers existants ;
- lancer les tests disponibles ;
- vérifier les sorties ;
- signaler clairement les erreurs ou dépendances manquantes.

OBJECTIF FINAL :

Construire une pipeline robuste et reproductible :

EXAM
→ QUALITY FILTERING
→ PLANE CLASSIFICATION
→ PLANE GROUPING
→ FETALCLIP VISUAL EMBEDDINGS
→ PLANE EMBEDDINGS
→ IMAGE-PLANE FUSION
→ INTRA-PLANE AGGREGATION
→ MULTI-PLANE EXAM FUSION
→ NORMAL/ABNORMAL CLASSIFICATION
→ ANOMALY CLASSIFICATION
→ FINE-TUNING
→ ENSEMBLE LEARNING
→ SOFT VOTING
→ XAI
→ STRUCTURED AI REPORT
→ FINAL LLM REPORT

Le système doit être modulaire, testable, reproductible et adapté à un projet de recherche en imagerie médicale.