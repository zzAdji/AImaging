# Fonctionnalité : DICOM

## Objectif

Importer, lire et rendre des fichiers DICOM dans le viewer, sans fuite de
données patient. Le DICOM n'est pas persisté côté serveur.

## Flux

```
Import .dcm → Parsing → Pseudonymisation → Rendu PNG + buffer linéaire → Viewer
```

## Traitement

Le serveur (`dicom_service.py`, endpoint `/dicom/parse`) :

1. Enforce des limites (taille max, frames max, pixels max) ;
2. Décode le dataset (`pydicom`) et extrait les pixels ;
3. Pseudonymise : le Patient ID/Name n'est jamais renvoyé en clair, un
   pseudonyme temporaire sert aux contrôles de cohérence ;
4. Rendu de chaque frame en PNG + buffer linéaire rescale (HU) lorsque la
   résolution le permet ;
5. Gère le multi-frame (échantillonnage à 64 frames max).

## Fenêtrage / niveau

Les valeurs window/level (0-255 ou HU) sont transmises ; le client applique le
fenêtrage natif sur les valeurs rescalees via `dicomRenderer.ts`, avec
fallback CSS pour les images trop lourdes.

## Pixel spacing

Le `pixel_spacing_mm` du DICOM est transmis (optionnel) aux analyses
(standardisation, mesures) pour la calibration métrique.

## Sécurité

- Les DICOM bruts ne sont jamais envoyés à Gemini ni persistés.
- Seuls pixels rendus et métadonnées minimales sont retournés.
- Pseudonymisation via `DICOM_PSEUDONYM_KEY` (ou graine aléatoire).

## Fichiers principaux

- `server/dicom_service.py`
- `server/main.py` (`/dicom/parse`)
- `client/src/lib/dicom.ts`, `lib/dicomRenderer.ts`

## Statut

VERIFIED. Limites : certains codecs de décompression peuvent être absents
(erreur lisible), buffer linéaire borné (fallback CSS).