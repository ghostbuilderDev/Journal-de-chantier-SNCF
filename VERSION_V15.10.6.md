# Journal de chantier — V15.10.6

Cette mise à jour ajoute les albums photos à la V15.10.5. Elle modifie uniquement
l’interface du Journal : aucune migration Supabase ni configuration supplémentaire.

## Utilisation

1. Ouvrir la rédaction d’un message puis **Photos** pour sélectionner plusieurs
   images de la galerie, ou **Prendre une photo** pour utiliser l’appareil photo.
2. Utiliser **Prendre une autre photo** autant de fois que nécessaire. Les prises
   de vue précédentes restent dans le brouillon. **Ajouter des photos** permet
   de compléter avec la galerie. Le sélecteur proposé dépend du téléphone ; sur
   ordinateur, un sélecteur de fichiers remplace généralement l’appareil photo.
3. Retirer une image avec sa croix ou utiliser l’annotation existante. Le texte
   reste libre et peut être vide pour publier seulement les photos.
4. Appuyer une seule fois sur **Envoyer** : un seul message contient l’album et
   ses éventuelles autres pièces jointes. Entrée ajoute un retour à la ligne.
5. Dans le fil, deux photos apparaissent côte à côte, trois en mosaïque, et quatre
   ou plus dans un bloc de quatre vignettes. **+2** signifie que deux autres photos
   restent à consulter après les quatre vignettes d’un album de six photos.
6. Toucher une vignette puis utiliser **Précédente / Suivante**, glisser
   horizontalement, ou utiliser les flèches du clavier. Le compteur indique la
   position dans l’album. **Ouvrir** donne accès à l’original, **×** ferme l’album.

La fermeture de la rédaction conserve le texte et les fichiers dans le brouillon
du même compte et du même chantier. Après une interruption partielle de l’envoi,
**Réessayer** ajoute les fichiers restant à envoyer au même message. L’export PDF
continue de reprendre toutes les photos originales, y compris celles masquées
derrière le compteur. Les albums des messages existants adoptent aussi la mosaïque.

## Installation dans Termux

Télécharger **Journal-Chantier-V15.10.6.zip** dans **Téléchargements**, puis :

```bash
unzip -o "$HOME/storage/downloads/Journal-Chantier-V15.10.6.zip" -d "$HOME/Journal-Chantier-V15.10.6"
bash "$HOME/Journal-Chantier-V15.10.6/scripts/update-v15106-termux.sh"
```

L’installation reconnaît les fichiers de la V15.10.5, sauvegarde le code précédent,
conserve `config.js` et publie les seuls fichiers concernés. Une version différente
ou un fichier modifié arrête la procédure avant remplacement. Une interruption
du push peut être reprise avec la même commande.

Attendre la réussite de GitHub Pages, fermer toutes les fenêtres du Journal puis
rouvrir l’application. Ne pas désinstaller la PWA et ne pas effacer les données
du navigateur. Le module Rapport journalier reste en V10.5 : ses fonctions ne
sont pas modifiées par cette livraison.

La livraison est préparée et testée séparément ; elle doit être installée pour
être disponible aux utilisateurs. Les essais ne publient aucun message réel.
