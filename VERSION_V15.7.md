# Journal de chantier — V15.7

Cette mise à jour part de la V15.6 installée (`8ce4394`). Elle simplifie les formulaires Consignation caténaire, ITC et ARF.

- Les heures de début et de fin sont toujours visibles, dans les lignes **Prévu** et **Réel**. Un appui ouvre le sélecteur d’heure natif du téléphone. Le libellé « Facultatif » et les commandes été/hiver ont été retirés de ces tableaux.
- Le bouton **Date** affiche ou masque uniquement les dates. Il fonctionne également pour consulter un CR validé. Les dates choisies sont conservées après fermeture et enregistrement.
- Un seul champ **Intitulé** permet de choisir une référence, de rechercher dans la liste, de modifier le résultat ou d’écrire librement. La flèche ouvre toute la liste du type choisi. **Laisser vide** efface la sélection. Les groupes de SEL restent des groupes tels qu’ils figurent dans le fichier.
- Le catalogue comporte **64 références** : 14 SEL, 23 secteurs et 27 ZEP ou groupements. Les 11 ajouts proviennent des lignes complémentaires **Moret (Samois)** du classeur fourni. Les cellules sources et les associations explicites sont conservées ; voir `docs/REFERENCES_V15.7.md`.

Les horaires prévus restent non obligatoires. Une nouvelle ligne de nuit propose automatiquement le lendemain pour une heure après minuit ; une date modifiée explicitement garde la priorité. Les dates et instants déjà enregistrés sont conservés. Les conversions en heure de Paris se font en interne. Pour une nouvelle heure présente deux fois lors du changement d’heure, le logiciel conserve le décalage d’une saisie existante ou retient la première occurrence compatible avec le début. Une heure locale inexistante est refusée avec un message explicite.

L’apparence du sélecteur (cadran, liste ou réglage des heures) dépend du téléphone et du navigateur ; elle utilise leurs réglages horaires. Les valeurs sont enregistrées avec une précision à la minute. [Documentation du champ horaire natif](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/time).

## Installer depuis Termux

Télécharger `Journal-Chantier-V15.7.zip` dans **Téléchargements**, puis copier cette commande dans Termux :

```bash
mise_a_jour_dir="$(mktemp -d "$HOME/journal-v157-XXXXXXXX")" &&
unzip -q "$HOME/storage/downloads/Journal-Chantier-V15.7.zip" -d "$mise_a_jour_dir" &&
bash "$mise_a_jour_dir/Journal-Chantier-V15.7/scripts/update-v157-termux.sh"
```

Le script utilise le dépôt `Journal-de-chantier-SNCF` déjà présent dans Termux et les secrets Supabase déjà configurés dans GitHub. Il sauvegarde le code précédent, vérifie la version, publie le catalogue et attend la réussite de ses contrôles avant de publier l’interface. Il conserve les CR, les horaires, les demandes et la configuration existante.

Attendre la réussite de GitHub Pages, puis fermer et rouvrir l’application. L’en-tête du CR doit afficher **V15.7**. Si une étape échoue, relancer la même commande pour reprendre ; le script ne remplace pas des modifications locales inconnues.

## Vérifications

Les essais sur une base de test et dans Chromium ont couvert la sélection des références, la saisie libre, les heures, les dates masquées, le passage de minuit, une fin au surlendemain, l’enregistrement par l’administrateur, l’enregistrement provisoire puis l’envoi par l’agent et la réouverture sur tablette.

Le chemin réel de la migration, son registre d’installation et toutes les requêtes de contrôle de l’installateur ont été vérifiés. Le sélecteur a été contrôlé dans le navigateur ; son cadran Android doit être vérifié sur le téléphone après installation. Aucun déploiement de cette version n’a été exécuté depuis l’environnement de préparation.
