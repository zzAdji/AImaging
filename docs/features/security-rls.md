# Fonctionnalité : Sécurité & RLS

## Objectif

Isoler les données par utilisateur (auth.uid()) au niveau de la base
Supabase, et éviter toute fuite de secret côté frontend.

## RLS

- Toutes les tables couvertes par des politiques d'accès basées sur
  `auth.uid()`.
- Un utilisateur n'accède qu'à ses propres espaces de travail.
- Fonction `owns_workspace(ws_id)` centralise le contrôle d'appartenance.
- Les tests live (`client/tests/live/supabaseLive.test.ts`) valident la matrice
  8 tables (SELECT/INSERT/UPDATE/DELETE) + 3 buckets.

## Authentification

- Supabase Auth (Email/Password), session persistée côté client.
- `getCurrentUserId()` (auth.uid()) = source unique d'identité.
- Pas de lecture directe localStorage pour l'identité.

## Frontend

- Seule la clé publiable `VITE_SUPABASE_PUBLISHABLE_KEY` est exposée.
- La clé `service_role` est interdite côté client et dans Git.

## Pseudonymisation

- DICOM : Patient ID/Name remplacé par un pseudonyme temporaire.
- Voir `docs/features/dicom.md`.

## Fichiers principaux

- `client/src/lib/db/supabaseClient.ts`, `authService.ts`
- `client/src/state/AuthProvider.tsx`
- `supabase/migrations/` (RLS), `client/tests/live/supabaseLive.test.ts`

## Limites / remarques

- En dev, la confirmation d'email peut être désactivée (voir `docs/auth-setup.md`).
- La synchronisation des tests live dépend de credentials locaux (`VITE_DEV_AUTH_*`).