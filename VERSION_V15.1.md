# Journal de chantier V15.1 — CR off terrain

Cette livraison met à jour la V15 publiée le 8 septembre 2026 (base Git `ea7153fd37941db2e7e2132c201b96b81a09d6f8`). Elle conserve les autres fonctions du journal, du briefing et du rapport journalier.

## Utilisation

1. Ouvrir **CR off**, puis préparer une nuit pour un chantier.
2. Dans **Consignation caténaire** et **ITC**, ouvrir **Choisir les secteurs / SEL** ou **Choisir les ZEP**, selon la rubrique.
3. Choisir le programme du chantier, cocher les références nécessaires et enregistrer. Le catalogue est une liste de choix issue des semaines S37 à S44 : il ne sélectionne pas automatiquement les mesures applicables cette nuit. Les regroupements restent regroupés. Une référence manquante peut être ajoutée avec son libellé complet.
4. Attribuer toute une rubrique à un responsable et, au besoin, attribuer certaines lignes à une autre personne. Les personnes autorisées à la rubrique peuvent s’entraider. Les notifications conduisent à la rubrique concernée ; **Mes informations à compléter** tient compte des attributions par ligne.
5. Renseigner le début puis la fin de chaque périmètre. Les dates restent visibles pour les interventions passant minuit ou couvrant un week-end. L’état est calculé selon les heures présentes ; **À confirmer** et **Non concerné** sont aussi disponibles. Un motif est exigé pour une ligne déclarée non concernée.
6. L’**ARF** garde seulement un début et une fin pour toute l’intervention. Les autres rubriques continuent à fonctionner comme dans la V15.
7. Dans **Accès au CR et destinataires**, ouvrir la liste proposée. Les adresses lisibles et celles reconstituées sont distinguées. Corriger les adresses si nécessaire, cocher les personnes choisies, puis ajouter la sélection au formulaire et enregistrer. D’autres adresses peuvent être saisies dans la liste libre. Aucune proposition ne devient destinataire sans sélection de l’encadrant.
8. Valider le CR une fois les périmètres et les rubriques complétés. Vérifier la copie et les destinataires avant l’envoi. Le CR reste privé et ne paraît pas dans le fil d’actualité.

## Prévu, réalisé et historique

- Les horaires demandés dans le programme sont affichés avec leur onglet et leur ligne d’origine, comme information à rapprocher du périmètre. Aucune correspondance ambiguë entre une plage horaire et une voie n’est inventée.
- L’encadrant peut confirmer séparément les horaires prévus d’un périmètre. Les écarts positifs à l’accord et à la restitution apparaissent alors dans le récapitulatif et l’email.
- Chaque ligne conserve son responsable, l’auteur réel de la saisie et son heure de modification. Les versions de ligne empêchent une seconde personne d’écraser silencieusement une saisie concurrente.
- La copie de la dernière nuit antérieure reprend les sélections, les responsables, les accès et les destinataires. Les heures prévues/réelles, remarques, échéances et états sont remis à renseigner.
- Les anciens CR à horaires globaux restent lisibles et modifiables. Lors d’un passage volontaire aux périmètres, un ancien horaire renseigné est conservé dans une ligne **Ancien périmètre global — à préciser**, à confirmer ; son libellé peut être précisé dans **Responsable de ce périmètre**. Un retrait de ligne conserve son historique ; un motif est demandé si des heures avaient déjà été saisies.
- Les versions déjà validées et les copies d’envoi restent intactes. Un rectificatif crée une nouvelle révision.

## Données à vérifier

Le ZIP contient un dossier `donnees-privees` avec 57 références de catalogue et 21 propositions de destinataires : 20 personnes et une liste de diffusion. Les 43 lignes de programme retenues sont celles de Petit/Dahmani dans les onglets S37 à S44 et les deux week-ends inclus.

Les cellules fusionnées ont été prises en compte. Les notes de coactivité et les secteurs non renseignés ne deviennent pas des périmètres fictifs. Les références divergentes de Chalette et la S11 non précisée de Garenne en S37 sont signalées. Les autres absences et notes figurent dans la section `issues` du fichier d’import privé.

Pour les contacts : 9 adresses sont entièrement lisibles, 11 sont proposées selon la règle `prénom.nom@sncf.fr`, et l’adresse de la liste de diffusion reste vide. Ces propositions ne constituent pas une vérification de la délivrabilité. Le CSV joint sert à la relecture.

## Installation Termux

Télécharger `Journal-Chantier-V15.1.zip` dans les téléchargements Android, puis exécuter :

```bash
[ -d "$HOME/storage/downloads" ] || termux-setup-storage
pkg install -y git gh python unzip &&
journal_v151_dir="$(mktemp -d "$HOME/journal-v151-XXXXXXXX")" &&
unzip -q "$HOME/storage/downloads/Journal-Chantier-V15.1.zip" -d "$journal_v151_dir" &&
bash "$journal_v151_dir/Journal-Chantier-V15.1/scripts/update-v151-termux.sh"
```

L’installateur vérifie la V15 et les fichiers dépendants, sauvegarde le code précédent, publie le serveur et attend sa validation par GitHub Actions avant de publier l’interface. Il refuse de remplacer des modifications divergentes. La même commande permet de reprendre après une interruption.

Le catalogue et les contacts sont transmis par le secret GitHub `JOURNAL_CR_V151_IMPORT`, puis stockés dans le schéma privé Supabase. Ils ne sont copiés ni dans le dépôt public ni dans les fichiers servis par GitHub Pages. Seuls les encadrants autorisés peuvent consulter les propositions. Ne pas ajouter manuellement le dossier `donnees-privees` au dépôt.

La migration est additive et ne rejoue pas les anciennes migrations. Aucun abonnement ou nouveau service n’est nécessaire pour cette évolution. L’envoi des CR utilise toujours la configuration email de la V15. Si l’expéditeur n’a pas encore été configuré, consulter `VERSION_V15.md` ou lancer depuis le dépôt :

```bash
bash "$HOME/Journal-de-chantier-SNCF/scripts/configure-v15-email-termux.sh"
```

Après succès de GitHub Pages, fermer complètement puis rouvrir l’application :
https://ghostbuilderdev.github.io/Journal-de-chantier-SNCF/

Cette livraison n’a pas été exécutée sur la base de production lors de sa préparation. Les tests utilisent des bases et des destinataires de démonstration ; aucun email ni notification réelle n’a été envoyé.
