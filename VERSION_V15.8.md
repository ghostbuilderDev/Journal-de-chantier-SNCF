# Journal de chantier — V15.8

Cette mise à jour se pose sur la V15.7.1. Elle conserve le correctif qui permet aux contributeurs d’ouvrir la grande fenêtre de rédaction et d’envoyer leurs messages.

## Installer depuis Termux

1. Télécharger **Journal-Chantier-V15.8.zip** dans le dossier **Téléchargements** du téléphone.
2. Ouvrir Termux et exécuter :

```bash
termux-setup-storage
pkg install -y git gh python unzip
unzip -o "$HOME/storage/downloads/Journal-Chantier-V15.8.zip" -d "$HOME/Journal-Chantier-V15.8"
bash "$HOME/Journal-Chantier-V15.8/scripts/update-v158-termux.sh"
```

Le script sauvegarde le code précédent, installe et vérifie la partie serveur dans GitHub Actions, puis publie l’interface. Il utilise les secrets Supabase déjà configurés dans GitHub. Aucun service d’email ni abonnement supplémentaire n’est nécessaire.

Attendre la fin du script et la réussite de GitHub Pages dans [les exécutions GitHub](https://github.com/ghostbuilderdev/Journal-de-chantier-SNCF/actions). Fermer ensuite **toutes** les fenêtres du journal et du briefing, puis rouvrir [l’application](https://ghostbuilderdev.github.io/Journal-de-chantier-SNCF/). Le CR off affiche **V15.8**.

Si une étape échoue, l’interface n’est pas publiée avant validation du serveur. Relancer la même commande reprend l’installation. Si le script signale des fichiers modifiés dans le dépôt, il les conserve et s’arrête au lieu de les écraser. Ne pas employer `git reset --hard` pour forcer la mise à jour.

## ARF : uniquement le réel

Ouvrir **CR off → ARF · RSO** : seuls **Début réel** et **Fin réelle** sont proposés. Le bouton **Date** permet toujours d’ajuster les dates d’une intervention traversant minuit ou plusieurs jours. L’affectation, l’enregistrement provisoire et l’envoi définitif restent disponibles. Les anciens clients qui transmettraient encore du prévu ARF ne pourront plus l’enregistrer.

## Préparer à partir de la veille

Dans **CR off → Préparer une nuit**, choisir le chantier et la nouvelle date, puis **Reprendre la saisie précédente**. La nuit précédente disponible est proposée ; une autre nuit antérieure peut être choisie. Appuyer ensuite sur **Préparer**.

Le nouveau CR reprend les ZEP et les voies, les consignations, les horaires prévus ITC et caténaire, ainsi que les responsables encore autorisés. Les horaires prévus sont décalés vers les dates de la nouvelle intervention, en conservant les heures de Paris et l’écart entre début et fin. Les horaires réels sont vides. Aucun commentaire, réponse d’agent, validation, statut de réalisation ou demande précédente n’est copié. Le CR source reste intact.

Vérifier cette préparation, ajuster les éléments qui ont changé, puis **Envoyer la demande** dans chaque rubrique concernée. Rien n’est envoyé automatiquement lors de la reprise. Si un CR existe déjà pour la même nuit, il faut l’ouvrir : cette commande ne peut pas écraser ses informations.

## Retrouver les voies et les engins du briefing

L’envoi et la réouverture du briefing conservent désormais le nombre et le nom des voies, les états circulation/caténaire, les PK particuliers, les voies de travail, les pistes et la configuration détaillée des LAM et des autres engins.

Cette sauvegarde est conservée **sur le même appareil et dans le même navigateur**, séparément pour chaque chantier. Elle n’est pas une synchronisation de toute la préparation entre plusieurs appareils. Ne pas effacer les données du navigateur pour actualiser l’application. Avant le briefing suivant, ajuster la date et vérifier la configuration retrouvée. La commande explicite de réinitialisation complète reste disponible.

## Faire signer par QR code

1. Depuis le Journal de chantier, ouvrir le chantier puis son **Briefing au pied de l’opération**. Vérifier la date du briefing.
2. Au-dessus de la feuille de présence, appuyer sur **Créer le QR code de cette séance**. Afficher cette fenêtre sur la tablette ou un écran dans la salle. Le bouton **Copier le lien** permet aussi de transmettre ce même accès.
3. Chaque participant scanne le QR code avec l’appareil photo de son téléphone. **Aucun compte dans le journal n’est nécessaire.** Une connexion Internet est nécessaire.
4. Le participant renseigne **nom, prénom, fonction, entreprise**, trace sa signature avec le doigt et appuie sur **Valider ma signature**. Il doit attendre **Signature reçue** avant de fermer la page.
5. Le briefing reçoit les signatures automatiquement, en quelques secondes. **Actualiser** permet de vérifier immédiatement la réception. Masquer la fenêtre QR laisse l’émargement ouvert.
6. Lorsque tout le monde a signé, générer et vérifier le PDF, puis utiliser l’envoi ou l’archivage habituel. **La génération du PDF termine l’émargement**, après récupération des dernières signatures reçues. Le bouton **Terminer l’émargement** permet aussi de le fermer explicitement.

Le QR code est propre à la séance et expire après 18 heures au maximum. Pour une nouvelle séance, créer un **nouveau QR code**. Ne pas réutiliser un QR code imprimé pour plusieurs nuits. Après l’archivage, les anciennes signatures ne sont pas réinjectées dans la préparation suivante.

Une réponse réseau perdue peut être vérifiée par **Réessayer la validation**, sans créer une deuxième signature. Le téléphone conserve alors la saisie nécessaire à cette vérification. Un participant n’a accès ni au CR off ni à la liste des autres signataires par ce lien. Les signatures reçues restent enregistrées sur le serveur et sont rattachées à l’identifiant de leur séance.

## Contenu technique de la livraison

Migration additive `20260910000100_v15_8_preparation_briefing.sql`, reprise de CR transactionnelle, sessions QR et signatures dans un schéma privé, interfaces mobiles et conservation des configurations. Aucune migration ancienne n’est rejouée par l’installation.

Le QR code est généré localement, sans envoyer son lien à un générateur externe, avec [QR Code generator de Nayuki](https://www.nayuki.io/page/qr-code-generator-library), distribué sous licence MIT incluse dans le fichier du fournisseur.
