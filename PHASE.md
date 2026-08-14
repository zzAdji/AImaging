Phase 1 — Fondations du modèle de donnéesCréer une notion explicite de WorkspaceExam côté client et côté serveur.
Chaque image doit avoir :
imageId stable ;
nom et ordre dans l’examen ;
fichier original ou référence de fichier ;
aperçu PNG/JPEG pour Gemini ;
pixels originaux pour les modèles de vision ;
dimensions ;
métadonnées DICOM si disponibles ;
identifiant de série, étude, patient pseudonymisé et modalité ;
annotations et mesures existantes ;
résultat de prédiction associé ;
Grad-CAM associée, si demandée ;
état d’analyse : en attente, analyse, terminé, erreur.
L’état IA envoyé au serveur ne doit pas être seulement une capture d’écran. Il doit combiner :
les pixels de l’image originale, pour la prédiction ;
un rendu du canvas, pour que Gemini voie annotations, couleurs, formes et mesures ;
un manifeste JSON précis de tous les objets du canvas.
Ainsi l’IA peut comprendre visuellement le contexte tout en ayant les coordonnées exactes de chaque élément.
Phase 2 — Contrat d’actions IA structuré
Remplacer les commandes locales fictives par un protocole unique d’actions versionné.
Chaque action contient :
id ;
type ;
targetImageId ;
order ;
reason ;
confidence ;
données d’exécution ;
avertissements éventuels.
Exemples de familles d’actions à prendre en charge :
Famille	Actions
Analyse	analyze_image, analyze_exam, predict, generate_report, explain_prediction
Vue	zoom_to_region, fit_image, set_window_level, set_brightness, set_contrast, invert, rotate, flip
Annotations	create_annotation, create_text, create_rectangle, create_ellipse, create_arrow, create_line, create_freehand
Mesures	create_distance, create_measure, create_angle, label_measurement
Gestion objets	update_shape, move_shape, resize_shape, style_shape, delete_shape, set_visibility, select_shape
Couches	set_layer_visibility, set_layer_opacity, lock_layer, rename_layer
Vision	generate_gradcam, show_gradcam, set_gradcam_opacity, focus_gradcam_region
Rapport	replace_report, append_report_section, rewrite_report_section, highlight_report_evidence
Navigation multi-images	select_image, focus_image, compare_images, synchronize_view
Notifications	info, warning, error




Les objets créés par l’IA doivent être identifiables, par exemple avec author: "ai" et commandId. Cela facilite l’historique, le filtrage et l’annulation.
Exemple conceptuel :
{
  "order": 3,
  "type": "create_annotation",
  "targetImageId": "image-02",
  "reason": "Mettre en évidence la région d'attention principale.",
  "data": {
    "x": 1240,
    "y": 890,
    "label": "Zone d'attention du modèle",
    "style": {
      "color": "#f97316",
      "fontSize": 18,
      "fontWeight": "bold"
    }
  }
}
Les coordonnées doivent toujours être en pixels de l’image originale, jamais en coordonnées d’écran ou de zoom.
Phase 3 — Syntaxe de commande utilisateur
Deux modes d’entrée.
Instruction libre
Sans préfixe, le texte est une instruction à interpréter :
« Mets en évidence les zones les plus utiles à relire et rédige un résumé. »


Gemini génère alors une séquence structurée d’actions.
Commande explicite
Le préfixe @ indique que l’utilisateur veut une commande directe.
Exemples :
@analyze all
@gradcam image:2 opacity:65
@annotation image:1 x:430 y:210 text:"Opacité à contrôler" color:#ef4444 size:18
@measure image:3 from:120,300 to:780,300 color:#22c55e width:3 label:"Distance"
@wl image:1 preset:lung
@layer measurements hide
@report generate
Le champ de saisie doit :
détecter immédiatement @ ;
afficher une liste de commandes disponibles ;
proposer auto-complétion, paramètres et exemples ;
valider la syntaxe avant envoi ;
signaler clairement les paramètres manquants ;
garder l’historique des commandes personnalisées ;
permettre d’enregistrer une séquence sous un nom, par exemple @preset pneumonie.
Une commande non reconnue n’est jamais exécutée. L’IA retourne une erreur structurée avec suggestion de correction.
Phase 4 — Exécution libre mais transactionnelle
L’IA agit sans approbation humaine supplémentaire, conformément à votre demande. En contrepartie, chaque réponse doit être exécutée comme une transaction.
Cycle :
Le client envoie l’instruction et le contexte d’examen.
Le serveur renvoie le plan d’actions validé.
Le client prévalide les cibles, coordonnées, types et limites.
Le client exécute les actions strictement dans l’ordre.
Une seule entrée d’historique est créée pour toute la séquence.
Ctrl+Z annule l’intégralité de la séquence IA.
Le journal expose ce qui a été fait, sur quelle image et pourquoi.
Si l’action 4 sur 8 échoue, les actions précédentes doivent être annulées ou l’état doit clairement indiquer une exécution partielle. Je recommande l’annulation automatique : le canvas reste cohérent.
Phase 5 — Analyse automatique à l’ouverture
Dès qu’un espace de travail contient une ou plusieurs images stables :
Vérifier les formats et métadonnées.
Regrouper les images par étude et série.
Détecter les incohérences éventuelles.
Construire le contexte global de l’examen.
Lancer la prédiction sur les images compatibles.
Générer les Grad-CAM nécessaires.
Produire une synthèse initiale.
Afficher les résultats dans les panneaux IA.
Le loader doit être de type Figma :
une progression globale : Préparation de l’examen — 2 / 5 images ;
une progression par image ;
les sous-étapes visibles : lecture, validation DICOM, prédiction, Grad-CAM, synthèse ;
l’application reste utilisable pendant le chargement ;
les images déjà analysées deviennent immédiatement interactives ;
une erreur sur une image n’empêche pas les autres de terminer.
Ne pas lancer l’analyse tant que les dimensions réelles de l’image ne sont pas disponibles.
Phase 6 — Multi-images et cohérence d’examen
Le serveur doit analyser l’examen comme un ensemble, pas comme une simple liste de fichiers.
Contrôles à implémenter :
même StudyInstanceUID et PatientID pseudonymisé pour les DICOM ;
modalité compatible ;
même région anatomique ou séries cohérentes ;
détection d’images provenant vraisemblablement d’études différentes ;
détection de doublons ;
ordre des images et orientation ;
dimensions ou espacement pixel incohérents ;
avertissement si une image PNG/JPEG ne permet pas de confirmer son appartenance à l’examen.
Exemples de retours :
avertissement : « L’image 4 n’a pas de métadonnées DICOM ; son appartenance à l’examen ne peut pas être vérifiée. »
erreur : « Les images 1 et 3 ont des Study UID différents : comparaison clinique désactivée. »
avertissement : « La mesure en mm est indisponible : Pixel Spacing absent. Affichage en pixels uniquement. »
L’IA doit pouvoir cibler une image ou toutes les images :
@analyze image:2
@analyze all
@compare image:1 image:3
@annotation image:all text:"À relire"
Phase 7 — DICOM réel
L’ouverture DICOM actuelle est seulement déclarée dans l’interface : elle doit devenir réelle.
Le backend devra :
lire les fichiers DICOM ;
extraire pixels, fenêtres/niveaux, orientation, PixelSpacing, modality, série et étude ;
gérer les niveaux de gris médicaux ;
produire un aperçu web sans perdre l’original ;
renvoyer les métadonnées non sensibles nécessaires au client ;
appliquer les mesures en mm uniquement si la calibration existe ;
traiter les multi-frames si nécessaire.
Le frontend devra :
afficher les vrais tags utiles au lieu des valeurs fictives ;
distinguer clairement une mesure calibrée d’une mesure en pixels ;
utiliser les valeurs DICOM de fenêtre/niveau ;
conserver l’original DICOM pour le serveur, même si le canvas affiche un rendu PNG.
Phase 8 — Grad-CAM côté serveur
La Grad-CAM doit être générée avec le modèle ayant produit la classification, jamais inventée par Gemini.
Endpoint ou opération serveur :
reçoit imageId et éventuellement le modèle ou la classe cible ;
calcule la carte d’activation ;
normalise et retourne une superposition PNG/WebP ;
retourne aussi la région d’attention principale, ses coordonnées image et la classe concernée ;
garde la provenance : modèle, classe cible, date, paramètres.
Le client réutilise sa couche Grad-CAM existante pour :
afficher/masquer la carte ;
régler l’opacité ;
zoomer sur la région d’attention ;
créer éventuellement une annotation IA liée à la carte.
L’interface doit préciser que la Grad-CAM est une explication de contribution du modèle, non une segmentation ou une preuve anatomique.
Phase 9 — Gemini comme planificateur multimodal
Le serveur doit donner à Gemini :
les aperçus des images de l’examen ;
des vues canvas actualisées, seulement quand nécessaires ;
la liste précise des formes, mesures, calques et styles ;
les résultats de prédiction et Grad-CAM ;
les métadonnées d’examen autorisées ;
le catalogue exhaustif d’outils et leurs schémas ;
les limites médicales et les règles de sécurité.
Gemini retourne uniquement un JSON validé par Pydantic :
résumé utilisateur ;
diagnostics/explanations ;
avertissements ;
liste d’actions ordonnées ;
rapport éventuel ;
références aux images et aux éléments canvas existants.
Le serveur rejette toute action :
avec image inexistante ;
avec coordonnées hors image ;
avec couleur, taille ou épaisseur hors limites ;
avec objet inconnu ;
qui tente de produire une mesure en mm sans calibration ;
qui prétend à une localisation clinique sans source vision valide.
Phase 10 — Capture de canvas et contexte vivant
Une capture du canvas est utile, mais ne doit pas être faite à chaque frappe.
Déclencheurs recommandés :
avant une instruction qui concerne les annotations ou la géométrie ;
après une séquence IA modifiant le canvas ;
lorsqu’un utilisateur demande une explication d’une zone visible ;
lorsqu’il demande à modifier ou déplacer un objet existant ;
lors d’une analyse globale initiale ;
sur demande explicite @context refresh.
Le contexte doit être limité et compressé :
image originale ou aperçu ;
screenshot canvas ;
manifeste JSON ;
image active ;
sélection active ;
viewport courant ;
actions récentes.
Pour préserver la performance, utiliser un hash de l’état canvas et ne renvoyer une capture que si cet état a changé.
Phase 11 — Interface utilisateur à ajouter
Le mode IA doit inclure :
état global de l’examen et de chaque image ;
timeline des actions IA ;
panneau d’avertissements et erreurs ;
journal expliquant chaque modification ;
distinction visuelle entre objets utilisateur et objets IA ;
sélection des images analysées ;
onglet « Contexte envoyé à l’IA » ;
indication de l’image ou série active ;
bouton « Annuler la dernière séquence IA » ;
arrêt d’exécution pour une séquence longue ;
reprise ou relance d’une analyse image par image ;
gestion des requêtes en attente et expirées.
Les métadonnées actuellement fictives du panneau IA — modèle, latence, série — devront être remplacées par les données réelles renvoyées par le backend.
Phase 12 — API à construire
À terme, le backend exposera au minimum :
Endpoint	Rôle
POST /workspace/exams	Crée une analyse temporaire d’examen
POST /workspace/exams/{id}/images	Ajoute une image/DICOM
POST /workspace/exams/{id}/analyze	Analyse globale ou ciblée
GET /workspace/exams/{id}/status	État et progression du loader
POST /workspace/exams/{id}/gradcam	Produit une Grad-CAM ciblée
POST /workspace/exams/{id}/commands	Interprète instruction libre ou @commande
POST /workspace/exams/{id}/reports	Génère le rapport Gemini
GET /workspace/exams/{id}/context	Retourne l’état consolidé




Sans authentification ni persistance, ces examens peuvent rester temporaires en mémoire ou dans un stockage de fichiers temporaire avec nettoyage automatique.
Phase 13 — Sécurité, limites et traçabilité
Même avec exécution autonome, il faut absolument :
ne jamais inclure la clé Gemini dans le navigateur ;
journaliser commande, contexte, modèle, réponse et actions exécutées ;
marquer les sorties IA comme assistance ;
permettre l’annulation complète ;
conserver les annotations IA séparables des annotations humaines ;
bloquer toute tentative de conclusion définitive non justifiée par le modèle ;
ne pas présenter une mesure non calibrée comme une donnée clinique ;
limiter la taille et le nombre d’images envoyées à Gemini ;
prévoir l’effacement automatique des images temporaires ;
afficher explicitement les limites du classifieur actuel : classification globale thoracique, pas segmentation diagnostique.
Ordre concret de réalisation
Créer le modèle WorkspaceExam, les identifiants d’images et le manifeste canvas.
Brancher l’analyse réelle multi-images sur le serveur existant.
Remplacer les diagnostics et rapports fictifs dans le front.
Construire le format JSON d’actions, sa validation et son moteur d’exécution transactionnel.
Ajouter les commandes explicites @ avec auto-complétion.
Relier Gemini au planificateur d’actions structuré.
Implémenter les actions de canvas existantes : styles, textes, formes, mesures, calques, réglages d’affichage.
Ajouter le contexte visuel canvas + manifeste de formes.
Implémenter Grad-CAM réelle sur le serveur et sa couche visuelle.
Implémenter la lecture DICOM réelle, mesures calibrées et contrôles de cohérence.
Ajouter l’analyse automatique à l’ouverture avec progression par image.
Ajouter comparaison inter-images, avertissements et gestion fine des erreurs.
Tester les plans IA, erreurs, annulations et exécutions multi-images avant toute utilisation clinique.

Voici ce que j'ai fait et ce qui restait.

Terminées :
Modèle WorkspaceExam, identifiants d’images et manifeste canvas.
Analyse serveur multi-images.
Remplacement des données fictives par prédictions et rapports serveur.
Plans d’actions JSON, validation et exécution contrôlée.
Commandes explicites @ et auto-complétion.
Planificateur Gemini structuré.
Actions canvas : annotations, styles, formes, mesures, calques et affichage.
Contexte visuel canvas et manifeste de formes.
Grad-CAM réelle serveur + affichage.
DICOM, mesures calibrées et cohérence.
Analyse automatique à l’ouverture avec progression.
Avertissements et erreurs de cohérence déterministes.
Reste à finaliser :
Exécution réellement transactionnelle d’actions IA sur plusieurs images en une seule fois : le plan peut les cibler, mais le moteur client doit encore orchestrer proprement les changements d’image et l’annulation globale.
Tests de bout en bout avec Gemini et de vrais DICOM cliniques, notamment compressés.
Fenêtrage/niveau DICOM natif sur les pixels bruts ; l’import respecte le fenêtrage initial, mais l’ajustement interactif reste une prévisualisation.