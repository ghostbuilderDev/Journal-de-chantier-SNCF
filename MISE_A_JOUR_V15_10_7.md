# Journal Chantier Connecté — V15.10.7

## Photos plus rapides, sans perte de qualité

Cette version accélère l'ouverture du fil d'actualité et la publication des albums photo.

- Les images du fil sont chargées seulement lorsqu'elles approchent de l'écran.
- Les photos déjà pourvues d'un aperçu utilisent cette vignette légère dans le fil.
- Une photo historique sans aperçu reste inchangée : son original est simplement chargé au moment où il devient visible.
- Le visualiseur plein écran et le PDF demandent toujours l'original privé : aucune réduction de qualité n'est appliquée à ces usages.
- Un album est maintenant téléversé par groupes de trois fichiers, plutôt que strictement un fichier après l'autre.

Il n'y a pas de migration SQL à exécuter pour cette version.

## Mise à jour Termux

Télécharger l'archive V15.10.7 dans `Download`, puis exécuter :

```sh
unzip -o "$HOME/storage/downloads/Journal-Chantier-V15.10.7-Photos-rapides.zip" -d "$HOME/Journal-Chantier-V15.10.7" && bash "$HOME/Journal-Chantier-V15.10.7/scripts/update-v15107-termux.sh"
```
