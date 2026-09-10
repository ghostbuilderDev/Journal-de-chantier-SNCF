# Journal de chantier — V15.10.2

Cette livraison complète V15.10.1 et conserve ses évolutions : transferts du Rapport journalier, mentions avec accès direct au message et signature QR agrandie. Elle corrige l'ajout automatique de doublons dans la liste des participants du briefing.

## Vos noms déjà enregistrés

Gardez la liste des participants sur l'appareil de l'encadrant. Il n'est pas nécessaire de supprimer les vingt noms de la veille. Les signatures de la nouvelle séance complètent les lignes existantes lorsque le nom et le prénom correspondent à un seul participant non signé.

Les différences de majuscules, d'accents, d'espaces, de tirets ou d'apostrophes sont tolérées. L'entreprise et la fonction ne servent plus à identifier la personne ; elles peuvent être actualisées avec les renseignements saisis aujourd'hui. Le nom enregistré et la position de sa ligne sont conservés.

Une correspondance de noms n'est pas un contrôle d'identité. Si deux personnes ont les mêmes nom et prénom, l'encadrant doit vérifier à qui appartient la signature.

## En cas de doute

Un bandeau **Signatures à vérifier** apparaît au-dessus de la liste. Une signature ambiguë reste en attente, sans ajouter automatiquement un nom.

1. Appuyer sur **Vérifier les signatures**.
2. Sélectionner la personne déjà enregistrée, puis **Rattacher la signature**.
3. Si la personne est réellement nouvelle, choisir **Ajouter comme nouveau participant**, puis confirmer.

Si la personne possède déjà une signature, l'encadrant peut conserver celle qui est présente ou confirmer son remplacement. La réception répétée d'une même signature et les actualisations n'ajoutent pas de ligne supplémentaire. **Plus tard** conserve la vérification en attente ; elle reste présente après rechargement sur le même appareil.

Les signatures en attente doivent être vérifiées avant de générer le PDF ou de passer à une autre date. Cela évite de produire un document qui les oublierait. Les noms et les rapprochements restent sauvegardés sur l'appareil de l'encadrant, selon le fonctionnement actuel du briefing ; les signatures reçues par QR restent également conservées sur le serveur de leur séance. Il faut poursuivre le briefing sur ce même appareil pour retrouver ses choix de rapprochement.

Les doublons déjà présents avant cette mise à jour ne sont pas supprimés automatiquement : deux lignes similaires peuvent désigner deux personnes distinctes. Il est possible de rattacher une signature à la bonne ligne puis de retirer manuellement la ligne vide en trop, après vérification.

## Installation avant la séance

Ce ZIP est cumulatif. Il peut être installé depuis V15.9, V15.10 ou V15.10.1. Si la précédente livraison n'est pas encore installée, utiliser directement celle-ci.

Télécharger **Journal-Chantier-V15.10.2.zip** dans Téléchargements, puis lancer dans Termux :

```sh
unzip -o "$HOME/storage/downloads/Journal-Chantier-V15.10.2.zip" -d "$HOME/Journal-Chantier-V15.10.2"
bash "$HOME/Journal-Chantier-V15.10.2/scripts/update-v15102-termux.sh"
```

L'installateur conserve les réglages et les données, sauvegarde le code précédent, vérifie le serveur puis publie l'interface. Aucune nouvelle migration de données n'est nécessaire pour ce correctif ; les migrations V15.10 et V15.10.1 sont incluses si elles ne sont pas encore installées. Une migration déjà enregistrée n'est pas rejouée. Les modifications locales non reconnues provoquent un arrêt explicite, sans écrasement.

Attendre la réussite de GitHub Pages, puis fermer et rouvrir Journal de chantier et Briefing. **Ne pas effacer les données du navigateur ni désinstaller la PWA** : les noms enregistrés sur l'appareil doivent être conservés. En cas d'interruption de l'installation, relancer la seconde commande.

Ouvrir le briefing du bon chantier sur l'appareil contenant la liste, préparer la nouvelle séance et afficher son QR code. Faire signer une première personne et vérifier que sa signature complète sa ligne avant de faire signer toute l'équipe.

Les essais utilisent les interfaces réelles dans Chromium aux dimensions téléphone et tablette, avec une base de test jetable. La vérification finale sur vos appareils et votre serveur s'effectue après installation ; cette livraison ne les a pas modifiés à distance.
