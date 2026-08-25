# AImaging — Site de Présentation

Site vitrine du projet **AImaging** (Hôpital Général de Garoua) : présentation du module de **diagnostic radiographique par intelligence artificielle** et des **performances des modèles**.

Structure, animations et mise en page reprises à l'identique du site `CXR-Pathology_Analysis/frontend`, avec palette et contenus adaptés au projet (charbon + accent bleu `#4F8EF7`). La partie échographie est annoncée « bientôt ».

Identité visuelle : logo `public/images/logo.png` + favicon `app/favicon.ico`.

## Démarrage

```bash
cd presentation-site
npm install
npm run dev      # http://localhost:3000
```

Build de production : `npm run build && npm start`.

## Variables d'environnement (optionnel)

Créer un fichier `.env.local` :

```
NEXT_PUBLIC_APP_URL=http://localhost:5173     # URL de l'application d'analyse (dossier ../client)
NEXT_PUBLIC_BACKEND_URL=http://localhost:8000 # URL du backend FastAPI
```

## Pages

- `/` — Accueil : Hero cinématique → Features → Philosophy → Protocol
- `/performance` — Performances des modèles radiographie

## Insérer vos images de performance

La page `/performance` utilise des **templates** avec images placeholder. Remplacez simplement les fichiers dans :

| Template | Chemin |
|---|---|
| AUC-ROC | `public/images/performance/classification/auc_roc.png` |
| Benchmarks validation | `public/images/performance/classification/validation_benchmark.png` |
| Recouvrement probabilités | `public/images/performance/classification/probability_overlap.png` |
| Benchmark Dice | `public/images/performance/chexmask/dice_benchmark.png` |
| Benchmark IoU | `public/images/performance/chexmask/iou_benchmark.png` |
| Courbe PR | `public/images/performance/chexmask/pr_curve.png` |
| Courbe F1 | `public/images/performance/chexmask/f1_curve.png` |
| Matrice de confusion | `public/images/performance/chexmask/confusion_matrix.png` |
| Courbes d'entraînement | `public/images/performance/chexmask/training_curves.png` |

Les titres/descriptions de chaque carte se modifient dans `app/performance/page.tsx`
(tableaux `BENCHMARKS` et `CHEXMASK_BENCHMARKS`).

## Stack

Next.js (App Router) · React 19 · Tailwind CSS 3 · GSAP + ScrollTrigger · Lenis · lucide-react

Polices : Sora, Instrument Serif, Fira Code.
