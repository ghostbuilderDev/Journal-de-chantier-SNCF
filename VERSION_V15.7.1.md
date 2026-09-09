# Journal de chantier — V15.7.1

Correctif urgent de la communication, à appliquer sur la V15.7.

La fenêtre de rédaction vérifiait une liste de membres disponible seulement en mode local. En mode connecté, les contributeurs et les administrateurs de chantier restaient dans l’ancien champ, dont le bouton Envoyer était masqué. Le propriétaire principal passait ce contrôle, ce qui cachait la régression lors de ses essais.

Le correctif ouvre la rédaction sur le chantier sélectionné et vérifie les droits réels auprès du serveur avant publication, avec la fonction existante `journal_v142_can_write`. Les contributeurs et administrateurs autorisés peuvent envoyer ; les lecteurs et comptes révoqués restent bloqués. Les règles de sécurité de la base ne sont pas modifiées.

- Bouton Envoyer disponible également si la fenêtre agrandie ne peut pas s’ouvrir.
- Entrée ajoute une ligne et ne publie jamais le message.
- Erreurs visibles dans la rédaction ; texte et fichiers conservés pour réessayer.
- Un double appui ne déclenche pas deux envois. Une reprise de pièce jointe réutilise le message déjà enregistré.
- Nouvelles adresses des fichiers de l’interface et nouvelle version du cache pour charger le correctif sur les autres appareils.

## Installation dans Termux

Télécharger `Journal-Chantier-V15.7.1.zip` dans Téléchargements. Exécuter une seule fois depuis le téléphone qui publie habituellement les mises à jour :

```bash
unzip -o "$HOME/storage/downloads/Journal-Chantier-V15.7.1.zip" -d "$HOME/Journal-Chantier-V15.7.1-update" && bash "$HOME/Journal-Chantier-V15.7.1-update/scripts/update-v1571-termux.sh"
```

Le script vérifie la version et les fichiers, sauvegarde le code précédent et publie uniquement le correctif. Il ne modifie ni la configuration ni les messages stockés. Aucune migration Supabase, aucun paramétrage d’email.

Attendre la réussite de GitHub Pages dans les Actions GitHub. Ensuite **chaque utilisateur ferme toutes les fenêtres du journal puis le rouvre** :

https://ghostbuilderdev.github.io/Journal-de-chantier-SNCF/?v=15.7.1

Ne pas effacer les données du navigateur. Un contributeur doit pouvoir toucher « Message ou photo », rédiger puis appuyer sur « Envoyer ». Si « Lecture seule » apparaît, son rôle sur ce chantier doit être vérifié par un administrateur.

## Vérification

Le test `tests/messages-v1571-browser.cjs` exerce l’interface réelle dans Chromium avec une base SQL jetable et des comptes de rôles différents. Les échanges de fichiers et le transport Supabase sont simulés ; les messages, les métadonnées et la vérification des rôles passent par les fonctions SQL. Aucun message n’est envoyé dans votre chantier pendant ces essais.
