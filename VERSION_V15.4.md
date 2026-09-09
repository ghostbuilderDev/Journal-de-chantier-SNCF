# Journal de chantier — V15.4

Livraison préparée sur le commit V15.3 `a5b06c6` du dépôt existant.

Correctif d’installation du 9 septembre 2026 : reprise également depuis le commit serveur `bdf9aa7`, où l’installation a été interrompue avant publication de l’interface. Le fichier SQL contient désormais l’enveloppe de transaction attendue par l’installateur. Ce contrôle est exécuté avant connexion et testé dans le workflow avec l’inscription au registre des migrations. Les fonctionnalités V15.4 ci-dessous restent identiques.

- Une seule carte verte pour une action terminée, à la date de clôture. Les messages d’origine, annonces, réponses et preuves restent dans son historique. L’épingle temporaire disparaît après trois minutes ; les autres informations permanentes gardent leur fonctionnement.
- Ajout rapide « Production » : une ligne par travail prévu, saisie partagée avec le CR de la même nuit. Chaque pourcentage est confirmé en fin de séance (0 % est valide). Travaux supplémentaires possibles. Les mises à jour modifient le même message et conservent les auteurs dans l’historique.
- Ajout rapide « Renseignements techniques ».
- Aperçu du véritable email HTML, identique à celui envoyé : rubriques, tableaux prévu/réel, production et sécurité.
- Liste des contacts proposés masquée pour la phase de test. Saisie manuelle du destinataire ; aucun destinataire repris automatiquement dans un nouveau CR de test. Les listes des anciens CR restent conservées.
- Bloc « Avant de valider et envoyer » avec les rubriques manquantes et des liens vers les champs à enregistrer.
- Ouverture du CR sans chargement du catalogue de programmation ; état de chargement immédiat et cartes cliquables.
- Bouton « Améliorer », proposition relue avant utilisation. Saisie des dates particulières ITC, consignation et ARF conservée.
- Confirmations de l’application et du briefing dans des fenêtres internes. Les demandes d’autorisation du téléphone restent gérées par le navigateur.
- Export dans un document séparé : pas de reconstruction du fil ; photos déjà chargées réutilisées et réduites à 1 000 pixels pour l’impression. Au bout de 15 secondes d’attente réseau, les photos manquantes sont signalées et peuvent être réessayées. Aucun original n’est modifié.

## Installation

Télécharger le nouveau fichier `Journal-Chantier-V15.4-corrige.zip` dans Téléchargements puis coller dans Termux :

```bash
[ -d "$HOME/storage/downloads" ] || termux-setup-storage
pkg install -y git gh python unzip &&
journal_v154_dir="$(mktemp -d "$HOME/journal-v154-XXXXXXXX")" &&
unzip -q "$HOME/storage/downloads/Journal-Chantier-V15.4-corrige.zip" -d "$journal_v154_dir" &&
bash "$journal_v154_dir/Journal-Chantier-V15.4/scripts/update-v154-termux.sh"
```

Le script sauvegarde le code, publie d’abord le correctif serveur, attend les tests GitHub Actions puis publie l’interface. Il reconnaît la V15.3 et les fichiers exacts de la première livraison V15.4. Toute autre modification provoque un arrêt explicite, sans écrasement. Une migration déjà enregistrée n’est pas rejouée. Après la coche verte de GitHub Pages, fermer puis rouvrir le Journal.

## Activer le premier envoi email

Cette livraison installe le service. Son activation réelle exige votre clé Resend et votre adresse de test ; ces éléments ne sont pas disponibles dans les fichiers joints. Aucun email de test n’a été envoyé pendant le développement.

1. Créer un compte sur [Resend](https://resend.com/signup) avec l’adresse qui recevra le CR de test.
2. Créer une [clé API](https://resend.com/api-keys) avec le droit `Sending access`.
3. Après la mise à jour, lancer :

```bash
bash "$HOME/Journal-de-chantier-SNCF/scripts/configure-v154-email-termux.sh"
```

La commande demande l’adresse de test et la clé en saisie masquée. Pour l’expéditeur, Entrée conserve `Journal de chantier <onboarding@resend.dev>`. Elle transfère les réglages au service serveur via les secrets GitHub puis lance uniquement le workflow `Configuration email V15.4`. Attendre sa coche verte.

Avec cet expéditeur de test, le destinataire doit être l’adresse du compte Resend : [règle officielle Resend](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain). Un expéditeur de votre domaine déjà vérifié est également accepté par la commande. Les secrets ne sont jamais inclus dans le code ni dans le stockage du navigateur.

Dans le CR, saisir manuellement votre seule adresse, enregistrer les accès et destinataires, valider, ouvrir l’aperçu et envoyer. Le serveur refuse toute autre adresse pendant cette phase de test. L’acceptation par le service email ne garantit pas l’arrivée dans la boîte principale : vérifier la réception effective et les courriers indésirables.

Le passage à plusieurs destinataires sera configuré dans la prochaine évolution, après votre vérification de la liste et de l’expéditeur.

## Production sur le terrain

Au début de la séance : Ajout rapide terrain → Production → date de début de nuit → intitulé de chaque travail → Enregistrer. Les pourcentages peuvent rester vides.

En fin de séance : ouvrir la production dans le fil ou dans le CR off, saisir les pourcentages et ajouter les travaux supplémentaires. Enregistrer. Le même contenu alimente le journal et le CR. Une fois le CR validé, il faut un rectificatif pour modifier cette production : la copie déjà envoyée reste figée.
