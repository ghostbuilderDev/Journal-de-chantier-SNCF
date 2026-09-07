# Journal Chantier V14.5 — Améliorer l’application

Un espace commun recueille les retours des premiers essais et du développement. Il est accessible aux utilisateurs connectés dont le compte n’a pas été révoqué, quel que soit leur chantier, y compris sans chantier affecté.

## Où le trouver

Sur le téléphone : ouvrez le menu **☰**, puis **Améliorer l’application**, au-dessus de la liste des chantiers. Sur les grands écrans, le même accès est présent dans la barre supérieure. Le fil s’ouvre dans une fenêtre dédiée ; le bouton de retour permet de retrouver le chantier et son brouillon.

Les onglets Discussion, Documentation, Actions, Pilotage et Mes applications conservent leur fonction. Les retours ne sont pas publiés dans les discussions chantier et ne déclenchent pas les notifications du mode chantier.

## Partager un retour utile

Publiez **un problème ou une idée par retour**. Consultez les publications existantes et répondez à un retour similaire pour compléter les informations.

- **Problème rencontré** : indiquez ce que vous faisiez, le résultat obtenu et ce que vous attendiez.
- **Idée d’amélioration** : décrivez le besoin et l’usage souhaité.
- Donnez un titre précis, par exemple « Le bouton Envoyer disparaît quand le clavier s’ouvre ».
- Ajoutez si utile une capture d’écran, au format JPEG, PNG ou WebP, de 5 Mo maximum. Une capture par retour ; sa présence est facultative.

Le titre accepte 100 caractères, la description 4 000 caractères et chaque réponse 2 000 caractères. Votre nom est indiqué automatiquement. Les autres utilisateurs peuvent répondre dans la discussion associée. L’auteur peut corriger son texte ou supprimer sa contribution. La capture reste celle de la publication initiale.

## Suivre le traitement

Les administrateurs généraux et le propriétaire de l’application gèrent le statut :

| Statut | Usage |
|---|---|
| À étudier | Retour reçu, à examiner. |
| Prévue | Amélioration retenue pour une prochaine version. |
| En cours | Modification en cours de réalisation. |
| Réalisée | Modification livrée et à vérifier par les utilisateurs. |

Le statut n’exécute aucune modification de l’application : il sert au suivi. L’administrateur peut préciser la version concernée dans une réponse. Il peut supprimer une publication ou une réponse inappropriée, mais ne réécrit pas le propos d’un autre auteur.

Les filtres permettent de retrouver les problèmes, les idées et leur statut. Les derniers retours apparaissent en premier ; la pagination donne accès aux précédents. L’actualisation ne remplace pas le texte que vous êtes en train de saisir.

## Connexion et brouillons

Une connexion est nécessaire pour consulter les retours et les publier. En cas d’échec d’envoi, la fenêtre conserve le texte et la capture pour réessayer tant que vous restez dans l’application avec le même compte. Les nouvelles publications utilisent un identifiant stable pour éviter un doublon lors de la reprise du même envoi.

Les brouillons de cet espace restent en mémoire : une fermeture complète ou un rechargement peut les effacer. Ils sont purgés à la déconnexion ou au changement de compte. Les captures sont stockées dans un espace privé ; leur consultation nécessite un accès autorisé. Un lien temporaire déjà généré reste valable jusqu’à son expiration.

Le fil vérifie les nouveautés seulement lorsque sa fenêtre est ouverte et visible. Il ne produit ni son ni notification système.

## Installer depuis Termux

1. Téléchargez **Journal-Chantier-V14.5-Retours-Application.zip** dans le dossier **Téléchargements** du téléphone.
2. Collez dans Termux la commande accompagnant ce téléchargement. Elle vérifie l’archive et utilise le dépôt déjà identifié : `$HOME/Journal-de-chantier-SNCF`.
3. L’installateur sauvegarde le code et envoie d’abord le serveur du fil de retours. GitHub Actions exécute les tests SQL, puis applique uniquement la migration 005 sur la base où V14.2 est déjà enregistrée.
4. L’interface est ajoutée après la réussite de cette étape. Attendez ensuite la réussite de [GitHub Pages](https://github.com/ghostbuilderDev/Journal-de-chantier-SNCF/actions).
5. Fermez l’application et ses anciens onglets, puis ouvrez [Journal Chantier](https://ghostbuilderdev.github.io/Journal-de-chantier-SNCF/).

Les secrets GitHub déjà configurés sont réutilisés. Aucun SQL, mot de passe ni nouvelle clé à coller dans Supabase pour cette livraison. Les fonctionnalités et la présentation déjà présentes dans la version installée sont conservées ; ce script n’active pas un mode chantier qui n’était pas encore publié.

En cas d’interruption, relancez la même commande. L’installateur conserve les modifications locales inconnues et signale celles qui empêchent la mise à jour. La sauvegarde produite contient le code précédent ; elle n’est pas une sauvegarde de la base de données.

## Essai rapide avec deux comptes

1. Depuis A, publiez une idée avec une capture. Vérifiez qu’elle n’apparaît pas dans la discussion chantier.
2. Depuis B, sur un autre chantier, ouvrez **Améliorer l’application** : retrouvez le même retour et répondez-y.
3. Depuis A, ouvrez le retour pour consulter la réponse et corriger votre propre texte.
4. Avec le propriétaire ou un administrateur général, passez le retour à **En cours**, puis **Réalisée**.
5. Vérifiez qu’un membre ordinaire peut répondre mais ne peut ni changer le statut ni modifier le texte d’un autre auteur.
6. Fermez ce fil, poursuivez les échanges chantier et vérifiez que leurs brouillons et notifications habituelles fonctionnent.

Les contrôles automatisés et leurs limites sont précisés dans **VALIDATION_V14_5.md**.
