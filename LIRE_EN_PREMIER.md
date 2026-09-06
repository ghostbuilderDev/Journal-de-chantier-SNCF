# Journal Chantier Connecté — mise à jour V14.2

Archive complète de mise à jour préparée le 6 septembre 2026 pour le dépôt `ghostbuilderdev/Journal-de-chantier-SNCF` et le projet Supabase déjà configuré. Elle contient le code, la migration complémentaire, la fonction serveur de suppression de compte, l’installateur Termux et les tests.

## Installation sur le téléphone

**Pour la reprise montrée dans les captures, le secret PostgreSQL est déjà configuré : remplacer l’ancienne archive par celle-ci puis relancer directement la commande. Ne pas ressaisir le mot de passe.**

1. Télécharger `Journal-Chantier-V14.2-Connexion-Supabase.zip` dans **Download / Téléchargements**, sans changer son nom.
2. Ouvrir **Termux** (appelé « Thermix » dans la demande).
3. Coller cette ligne :

```bash
pkg install -y git gh python unzip && { test -d "$HOME/storage/downloads" || termux-setup-storage; } && journal_tmp="$(mktemp -d)" && unzip -q "$HOME/storage/downloads/Journal-Chantier-V14.2-Connexion-Supabase.zip" -d "$journal_tmp" && bash "$journal_tmp/Journal-Chantier-V14.2/scripts/update-termux.sh"
```

Lors du premier accès, autoriser le stockage dans Android. Si l’archive n’est pas encore accessible après cette autorisation, relancer la même ligne. Une connexion GitHub peut être demandée. Le script recherche le dépôt Git existant ; s’il ne le trouve pas, il demande son chemin. Il refuse d’écraser des modifications locales ou une version de l’application différente de la base fournie.

Les secrets GitHub `SUPABASE_ACCESS_TOKEN` et `SUPABASE_PROJECT_ID` doivent déjà être renseignés (valeurs et emplacement détaillés dans **MISE_A_JOUR_V14_2.md**). Le dépôt existant doit être sur la branche `main` et GitHub Actions activé. Aucune clé d’administration ne doit être ajoutée à `config.js` ou au code publié.

La commande sauvegarde le code, publie le backend, attend les contrôles et le déploiement Supabase, puis publie l’interface. Le déploiement GitHub Pages habituel doit ensuite finir. Fermer tous les onglets de l’application, puis rouvrir l’application pour charger V14.2. La sauvegarde automatique concerne le code ; ce n’est pas une sauvegarde de la base Supabase.

## Utilisation

| Demande | Utilisation dans V14.2 |
|---|---|
| Voir les personnes inscrites | Bouton **Annuaire**, ou **Annuaire des personnes** dans le menu latéral sur téléphone. Recherche par nom ou entreprise. Les comptes suspendus restent visibles au propriétaire dans **Administration**. |
| Attribuer un pilote | **Action → Nouvelle action / Modifier → Pilote de l’action**. Les personnes sans accès contributeur au chantier sont grisées ; leur donner d’abord un accès dans Administration. |
| Ouvrir une action du fil | Cliquer sur la carte **Ouvrir l’action**. Le créateur, le pilote et les administrateurs autorisés peuvent modifier ; les autres consultent la fiche. |
| Photo sans commentaire | Ajouter la photo puis **Envoyer**, en laissant le texte vide. Fonctionne aussi dans **Ajout rapide terrain**. |
| Plusieurs chantiers administrés | Propriétaire principal : **Administration**, cocher les chantiers souhaités et sélectionner le rôle sur chacun, puis enregistrer. |
| Retirer les droits | **Administration → Retirer tous les accès**. Le compte reste inscrit, mais ses accès sont bloqués côté serveur. |
| Supprimer le compte | Propriétaire principal : **Administration → Supprimer le compte**, puis écrire **SUPPRIMER**. Le compte de connexion et le profil disparaissent ; les contributions déjà consignées restent dans le journal. |
| Garder les onglets accessibles | Le fil défile dans la zone sous les onglets. Sur petit écran, les onglets restent défilables horizontalement. |
| Arriver au dernier message | À l’ouverture du chantier ou de Discussion, le fil descend au dernier message chargé. Si l’utilisateur remonte lire l’historique, l’actualisation conserve sa position. |
| Échéances souples | **Immédiate**, **Aujourd’hui**, **Demain**, **Dans une semaine**, **Date libre**, **Sans échéance**. |

Une attribution historique saisie en texte libre ne constitue pas une identité de compte : sélectionner la personne dans l’annuaire pour lui donner le rôle de pilote de l’action. Les annonces historiques sont reliées automatiquement lorsqu’une correspondance unique est identifiable. Les cas ambigus restent consultables depuis l’onglet Action.

## Corrections de fiabilité associées

- Les fichiers échoués restent disponibles pour **Réessayer**, sans dupliquer les fichiers déjà envoyés.
- Un double clic ne produit pas deux envois dans le fil.
- Les brouillons sont isolés par chantier dans l’onglet en cours. Ce mécanisme ne constitue pas une file hors ligne persistante : ne pas fermer l’application avec des fichiers non envoyés.
- Les mots de passe ne sont plus conservés dans le brouillon de connexion. La déconnexion purge les données privées d’interface.
- Le chargement des messages et de leurs pièces jointes est paginé ; il n’est plus arrêté aux 1 500 premiers messages.

## Validation et compatibilité

Les tests JavaScript et les essais de l’installateur utilisent une copie isolée, des comptes fictifs et des réponses Supabase simulées. Le diagnostic fourni confirme PostgreSQL 17.6 et la structure des tables, contraintes, index et signatures du projet. La migration `00300` conserve intégralement `chantier_message_content`, qui autorise déjà le texte vide pour une photo, et adapte la FK de l’auteur des invitations pour préserver celles-ci lors d’une suppression de compte. Les deux tentatives précédentes ont été annulées transactionnellement. L’installateur reconnaît les fichiers du backend déjà envoyé (`284c52f`) et attend toujours le succès Supabase avant de publier l’interface.

Le diagnostic ne contient pas les corps des triggers ni les politiques historiques : leurs effets réels restent à qualifier, notamment lors d’une suppression de compte de test. La nouvelle migration contrôle les tables, les champs et les dépendances avant de modifier la base. Une structure incompatible provoque une erreur et l’annulation de la transaction. **Ne pas supprimer ces contrôles pour forcer une installation** : transmettre le message d’erreur et le schéma réel afin d’adapter la migration.

Après retrait des accès, les nouvelles requêtes sont bloquées côté serveur. L’interface se réactualise au retour dans l’application et périodiquement. Un fichier déjà téléchargé reste sur l’appareil ; un lien de fichier signé déjà émis peut rester valide jusqu’à son expiration, actuellement une heure.

Si la suppression Auth échoue après le blocage des droits, l’application le signale et permet de réessayer depuis Administration. Elle n’annonce une suppression réussie qu’après confirmation du serveur.

Les fichiers SQL historiques sont conservés pour référence. **Ne pas exécuter cette archive sur une base vide** : elle met à jour la base existante, elle ne reconstruit pas le schéma initial absent.

## Connexion PostgreSQL pour la mise à jour

L’exécution GitHub a rencontré un refus HTTP 403 / Cloudflare 1010 dans l’ancien envoi via la Management API. Le nouveau mode utilise la connexion PostgreSQL officielle, configurée explicitement avec le secret GitHub `SUPABASE_DB_URL`. Aucun changement de signature HTTP ni nouvel essai automatique après ce refus n’est effectué.

**Si `SUPABASE_DB_URL` a déjà été enregistré et que l’étape « Vérifier la connexion PostgreSQL en lecture seule » a réussi, ne pas relancer le configurateur : passer directement à l’installateur.**

1. Dans le projet Supabase, ouvrir **Connect**, puis **Session pooler**, port **5432**. Relever le champ **Host**.
2. Depuis l’archive nouvellement extraite, lancer `python scripts/configure-supabase-db.py` dans Termux. Le configurateur demande l’hôte, puis le mot de passe PostgreSQL avec saisie invisible. Il encode les caractères spéciaux et enregistre la connexion dans GitHub par l’entrée standard de `gh secret set`. Ne pas coller le mot de passe dans une conversation ou une commande.
3. Lancer l’installateur `scripts/update-termux.sh` selon la commande ci-dessus. Le workflow vérifie la connexion avec `SELECT 1`, puis utilise les mêmes transactions, liste de migrations et registre. Les anciennes versions V14.2 fournies sont reconnues par leurs empreintes exactes pour reprendre après un échec.

Le token `SUPABASE_ACCESS_TOKEN` et le projet `SUPABASE_PROJECT_ID` restent nécessaires au déploiement de la fonction Edge. La connexion PostgreSQL ne garantit pas le succès de cet autre déploiement : la nouvelle interface attend toujours la réussite complète du workflow.

Le configurateur ne réinitialise pas le mot de passe PostgreSQL. Utiliser le mot de passe existant ; si celui-ci est inconnu, examiner les connexions existantes avant toute réinitialisation.

Référence : [connexions officielles Supabase](https://supabase.com/docs/guides/database/connecting-to-postgres).
