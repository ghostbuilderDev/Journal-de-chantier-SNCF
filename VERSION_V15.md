# Journal de chantier — V15.0

Livraison du 8 septembre 2026, construite sur le dépôt Journal V14.7, commit `24627a6b70e6ff67f59bef3aacae4010e5264e03`. Le rapport journalier externe reste l’application AINM V10.3.

## Ce que contient la version

- **CR off / encadrement** : un formulaire privé par chantier et par nuit, hors du fil d’actualité.
- Six rubriques : consignation caténaire, ITC, ARF, production / technique, sécurité, synthèse finale. Chacune peut avoir un responsable, une échéance et d’autres personnes autorisées.
- Demande et relance dans les notifications, ouverture directement sur la rubrique à compléter. Reprise facultative des attributions et des destinataires du dernier CR, sans reprendre ses horaires ou ses textes.
- Contributions de plusieurs personnes conservées séparément ; responsable et auteur réel identifiés. Protection contre l’écrasement d’une saisie concurrente.
- Date de nuit et horaires complets, passage de minuit et changements d’heure de Paris pris en compte.
- Synthèse courte pour le mail du matin : jusqu’à 600 caractères pour chacun des volets technique, sécurité et synthèse. Les contributions courtes sont reprises automatiquement ; les détails restent dans le CR. Aucun « RAS » n’est inventé.
- Validation par l’encadrement, copie figée, historique et rectificatif avec numéro de version. Envoi individuel ou regroupement des CR validés partageant exactement les mêmes destinataires.
- **Administration** : lignes compactes repliées, recherche, filtre par état et inscriptions en attente en premier. Les commandes existantes d’accès, de déblocage et de suppression restent dans la fiche dépliée.
- **Actions terminées** : message associé replié, affiché en vert et consultable au toucher ; un message associé à une action encore ouverte reste développé.
- **Rapport journalier** : les anciens liens vers le dépôt GitHub AINM sont dirigés vers l’application publiée. Aucun jeton n’est ajouté à son URL.
- **Notifications** : boîte persistante pour les nouveaux messages et demandes ; activation explicite des alertes du téléphone, indépendante de la durée d’un poste.
- **Documents** : consultation et téléchargement pour les membres autorisés, y compris contributeurs. La gestion des fichiers reste réservée aux personnes habilitées.

Les captures disponibles montraient cinq points d’amélioration. Ce sont ces cinq points qui sont repris dans cette livraison, avec le nouveau CR.

## Installer depuis Termux

1. Télécharger `Journal-Chantier-V15.zip` dans **Téléchargements**, en gardant ce nom.
2. Autoriser Termux à accéder aux fichiers si nécessaire : `termux-setup-storage`.
3. Coller :

```bash
pkg install -y git gh python unzip &&
journal_v15_dir="$(mktemp -d "$HOME/journal-v15-XXXXXXXX")" &&
unzip -q "$HOME/storage/downloads/Journal-Chantier-V15.zip" -d "$journal_v15_dir" &&
bash "$journal_v15_dir/Journal-Chantier-V15/scripts/update-v15-termux.sh"
```

Le dépôt local par défaut est `$HOME/Journal-de-chantier-SNCF`. S’il n’existe pas, le script le clone. Pour un autre emplacement, passer son chemin en premier argument du script.

Termux peut demander la connexion à GitHub. Utiliser le compte autorisé à publier ce dépôt, avec les permissions `repo` et `workflow`. Les trois secrets GitHub de l’installation existante sont requis : `SUPABASE_PROJECT_ID`, `SUPABASE_DB_URL`, `SUPABASE_ACCESS_TOKEN`. Le projet attendu est contrôlé.

L’installation vérifie la version et l’absence de changements locaux, conserve une sauvegarde du code, publie d’abord les fonctions et la migration, attend la réussite du workflow V15 pour le commit envoyé, puis publie l’interface. Aucun ancien script SQL ni réinitialisation des données n’est exécuté. Si des fichiers ont changé depuis la base vérifiée, le script s’arrête en les conservant. Relancer la même commande permet de reprendre après une interruption reconnue.

Attendre ensuite la réussite de GitHub Pages, fermer les fenêtres de l’application et la rouvrir. L’installation de la PWA déjà présente est conservée. Les versions de cache ont été actualisées.

## Activer les notifications sur chaque téléphone

Ouvrir **Alertes → Activer sur ce téléphone** et accepter l’autorisation du navigateur. Sur iPhone, ouvrir l’application installée sur l’écran d’accueil. L’installation serveur configure ou réutilise les clés déjà utilisées par le mode chantier ; elle ne les remplace pas lorsqu’elles existent.

Les nuits précédentes sont accessibles depuis le bouton de pagination de la liste des CR.

Les nouvelles notifications restent consultables dans l’application pendant 90 jours (100 dernières affichées). Elles ne contiennent pas le texte confidentiel du CR sur l’écran verrouillé. Le réseau, les réglages du téléphone et les services push peuvent retarder ou empêcher une alerte : la boîte du journal reste la référence. Les notifications ne sont pas reconstruites rétroactivement pour les anciens messages.

## Configurer l’envoi email — une fois

**L’envoi direct nécessite une adresse expéditrice vérifiée. L’abonnement Supabase seul ne fournit pas cette identité email.** La livraison utilise l’API Resend ; aucun compte Resend ni abonnement supplémentaire n’est souscrit par cette installation.

Si le projet dispose déjà des secrets Supabase `RESEND_API_KEY` et `JOURNAL_CR_FROM`, ils sont conservés. Sinon, après avoir obtenu une clé d’envoi Resend et vérifié le domaine de l’expéditeur, exécuter :

```bash
bash "$HOME/Journal-de-chantier-SNCF/scripts/configure-v15-email-termux.sh"
```

Le script demande l’expéditeur et la clé (saisie masquée), les stocke comme secrets GitHub puis relance le workflow V15 pour configurer les fonctions Supabase. La clé n’est jamais écrite dans `config.js`, dans le ZIP ou dans le code publié. Ne pas saisir un expéditeur fictif : il doit avoir été vérifié auprès du service d’envoi.

Sans cette configuration, les CR peuvent être remplis, validés et archivés ; une tentative d’envoi affiche **« Envoi email à configurer »**, sans annoncer de faux succès. Un envoi réussi signifie que le service email l’a accepté, pas que chaque destinataire l’a lu ou reçu dans sa boîte principale. Le suivi des rebonds n’est pas inclus.

Références du fournisseur : [API d’envoi](https://resend.com/docs/api-reference/emails/send-email), [prévention des doubles envois](https://resend.com/docs/dashboard/emails/idempotency-keys).

## Utilisation du CR

1. L’encadrant ouvre **CR off → Préparer une nuit**, choisit le chantier et la date de début de nuit.
2. Dans chaque rubrique, **Attribuer / modifier la demande** permet de choisir un responsable et des personnes supplémentaires. Pour autoriser quelqu’un sur tout le CR, utiliser **Accès au CR et destinataires**.
3. Chaque personne renseigne sa rubrique ou ajoute une contribution. Les rubriques technique, sécurité et synthèse acceptent plusieurs contributions. Un collègue autorisé peut compléter à la place du responsable.
4. Enregistrer les rubriques puis indiquer **Complété** ou **Non concerné**. Les informations manquantes ou à confirmer empêchent la validation.
5. L’encadrant vérifie les résumés et la liste des destinataires, valide le CR, ouvre l’aperçu puis confirme l’envoi.
6. Pour plusieurs chantiers, cocher les CR validés dans la liste et préparer un envoi groupé. Un mélange de destinataires est refusé par le serveur.
7. Après validation, utiliser **Créer un rectificatif** pour corriger. La copie précédente reste consultable dans l’historique.

Les données sont enregistrées dans le Supabase actuel. Les saisies de CR requièrent une connexion ; une saisie non enregistrée reste dans la fenêtre ouverte, avec un avertissement avant fermeture. Les notifications ne donnent jamais de droits supplémentaires : un retrait d’accès au chantier est appliqué à chaque consultation du CR.

## Vérifications de la livraison

Tests automatisés de base PostgreSQL embarquée (PGlite), fonctions email simulées sans envoi, dispatcher push simulé, identité et cache du service worker, compatibilité du briefing, consultation documentaire, liens AINM et gardes de l’installateur. Un second contrôle sur PostgreSQL 17 jetable est inclus dans GitHub Actions avant application de la migration en production.

Les tests sur navigateur mobile ont été exécutés avec succès et sont disponibles dans `tests/cr-v15-browser.cjs` (Playwright + PGlite). Ils n’appellent aucun service de production. Le rapport de vérification final est fourni dans le ZIP.

La livraison n’a pas encore été exécutée sur votre Supabase ni publiée depuis cet environnement. La commande Termux effectue cette montée de version.
