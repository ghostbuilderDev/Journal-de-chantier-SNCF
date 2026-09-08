# Journal de chantier V15.2 — CR off simplifié

Cette livraison s’applique à la V15.1 du journal `ghostbuilderDev/Journal-de-chantier-SNCF`, vérifiée au commit `505b7bda31cb0370413ee810a0481ad39a4aec74`. Elle se publie avec la commande Termux ci-dessous. Le ZIP seul ne change pas l’application en ligne.

## Ce qui change

- Un tableau de cinq rubriques, avec une fenêtre de saisie dédiée à chaque rubrique. La synthèse finale disparaît du formulaire courant.
- Consignations : secteurs ou SEL saisis librement, choix parmi les références déjà utilisées sur ce chantier, cases à cocher pour la nuit.
- ITC : ZEP explicites, heures prévues et heures réelles de début et de fin.
- Les heures prévues peuvent être mémorisées pour la semaine du lundi au dimanche du chantier. Elles sont reprises à la création d’une prochaine nuit de cette semaine avec « Reprendre… » coché. Les CR déjà créés ne sont jamais modifiés par cette mémorisation. Une nouvelle semaine ne reprend pas les heures prévues de la précédente.
- Les horaires réels, les commentaires et la production ne sont jamais recopiés dans la nouvelle nuit.
- ARF : une seule paire début réel / fin réelle pour l’ensemble de l’intervention. L’encadrant peut renseigner la fin prévue pour le rappel et choisir le RSO responsable.
- Une demande est attribuée uniquement pour la consignation, les ITC et l’ARF. Un responsable par rubrique dans le nouvel écran. Les anciens responsables de ligne restent pris en compte tant que la rubrique n’a pas été reconfigurée.
- « Mes demandes » reste accessible même si les notifications du téléphone ne sont pas activées. Une fenêtre discrète s’affiche au responsable à l’ouverture de l’application, ou lors de l’actualisation des demandes (environ 30 secondes), lorsque aucune saisie ou autre fenêtre n’est en cours.
- « Plus tard » ferme la fenêtre. L’inhibition suspend les prochains rappels de cette demande ; elle peut être annulée dans « Mes demandes ». Une nouvelle attribution réactive les rappels.
- Le planificateur contrôle chaque minute les fins attendues. Il génère un rappel à partir d’une heure avant une fin prévue encore manquante, une seule fois pour cette échéance. Pour plusieurs fins prévues, il suit la prochaine fin manquante. Une fin réelle renseignée n’est plus rappelée. En cas de reprise du planificateur, une échéance passée depuis moins de douze heures peut encore être rappelée.
- Les fenêtres de demande sont réservées au destinataire de la demande. Les personnes déjà autorisées au CR peuvent compléter les rubriques ; un agent responsable d’horaires peut aussi contribuer à la production et à la sécurité, sans recevoir tout le CR privé ni les destinataires.
- Production : un grand champ de texte partagé, avec protection contre l’écrasement des modifications d’un collègue.
- Sécurité : écrire un fait, choisir Top ou Flop et enregistrer. L’auteur est ajouté automatiquement. Aucune attribution supplémentaire. « Rien à signaler » est disponible en l’absence d’observations.
- Gemini : la même passerelle que le briefing est appelée pour améliorer le texte saisi. Une proposition doit être relue puis appliquée explicitement. Un échec conserve le texte original. Les horaires structurés et la liste des destinataires ne sont pas envoyés à Gemini par cette fonction.
- Le mail validé contient une mise en page lisible : production, sécurité, tableaux prévu/réel des consignations et ITC, puis ARF. Le serveur utilise la version validée, avec une version texte de secours.

## Données existantes

Supabase, les comptes, les droits, les destinataires déjà enregistrés, les documents, les anciennes saisies et les copies validées sont conservés. Le catalogue Excel S37–S44 n’est plus proposé dans la configuration. Il n’est pas supprimé physiquement. Les anciennes données de synthèse restent en base et les copies déjà validées conservent leur contenu. Un retrait ou un renommage de périmètre contenant des horaires demande un motif ; l’historique est conservé.

Les comptes-rendus restent privés et ne sont pas publiés dans le fil d’actualité. Cette installation n’envoie aucun mail de CR. La configuration email existante est conservée ; si aucun expéditeur n’avait été configuré dans V15, suivre `scripts/configure-v15-email-termux.sh` avant le premier envoi.

## Installation dans Termux

Télécharger `Journal-Chantier-V15.2.zip` dans le dossier Téléchargements du téléphone, puis coller :

```bash
[ -d "$HOME/storage/downloads" ] || termux-setup-storage
pkg install -y git gh python unzip &&
journal_v152_dir="$(mktemp -d "$HOME/journal-v152-XXXXXXXX")" &&
unzip -q "$HOME/storage/downloads/Journal-Chantier-V15.2.zip" -d "$journal_v152_dir" &&
bash "$journal_v152_dir/Journal-Chantier-V15.2/scripts/update-v152-termux.sh"
```

Le script réutilise les secrets Supabase déjà installés dans GitHub. Il conserve une sauvegarde du code précédent, vérifie la version reconnue, publie d’abord le serveur et attend la réussite de ses tests et de son installation avant de publier l’interface. Une modification locale ou une base incompatible est conservée et signalée. En cas d’interruption, relancer la même commande.

Attendre la réussite de GitHub Pages : https://github.com/ghostbuilderdev/Journal-de-chantier-SNCF/actions

Fermer puis rouvrir le journal sur **le téléphone de l’encadrant et celui des agents** : https://ghostbuilderdev.github.io/Journal-de-chantier-SNCF/

Le haut du CR doit afficher V15.2. Ouvrir le CR concerné, choisir « Consignation caténaire », puis « Configurer les lignes et le responsable ». Vérifier le compte de Michael Bouge, les références et les heures prévues, puis « Enregistrer et demander ». Michael doit retrouver « Mes demandes » avec ce même compte sur son téléphone. Une attribution déjà active est également détectée par la nouvelle version.

Les notifications lorsque l’application est fermée restent soumises à l’autorisation du téléphone et à sa connexion : les activer dans Alertes si nécessaire. Les demandes dans l’application restent disponibles sans cette autorisation. La réception sur le téléphone réel de Michael devra être constatée après l’installation ; les tests de cette livraison utilisent des comptes simulés.

## Vérification technique

Voir `VERIFICATIONS_V15.2.txt`. Aucun contact réel, aucune demande à un agent réel et aucun appel réel à Gemini n’a été utilisé pour les tests de cette livraison.
