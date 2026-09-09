# Journal de chantier — V15.3

Cette mise à jour s’applique à la V15.2 installée sur le dépôt Journal-de-chantier-SNCF.

## Ce qui change

- **Actions terminées** : le message d’origine, l’annonce de création et le message de clôture deviennent verts et compacts. Un toucher ouvre les détails, les pièces jointes et la preuve. Une action rouverte retrouve son état en cours. L’historique ouvert reste ouvert lors d’une actualisation du fil.
- **Améliorer l’application** : accès direct depuis le menu, bouton de signalement toujours accessible en bas de la liste, conservation du brouillon et reprise sans doublon après une coupure. Les droits d’appel du service de signalement sont rétablis pour les comptes autorisés ; les règles d’auteur et d’administrateur sont conservées.
- **CR off** : accueil plus compact et fenêtres adaptées au téléphone. Une seule fenêtre regroupe le responsable, les références et les horaires. Choix **SEL / Secteur**, puis numéro ou nom libre. Pour les ITC, saisie de la **ZEP**. Chaque référence dispose d’un tableau : colonnes **Début / Fin**, lignes **Prévu / Réel**. L’ARF comporte un seul tableau pour l’ensemble des voies.
- **Saisie de nuit** : taper `23:15` ou `2315`. Le lendemain est indiqué automatiquement. Le petit bouton **Dates** sert uniquement aux cas particuliers. Les heures restent en heure de Paris ; une heure ambiguë au changement d’heure nécessite de préciser été ou hiver.
- **Briefing PDF** : ajout des photos avec leurs légendes sur des pages dédiées, image entière et proportions conservées. L’export attend la lecture des photos ; une image illisible provoque un message d’erreur au lieu d’un PDF incomplet.

## Utilisation du CR off

1. Ouvrir la nuit puis **Consignation**, **ITC** ou **ARF**.
2. Choisir le responsable de la rubrique, renseigner les références et les heures prévues.
3. Laisser cochée l’option de réutilisation pour les prochaines nuits de la même semaine si le programme est identique. Les heures réelles ne sont jamais recopiées.
4. Appuyer sur **Enregistrer et demander**. L’agent retrouve la demande dans **Mes demandes**, même si les notifications du téléphone ne sont pas activées. La notification système dépend toujours de l’autorisation du téléphone et de sa connexion.
5. L’agent complète les heures réelles et, si nécessaire, un commentaire de retard. **Non pris** nécessite un motif et des heures réelles vides.

Les références historiques restent conservées. Pour renommer ou retirer une référence qui possède déjà des horaires, préciser le motif proposé dans la fenêtre. Production, sécurité Top/Flop, Gemini, confidentialité, destinataires et rappels existants sont conservés.

## Installation dans Termux

Télécharger **Journal-Chantier-V15.3.zip** dans le dossier Téléchargements du téléphone. Ne pas renommer le fichier. Exécuter :

```bash
[ -d "$HOME/storage/downloads" ] || termux-setup-storage
pkg install -y git gh python unzip &&
journal_v153_dir="$(mktemp -d "$HOME/journal-v153-XXXXXXXX")" &&
unzip -q "$HOME/storage/downloads/Journal-Chantier-V15.3.zip" -d "$journal_v153_dir" &&
bash "$journal_v153_dir/Journal-Chantier-V15.3/scripts/update-v153-termux.sh"
```

Le script utilise les secrets GitHub Supabase déjà configurés. Il sauvegarde le code, installe la migration V15.3, attend la réussite des contrôles GitHub Actions, puis publie l’interface. Les réglages Supabase, email et Gemini ne sont pas remplacés. Il ne supprime aucune donnée de chantier, photo ou ancien CR.

Attendre la coche verte de GitHub Pages, puis fermer et rouvrir le journal sur chaque téléphone. L’en-tête du CR doit indiquer **V15.3**. Aucun envoi de CR n’est lancé par l’installation.

En cas d’interruption, relancer la même commande. Si le script indique qu’un fichier a été modifié depuis la version vérifiée, il conserve ces modifications : ne pas forcer le remplacement. La sauvegarde annoncée contient le code précédent, pas une sauvegarde de la base Supabase.

## Vérifications

Tests effectués avec une base SQL jetable et un navigateur mobile simulé en 390 et 320 pixels : demandes individuelles, droits, saisies, publication et réponse aux signalements, coupure réseau, actions terminées, conservation des CR et export PDF. Le PDF a été généré par le véritable module du briefing puis contrôlé visuellement. Aucun message, CR ou test n’a été envoyé à de vrais utilisateurs.

Les tests PostgreSQL 17 et les contrôles du projet Supabase seront exécutés par GitHub Actions lors de votre installation. Le fonctionnement sur les téléphones réels sera à contrôler après cette installation.
