# Journal de chantier V15.10.1

Cette livraison remplace le ZIP V15.10. **Installer uniquement ce nouveau ZIP** : il contient les transferts et les mentions de la V15.10 ainsi que les compléments demandés. Il s’applique directement à la V15.9 publiée, ou à la V15.10 déjà installée. Aucun rapport, chantier, briefing ou signature existant n’est supprimé.

## Résultat de la vérification

| Demande | Vérification et résultat dans V15.10.1 |
| --- | --- |
| Transférer le Rapport journalier à un ou plusieurs contributeurs autorisés | Déjà présent en V15.10 ; repris dans cette livraison et testé avec plusieurs comptes. |
| Ouvrir le même rapport et retrouver toutes les informations | Même identifiant et document partagé, y compris photos et signatures ; aucune création de copie lors du transfert. |
| Transferts successifs, nouvelle contribution, validation et historique | Déjà présents ; historique conservé sur le serveur, version contrôlée pour empêcher l’écrasement des saisies simultanées. |
| Mention avec auteur, chantier, extrait et accès direct au message | Déjà présent ; ouverture du bon chantier, retrait des filtres, chargement du message visé et mise en évidence pendant cinq secondes. |
| Notification dès l’arrivée d’une mention ou d’un transfert | Complété : signal Supabase Realtime personnel, sans attendre le délai d’actualisation de vingt secondes. |
| Signature QR dans une grande fenêtre sur téléphone | Ajouté : grande zone, effacement, rotation portrait/paysage, validation du tracé et aperçu immédiat dans le formulaire. |
| Conservation de la saisie en cours | Ajoutée pour le formulaire QR et son tracé sur le même onglet, y compris après rechargement. |
| Nom et entreprise en majuscules | Ajouté dans les champs, à l’enregistrement serveur, à la reprise dans le briefing et dans le PDF. Le prénom conserve sa casse. |
| Présentation professionnelle de la page QR | Titre « Journal de chantier – Briefing au pied de l’opération », aucun intitulé d’hébergement ajouté dans la page, bouton Plein écran lorsque disponible. |
| Compatibilité PWA et QR existants | Liens et jetons inchangés, trois périmètres de cache conservés, aucun contenu privé mis en cache par les service workers. |

## Rapport journalier et mentions

Depuis le chantier, ouvrir **Applications → Rapport journalier**. Le bouton **Transférer le rapport journalier** enregistre les champs et permet de cocher les contributeurs autorisés du chantier. Le destinataire retrouve le rapport depuis sa notification ou la liste des rapports. Il peut le compléter, le transférer à nouveau ou le valider suivant les contrôles existants du formulaire.

Les précédents intervenants gardent un accès en consultation ; les administrateurs conservent leurs droits de modification tant que le rapport n’est pas validé. Un conflit entre deux saisies est signalé et la saisie locale est conservée. Une interruption de connexion ne doit pas conduire à créer un second rapport : réessayer la même opération utilise sa confirmation d’origine.

Pour mentionner une personne, utiliser **@ Mentionner** dans la fenêtre de rédaction et la choisir dans l’annuaire du chantier. La petite alerte peut être masquée ; elle reste accessible dans la cloche. Un appui ouvre directement le contenu concerné. Les notifications personnelles utilisent désormais la connexion Realtime existante de Supabase, avec un signal limité au compte concerné ; le contenu reste contrôlé par les droits de l’application. [Documentation Supabase](https://supabase.com/docs/guides/realtime/postgres-changes).

La réception en temps réel nécessite une application ouverte et connectée. La vérification périodique toutes les vingt secondes et l’actualisation au retour au premier plan restent disponibles en cas d’interruption. Les notifications du téléphone déjà configurées sont conservées. Aucun service d’envoi d’email n’est ajouté.

## Signer après le scan du QR code

1. Scanner le QR code du briefing en cours.
2. Renseigner nom, prénom, fonction et entreprise. Le nom et l’entreprise passent en majuscules.
3. Appuyer sur **Appuyer ici pour signer**. Signer dans la grande fenêtre ; utiliser **Effacer** si nécessaire.
4. Appuyer sur **Valider la signature** pour retrouver le tracé dans le formulaire. Cette action ne transmet pas encore la participation.
5. Vérifier le formulaire puis appuyer sur **Valider ma participation**. Attendre **Signature reçue**.

Fermer la fenêtre de signature conserve le tracé en cours. Il reste à le valider avant de transmettre le formulaire. Une signature déjà envoyée mais dont la confirmation a été perdue est renvoyée avec le même identifiant, y compris si la séance a été fermée entre-temps. Les signatures restent rattachées à leur séance ; le QR code précédent ne devient jamais celui du nouveau briefing.

Le bouton **Plein écran** utilise le mode fourni par le navigateur lorsqu’il est disponible. La PWA Briefing conserve son mode `standalone`, son identité et son périmètre. Une page web ne peut pas imposer la disparition permanente de la barre d’adresse du navigateur ; le bouton propose un affichage plein écran à la demande, sans modifier l’URL du QR code. [Plein écran : MDN](https://developer.mozilla.org/en-US/docs/Web/API/Element/requestFullscreen), [affichage PWA : MDN](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/display).

## Installation sur Termux

Télécharger **Journal-Chantier-V15.10.1.zip** dans Téléchargements, puis exécuter :

```sh
unzip -o "$HOME/storage/downloads/Journal-Chantier-V15.10.1.zip" -d "$HOME/Journal-Chantier-V15.10.1"
bash "$HOME/Journal-Chantier-V15.10.1/scripts/update-v15101-termux.sh"
```

L’installateur conserve la configuration Supabase et vérifie les fichiers de la version précédente. Il sauvegarde le code, publie d’abord le serveur, attend les tests GitHub Actions, puis publie l’interface. Les migrations V15.10 et V15.10.1 sont enregistrées séparément : une migration déjà installée n’est pas rejouée. Si une étape est interrompue, relancer la seconde commande.

Attendre la réussite de **GitHub Pages**, puis fermer et rouvrir Journal de chantier et Briefing sur les téléphones et tablettes. Il n’est pas nécessaire d’effacer les données du navigateur ou de désinstaller la PWA.

Le formulaire natif Rapport journalier AINM conserve son numéro V10.3 propre à cette application ; le numéro de cette livraison du Journal est V15.10.1.

## Portée des essais

Les tests portent sur les interfaces réelles dans Chromium aux dimensions téléphone, tablette et ordinateur, avec plusieurs comptes et une base PostgreSQL jetable via PGlite. Les échanges Supabase sont simulés uniquement pour l’authentification et le transport. Les déclarations de réplication, les droits et les transactions sont contrôlés en SQL. Le workflow répète les contrôles sur PostgreSQL 17 avant l’installation.

La réception sur le service Supabase en production et sur vos appareils Android réels reste à constater après installation. Aucune publication ni modification de données de production n’a été effectuée pendant la préparation du ZIP.
