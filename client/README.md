# Client — AImaging

Application web React + TypeScript + Vite. Interface d'édition médicale :
images, annotations, mesures, analyses IA, rapports.

## Rôle

C'est le frontend d'AImaging. L'utilisateur s'authentifie (Supabase Auth),
gère ses examens, ouvre un workspace, analyse les images et édite les rapports.

## Démarrage

```bash
npm install
npm run dev      # http://localhost:5173
```

## Build

```bash
npm run build    # tsc -b && vite build
```

## Tests

```bash
npm run test     # vitest run (unitaires)
# Tests live (Supabase) : client/tests/live/, nécessitent VITE_DEV_AUTH_* locaux
```

## Lint

```bash
npm run lint     # eslint .
```

## Architecture

Voir [docs/client.md](../docs/client.md) pour la vue détaillée.

Structure `src/` :

- `components/` : composants React (canvas, panneaux, IA, fœtal).
- `state/` : providers (`AuthProvider`, `WorkspaceProvider`,
  `EditorModalityProvider`).
- `lib/` : logique métier et services.
- `lib/db/` : repositories Supabase (auth, examens, images, rapports,
  persistence éditeur).

## Providers principaux

| Provider | Rôle |
|---|---|
| `AuthProvider` | Session Supabase, `useAuth()`. |
| `WorkspaceProvider` | État central du workspace et orchestration IA. |
| `EditorModalityProvider` | Choix de la modalité d'édition. |

## Persistance

- Supabase (PostgreSQL + Storage) : sources de vérité.
- `localStorage` : préférences UI, récents.
- Sans Supabase configuré (`VITE_SUPABASE_URL`), l'app fonctionne en mode
  dégradé local.

## Intégration API

`lib/workspaceApi.ts` appelle l'API FastAPI (base : `VITE_API_BASE_URL`).
Voir [docs/api.md](../docs/api.md).

## Configuration

Voir [client/.env.example](.env.example) et [docs/configuration.md](../docs/configuration.md).

## Limites

- Mode local (sans Supabase) : une partie de la persistance n'est pas
  disponible.
- L'échographie (composants `fetal/`) est hors périmètre actif.

