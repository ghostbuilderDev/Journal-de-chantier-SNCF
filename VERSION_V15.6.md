# Journal de chantier — V15.6

Mise à jour préparée pour la V15.5 installée (commit `0e7142c`).

- **Rédaction agrandie** : cliquer dans « Message ou photo » ouvre l’espace de rédaction. Entrée insère une ligne. Le bouton **Envoyer** est le seul à publier. « Mettre de côté » conserve le texte et les pièces jointes ; un brouillon local peut être repris après rechargement sur le même appareil et avec le même compte.
- **Améliorer le message** : proposition modifiable, à relire avant de l’appliquer. Le texte d’origine et les pièces jointes sont conservés. Aucune publication automatique. Contrôle des valeurs numériques, des sigles et des formulations d’incertitude ; l’utilisateur reste chargé de relire la proposition.
- **Emojis** : suppression du bouton redondant situé au-dessus de la barre d’actions ; les réactions déjà présentes sont conservées. Sélecteur complet de 3 944 emojis Unicode 17, avec catégories, recherche et saisie depuis le clavier.
- **CR off** : dates et horaires repliés sous **Date** ; leurs valeurs restent enregistrées. Les autres fonctions de V15.5 (demandes privées, brouillon/envoi définitif, PDF et partage manuel) sont conservées.
- **Références** : 53 choix issus des lignes Petit/Dahmani du classeur fourni, toutes ses feuilles comprises : 12 SEL, 19 secteurs/groupes et 22 références d’interception. Chaque choix conserve son libellé source et, lorsqu’il est explicite, le secteur associé. La case commence vide et reste modifiable après sélection. Les heures du fichier ne sont pas importées. Une valeur Excel non textuelle et les notes de coactivité sont écartées, sans inventer de référence.
- **Suppression définitive** : confirmation avant suppression des CR ou du chantier ; aucun dossier de restauration. La suppression d’un CR retire aussi ses demandes, réponses, validations et versions. Une nouvelle préparation du même chantier/de la même nuit crée un nouvel identifiant et un formulaire vierge. L’ancienne production reste dans le journal historique mais ne remplit pas ce nouveau CR ; seules de nouvelles saisies de production pourront l’alimenter.
- **Anciens retraits V15.5** : ils apparaissent comme « Suppression à finaliser », pour être supprimés explicitement. Préparer de nouveau leur nuit remplace le document retiré par un CR neuf. L’installation elle-même ne supprime aucun chantier ni CR.

## Installation dans Termux

Télécharger `Journal-Chantier-V15.6.zip` dans **Téléchargements**, puis :

```bash
termux-setup-storage
```

Puis exécuter :

```bash
mise_a_jour_dir="$(mktemp -d "$HOME/journal-v156-XXXXXXXX")" && unzip -q "$HOME/storage/downloads/Journal-Chantier-V15.6.zip" -d "$mise_a_jour_dir" && bash "$mise_a_jour_dir/Journal-Chantier-V15.6/scripts/update-v156-termux.sh"
```

Le script sauvegarde le code précédent, applique le serveur, attend les tests GitHub Actions, puis publie l’interface. En cas d’erreur, conserver le message et relancer la même commande. Aucun ancien fichier personnel n’est écrasé si sa version diffère de celle vérifiée. Les trois secrets GitHub Supabase déjà utilisés sont requis.

Attendre ensuite la coche verte GitHub Pages et fermer puis rouvrir l’application. Le CR affiche **V15.6**.

## Activer Gemini Pro

Le bouton du fil utilisait auparavant une correction locale, pas Gemini. Le briefing et le CR employaient une passerelle Google Apps Script dont le modèle serveur n’est pas exposé dans les sources fournies : sa version exacte n’a donc pas pu être vérifiée.

Cette livraison prépare un moteur Supabase utilisant **`gemini-3.1-pro-preview`**, choisi pour privilégier la qualité rédactionnelle parmi les modèles Pro documentés au moment de la mise à jour. Il s’agit d’un modèle preview, pas d’une garantie de meilleur résultat pour chaque texte. Le modèle peut être remplacé côté serveur via `JOURNAL_GEMINI_MODEL`.

**Pour activer ce moteur, une clé Gemini API doit être configurée une fois.** Si le secret `GEMINI_API_KEY` existe déjà dans Supabase, il est réutilisé. Sinon, dans Termux, après l’installation :

```bash
bash "$HOME/Journal-de-chantier-SNCF/scripts/configure-v156-gemini-termux.sh"
```

1. Utiliser une clé API de votre projet Google AI Studio, par exemple celle du script de briefing si vous en administrez les propriétés. Ne jamais la mettre dans `config.js`, dans une capture ou dans la conversation.
2. La commande `gh` demande la clé en saisie masquée, puis relance le workflow V15.6 pour la déposer côté serveur et activer le moteur.
3. Attendre la coche verte. Dans l’application, rédiger un message de test et choisir **Améliorer le message**, puis relire la proposition. Cela ne publie rien.

Tant que le moteur Pro n’a pas sa clé, la passerelle Gemini du briefing reste utilisée, avec des consignes renforcées ; son modèle exact ne peut pas être garanti. Aucun changement de modèle du briefing lui-même n’est revendiqué. Si Gemini refuse l’accès ou atteint son quota, le texte est conservé et une erreur claire est affichée. Les appels au moteur Pro utilisent la facturation/quota du projet Google associé à la clé ; aucune souscription n’est créée par la mise à jour. Le serveur limite les demandes à 30 par compte et par heure.

Sources vérifiées : [modèles Gemini](https://ai.google.dev/gemini-api/docs/models), [Gemini 3.1 Pro Preview](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-pro-preview), [catalogue Unicode 17](https://www.unicode.org/Public/emoji/latest/emoji-test.txt).

## Limites de vérification

Tests exécutés sur une base jetable et dans Chromium aux dimensions téléphone et tablette, sans toucher aux données réelles. Aucun message de chantier, email ou appel Gemini facturé n’a été envoyé. Le fonctionnement tactile et le clavier du téléphone/tablette réels ainsi que la réponse du projet Gemini seront à vérifier après installation. Effacer les données du navigateur efface les brouillons de cet appareil ; fermer la fenêtre de rédaction ne les efface pas.
