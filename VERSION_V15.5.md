# Journal de chantier — V15.5

Cette livraison met à jour la V15.4 installée. Elle conserve la configuration Supabase, les messages, photos, actions, productions et CR existants. Les suppressions de CR se font depuis l’interface, sur votre sélection ; l’installation ne supprime aucun de vos CR.

## Installation dans Termux

Télécharger `Journal-Chantier-V15.5.zip` dans **Téléchargements** du téléphone, puis exécuter :

```bash
termux-setup-storage
pkg install -y git gh python unzip
JOURNAL_V155_DIR="$(mktemp -d "$HOME/journal-v155-XXXXXXXX")" && unzip -q "$HOME/storage/downloads/Journal-Chantier-V15.5.zip" -d "$JOURNAL_V155_DIR" && bash "$JOURNAL_V155_DIR/Journal-Chantier-V15.5/scripts/update-v155-termux.sh"
```

La commande travaille sur `~/Journal-de-chantier-SNCF`. Si votre dépôt porte un autre nom, ajouter son chemin en dernier argument du script. Garder l’archive à son nom exact. Si Android a ajouté `(1)` au nom du fichier, renommer le téléchargement.

Le script vérifie les fichiers de la V15.4, sauvegarde le code, publie d’abord la migration, attend les tests et la validation de GitHub Actions pour ce commit, puis publie l’interface. Il s’arrête si un fichier concerné comporte une modification non reconnue. Les trois secrets GitHub Supabase de votre installation actuelle sont réutilisés. Aucune clé n’est demandée dans un message du journal.

En cas de coupure, relancer la même commande : le script reprend les étapes déjà validées. Ne pas copier les fichiers manuellement sur la version en service.

Attendre la coche verte de GitHub Pages, fermer puis rouvrir l’application sur le téléphone et sur la tablette. Le bandeau des CR affiche **V15.5**.

## Administrateur : préparer et centraliser

1. Ouvrir **CR off**, puis **Préparer une nuit**. Les nuits comportant une production apparaissent aussi dans la liste, même si le CR n’a jamais été ouvert sur cet appareil.
2. Ouvrir Consignation, ITC ou ARF. Choisir le responsable. Les prévisions sont facultatives.
3. Consignation : une seule ligne vide au départ. Choisir SEL ou Secteur, saisir ou choisir un intitulé modifiable. Ajouter les consignations nécessaires. Les anciennes lignes sont conservées ; retirer explicitement celles devenues inutiles.
4. ITC : saisir ZEP puis Voie. ARF : un seul début et une seule fin. Les dates de début et de fin sont visibles sous les heures ; les modifier pour un week-end. Les horaires sont en heure de Paris.
5. Cliquer **Envoyer la demande**. « Enregistrer » seul conserve une préparation sans créer de nouvelle demande.
6. Pour réutiliser les prévisions, cocher l’option de la semaine à l’enregistrement. Lors de la préparation d’une autre nuit, choisir explicitement de reprendre cette configuration. Les horaires réels ne sont pas recopiés.
7. Le récapitulatif distingue les informations manquantes, les brouillons sauvegardés par les agents et les informations définitivement reçues.

Une configuration modifiée pendant qu’un agent travaille doit être renvoyée avec **Enregistrer et renvoyer**. L’application demande confirmation avant de remplacer son brouillon. Pour corriger des informations déjà transmises, ouvrir la rubrique, préciser la correction et renvoyer la demande. Si le CR est validé, créer d’abord un rectificatif.

## Agent : enregistrer puis envoyer

Seul l’agent désigné reçoit la fenêtre. Il peut choisir **Plus tard** et la retrouver dans **Mes demandes**. Les contributeurs et lecteurs ne voient pas le menu de gestion du CR ni son contenu complet.

- **Enregistrer** sauvegarde le brouillon sur le serveur, sans clôturer la demande et sans remplacer la saisie officielle du CR.
- **Envoyer les informations** demande confirmation, contrôle les heures réelles (ou « Non pris / Non concernée »), alimente le CR et retire la demande des saisies en attente.
- Après transmission, l’agent ne peut plus la modifier directement. L’administrateur peut la lui renvoyer.

Le rappel de fin de séance utilise la fin prévue si elle est renseignée. Il peut être inhibé. Les fenêtres internes fonctionnent quand l’application est ouverte et connectée ; les alertes du téléphone fermé nécessitent les autorisations de notifications et le service push déjà installé.

## Production et sécurité

Le lien Production → CR reste actif. La saisie par travail avec pourcentage et indication « Travail ajouté » est conservée. Le choix **Descriptif libre** permet de raconter simplement les travaux réalisés sans imposer de pourcentage. Il conserve les lignes de production existantes.

L’attribution d’une demande de production est facultative. Elle suit la même séparation entre brouillon et envoi définitif. La sécurité reste une saisie de faits Top / Flop par l’encadrement, sans attribution obligatoire. Le bouton **Améliorer** conserve la proposition à relire avant application.

## PDF du CR et partage

1. Compléter le récapitulatif et attendre l’envoi définitif des demandes ouvertes.
2. **Valider le CR** fige une version conservée sur le serveur.
3. **Visualiser le PDF** ouvre le document réel, avec production, sécurité, consignations, ITC et ARF. Un aperçu de brouillon reste possible et porte la mention BROUILLON.
4. **Partager le CR off** ouvre le partage de fichiers du téléphone lorsqu’il est disponible. Choisir votre messagerie et ajouter vous-même le destinataire.

Aucun envoi automatique, aucune liste générique de destinataires, aucune configuration Resend n’est nécessaire. Si le navigateur ne propose pas le partage de fichiers, **Télécharger le PDF** puis le joindre dans votre messagerie. **Ouvrir / imprimer** ouvre le même fichier dans le lecteur PDF de l’appareil.

## Exporter le journal

Choisir les dates et les photos, puis créer le PDF. Le texte est paginé directement ; les photos sont téléchargées par petits groupes et optimisées dans le PDF. Les originaux du serveur ne sont pas modifiés. La progression est visible et l’opération peut être annulée.

Un échec de photo est retenté. S’il persiste, l’application indique les photos manquantes et propose de réessayer. Un document incomplet n’est produit que si vous le demandez explicitement ; il est signalé comme tel. Il n’y a plus d’impression d’une fenêtre HTML vide.

Les performances dépendent du nombre de photos, du téléphone et du réseau. Les contrôles locaux ont vérifié un journal de 220 événements et 20 photos, y compris la présence des images dans le fichier PDF final. Cela ne constitue pas une mesure de vitesse sur votre réseau SNCF.

## Supprimer les CR non réalisés

Dans la liste, sélectionner un ou plusieurs CR, puis **Supprimer la sélection**, ou utiliser **Supprimer** sur une ligne. Ils restent récupérables dans **CR supprimés**. Les demandes associées disparaissent pendant la suppression. Un ancien CR dont un envoi email a déjà été engagé est conservé pour garder son historique.

## Validation de la livraison

Les tests ont été exécutés sur une base PostgreSQL isolée via PGlite et dans Chromium avec les vraies fonctions de l’application, aux formats téléphone et tablette. Les PDF produits ont été extraits et rendus pour vérifier textes, photos, dates et polices. La transaction de déploiement a été testée avec une erreur forcée pour vérifier le retour arrière intégral.

Cette archive n’a pas été appliquée à votre serveur depuis cette conversation. Le partage Android et l’impression sur votre imprimante doivent être vérifiés sur votre appareil après l’installation.
