# Continuer le développement

Nous travaillons sur Journal Chantier Connecté, PWA HTML/CSS/JavaScript utilisée par des collaborateurs. Le propriétaire met à jour le dépôt GitHub ghostbuilderdev/Journal-de-chantier-SNCF depuis Termux ; Supabase est mis à jour par GitHub Actions.

Cette archive V14.2 comprend les modifications demandées le 6 septembre 2026 : annuaire, pilotes identifiés, actions cliquables/modifiables selon droits, photo seule, administration de plusieurs chantiers, révocation et suppression Auth, onglets fixes, dernier message et échéances souples. Lire LIRE_EN_PREMIER.md, MISE_A_JOUR_V14_2.md et les tests avant de poursuivre.

Important : le code V14.2 a été préparé et testé en environnement isolé. La présence de cette archive ne signifie pas qu’il est déjà déployé. Confirmer l’état réel par les résultats GitHub Actions et une archive récente du dépôt, sans écraser les modifications nouvelles.

Le code complet de l’interface reste dans app-v13.js et styles-v13.css pour compatibilité des chemins. Les versions des assets utilisent désormais 14.2-collaborateurs.

Le schéma Supabase initial est absent. Les migrations historiques du 1er septembre 2026 sont complémentaires. La migration active `20260906000300_v14_2_contraintes_reelles.sql` reprend le contrat réel vérifié de `journal_access_requests.requester_id` et conserve des contrôles explicites de compatibilité. Les tentatives `00100` et `00200` ont été refusées et remplacées avant toute application. Le diagnostic Diagnostic-Supabase-34056471078.json décrit les tables, colonnes, CHECK, FK, index et signatures en production PostgreSQL 17.6. La CHECK `chantier_message_content` est préservée intacte ; la FK `chantier_invitations.invited_by` est reconnue et détachée en SET NULL. Les corps de triggers et les politiques historiques restent absents du diagnostic. Ne pas reconstruire une base vide depuis ces seules migrations et ne pas retirer les contrôles pour forcer le passage.

L’installateur préserve config.js, vérifie la base connue, sauvegarde le code, pousse le backend puis attend son succès avant l’interface. Il inclut une fonction serveur de suppression de compte. Les tests SQL utilisent une base fictive de qualification, jamais des comptes réels pour vérifier les suppressions.
