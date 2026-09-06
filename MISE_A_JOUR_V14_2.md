# Journal Chantier Connecté — V14.2

Livraison du 6 septembre 2026, préparée depuis le transfert V14.1 fourni.

## Changements demandés

- Annuaire des personnes inscrites, avec leurs nom et prénom disponibles.
- Choix d'un pilote parmi les collaborateurs pour chaque action.
- Ouverture d'une action depuis le fil d'actualité et modification selon les droits de la personne connectée.
- Publication d'une photo sans obliger à saisir un commentaire.
- Administration de plusieurs chantiers par une même personne.
- Retrait effectif des droits et suppression d'un compte par l'administrateur principal.
- Onglets de navigation conservés à l'écran pendant le défilement.
- Ouverture de la discussion sur les messages les plus récents.
- Échéances plus souples, avec notamment une échéance immédiate.

## Installer depuis Termux

Télécharger **Journal-Chantier-V14.2-Connexion-Supabase.zip** dans le dossier **Download** du téléphone. Le dépôt Git habituel de l'application doit déjà être présent dans Termux et sa branche `main` ne doit pas avoir de modifications locales non enregistrées.

Copier la ligne fournie avec l'archive dans Termux. Elle installe les outils nécessaires, ouvre le ZIP puis lance `scripts/update-termux.sh`. À la première utilisation, Android peut demander l'accès au stockage et GitHub peut demander la connexion. Si le dépôt n'est pas trouvé, le script demande son chemin.

Les secrets GitHub Actions suivants doivent exister dans le dépôt, sous `Settings → Secrets and variables → Actions → Repository secrets` :

| Nom | Valeur / accès nécessaire |
|---|---|
| `SUPABASE_PROJECT_ID` | `eqfwdcttvnnrakyaacjm` |
| `SUPABASE_ACCESS_TOKEN` | Jeton personnel du compte Supabase autorisé à modifier la base et déployer les fonctions de ce projet ; ce n'est pas la clé publique de l'application. |
| `SUPABASE_DB_URL` | URI **Session pooler**, port 5432, créée par `scripts/configure-supabase-db.py`. Elle est déjà enregistrée pour la reprise montrée dans les captures. |

Le compte GitHub utilisé doit pouvoir pousser sur `main`, modifier les workflows et lire les noms de secrets du dépôt. GitHub Actions doit être activé, et la publication GitHub Pages habituelle doit suivre cette branche. Si GitHub refuse spécifiquement l'autorisation `workflow`, exécuter `gh auth refresh -h github.com -s workflow` puis relancer. Ne jamais coller ces secrets dans `config.js`, un commit, une commande publique ou une capture d'écran.

Le script :

1. Vérifie le dépôt, la configuration, la version des fichiers et les secrets disponibles.
2. Sauvegarde le code actuellement versionné et `config.js` dans un dossier `Journal-Chantier-sauvegarde-V14.2-…` du téléphone.
3. Publie le backend dans un premier commit. GitHub Actions vérifie d’abord les droits SQL dans un PostgreSQL 17 jetable et la fonction de suppression avec Node 24. La migration SQL et la fonction Supabase sont ensuite déployées si ces tests réussissent.
4. Attend le succès Supabase avant d'envoyer l'interface dans un second commit.
5. Affiche le lien GitHub Actions pour suivre la publication GitHub Pages habituelle.

`config.js`, les fichiers inconnus et les workflows sans lien avec Supabase sont conservés. Le script n'utilise ni push forcé, ni reset de base, ni suppression de fichier du dépôt. Si un fichier de l'application a changé depuis le transfert V14.1, il s'arrête pour que ces changements soient intégrés avant la mise à jour.

Après le succès de la publication GitHub Pages, fermer puis rouvrir l'application et ses anciens onglets pour charger la nouvelle version.

## Si la commande s'arrête

- **Modification locale** : sauvegarder ou enregistrer son travail dans Git avant de relancer.
- **Version de fichier différente** : envoyer une nouvelle archive du dépôt pour fusionner les améliorations avec son état actuel.
- **Secret absent** : l'ajouter dans GitHub, `Settings > Secrets and variables > Actions`, puis relancer.
- **Échec Supabase** : consulter le lien du workflow. L'interface nouvelle n'a pas encore été envoyée. Corriger le problème indiqué et relancer la même commande.
- **Push interrompu** : vérifier le commit local conservé, exécuter `git push origin main`, puis relancer la commande. Aucun push forcé n'est nécessaire.

## Portée des vérifications

Le code livré est contrôlé sur une copie isolée, sans déploiement sur votre production. La fixture SQL, la migration et les assertions ont réussi sous PostgreSQL 18.3 via PGlite 0.5.8. Le workflow les exécute de nouveau sous PostgreSQL 17 avant toute mutation de production. Les essais de l'installateur couvrent le transfert partiel et le dépôt complet de l'audit, la reprise après installation et le blocage de l'interface lorsque Supabase échoue.

L'archive d'origine ne contenait pas le schéma historique complet. Une première tentative a permis de confirmer en lecture seule que `journal_access_requests` utilise `requester_id` ; l'ancienne hypothèse `user_id` a été refusée avec rollback intégral. Le diagnostic complet de structure a ensuite confirmé que `chantier_message_content` accepte déjà le texte vide : cette règle est laissée intacte. La FK de l’auteur des invitations est aussi adaptée pour conserver ces invitations lors d’une suppression. La migration active `00300` reproduit ces contrats et contrôle encore les autres prérequis avant toute écriture. En cas d'incompatibilité, la transaction s'arrête au lieu de modifier une structure supposée. Conserver une sauvegarde récente des données Supabase et un export de son schéma avant l'installation ; la sauvegarde de code créée sur le téléphone ne les remplace pas.

Tester après publication avec un administrateur principal, un administrateur de deux chantiers et un compte collaborateur : choix du pilote, action ouverte depuis le fil, photo seule, retrait des droits et accès refusé après retrait. La suppression d'un compte est une action définitive ; utiliser un compte de test créé pour cette vérification.

La sauvegarde automatique est une sauvegarde du **code** : `commit-avant.txt`, `code-avant.tar` et `config.js`. Elle ne constitue pas une sauvegarde de la base ni des fichiers Supabase. En cas d'incident d'interface après publication, conserver ces fichiers pour préparer un retour du seul code. Ne pas rejouer d'anciennes migrations ou réinitialiser la base pour revenir à une interface antérieure.

## Commande à copier

Après téléchargement dans `Download` sous le nom exact `Journal-Chantier-V14.2-Connexion-Supabase.zip` :

```bash
pkg install -y git gh python unzip && { test -d "$HOME/storage/downloads" || termux-setup-storage; } && journal_tmp="$(mktemp -d)" && unzip -q "$HOME/storage/downloads/Journal-Chantier-V14.2-Connexion-Supabase.zip" -d "$journal_tmp" && bash "$journal_tmp/Journal-Chantier-V14.2/scripts/update-termux.sh"
```

Si Termux n'a jamais reçu l'autorisation d'accéder à Download, lancer une fois `termux-setup-storage`, accepter la demande Android, puis reprendre la commande.

## Rejouer les tests de l'installateur

Avec Python 3.11 ou plus récent et Git, depuis le dossier extrait de cette version :

```bash
python tests/release.test.py --original-zip /chemin/Supabase-Transfer-Journal-Chantier.zip --full-original-zip /chemin/Journal-de-chantier-SNCF-main.zip
```

Les deux chemins désignent les archives **V14.1 d'origine**, et non la livraison V14.2. Les tests créent un dépôt Git local temporaire, simulent GitHub Actions, contrôlent la conservation du code/configuration, le blocage en cas d'échec et la reprise. Aucun appel GitHub ni Supabase réel n'est effectué. Chaque option d'archive est facultative ; sans elle, les scénarios qui en dépendent sont signalés comme ignorés, les autres tests s'exécutent. Les archives de référence et aucune configuration privée ne sont embarquées dans les tests.

## Correctif de reconnaissance du dépôt

Le contrôle du dépôt accepte les différences de majuscules et minuscules dans son adresse GitHub, notamment `ghostbuilderDev`. Cette correction s’applique à la recherche automatique du dossier et au contrôle avant publication.

## Connexion PostgreSQL pour la mise à jour

L’exécution GitHub a rencontré un refus HTTP 403 / Cloudflare 1010 dans l’ancien envoi via la Management API. Le nouveau mode utilise la connexion PostgreSQL officielle et doit être configuré explicitement avec le secret GitHub `SUPABASE_DB_URL`. Aucun changement de signature HTTP ni nouvel essai automatique après ce refus n’est effectué.

Si l’étape GitHub « Vérifier la connexion PostgreSQL en lecture seule » a déjà réussi, le secret est en place : ne pas ressaisir le mot de passe et relancer directement l’installateur avec la nouvelle archive.

1. Dans le projet Supabase, ouvrir **Connect**, puis **Session pooler**, port **5432**. Relever le champ **Host**.
2. Depuis l’archive nouvellement extraite, lancer `python scripts/configure-supabase-db.py` dans Termux. Le configurateur demande l’hôte, puis le mot de passe PostgreSQL avec saisie invisible. Il encode les caractères spéciaux et enregistre la connexion dans GitHub par l’entrée standard de `gh secret set`. Ne pas coller le mot de passe dans une conversation ou une commande.
3. Lancer l’installateur `scripts/update-termux.sh` selon la commande ci-dessus. Le workflow vérifie la connexion avec `SELECT 1`, puis utilise les mêmes transactions, liste de migrations et registre. Les anciennes versions V14.2 fournies sont reconnues par leurs empreintes exactes pour reprendre après un échec.

Le token `SUPABASE_ACCESS_TOKEN` et le projet `SUPABASE_PROJECT_ID` restent nécessaires au déploiement de la fonction Edge. La connexion PostgreSQL ne garantit pas le succès de cet autre déploiement : la nouvelle interface attend toujours la réussite complète du workflow.

Le configurateur ne réinitialise pas le mot de passe PostgreSQL. Utiliser le mot de passe existant ; si celui-ci est inconnu, examiner les connexions existantes avant toute réinitialisation.

Référence : [connexions officielles Supabase](https://supabase.com/docs/guides/database/connecting-to-postgres).
