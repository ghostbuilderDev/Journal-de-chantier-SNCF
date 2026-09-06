# Extension Supabase V14.2

Cette migration complète une base existante. Les SQL historiques V7/V11/V12/V13 absents de l’archive ne sont pas reconstitués arbitrairement. Un schéma vierge ne peut pas être installé avec cette archive seule.

## Contrats

- `list_journal_user_directory(p_chantier_id uuid default null)` retourne `id`, `full_name`, `company`, `can_assign`. Le demandeur doit avoir au moins un accès validé. Les inscriptions Auth encore sans profil sont incluses : nom du profil, sinon métadonnées `full_name` ou `first_name` + `last_name`, sinon « Nom non renseigné ». Aucun email dans cet annuaire. Pour un chantier, `can_assign` exige un profil et un rôle contributeur/administrateur existants ; sélectionner un pilote ne donne aucun accès supplémentaire. Paginer les résultats côté client.
- `journal_v142_can_write(p_chantier_id)` permet de désactiver les commandes de modification en lecture seule.
- `action_items.assignee_user_id` est nullable ; les anciens libellés libres restent inchangés et ne donnent jamais de droits par simple correspondance de nom. Il faut sélectionner une personne une fois pour lui attribuer le suivi.
- `due_mode` : `none`, `date` ou `immediate`. Aujourd’hui/demain/dans une semaine sont enregistrés sous forme d’une vraie date. La date immédiate est `NULL` avec `due_mode=immediate`.
- `chantier_messages.action_id` relie une annonce à une action du même chantier. Le lien est retiré si l’action est supprimée.
- `journal_v142_set_user_access(p_user_id,p_global_role,p_memberships)` remplace toutes les attributions du compte en une transaction. `p_memberships` est un tableau `[{"chantier_id":"UUID","role":"administrateur"}]` ; plusieurs chantiers sont autorisés. `p_global_role` vaut `''` ou `administrateur_general`. Propriétaire uniquement.
- `journal_v142_revoke_user_access(p_user_id)` enlève les rôles et memberships et conserve un blocage serveur. Le compte reste visible pour être rétabli ou supprimé. Propriétaire uniquement.
- `journal_v142_administration_dashboard()` retourne un tableau JSON. Un échec de suppression Auth laisse le compte bloqué et visible pour réessayer.
- Edge Function `journal-delete-user`, POST `{user_id,confirmation:"SUPPRIMER"}` : session vérifiée en ligne avec `auth.getUser`, préparation SQL propriétaire, suppression Auth réelle, marquage final. La clé service reste dans l’environnement Supabase.

## Préservation et révocation

Les contraintes connues d’attribution des contributions sont converties en `ON DELETE SET NULL`, avec colonne d’identité nullable. Les messages, chantiers, actions, documents et noms historiquement consignés restent conservés. Les lignes de comptes, droits, demandes d’accès, réactions et accusés de lecture de la personne supprimée sont retirées. Les métadonnées de propriété des objets Storage sont transférées au propriétaire principal ; les fichiers ne sont pas supprimés.

La préparation et l’appel Auth sont deux transactions distinctes : si Auth échoue, les accès restent bloqués, les contributions sont préservées et le compte reste listé. Réessayer « Supprimer le compte » termine l’opération. La préparation supprime déjà le profil ; aucun accès ne doit être rétabli entre ces étapes.

Les JWT existants sont refusés par le contrôle serveur de compte actif, les règles RLS restrictives et les gardes d’écriture des tables du journal. Les trois buckets standards deviennent privés. Une URL signée déjà émise reste utilisable jusqu’à son expiration (jusqu’à une heure pour les photos) ; des fichiers déjà téléchargés ne peuvent pas être rappelés. Si un bucket personnalisé est configuré à la place de `chantier-files`, ses règles et son caractère privé doivent être vérifiés séparément.

## Contrôles de compatibilité

Le déploiement s’annule intégralement si les tables/colonnes/types attendus manquent, si une contrainte `UNIQUE(user_id)` interdit plusieurs chantiers, si des colonnes obligatoires supplémentaires rendent les attributions impossibles, si une contrainte multicolonne du corps de message ne peut pas être adaptée sans interprétation, ou si des FK/triggers DELETE inconnus risquent d’effacer des contributions. Les triggers DELETE personnalisés Auth/profiles et tables de droits doivent être examinés avant adaptation. Les cascades vers une table métier depuis les comptes, memberships, demandes d’accès, réactions ou reçus de lecture sont refusées. Le contrôle est répété avant remplacement/retrait des droits et préparation de la suppression pour refuser les dépendances dangereuses ajoutées ultérieurement.

Les écritures directes dans les tables de rôles/membres sont retirées aux clients ; seules les RPC et les triggers historiques exécutés avec les droits de leur propriétaire peuvent les modifier. Les accès directs aux profils sont limités au profil courant. Les règles historiques hors actions restent en place et sont complétées par des limites de compte actif et de chantier. Cette migration ne constitue pas un audit exhaustif des anciennes fonctions SECURITY DEFINER non fournies. Il faut toujours conserver la sauvegarde et l’export de schéma avant déploiement. Si un précontrôle s’arrête, fournir son message et l’export de schéma réel ; ne pas supprimer le contrôle pour forcer l’installation.

## Vérification reproductible

Sur une base PostgreSQL 16 **vide et jetable uniquement** :

```sh
psql -v ON_ERROR_STOP=1 -f supabase/tests/backend-fixture.sql
psql -v ON_ERROR_STOP=1 -f supabase/migrations/20260906000100_v14_2_collaborateurs_actions.sql
psql -v ON_ERROR_STOP=1 -f supabase/tests/backend-assertions.sql
```

La fixture refuse une base contenant déjà Auth, Storage ou profiles. Elle ne reproduit pas le schéma de production absent ; elle modélise explicitement les colonnes connues et des anciennes politiques permissives pour éprouver les nouvelles protections. Les assertions couvrent créateur/pilote/admin/autre/lecture seule, échéances, photos seules, liens inter-chantiers, multichantiers, inscriptions Auth sans profil, révocation avec ancien JWT, suppression et préservation des contributions. Elles vérifient aussi le refus d’une modification d’action sans auteur/pilote via une ancienne RPC `SECURITY DEFINER` et le refus d’une cascade métier ajoutée après déploiement.

```sh
node supabase/tests/edge-delete-user.test.cjs
```

Node 24 : **9 scénarios du gestionnaire Edge exécutés avec succès**, Auth/RPC simulés. **46 assertions SQL et 7 scénarios de refus de migration avec rollback ont été exécutés avec succès sur PostgreSQL 18.3 via PGlite 0.5.8**, entièrement en mémoire. Aucun appel à la production. Les 7 variantes vérifient la colonne historique absente, l’index mono-chantier, les triggers DELETE Auth et memberships, une FK utilisateur inconnue en cascade, une contrainte de message multicolonne et une cascade métier indirecte.

Pour reproduire ce contrôle local sans serveur PostgreSQL :

```sh
npm install --prefix /tmp/journal-pglite @electric-sql/pglite@0.5.8 --no-audit --no-fund
PGLITE_MODULE=/tmp/journal-pglite/node_modules/@electric-sql/pglite node supabase/tests/run-backend-pglite.cjs
```

Le workflow conserve son contrôle PostgreSQL 16 avant toute modification de production ; ce contrôle CI n’a pas été exécuté depuis l’environnement de préparation. Un succès sur cette fixture ne démontre pas la compatibilité d’un schéma historique différent : le précontrôle transactionnel reste obligatoire sur la base réelle. Les services Auth/Storage Supabase réels ne sont pas démarrés par PGlite ; leur intégration reste à vérifier sur le projet de qualification.

## Sources techniques

- [Supabase — gestion des utilisateurs](https://supabase.com/docs/guides/auth/managing-user-data) : suppression Auth, validité résiduelle des JWT et propriété Storage.
- [Supabase — deleteUser](https://supabase.com/docs/reference/javascript/auth-admin-deleteuser) : suppression serveur avec `shouldSoftDelete=false`.
- [Supabase — getUser](https://supabase.com/docs/reference/javascript/auth-getuser) : validation en ligne de la session.
- [Supabase — configuration des fonctions](https://supabase.com/docs/guides/functions/function-configuration) : `verify_jwt` ; ici la fonction vérifie elle-même chaque token avant toute opération, y compris les tokens ES256.
