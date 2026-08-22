# AIMAGING — PHASE 4
# CONSTRUCTION DU MODULE ÉCHOGRAPHIE FŒTALE
#
# OBJECTIF :
# transformer les briques échographiques actuellement disponibles
# en un véritable pipeline exploitable dans AImaging.
#
# IMPORTANT :
# la radiographie est maintenant considérée comme le premier module
# fonctionnel du produit.
#
# Cette phase concerne principalement l'ÉCHOGRAPHIE FŒTALE.
#
# NE PAS réouvrir les anciens chantiers radiographiques sauf si une
# dépendance directe empêche l'intégration échographique.

==================================================
1. CONTEXTE ACTUEL
==================================================

Le projet AImaging est un logiciel d'édition et d'analyse d'images médicales.

La radiographie thoracique possède maintenant :

- pipeline de tri CXR ;
- validation technique ;
- 5 modèles de classification ;
- ensemble soft voting ;
- Grad-CAM ;
- CXAS ;
- HybridGNet ;
- mesures anatomiques ;
- DICOM ;
- rapports ;
- AI command bar ;
- outils d'édition.

La 3D est définitivement abandonnée.

NE PAS :
- réintroduire la 3D ;
- réparer la 3D ;
- ajouter la 3D ;
- exposer des outils 3D.

==================================================
2. NOUVELLE ORGANISATION UI
==================================================

IMPORTANT :

La séparation :

NORMAL MODE
/
AI MODE

n'existe plus.

Les modes ont été fusionnés.

Pour la radiographie, l'éditeur fonctionne désormais comme une toolbox unique regroupant trois familles :

1. OUTILS SIMPLES
2. OUTILS IA
3. OUTILS RADIO

Cette logique doit devenir la base de l'architecture future multi-modalité.

Exemple :

RADIOGRAPHIE

Outils simples
- Move
- Hand
- Zoom
- Crop
- Rotate
- Brightness
- Contrast
- Window/Level
- Annotation
- Text
- Measure
- Angle
- Distance

Outils IA
- Grad-CAM
- Diagnostics
- Report

Outils radio
- CXR Sort
- Lung Analysis
- Anatomy Analysis
- Thoracic Measurements
- autres fonctions radiologiques

IMPORTANT :

Ne crée pas un nouveau "mode IA".

Les outils doivent être présentés comme des outils du logiciel.

Le système doit pouvoir changer automatiquement de toolbox
selon la modalité de l'examen.

==================================================
3. OBJECTIF DE CETTE PHASE
==================================================

Construire le module échographie fœtale.

Architecture cible :

                  EXAMEN ÉCHOGRAPHIQUE
                          │
                          ▼
                    Plusieurs images
                          │
                          ▼
                   QUALITY FILTER
                          │
                          ▼
                PLANE CLASSIFICATION
                          │
                          ▼
                   SCORE DES PLANS
                          │
                          ▼
                  IMAGE SELECTION
                          │
                          ▼
                 FetalCLIP / FEATURES
                          │
                          ▼
                ANOMALY ANALYSIS
                          │
                          ▼
                    MULTIMODAL
                          │
                          ▼
                    RÉSULTATS

Cette architecture est inspirée de la méthodologie DeepFetal,
mais AImaging doit rester maître de son propre pipeline.

NE PAS simplement copier DeepFetal.

==================================================
4. CE QUI EXISTE DÉJÀ
==================================================

D'après l'audit précédent, les éléments suivants existent :

- scripts/fetal_ultrasound/deepfetal_adapter/
- plane_inference.py
- quality_inference.py
- fetalclip_model.py
- fetalclip_embeddings.py
- infer_single_image.py
- infer_folder.py
- plane_grouping.py
- extract_embeddings.py

Poids présents :

- plane_classifier.pth ≈ 111 Mo
- filter.pt ≈ 3 Mo
- FetalCLIP_weights.pt ≈ 1,7 Go

Mais :

- aucun endpoint FastAPI échographie ;
- aucun workflow examen complet ;
- aucun test échographie ;
- package fetal_ultrasound/exam incomplet ;
- sources Python manquantes dans exam/ ;
- fetalclip_adapter vide.

L'audit indique que exam/ contient seulement des fichiers .pyc.

==================================================
5. RÈGLE IMPORTANTE SUR LE CODE DEEPFETAL
==================================================

NE PAS essayer de restaurer artificiellement tout le pipeline DeepFetal
à partir des .pyc sans d'abord déterminer ce qui est réellement disponible.

Inspecter :

- dépôt DeepFetal cloné ;
- dépôt FetalCLIP ;
- adapters locaux ;
- scripts existants ;
- checkpoints ;
- configurations ;
- README ;
- scripts d'inférence officiels.

Comparer :

ce qui existe dans le dépôt original
vs
ce qui existe dans AImaging.

Si un composant DeepFetal n'est pas récupérable proprement,
réimplémenter uniquement l'équivalent nécessaire dans AImaging.

NE PAS copier l'intégralité du projet original.

==================================================
6. PHASE 4A — AUDIT DE L'ÉCHOGRAPHIE EXISTANTE
==================================================

Avant de coder :

analyse complètement :

scripts/fetal_ultrasound/
DeepFetal/
FetalCLIP/

Vérifie :

- architecture des modèles ;
- preprocessing ;
- résolution d'entrée ;
- classes ;
- mapping des 41 plans ;
- format des outputs ;
- checkpoints ;
- device CPU/GPU ;
- dépendances ;
- fonctions d'inférence ;
- format des images ;
- possibilité de traiter un dossier ;
- possibilité de traiter un examen complet.

Produis un tableau :

| Module | Code | Checkpoint | Fonctionne seul | API | Statut |
|---|---|---|---|---|---|

Ne modifie rien durant cette sous-phase.

==================================================
7. PHASE 4B — QUALITY FILTER
==================================================

Créer un service d'inférence propre :

fetal_quality_analyze(image)

Le modèle doit produire au minimum :

- score qualité ;
- état accepted / rejected ;
- éventuellement score détaillé si disponible.

Exemple :

{
  "status": "accepted",
  "quality_score": 0.93
}

Une image refusée ne doit pas continuer automatiquement dans le pipeline
si le système considère qu'elle est inutilisable.

Créer un endpoint :

POST /fetal/quality

ou un endpoint groupé si l'architecture existante s'y prête mieux.

Utiliser les Pydantic schemas existants ou en créer de nouveaux.

==================================================
8. PHASE 4C — PLANE CLASSIFICATION
==================================================

Créer un service :

fetal_plane_analyze(image)

Le classifieur couvre 41 plans.

IMPORTANT :

récupérer le mapping EXACT des 41 classes depuis le code/dataset.

Ne pas réinventer les noms.

Le résultat doit contenir :

- plan principal ;
- confiance ;
- probabilités des classes ;
- top-k éventuellement.

Exemple :

{
  "predicted_plane": "...",
  "confidence": 0.91,
  "probabilities": {
      "...": 0.91,
      "...": 0.04
  }
}

Tester au moins 5 classes différentes
avant de traiter un dataset.

==================================================
9. PHASE 4D — PIPELINE IMAGE UNIQUE
==================================================

Avant de construire le pipeline examen,
faire fonctionner le workflow image unique :

image
↓
quality
↓
plane
↓
result

Créer :

POST /fetal/analyze-image

Le résultat doit être structuré.

Exemple conceptuel :

{
  "quality": {...},
  "plane": {...}
}

Ce endpoint sert de brique de base.

==================================================
10. PHASE 4E — PIPELINE MULTI-IMAGE
==================================================

Ensuite seulement, implémenter le traitement d'un examen.

Un examen échographique peut contenir :

image_001
image_002
image_003
...
image_N

Le système doit pouvoir :

1. recevoir plusieurs images ;
2. appliquer le quality filter ;
3. classifier les plans ;
4. grouper les images par plan ;
5. sélectionner les images pertinentes.

Exemple :

EXAM
│
├── Brain
│   ├── image_001
│   └── image_007
│
├── Heart
│   ├── image_012
│   └── image_019
│
└── Abdomen
    ├── image_024
    └── image_029

IMPORTANT :

Ne sélectionne pas arbitrairement les images.

Définis une règle claire :

- score de qualité ;
- score du plan ;
- éventuellement diversité ;
- éventuellement top-k par plan.

Documente cette règle.

==================================================
11. PHASE 4F — FETALCLIP
==================================================

Inspecte le modèle FetalCLIP déjà présent.

Objectif :

utiliser FetalCLIP comme extracteur de caractéristiques visuelles,
pas comme générateur de rapport.

Créer une abstraction :

fetalclip_encode(images)

qui retourne un format exploitable par la suite.

Exemple conceptuel :

{
  "image_id": "...",
  "embedding_path": "...",
  "embedding_shape": [...]
}

Ne stocke pas inutilement les embeddings en base
à ce stade si ce n'est pas nécessaire.

Prévoir cependant une architecture permettant de les référencer.

==================================================
12. PHASE 4G — ANOMALY MODEL
==================================================

IMPORTANT :

Le simple plane classifier ne détecte PAS une anomalie.

Le système doit explicitement séparer :

QUESTION 1 :
"Quel est le plan ?"

QUESTION 2 :
"Le plan est-il normal ou anormal ?"

Pour cette phase :

analyse l'état réel du code existant.

Si aucun modèle d'anomalie n'existe réellement :

NE PAS inventer une implémentation.

Créer uniquement l'interface prévue :

fetal_anomaly_predict(...)

avec un contrat clair.

Le statut doit rester :

NOT_IMPLEMENTED

jusqu'à ce qu'un véritable modèle et des données annotées soient disponibles.

IMPORTANT :

Ne transforme jamais FetalCLIP ou le plane classifier en prétendu détecteur
d'anomalies sans justification.

==================================================
13. PHASE 4H — MULTIMODAL
==================================================

Je veux introduire l'idée multimodale de DeepFetal,
mais progressivement.

Le modèle multimodal doit recevoir uniquement des informations réellement
produites par le pipeline.

Exemple :

IMAGES
+
PLANS
+
QUALITY SCORES
+
FETALCLIP FEATURES
+
INFORMATIONS CLINIQUES DISPONIBLES

↓

MULTIMODAL MODEL

↓

INTERPRETATION STRUCTURÉE

IMPORTANT :

Le multimodal n'est PAS le modèle primaire de détection d'anomalies
s'il ne possède pas de validation spécifique pour cette tâche.

Le multimodal sert à combiner/interpréter les informations.

Si le modèle multimodal n'est pas encore implémenté :

créer seulement l'abstraction et le schema.

Ne pas fabriquer de résultat médical.

==================================================
14. PHASE 4I — API
==================================================

Créer les endpoints nécessaires.

Minimum :

POST /fetal/quality
POST /fetal/plane
POST /fetal/analyze-image
POST /fetal/analyze-exam

Si possible, un endpoint unifié :

POST /fetal/analyze-exam

doit orchestrer :

quality
→ plane
→ grouping
→ selection
→ features
→ anomaly (si disponible)
→ multimodal (si disponible)

Le résultat doit indiquer clairement le statut de chaque étape.

Exemple :

{
  "quality": {
      "status": "ok"
  },

  "planes": [...],

  "selection": [...],

  "features": {
      "status": "ok"
  },

  "anomaly": {
      "status": "not_implemented"
  },

  "multimodal": {
      "status": "not_implemented"
  }
}

Ainsi le frontend pourra évoluer sans devoir attendre que tout le pipeline
soit terminé.

==================================================
15. PHASE 4J — WORKSPACE PROTOCOL
==================================================

L'échographie doit pouvoir être commandée depuis le même système d'actions
que la radiographie.

Créer les commandes UNIQUEMENT si elles correspondent à des actions
réellement implémentées.

Exemples possibles :

@fetal_quality
@fetal_plane
@fetal_analyze

Ne crée pas :

@fetal_anomaly

tant qu'aucun modèle d'anomalie réel n'existe.

Mettre à jour :

- workspace protocol ;
- catalogue des commandes ;
- validation ;
- moteur d'exécution.

Toutes les actions doivent être validées côté serveur.

==================================================
16. PHASE 4K — UI ÉCHOGRAPHIE
==================================================

L'interface utilise maintenant une philosophie de TOOLBOX,
pas de modes séparés.

Pour un examen échographique :

OUTILS SIMPLES

- Move
- Hand
- Zoom
- Rotate
- Crop
- Brightness
- Contrast
- Annotation
- Measure
- Angle
- Distance
- Text

OUTILS IA

- Analyze
- Plane detection
- AI features
- AI selection
- Anomaly analysis (uniquement si disponible)
- Grad-CAM (uniquement si applicable)
- rapport

OUTILS ÉCHO

- Quality
- Plane classification
- Plane grouping
- Selected views
- FetalCLIP
- Multimodal analysis

Ne copie pas exactement les outils radio.

Chaque modalité doit avoir ses propres outils spécifiques.

==================================================
17. PHASE 4L — ÉCRAN D'EXAMEN
==================================================

L'éditeur doit pouvoir recevoir un examen contenant plusieurs images.

Créer une navigation adaptée :

- filmstrip ;
- sélection d'image ;
- groupe par plan ;
- images sélectionnées ;
- qualité ;
- résultat IA.

L'utilisateur doit pouvoir :

- ouvrir une image ;
- voir son plan ;
- voir le score de qualité ;
- voir les images appartenant au même plan ;
- visualiser les images sélectionnées.

Ne pas transformer l'écran en dashboard.

Il reste un logiciel d'édition.

==================================================
18. PHASE 4M — VISUALISATIONS
==================================================

Prévoir des visualisations pour :

Quality

Plane

Selection

Features

Les résultats doivent être visuels.

Exemple :

PLANE

4CH
92 %

QUALITY

94 %

Les probabilités détaillées peuvent être affichées dans un panneau
secondaire.

==================================================
19. PHASE 4N — TESTS
==================================================

Créer une vraie suite de tests échographie.

Minimum :

### Quality
- image valide ;
- mauvaise qualité ;
- entrée invalide.

### Plane
- chargement du checkpoint ;
- mapping des classes ;
- prédiction ;
- probabilité.

### Multi-image
- regroupement ;
- sélection ;
- image rejetée ;
- plusieurs plans.

### FetalCLIP
- chargement ;
- extraction ;
- forme des embeddings.

### API
- /fetal/quality
- /fetal/plane
- /fetal/analyze-image
- /fetal/analyze-exam

### Workspace
- action valide ;
- action invalide ;
- action non implémentée rejetée.

IMPORTANT :

Les tests doivent fonctionner sans modèle d'anomalie si celui-ci n'existe pas encore.

==================================================
20. PHASE 4O — DATASET DE TEST
==================================================

Créer un petit dataset local de test.

Pas besoin de milliers d'images.

Commencer avec :

- 5–10 images de bonne qualité ;
- plusieurs plans ;
- quelques images rejetables.

Idéalement :

5 à 10 images par plan pour les plans disponibles.

Mais ne télécharge pas massivement les 41 classes pour l'instant.

L'objectif est de valider le pipeline technique.

==================================================
21. PHASE 4P — PERFORMANCE
==================================================

Mesurer :

- quality inference ;
- plane inference ;
- FetalCLIP ;
- multi-image pipeline.

Indiquer :

- temps ;
- VRAM ;
- RAM ;
- CPU/GPU ;
- temps par image ;
- temps par examen.

Ne lancer aucun benchmark massif.

==================================================
22. PHASE 4Q — INTÉGRATION DANS L'ÉDITEUR
==================================================

Le résultat doit s'intégrer au workspace actuel.

IMPORTANT :

Ne crée pas une deuxième application.

Le même éditeur doit pouvoir gérer :

Radiographie

et

Échographie.

L'éditeur détermine la modalité de l'examen.

Puis il affiche les outils correspondants.

Conceptuellement :

exam.modality === "radiography"

→ outils simples
→ outils IA
→ outils radio

exam.modality === "fetal_ultrasound"

→ outils simples
→ outils IA
→ outils écho

La structure visuelle reste identique.

Seuls les outils spécifiques changent.

==================================================
23. PHASE 4R — DICOM / IMAGES
==================================================

L'échographie peut être composée de :

- JPG ;
- PNG ;
- éventuellement DICOM.

Ne suppose pas que tous les datasets publics sont DICOM.

Construire l'abstraction pour accepter les formats réellement supportés.

Documenter les différences.

==================================================
24. PHASE 4S — DOCUMENTATION
==================================================

Documenter le pipeline réel :

Examen
↓
Quality
↓
Plane
↓
Selection
↓
FetalCLIP
↓
Anomaly [si disponible]
↓
Multimodal [si disponible]

Indiquer explicitement :

✅ implémenté
🟡 expérimental
❌ non implémenté

Ne jamais présenter l'anomalie comme fonctionnelle
sans modèle validé.

==================================================
25. PHASE 4T — FIN DE PHASE
==================================================

À la fin, lancer :

- tous les tests backend ;
- tests fetal ;
- build frontend ;
- tests workspace.

Créer un scénario E2E :

Créer examen échographique
↓
Importer plusieurs images
↓
Quality
↓
Plane
↓
Grouping
↓
Selection
↓
FetalCLIP
↓
Résultat visible dans l'éditeur

Si anomaly n'est pas encore disponible :

afficher clairement :

"Anomaly analysis not yet available."

NE PAS simuler une prédiction.

==================================================
26. RAPPORT FINAL
==================================================

À la fin, produire :

1. composants échographiques trouvés ;
2. composants réutilisés ;
3. composants réécrits ;
4. checkpoints utilisés ;
5. preprocessing réel ;
6. endpoints ajoutés ;
7. workspace actions ajoutées ;
8. composants frontend ajoutés ;
9. tests ajoutés ;
10. performances ;
11. limites ;
12. éléments non implémentés ;
13. prochaine phase recommandée.

Créer une matrice :

| Fonction | Statut | Test | Endpoint | UI | Limitation |
|---|---|---|---|---|---|

==================================================
RÈGLE DE FIN
==================================================

Cette phase ne doit PAS chercher à terminer artificiellement
la détection des anomalies.

Le pipeline doit d'abord être solide :

QUALITY
→ PLANE
→ SELECTION
→ FEATURES

Puis seulement :

ANOMALY
→ MULTIMODAL

Si les données ou modèles nécessaires aux anomalies ne sont pas présents,
laisser cette partie explicitement "NOT IMPLEMENTED".

Lorsque la phase 4 est terminée :

ARRÊTE-TOI.


Présente le rapport final de Phase 4.