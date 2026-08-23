-- ============================================================================
-- AIMAGING · Phase Database 2 · Fondation Supabase
-- 0001_extensions_and_helpers.sql
--
-- Extensions et helpers transversaux.
--
-- gen_random_uuid() est natif depuis PostgreSQL 13 (fourni par Supabase) :
-- aucune extension supplémentaire n'est installée volontairement.
-- (FONDATION.md §6 : ne pas installer d'extensions inutiles.)
-- ============================================================================

-- Fonction commune de maintenance de `updated_at` (FONDATION.md §17).
-- Une seule fonction de trigger, appliquée table par table dans les
-- migrations suivantes : jamais de logique copiée-collée dans chaque table.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at := now();
    return new;
end;
$$;
