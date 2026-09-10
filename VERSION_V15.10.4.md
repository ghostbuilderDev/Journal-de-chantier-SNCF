# Journal de chantier V15.10.4 — Numérotation des rapports journaliers

Correctif à installer sur la V15.10.3. Le module Rapport journalier affiche V10.4.

## Ce qui est corrigé

- Numéro attribué par le serveur au premier enregistrement du rapport. Le compteur est commun à tous les utilisateurs, appareils et chantiers du Journal.
- Initialisation au-dessus du plus grand numéro présent dans les rapports partagés et les noms des PDF déjà archivés dans le Journal. Exemple : les RJ 1 et 2 existent ; le prochain numéro disponible est 3.
- Le bouton « Créer le rapport suivant » prépare la nouvelle séance. Un ancien rapport déjà archivé est identifié comme tel.
- Le même rapport conserve son numéro lors des sauvegardes, transferts, validations et nouvelles tentatives après une coupure. Une nouvelle création reçoit le numéro suivant. Les numéros attribués ne sont jamais recyclés après suppression.
- Le formulaire affiche le numéro confirmé. Un nouveau brouillon affiche « Numéro attribué à l’enregistrement », sans présenter un n° 1 provisoire comme définitif.
- Le PDF destiné au téléphone, au Journal ou à SharePoint est généré après confirmation de ce numéro. Le serveur refuse une nouvelle archive dont la référence ne correspond pas au rapport enregistré.
- La création du rapport suivant n’écrase plus le brouillon du rapport précédent. La reprise est séparée par compte, chantier et identifiant du rapport.
- La date d’un rapport existant reste celle de sa séance ; ouvrir l’application un autre jour ne change plus cette date.
- Les commandes de remise à zéro et de modification manuelle des numéros sont retirées du module intégré.

## Conservation des données

Les PDF déjà transmis et les rapports déjà validés conservent leurs références historiques. Les éventuels doublons déjà présents dans ces anciens documents ne sont pas réécrits. Un ancien brouillon partagé non encore archivé reçoit sa référence définitive lors de son prochain enregistrement.

Le compteur peut présenter des écarts si des rapports numérotés sont abandonnés ou supprimés : leurs numéros restent réservés. Les documents conservés uniquement ailleurs (téléphone ou SharePoint sans copie dans le Journal) ne sont pas accessibles à l’initialisation ; l’import des anciens PDF dans le Journal tient compte de leur suffixe `_N000003.pdf` lorsqu’il existe.

Les saisies hors connexion restent conservées. Une connexion est nécessaire pour attribuer le numéro d’un nouveau rapport et confirmer les modifications avant son export. Une reprise d’archivage déjà préparée conserve le PDF original.

## Installation dans Termux

Télécharger `Journal-Chantier-V15.10.4.zip`, puis exécuter :

```bash
unzip -o "$HOME/storage/downloads/Journal-Chantier-V15.10.4.zip" -d "$HOME/Journal-Chantier-V15.10.4"
bash "$HOME/Journal-Chantier-V15.10.4/scripts/update-v15104-termux.sh"
```

L’installation sauvegarde le code, vérifie la version existante, publie la migration, attend la réussite de ses tests GitHub Actions et met ensuite à jour l’interface. Elle réutilise les secrets Supabase déjà configurés. Elle ne rejoue pas les migrations de production précédentes.

Une fois GitHub Pages terminé, fermer puis rouvrir l’application et le Rapport journalier. Ne pas effacer les données du navigateur. La version V10.4 est visible dans le Rapport journalier.

En cas d’interruption, relancer la même commande : les étapes déjà terminées sont reconnues. Une version inconnue ou des modifications locales sont conservées et provoquent un arrêt explicite.
