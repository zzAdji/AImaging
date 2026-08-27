# Fonctionnalité : Authentification

## Objectif

Connecter l'utilisateur via Supabase Auth et utiliser `auth.uid()` comme
source d'identité pour l'accès aux données (RLS).

## Flux

```
Login → Supabase Auth → session (auth.uid()) → RLS → user data
```

## Traitement

- `authService` (`client/src/lib/db/authService.ts`) centralise la session :
  bootstrap, subscribe, signIn, signOut, sendPasswordReset.
- `AuthProvider` (React) expose `useAuth()` : `isAuthenticated`, `userId`,
  `email`, `displayName`, `loading`.
- Session persistée et rafraîchie automatiquement par supabase-js.
- `getCurrentUserId()` lève une erreur explicite si aucune session.

## Sorties

- Session active (token), identité utilisateur.
- Accès aux données filtrées par RLS.

## Fichiers principaux

- `client/src/state/AuthProvider.tsx`
- `client/src/lib/db/authService.ts`, `supabaseClient.ts`
- `client/src/components/LoginScreen.tsx`

## Limites

- En dev local, la confirmation d'email peut être désactivée.
- Tests live dépendent de comptes de test (voir `docs/auth-setup.md`).