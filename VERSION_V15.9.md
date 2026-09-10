# Journal de chantier — V15.9

Cette mise à jour s’installe sur la V15.8 publiée. Elle ajoute une complétude partagée du CR off et le partage de l’affichage du QR code du briefing.

## Installation dans Termux

Télécharger **Journal-Chantier-V15.9.zip** dans **Téléchargements**, puis exécuter :

```bash
unzip -o "$HOME/storage/downloads/Journal-Chantier-V15.9.zip" -d "$HOME/Journal-Chantier-V15.9"
bash "$HOME/Journal-Chantier-V15.9/scripts/update-v159-termux.sh"
```

Si Termux n’a pas encore accès aux fichiers : `termux-setup-storage`. Les outils nécessaires restent `git`, `gh`, `python` et `unzip` (`pkg install -y git gh python unzip`).

Le script vérifie la version existante, sauvegarde son code, applique la partie serveur avec ses tests GitHub, puis publie l’interface. Il reprend les secrets Supabase déjà configurés. Aucun paramétrage supplémentaire de messagerie n’est nécessaire.

Attendre la réussite du script et de [GitHub Pages](https://github.com/ghostbuilderdev/Journal-de-chantier-SNCF/actions), fermer toutes les fenêtres du journal et du briefing, puis rouvrir [l’application](https://ghostbuilderdev.github.io/Journal-de-chantier-SNCF/). Le CR off indique **V15.9**. Ne pas effacer les données du navigateur : elles peuvent contenir des brouillons ou des configurations utiles.

En cas d’interruption, relancer la même commande. L’interface est publiée seulement après validation du serveur. Un fichier modifié depuis la version vérifiée est conservé et arrête l’installation ; ne pas forcer son remplacement.

## Complétude du CR off : préparer et désigner les agents

1. Renseigner les travaux dans **Production** pour le chantier et la nuit concernés. Ils alimentent automatiquement la saisie commune. Cette saisie utilise les mêmes travaux, sans créer un deuxième message de production.
2. Dans **CR off**, ouvrir **Production réalisée** ou **Sécurité · tops et flops**. Ces deux boutons ouvrent la même fenêtre **Complétude du CR off**, sur le volet choisi.
3. Ouvrir **Responsables**, cocher les agents qui compléteront les deux volets, puis **Envoyer la demande aux agents**. Plusieurs agents peuvent être désignés.
4. Les agents reçoivent leur demande dans l’application. Ils peuvent l’ouvrir ou la masquer et la retrouver dans **Mes demandes**. Ils accèdent à cette saisie, sans accéder à la gestion du CR complet.

Lorsque l’encadrant ou un agent déjà désigné enregistre une production, la fenêtre commune s’ouvre directement. Une production saisie par un autre contributeur est bien reprise ; l’encadrant désigne ensuite les responsables.

## Compléter au fil de la séance

- **Production** reprend chaque travail et son pourcentage, de 0 à 100. Un pourcentage vide reste à compléter. **Ajouter un travail réalisé** permet de saisir un travail ajouté pendant la séance. Le **Descriptif libre** reste possible lorsque des pourcentages ne sont pas adaptés.
- **Sécurité** recueille les observations : saisir le fait et choisir **Top** ou **Flop**. Les auteurs et les dernières personnes ayant complété une observation restent identifiables. S’il n’y a aucun fait à signaler, cocher **Rien à signaler en sécurité**.
- Les modifications sont sauvegardées automatiquement après une courte pause. **Enregistrer** confirme la sauvegarde sur le serveur et laisse la demande ouverte. **Fermer** enregistre puis masque la fenêtre, sans la finaliser.
- Les autres responsables retrouvent les données partagées à la réouverture et lors de l’actualisation de la fenêtre. Une saisie en cours n’est pas remplacée pendant la frappe. Si deux personnes modifient le même élément, un choix présente **Ma saisie** et **Enregistré** ; il faut les rapprocher avant de poursuivre.
- Si la connexion est interrompue, un brouillon de reprise est conservé sur le même appareil, pour le même compte et le même CR. Il ne devient partagé qu’après confirmation du serveur. Réouvrir la demande et appuyer sur **Enregistrer** une fois la connexion rétablie. Ne pas changer d’appareil en supposant qu’une saisie hors connexion a déjà été transmise.

## Transmettre à l’encadrant

À la fin de la séance, l’un des responsables clique sur **Transmettre au CR off**, après avoir complété les deux volets. Un message précise que les agents ne pourront plus modifier directement la demande après transmission.

Cette action alimente les rubriques Production et Sécurité du CR et retire la demande des saisies en attente de tous les responsables. **Elle ne valide pas le CR complet et ne l’envoie pas à la hiérarchie.** Le CR reste en brouillon.

L’encadrant peut alors consulter les deux volets, modifier les informations, ou sélectionner **Responsables → Renvoyer pour complément** avec une consigne. La demande réapparaît chez les agents désignés avec les données conservées. L’encadrant garde la validation du compte rendu complet et le parcours de visualisation et partage manuel du PDF.

## Partager et afficher le QR code du briefing

1. Dans le briefing, vérifier le chantier et la date, puis **Créer le QR code de cette séance** ou **Afficher le QR code**.
2. Appuyer sur **Partager le QR code** et choisir l’application utilisée pour transmettre le lien vers la tablette ou l’écran.
3. Sur cet autre appareil, ouvrir le lien reçu. Il affiche le QR code en grand, avec le chantier, la date et l’identifiant de la séance. Le bouton **Plein écran** agrandit la présentation.
4. Les agents scannent ce QR code avec leur téléphone : ils arrivent sur le formulaire de signature de ce briefing. Les signatures rejoignent le formulaire de l’encadrant.
5. À chaque nouvelle séance, créer le nouveau QR et partager son nouveau lien. Sur la tablette, ouvrir ce lien pour remplacer l’affichage précédent.

Le lien partagé ouvre une **page d’affichage du QR**, et le QR lui-même ouvre le **formulaire de signature**. La page vérifie régulièrement que l’émargement est ouvert ; elle masque le QR lorsque la séance est fermée, expirée, ou ne peut plus être vérifiée. Une connexion Internet est nécessaire pour cette vérification et pour envoyer une signature.

**Télécharger l’affiche QR** permet aussi d’obtenir une image PNG à afficher ou transmettre soi-même. Cette image est fixe : elle indique la date et la séance, mais doit être remplacée manuellement au prochain briefing. Un ancien QR fermé n’accepte plus de signatures côté serveur.

Si le partage natif n’est pas proposé par le navigateur, le bouton copie le lien d’affichage lorsque cette fonction est disponible. Le lien **Ouvrir l’affichage du QR code** et le téléchargement de l’affiche restent accessibles.

## Données et mise à jour

La migration ajoute des tables privées de complétude, d’agents désignés, d’observations et de confirmation des sauvegardes. Elle garde la production existante comme source. La suppression d’un CR supprime aussi ses données de complétude ; une nouvelle nuit ne reprend pas les réponses ou les transmissions précédentes.

Les droits de gestion du CR, les demandes ITC/caténaire/ARF et le fonctionnement des signatures QR de la V15.8 sont conservés. La rédaction et l’envoi des messages restent ceux du correctif V15.7.1. Le partage de QR utilise le générateur local déjà livré, sans service externe de génération.
