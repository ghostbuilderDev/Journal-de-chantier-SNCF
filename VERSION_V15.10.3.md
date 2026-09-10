# Journal de chantier — V15.10.3

Correctif pour la V15.10.2 : les signatures du Briefing au pied de l'opération sont intégrées automatiquement, sans vérification manuelle par l'encadrant.

## Fonctionnement

- Le bandeau « Signatures à vérifier », son bouton et sa fenêtre sont supprimés.
- Une nouvelle personne est ajoutée directement à la feuille des participants.
- Si le nom, le prénom et la société correspondent à une personne déjà enregistrée, la nouvelle signature remplace automatiquement l'ancienne sur sa ligne.
- Les différences de majuscules, d'accents, d'espaces et de ponctuation sont neutralisées pour ce rapprochement. Par exemple, « S.N.C.F. » et « SNCF » correspondent. Le nom et la société restent affichés et enregistrés en majuscules.
- La fonction n'entre pas dans l'identification : elle peut être mise à jour sans créer une autre personne.
- Une ligne préparée sans société peut être complétée si elle est la seule à porter ces nom et prénom.
- Plusieurs lignes portant les mêmes nom, prénom et société sont regroupées lors de la réception d'une nouvelle signature. Des sociétés différentes restent distinctes.
- La signature la plus récente est conservée, même si une ancienne réponse arrive plus tard ou si l'application est actualisée plusieurs fois.

Les signatures du briefing en cours qui étaient restées en attente dans la V15.10.2 sont reprises automatiquement à l'ouverture. Les signatures d'une autre séance ne sont pas reportées sur le briefing du jour.

L'export PDF ne demande plus de vérifier les signatures. Il termine toujours l'émargement et récupère les dernières signatures reçues avant de produire le document. Le QR code, son partage, la grande zone de signature et la configuration des voies conservent leur fonctionnement.

## Installation

Ce correctif s'installe sur la **V15.10.2**, actuellement publiée dans votre dépôt. Il conserve les autres fonctionnalités installées et ne nécessite aucune migration Supabase ni modification de clés ou de réglages serveur.

Télécharger **Journal-Chantier-V15.10.3.zip** dans Téléchargements, puis lancer ces deux commandes dans Termux :

```sh
unzip -o "$HOME/storage/downloads/Journal-Chantier-V15.10.3.zip" -d "$HOME/Journal-Chantier-V15.10.3"
bash "$HOME/Journal-Chantier-V15.10.3/scripts/update-v15103-termux.sh"
```

L'installateur vérifie les fichiers de la version précédente, sauvegarde le code puis publie le correctif. Les fichiers modifiés en dehors de cette version sont conservés ; l'installation s'arrête pour éviter de les écraser. Une interruption peut être reprise en relançant la seconde commande.

Attendre la réussite de GitHub Pages, puis fermer et rouvrir Journal de chantier et Briefing sur l'appareil de l'encadrant. Ne pas effacer les données du navigateur ni désinstaller l'application : les noms et les signatures en attente sont enregistrés sur cet appareil.

L'encadrant peut ensuite afficher le QR code et laisser les participants signer. Aucun rapprochement manuel ni validation supplémentaire de ces signatures n'est demandé.

## Vérifications

Tests réalisés sur les interfaces réelles dans Chromium aux dimensions téléphone et tablette, avec une base de test isolée : vingt noms sauvegardés, deux formulaires de signature sur des sessions distinctes, reprise de cinq signatures en attente, remplacement de l'image de signature, regroupement des doublons, actualisations, export PDF et caches PWA.

Les signatures reçues par QR restent enregistrées sur le serveur de leur séance. Ce correctif modifie leur intégration dans la feuille du briefing ; il n'efface pas ces reçus serveur. La dernière signature apparaît sur la feuille et dans le PDF.

La livraison est prête à installer. Aucun déploiement ni modification des données de production n'a été effectué pendant sa préparation.
