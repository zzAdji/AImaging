# AIMAGING — PHASE 9A
# VALIDATION LIVE SUPABASE

La base Supabase et l'architecture de persistance sont maintenant
implémentées.

Les tests live sont déjà préparés dans :

client/tests/live/supabaseLive.test.ts

Cette étape ne doit ajouter aucune fonctionnalité.

OBJECTIF :

Exécuter réellement les tests live avec un vrai projet Supabase.

==================================================
1. CONFIGURATION
==================================================

Vérifie que les variables nécessaires sont présentes.

Frontend :

VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY

Variables de test utilisées par la suite live,
selon la configuration déjà prévue dans le repository.

NE JAMAIS demander ou afficher une service_role key côté frontend.

Si une clé serveur est nécessaire pour préparer
les utilisateurs de test, elle doit rester hors du frontend.

==================================================
2. UTILISATEURS TEST
==================================================

Créer ou utiliser réellement :

USER A
USER B

Les credentials doivent être locaux et non commités.

==================================================
3. AUTH
==================================================

Tester réellement :

USER A login
USER A session restore
USER A logout

USER B login
USER B session restore
USER B logout

==================================================
4. DATABASE
==================================================

USER A :

create workspace
create examination
create image metadata
create annotation
create measurement
create analysis run
create classification result
create report

Vérifier lecture / modification / suppression.

==================================================
5. RLS
==================================================

USER A crée les données A.

USER B tente :

SELECT
INSERT
UPDATE
DELETE

sur les ressources A.

Résultat attendu :

TOUT accès interdit.

USER B ne doit obtenir aucune donnée A.

==================================================
6. STORAGE
==================================================

USER A :

upload image
download image
delete image

USER B :

download A → DENIED
delete A → DENIED

Répéter sur :

medical-images
analysis-artifacts
reports

==================================================
7. USER SWITCHING
==================================================

A login
→ données A visibles

logout

B login
→ données A invisibles

==================================================
8. TEST DE RÉGRESSION
==================================================

Après les tests live :

npm run build

Puis :

pytest

Puis :

vitest

Ne modifier aucun comportement métier.

==================================================
9. SI UN TEST ÉCHOUE
==================================================

NE désactive jamais RLS.

NE passe jamais le frontend en service_role.

NE réduis jamais les policies pour faire passer le test.

Identifie :

- utilisateur ;
- table/bucket ;
- opération ;
- policy concernée ;
- erreur exacte.

Corrige uniquement si la policy ou le code est incorrect.

==================================================
10. SI TOUT PASSE
==================================================

Produire un rapport :

AUTH LIVE : PASS
DATABASE LIVE : PASS
RLS LIVE : PASS
STORAGE LIVE : PASS
USER ISOLATION : PASS
BUILD : PASS
TESTS : PASS

Puis ARRÊTER.

Ne commence aucune autre phase.