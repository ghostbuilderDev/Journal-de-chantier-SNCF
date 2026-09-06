# Journal Chantier V14.4 — Mode chantier

Cette version ajoute une session de chantier personnelle, limitée dans le temps, avec des notifications push et une vue dédiée à la discussion. Elle conserve les menus, les fonctions V14.2 et la présentation V14.3.

Le correctif de reprise GitHub attend l'exécution correspondant au commit et au workflow du mode chantier. Il ne s'arrête plus au premier retour 404 lors de l'apparition du nouveau workflow. Une exécution en cours ou réussie est réutilisée ; un échec peut être relancé. Si GitHub ne fournit toujours aucune exécution, le script affiche un diagnostic sur le fichier du workflow, son état et la branche par défaut. L'interface reste bloquée jusqu'au succès confirmé.

Le correctif pg_net reprend également une installation arrêtée par le contrôle des droits des tables techniques. La migration déjà enregistrée est conservée, et les mêmes clés de notification sont réutilisées. Aucun code SQL à coller dans Supabase.

## Installer depuis votre téléphone

1. Téléchargez `Journal-Chantier-V14.4-Mode-Chantier.zip` dans **Téléchargements**. Conservez ce nom exact.
2. Ouvrez Termux. Le dépôt utilisé est `$HOME/Journal-de-chantier-SNCF`, déjà identifié lors de la mise à jour V14.2.
3. Collez la commande fournie avec l'archive. Acceptez l'accès aux fichiers si Android le demande.
4. Laissez Termux terminer. Le script sauvegarde le code et envoie d'abord les éléments serveur dans GitHub. GitHub Actions teste la migration sur une base jetable, applique uniquement la migration V14.4, configure les clés de notification et déploie la fonction Supabase.
5. L'interface est envoyée après la réussite de cette étape. Attendez aussi la réussite de la publication GitHub Pages dans [GitHub Actions](https://github.com/ghostbuilderDev/Journal-de-chantier-SNCF/actions).
6. Fermez l'application et ses anciens onglets, puis ouvrez [Journal Chantier](https://ghostbuilderdev.github.io/Journal-de-chantier-SNCF/).

Les trois secrets GitHub déjà configurés sont réutilisés : `SUPABASE_PROJECT_ID`, `SUPABASE_DB_URL` et `SUPABASE_ACCESS_TOKEN`. Aucune saisie SQL dans Supabase n'est nécessaire. Les clés Web Push sont générées automatiquement et conservées côté serveur pour les reprises de déploiement ; elles ne sont pas dans cette archive ni dans `config.js`.

Si le script s'interrompt, le message indique l'étape et la sauvegarde. Relancez la même commande pour reprendre. Une modification locale inconnue est conservée et bloque son remplacement : ne supprimez pas votre dépôt. Une erreur du serveur ne doit pas être contournée en publiant manuellement les nouveaux fichiers d'interface.

## Démarrer une session

Connectez-vous, sélectionnez votre chantier et ouvrez **Mode chantier**. Choisissez une heure de fin, puis démarrez. Une session dure au maximum 24 heures et concerne le chantier choisi sur cet appareil.

L'application vous propose d'autoriser les notifications. Sur Android, utilisez un navigateur compatible tel que Chrome et, pour un accès rapide, installez l'application sur l'écran d'accueil. Si le navigateur ou ses réglages empêchent les notifications, le mode et le fil restent accessibles ; l'interface signale l'absence de push.

L'autorisation de notification est donnée une première fois au navigateur. Elle n'active pas des alertes permanentes : le serveur vérifie qu'une session est encore en cours avant chaque envoi.

## Pendant le chantier

- Le bandeau indique la fin de session et donne accès à la pause, à l'arrêt et au fil dédié.
- Les nouveautés du chantier sélectionné sont regroupées pour éviter une notification sonore par publication rapprochée. Les éléments prioritaires empruntent une voie immédiate côté serveur.
- Vos propres publications ne déclenchent pas de push vers votre session. La consultation effective du fil supprime les alertes en double tant que la présence de cette fenêtre est à jour.
- Une notification ouvre le chantier et, lorsqu'il existe, le message ou l'action concerné. Les règles habituelles d'accès et de modification restent applicables.
- **Fil dédié** agrandit la discussion et conserve ses commandes, avec un retour visible vers l'application. Il ne crée pas de bulle flottant au-dessus des autres applications Android.
- L'option de maintien de l'écran allumé utilise la fonction proposée par le navigateur. Elle s'arrête quand le mode ou la vue ne sont plus actifs et peut être refusée par le téléphone.

## Pause et fin

La pause suspend les nouvelles alertes pendant la durée indiquée. Vous pouvez reprendre, prolonger la session ou l'arrêter. La fin automatique repose sur l'heure du serveur : elle continue de s'appliquer quand l'application est fermée.

Un arrêt ou une pause demandé hors connexion est mémorisé sur le téléphone et transmis au retour du réseau. L'application bloque les notifications locales ; si ce blocage ne peut pas être confirmé, elle le signale explicitement. Une notification déjà transmise au système peut subsister. Lors de la prochaine connexion, vérifiez l'état affiché.

Hors session, les nouvelles publications restent dans le journal sans déclencher ce dispositif d'alerte. Le démarrage suivant donne un récapitulatif plutôt qu'une rafale d'anciennes notifications. Ce compteur porte sur les événements enregistrés depuis le précédent poste, dans une limite de 30 jours ; l'historique du journal reste indépendant. Une fiche de pilotage et son annonce dans le fil peuvent compter comme deux nouveautés.

Chaque appareil a sa propre session : arrêter le mode sur un téléphone ne termine pas celui qui a été démarré séparément sur un autre appareil.

## Vérifier après installation

Faites ces essais avec deux comptes ayant accès au même chantier :

1. Avec le compte A, démarrez une session de courte durée et autorisez les notifications.
2. Placez l'application A en arrière-plan. Avec B, publiez un message, une photo et une action. Vérifiez la notification regroupée sur A, puis son ouverture vers le chantier.
3. Laissez le fil A visible et actif ; publiez depuis B et vérifiez que la nouveauté apparaît sans alerte en double.
4. Activez une pause sur A, publiez depuis B, puis répétez après la fin de session. Aucune nouvelle notification ne doit être émise pour cette session.
5. Ouvrez le fil dédié, envoyez une photo, ouvrez une action, puis utilisez le retour vers l'application.
6. Sur un téléphone partagé, déconnectez A, connectez B et vérifiez que les notifications ne reprennent que pour une session explicitement démarrée par B.

La réception push dépend du réseau, du navigateur et des réglages Android (notifications et batterie). Les envois ne sont pas mis en attente durable chez le service push : une alerte manquée hors connexion reste consultable dans le journal et le récapitulatif. Ce dispositif ne remplace pas une alarme de sécurité ou un moyen de communication d'urgence.

## Exploitation

La migration ajoute ses propres tables et fonctions. Elle s'appuie sur les droits V14.2 déjà déployés, sans remplacer l'historique du journal. Le serveur recontrôle les droits avant l'envoi ; un compte supprimé ou privé d'accès ne doit plus recevoir de nouvelles livraisons.

Le traitement planifié utilise Supabase Cron, pg_net et une Edge Function. La vérification tourne toutes les 30 secondes ; la fonction d'envoi n'est appelée que si la file contient du travail. Les éléments prioritaires peuvent déclencher un envoi sans attendre ce prochain contrôle. Ces appels doivent être suivis dans les limites de votre projet Supabase. Les messages de notification restent génériques : le texte privé des échanges et les pièces jointes ne sont pas placés dans le contenu push.

Le configurateur tente de retirer l'accès en lecture des rôles clients aux tables techniques `net.http_request_queue` et `net._http_response`. Supabase peut conserver ces droits internes sur son extension gérée : cela ne constitue pas un accès depuis l'application lorsque les rôles clients sont sans connexion directe (`NOLOGIN`) et le schéma `net` est exclu de la Data API. Ces deux conditions sont alors vérifiées avant le transfert des secrets, puis avant l'activation. Le test API utilise la clé publique de l'application et demande zéro ligne ; seul le refus de schéma précis `406 / PGRST106` est accepté. Une erreur réseau, de clé ou de permission ne valide pas ce contrôle. Les fonctions HTTP et les droits d'écriture de pg_net sont conservés. [Modèle de permissions Supabase](https://supabase.com/docs/guides/database/extensions/pg_net), [sélection des schémas PostgREST](https://docs.postgrest.org/en/stable/references/api/schemas.html).

Ce contrôle vérifie la configuration au moment du déploiement. Une modification administrative ultérieure des schémas exposés, ou l'ajout d'une fonction publique donnant accès à la file, nécessite une nouvelle vérification.

Cette livraison a été préparée et testée en environnement isolé. Sa réussite sur votre projet est confirmée par GitHub Actions, puis par les essais sur les téléphones réellement utilisés.
