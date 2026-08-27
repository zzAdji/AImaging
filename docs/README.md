# AImaging — Documentation technique

Documentation centrale du projet AImaging.

## Objectif

AImaging est une plateforme SaaS d'analyse d'images médicales par deep
learning, destinée à l'Hôpital Général de Garoua. Le périmètre actif couvre la
**radiographie thoracique**. L'échographie fœtale et la 3D sortent du périmètre
documentaire.

Cette documentation décrit le code réel, pas les intentions passées. Chaque
affirmation doit pouvoir être vérifiée dans le dépôt.

## Documents

| Document | Contenu |
|---|---|
| `architecture.md` | Vue globale et architecture par couche |
| `client.md` | Frontend React : architecture, état, composants |
| `server.md` | Backend FastAPI : routes, services, configuration |
| `scripts.md` | Scripts Python hors serveur (radiographie, opencxr, shared) |
| `api.md` | Référence des endpoints serveur |
| `data-model.md` | Modèle de données et persistance Supabase |
| `workflows.md` | Flux métier réels |
| `configuration.md` | Environnements, variables, ports, dépendances |
| `features/` | [Fiches fonctionnelles par domaine](features/README.md) |

## Structure du dépôt

```
client/        Application React + TypeScript + Vite
server/        API FastAPI (port 8000)
scripts/       Scripts IA et prétraitement
models/        Checkpoints du modèle radiographique (chest_xray)
supabase/      Migrations et configuration Supabase
docs/          Documentation
```

## Mermaid

Les diagrammes figurent dans les documents concernés. L'affichage Mermaid se
fait sur GitHub ou dans VS Code avec l'extension appropriée.

## Convention

La source de vérité est le code actuel. Ne pas documenter une fonctionnalité
qui n'est plus implémentée sans le préciser.