# Supabase — livraison V14.2

Cette archive met à jour une installation existante. Elle ne permet pas de reconstruire une base vide : le schéma historique initial n'était pas dans le transfert reçu.

## Déploiement

L'installateur `scripts/update-termux.sh` envoie d'abord le backend à GitHub. Le workflow `deploy-supabase-migrations.yml` :

1. Vérifie `SUPABASE_ACCESS_TOKEN` et `SUPABASE_PROJECT_ID` dans les secrets GitHub Actions. Le projet attendu est `eqfwdcttvnnrakyaacjm`.
2. Exécute les tests de droits SQL dans un PostgreSQL 17 jetable et les tests de suppression de compte avec Node 24, avant toute mutation de production.
3. Applique uniquement les fichiers nommés dans `supabase/release-migrations.txt`.
4. Enregistre chaque migration dans `public.journal_sql_migrations`, dans la même transaction que son SQL. Une erreur SQL annule les modifications de cette migration et bloque l'étape suivante.
5. Déploie la fonction `journal-delete-user` avec la CLI Supabase.
6. Confirme qu'un appel anonyme à cette fonction reçoit HTTP 401, sans supprimer de compte.

L'installateur attend le succès de ces étapes avant de publier l'interface. Il conserve `config.js` et fusionne uniquement la section `[functions.journal-delete-user]` du fichier Supabase `config.toml` ; les autres sections sont conservées.

Lorsque `SUPABASE_DB_URL` est configuré, le workflow ouvre la connexion PostgreSQL TLS officielle du projet et transmet le mot de passe uniquement à `psql` par son environnement. La valeur n'est jamais ajoutée au code, aux arguments de commande ou aux journaux. L'ancienne Management API reste seulement le transport historique de repli lorsqu'aucune URL PostgreSQL n'est configurée ; un refus HTTP 403 / 1010 ne déclenche aucun changement automatique de transport.

La CLI est fixée à la version `2.116.0`. `SUPABASE_ACCESS_TOKEN` doit autoriser l'écriture SQL et le déploiement des fonctions sur ce projet ; la clé publique de `config.js` ne peut pas le remplacer. Le workflow refuse de déployer une autre branche que `main`, y compris lors d'un déclenchement manuel. Les contrôles et le déploiement utilisent le même commit GitHub.

## Migrations anciennes

Les quatre migrations V14/V14.1 restent des pièces d'historique. Elles ne sont **pas rejouées** par cette livraison, même si elles n'apparaissent pas dans l'ancien registre. Les fichiers V14.2 `00100` et `00200`, refusés intégralement avant tout enregistrement, sont conservés comme transactions vides. La migration active `00300` conserve la CHECK réelle `body IS NOT NULL OR deleted_at IS NOT NULL`, utilise `journal_access_requests.requester_id`, détache l’auteur des invitations par SET NULL lors de sa suppression et contrôle encore les autres prérequis.

Pour les mises à jour suivantes : ajouter un nouveau fichier SQL, l'inscrire explicitement dans `release-migrations.txt`, conserver les migrations effectivement enregistrées sans les modifier, et tester sur une copie du schéma réel. Chaque fichier doit avoir une unique enveloppe `BEGIN;` / `COMMIT;`, sur leurs propres lignes. Le registre applicatif `journal_sql_migrations` est distinct du registre de la CLI Supabase ; continuer à utiliser ce déployeur explicite pour cette installation.

## Suppression des comptes

La fonction Edge vérifie le jeton utilisateur via Supabase Auth puis l'autorisation d'administrateur principal côté base. La vérification JWT historique de la passerelle est désactivée pour cette fonction ; cela ne dispense pas de la vérification d'identité dans son code. La clé d'administration reste dans l'environnement Supabase de la fonction et n'est jamais transmise au navigateur.

## Vérification et incident

Ouvrir [GitHub Actions](https://github.com/ghostbuilderdev/Journal-de-chantier-SNCF/actions) puis le workflow Supabase. S'il échoue, l'installateur ne publie pas l'interface V14.2. Le backend peut être déjà partiellement déployé entre les étapes (migration réussie mais fonction refusée) : corriger l'erreur indiquée, puis relancer l'installateur. Le registre évite de rejouer la migration réussie.

La sauvegarde automatique de l'installateur contient **le code**, pas les données Supabase. Ne pas exécuter de reset de base pour résoudre un incident.

La fixture, la migration et les assertions SQL ont réussi en préparation sous PostgreSQL 18.3 via PGlite 0.5.8. Le passage du même scénario sous PostgreSQL 17 dans GitHub Actions reste obligatoire. La fixture est un schéma de test explicite et ne reconstitue pas les anciennes migrations manquantes de production.

Références : [déploiement des fonctions par GitHub Actions](https://supabase.com/docs/guides/functions/examples/github-actions), [CLI Supabase](https://supabase.com/docs/reference/cli/supabase-functions-deploy), [version 2.116.0](https://github.com/supabase/cli/releases/tag/v2.116.0), [requête SQL par Management API](https://supabase.com/docs/reference/api/v1-run-a-query).
