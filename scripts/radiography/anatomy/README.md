# Branche CXAS — Analyse anatomique thoracique

Segmentation anatomique (159 classes PAXRay, modèle UNet-ResNet50
officiel CXAS) + mesures **réellement supportées** par la bibliothèque :
**CTR** (rapport cardiothoracique) et **SCD** (distance colonne-centre),
plus optionnellement area / perimeter / compactness / centroid / box /
convexity / radiomics.

Branche **indépendante** du pipeline de classification (5 modèles +
soft voting + Grad-CAM) : aucun fichier de classification n'est
modifié, et le serveur démarre sans.

## Installation (réseau lent : opérations séparables)

```bash
python scripts/radiography/anatomy/install_cxas.py                          # tout
python scripts/radiography/anatomy/install_cxas.py --patch-only             # patch seul
python scripts/radiography/anatomy/install_cxas.py --weights-only           # poids seuls
python scripts/radiography/anatomy/install_cxas.py --verify-only            # self-test seul
python scripts/radiography/anatomy/install_cxas.py --with-simpleitk         # + lecture DICOM
python scripts/radiography/anatomy/install_cxas.py --wheels-dir <dossier>   # wheels locaux
```

Ce que fait le script (et que ferait sinon `pip install cxas`) :

1. `pip install cxas --no-deps` + `gdown colorcet beautifulsoup4 soupsieve pycocotools`
   (+ `SimpleITK` avec `--with-simpleitk`).
   **Ne touche ni torch, ni pydicom, ni numpy, ni opencv, ni scikit-learn**.
2. **Patch « lazy »** dans le site-packages (indispensable) : le serveur
   utilise pydicom 3.0.2 alors que cxas déclare `pydicom>=2.4.5,<3`.
   Le patch déplace les imports de `SimpleITK`, `pydicom_seg` et
   `skimage` au moment de leur usage : `import cxas` ne charge plus
   aucune de ces dépendances. Validé sur Python 3.14.5.
3. **Poids** : téléchargés automatiquement au premier usage de la classe
   `CXAS` (gdown) dans `~/.cxas/weights/` (`CXAS_PATH` pour changer).
   ~250 Mo — relancé jusqu'à 5 fois par le script.
4. **Self-test** : masques synthétiques → CTR et SCD doivent retourner
   des valeurs numériques.

## Test sur images réelles (validation ~échantillon)

```bash
# Image unique
python -m scripts.radiography.anatomy.main_test --image data/test/image.jpg

# Échantillon 9 images/classe (36 images) avec agrégat CSV/JSON
python -m scripts.radiography.anatomy.main_test --sample-dir data/chest-xray \
    --sample-per-class 9 --seed 42
```

(À exécuter depuis la racine du dépôt : le paquet `scripts.radiography.anatomy`
s'importe via le répertoire courant.)

Sorties dans `outputs/cxas/<image_fichier>_*/` :
`images/original.png`, `overlays/overlay.png`, `overlays/montage.png`
(original | masques | overlay), `masks/<label>.png` et
`measurements/results.json` ; agrégat global `outputs/cxas/validation/`.

## Unités et limites (importantes)

- **CTR** : coefficient sans dimension (≈0,4–0,6 sur thorax sain).
- **SCD** : **en pixels sur la grille 512×512 de CXAS**. Le champ
  `value_px_original` applique un facteur approximatif vers la taille
  d'origine, et `value_mm` exige le PixelSpacing des DICOM
  (`--pixel-spacing-mm` ou l'option serveur) — conversions indicatives,
  **non calibrées cliniquement**.
- Les JPG du dataset n'ont pas de métadonnées : SCD restera en pixels.
- Le dataset contient des `.jpeg` (non acceptés par cxas) : le module
  les convertit en `.png` temporaire à la volée.
- DICOM : support limité sans SimpleITK, support complet avec
  `--with-simpleitk` (20 Mo à télécharger, réseau lent).

## Intégration serveur (à venir)

`analyze_anatomy()` retourne un `AnatomyResult` sérialisable (masques
PNG en data-URL, mesures, durées) — prêt pour un endpoint
`POST /workspace/exams/{workspace_id}/anatomy` avec chargement
paresseux (le serveur ne charge CXAS qu'à la première demande).