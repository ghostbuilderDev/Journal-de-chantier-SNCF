# Journal de chantier — V15.10.7

Cette version accélère les photos sans réduire la qualité des éléments de preuve.

## Ce qui change

- À l'ouverture d'un chantier, les messages arrivent sans demander immédiatement toutes les photos de l'historique.
- Le fil charge automatiquement une photo seulement lorsqu'elle approche de la zone affichée. Une simple remontée dans l'historique continue donc de fonctionner naturellement.
- Lorsqu'un aperçu sécurisé existe, il est utilisé dans le fil. La photo originale reste privée dans Supabase.
- Le bouton d'agrandissement demande toujours l'original en pleine définition. Le PDF demande également cet original : la couverture, les légendes et l'historique ne changent pas.
- L'envoi de plusieurs pièces jointes utilise trois transferts simultanés, ce qui évite l'attente strictement séquentielle des albums.

Il n'y a aucune migration SQL à exécuter et aucun droit ou document existant n'est modifié.

## Installation dans Termux

1. Télécharger `Journal-Chantier-V15.10.7-Photos-rapides.zip` dans le dossier **Download**.
2. Coller cette seule commande dans Termux :

```bash
unzip -o "$HOME/storage/downloads/Journal-Chantier-V15.10.7-Photos-rapides.zip" -d "$HOME/Journal-Chantier-V15.10.7" && bash "$HOME/Journal-Chantier-V15.10.7/scripts/update-v15107-termux.sh"
```

Le programme conserve `config.js`, les données Supabase et les brouillons locaux. Après le message de réussite, attendre la coche verte de GitHub Pages, fermer complètement l'application puis la rouvrir. Ne pas désinstaller la PWA ni effacer les données du navigateur.
