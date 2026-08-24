# AIMAGING — Configuration Supabase Auth (Phase Database 8)

## Paramètres requis dans le projet Supabase (Dashboard)

| Paramètre | Valeur recommandée |
|---|---|
| Authentication › Providers › Email | **Enabled** (Email/Password) |
| Authentication › Providers › Email › Confirm email | **ON** en prod ; OFF acceptable en dev local pour créer les comptes de test rapidement |
| Authentication › URL Configuration › Site URL | `http://localhost:5173` (dev) / domaine final (prod) |
| Authentication › URL Configuration › Redirect URLs | `http://localhost:5173/**` + domaines déployés |
| Email templates (Reset password) | Lien pointant vers le Site URL ci-dessus |

## Comptes de test

1. Créer USER A et USER B (Authentication › Users › Add user, emails distincts,
   mots de passe connus).
2. Renseigner localement `client/.env` :
   - `VITE_DEV_AUTH_EMAIL` / `VITE_DEV_AUTH_PASSWORD` (USER A)
   - `VITE_DEV_AUTH_SECOND_EMAIL` / `VITE_DEV_AUTH_SECOND_PASSWORD` (USER B)
3. Les tests LIVE (`client/tests/live/supabaseLive.test.ts`) valident alors la
   matrice RLS complète (8 tables × SELECT/INSERT/UPDATE/DELETE + 3 buckets).

## Sécurité

- Seules `VITE_SUPABASE_URL` et `VITE_SUPABASE_PUBLISHABLE_KEY` sont utilisées
  côté frontend (clé publiable — acceptable).
- **Aucun** `SUPABASE_SERVICE_ROLE_KEY` ne doit jamais apparaître dans une
  variable `VITE_*`, dans le code, ou dans Git.
