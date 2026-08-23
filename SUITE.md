# AIMAGING — PHASE DATABASE 4
# MIGRATION DES IMAGES VERS SUPABASE STORAGE
#
# OBJECTIF :
# remplacer progressivement le stockage local des images par
# Supabase Storage + examination_images, sans encore migrer
# les annotations, mesures, résultats IA ou rapports.
#
# IMPORTANT :
# La Phase Database 3 est terminée.
#
# Les examens sont maintenant persistés dans Supabase.
#
# Les images restent encore locales :
# - data URLs ;
# - rendered DICOM frames ;
# - cache local.
#
# Cette phase a UN SEUL objectif :
#
# IMAGE FILE
#     ↓
# SUPABASE STORAGE
#     ↓
# examination_images
#     ↓
# application
#
# NE PAS migrer :
# - annotations
# - measurements
# - analysis_runs
# - classification_results
# - Grad-CAM
# - reports
# - WorkspaceStore
# - FetalExamProvider
# - authentification complète
# - IA
# - CXAS
# - HybridGNet
# - DeepFetal
# - 3D
#
# La 3D est définitivement hors périmètre.

==================================================
1. ÉTAT ACTUEL
==================================================

La Phase 2 a créé :

- Supabase PostgreSQL
- RLS
- Storage
- repositories
- types

La Phase 3 a migré :

- workspaces
- examinations

vers Supabase.

Le frontend continue à fonctionner avec un cache local
pour les données non encore migrées.

L'objectif de cette phase est maintenant de migrer
les FICHIERS IMAGES.

==================================================
2. AUDIT AVANT MODIFICATION
==================================================

Inspecter :

client/src/lib/examinations.ts
client/src/App.tsx
client/src/lib/recent.ts
client/src/lib/dicom.ts
client/src/lib/dicomRenderer.ts
client/src/state/WorkspaceProvider.tsx
client/src/components/ExamsScreen.tsx
client/src/lib/db/repositories/imageRepository.*
client/src/lib/db/repositories/examinationRepository.*

Identifier précisément :

- comment les images sont importées ;
- où le File original existe ;
- comment le data URL est créé ;
- comment une image est restaurée ;
- comment les dimensions sont stockées ;
- comment le DICOM est traité ;
- comment les frames sont gérées ;
- comment une image est affichée après rechargement.

NE MODIFIE RIEN avant cet audit.

==================================================
3. OBJECTIF DE STOCKAGE
==================================================

Les fichiers physiques doivent désormais aller dans :

Supabase Storage

Bucket :

medical-images

Structure :

medical-images/
  {user_id}/
    {workspace_id}/
      {examination_id}/
        images/
          {image_id}/
            {filename}

La table :

examination_images

conserve les métadonnées.

AUCUNE image ne doit être stockée comme :

- base64 ;
- data URL ;
- bytea ;
- JSON énorme.

==================================================
4. IMAGE RECORD
==================================================

Pour chaque fichier importé :

1. obtenir ou créer examination_image.id ;
2. construire son storage_path ;
3. upload vers Storage ;
4. enregistrer storage_path dans PostgreSQL ;
5. enregistrer les métadonnées ;
6. conserver temporairement le cache local nécessaire au rendu.

Exemple de record :

{
  id,
  examination_id,
  filename,
  storage_path,
  mime_type,
  width,
  height,
  sort_order,
  source_kind,
  metadata
}

==================================================
5. IMPORTANT — NE PAS SUPPRIMER IMMÉDIATEMENT LE CACHE LOCAL
==================================================

Pendant cette phase :

Supabase Storage = source persistante du fichier

localStorage / mémoire = cache de compatibilité

Le but est d'éviter toute régression.

Le système doit donc pouvoir :

READ

Supabase Storage
   ↓
si disponible → image
   ↓
sinon → cache local fallback

WRITE

import
   ↓
upload Storage
   ↓
insert/update examination_images
   ↓
mettre à jour cache local

==================================================
6. IMPORT D'IMAGE
==================================================

Modifier progressivement le workflow :

Import image
↓
validation fichier
↓
création record examination_images
↓
upload Storage
↓
metadata DB
↓
affichage canvas

L'interface ne doit pas changer.

Les cartes, filmstrip, canvas et outils existants
doivent rester identiques.

==================================================
7. UPLOAD SÉCURISÉ
==================================================

Les buckets sont privés.

NE PAS rendre medical-images public.

Utiliser les mécanismes Supabase adaptés
aux fichiers privés.

Ne jamais exposer une clé service_role.

Les chemins Storage doivent être dérivés des IDs
réellement autorisés.

NE JAMAIS accepter un user_id arbitraire envoyé
par le frontend pour contourner les policies.

==================================================
8. TYPES DE FICHIERS
==================================================

Préserver le support actuel pour :

- JPEG
- PNG
- DICOM

Ne change pas le comportement de lecture DICOM existant.

IMPORTANT :

Pour les DICOM :

ne pas supprimer la logique actuelle de pseudonymisation.

Le stockage du fichier original et les métadonnées pseudonymisées
doivent rester séparés.

Ne jamais exposer inutilement :

PatientName
PatientID
etc.

==================================================
9. DICOM
==================================================

Le système actuel peut produire des frames/renders.

Avant modification, déterminer exactement :

- ce qui doit être conservé comme source ;
- ce qui doit être dérivé ;
- ce qui doit rester en mémoire.

Objectif cible :

Original DICOM
→ Storage

Métadonnées pseudonymisées
→ PostgreSQL

Rendered frame
→ cache/dérivé si nécessaire

LinearImageBuffer
→ NE PAS persister

Ne pas transformer automatiquement tous les frames
en fichiers indépendants en base si cela n'est pas nécessaire
à l'architecture actuelle.

Présenter ton choix avant implémentation si ambigu.

==================================================
10. UPLOAD ATOMIQUE
==================================================

Éviter les états incohérents.

Le flux doit être :

1. créer/valider l'identité du fichier ;
2. upload Storage ;
3. créer/mettre à jour le record DB ;
4. retourner le record complet.

Si l'upload réussit mais que l'insert DB échoue :

gérer explicitement le nettoyage du fichier orphelin.

Si l'insert DB réussit mais que l'upload échoue :

ne jamais présenter l'image comme synchronisée.

Aucune erreur silencieuse.

==================================================
11. ÉTAT DE SYNCHRONISATION
==================================================

Réutiliser le système existant :

synced
syncing
error
local-only

Exemple :

image uploading...
image synced
image sync error
local cached

Ne pas afficher "Saved" si le fichier n'existe
que localement alors que Supabase est disponible.

==================================================
12. FILMSTRIP / ÉDITEUR
==================================================

Le rendu actuel de l'éditeur doit rester identique.

Le remplacement :

dataUrl
→
Storage URL

ne doit pas changer :

- le zoom ;
- le pan ;
- les outils ;
- les annotations ;
- le fenêtrage ;
- les mesures ;
- la command bar.

Si l'application a besoin d'un data URL pour CanvasViewport,
créer une fonction de chargement temporaire :

storage object
→ Blob
→ object URL / data URL
→ renderer

Mais ne pas réécrire le viewer.

==================================================
13. RECENT FILES
==================================================

Examiner :

lib/recent.ts

Ne plus considérer le data URL comme la source principale
d'un fichier.

Conserver éventuellement :

- filename ;
- examination_id ;
- image_id ;
- storage_path ;
- timestamp.

Les handles IndexedDB peuvent rester en compatibilité
pendant cette phase.

Ne pas casser Ctrl+O / récents.

==================================================
14. MIGRATION DES IMAGES EXISTANTES
==================================================

Créer un script ou une fonction de migration idempotente.

Entrée :

anciens examens localStorage / cache local.

Pour chaque image :

1. identifier examination.legacy_id ;
2. retrouver examination UUID ;
3. retrouver/créer examination_images ;
4. convertir le contenu vers un Blob/File si nécessaire ;
5. upload Storage ;
6. enregistrer storage_path ;
7. marquer comme synchronisé.

NE PAS supprimer immédiatement les données locales.

La suppression du cache sera faite dans une phase ultérieure
après validation.

==================================================
15. DÉDOUBLONNAGE / ID CHEMINS
==================================================

Le stockage doit être idempotent.

Une relance du processus ne doit pas créer des centaines
de fichiers identiques.

Utiliser :

image_id

comme élément stable du chemin.

Éventuellement utiliser une empreinte du fichier pour
détecter les doublons, mais uniquement si cela s'intègre
proprement au modèle existant.

Ne pas inventer un système de déduplication complexe
sans besoin.

==================================================
16. SUPPRESSION
==================================================

Avant migration :

delete examination
→ delete local object

Après migration :

delete examination
→ delete DB records
+
delete Storage objects

Mais attention :

Cette phase doit seulement préparer le comportement.

Si le repository actuel ne sait pas encore faire le cleanup
Storage de manière sûre, implémente le minimum nécessaire
et documente le reste.

Ne crée pas de suppression destructive irréversible
sans confirmation dans l'interface si l'UI actuelle ne l'exige pas.

==================================================
17. DUPLICATION
==================================================

Après migration des images :

la duplication doit être clairement définie.

Ne pas simplement partager le même fichier sans raison.

Pour l'instant :

duplicate examination
→ nouvel examination UUID
→ nouvelles examination_images
→ nouveaux chemins Storage
ou référence contrôlée selon la stratégie choisie.

Présente le choix avant implémentation si le comportement
du produit n'est pas encore clairement défini.

==================================================
18. TESTS
==================================================

Créer des tests pour :

- upload image ;
- création examination_image ;
- lecture ;
- synchronisation ;
- erreur upload ;
- erreur DB ;
- fallback local ;
- migration idempotente ;
- delete ;
- duplicate ;
- DICOM ;
- JPEG ;
- PNG.

Tester qu'une image non synchronisée ne soit jamais
présentée comme synchronisée.

==================================================
19. TESTS SUPABASE RÉELS
==================================================

La Phase 3 n'a pas pu réaliser les tests live car la base
n'était pas provisionnée dans l'environnement de développement.

Cette phase doit, si les credentials sont maintenant configurés,
effectuer au moins :

1. upload réel ;
2. lecture réelle ;
3. création DB réelle ;
4. génération d'une URL/lecture contrôlée ;
5. suppression réelle.

Si les credentials live ne sont toujours pas disponibles :

ne pas simuler un "PASS".

Marquer explicitement :

SKIPPED — Supabase credentials unavailable.

==================================================
20. STORAGE SECURITY TEST
==================================================

Tester :

USER A
→ peut lire son fichier

USER B
→ ne peut pas lire le fichier A

USER B
→ ne peut pas supprimer le fichier A

Ne pas utiliser service_role pour vérifier ce comportement.

==================================================
21. PERFORMANCE
==================================================

Mesurer sur quelques images :

- temps upload ;
- temps download ;
- taille ;
- conversion éventuelle ;
- mémoire utilisée.

Ne pas benchmarker des milliers d'images.

==================================================
22. NON-RÉGRESSION
==================================================

Après migration :

- npm run build ;
- tests frontend ;
- tests Supabase foundation ;
- tests Phase 3 ;
- backend existant.

Ne pas introduire de régression dans :

- ExamsScreen ;
- CanvasViewport ;
- DICOM ;
- radio ;
- échographie UI ;
- command bar.

==================================================
23. CE QUI RESTE LOCAL APRÈS CETTE PHASE
==================================================

À la fin :

Local uniquement :

- annotations ;
- mesures ;
- résultats IA ;
- Grad-CAM ;
- reports ;
- FetalExamProvider ;
- WorkspaceStore ;
- undo/redo ;
- préférences ;
- session.

Supabase :

- workspaces ;
- examinations ;
- examination_images ;
- fichiers images.

==================================================
24. RAPPORT FINAL
==================================================

Produire :

1. architecture avant/après ;
2. fichiers modifiés ;
3. stratégie Storage ;
4. stratégie DICOM ;
5. migration des images ;
6. fallback ;
7. suppression ;
8. duplication ;
9. tests ;
10. tests live Supabase ;
11. problèmes ;
12. recommandation Phase 5.

Matrice :

| Fonction | Avant | Après | Testé | Statut |
|---|---|---|---|---|
| Import JPEG | local | Storage | ✓ | DONE |
| Import PNG | local | Storage | ✓ | DONE |
| Import DICOM | local | Storage | ✓ | DONE |
| Load image | local | Storage + cache | ✓ | DONE |
| Delete | local | DB + Storage | ✓ | DONE |
| Duplicate | local | DB + Storage | ✓ | DONE |
| Fallback | local | local | ✓ | DONE |

==================================================
RÈGLE FINALE
==================================================

Cette phase concerne UNIQUEMENT :

EXAMINATION IMAGES
+
SUPABASE STORAGE

Ne migre pas :

- annotations ;
- measurements ;
- AI results ;
- reports ;
- WorkspaceStore ;
- FetalExamProvider ;
- Auth complète.

Lorsque cette phase est terminée :

ARRÊTE-TOI.

Ne commence pas automatiquement une autre phase.