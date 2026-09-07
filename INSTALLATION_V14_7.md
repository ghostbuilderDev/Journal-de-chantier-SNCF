# Journal V14.7 + Rapport AINM V10.2

Utiliser ce pack à la place du ZIP Rapport V10.1. Il contient les deux applications complètes, dans deux dossiers distincts, et un installateur qui contrôle les versions avant de modifier les dépôts.

## Base conservée
Le journal reprend Journal-Chantier-V14.6-Briefing-Archives.zip (révision 1), puis les correctifs Correctif-Ouverture-Briefing.zip et Correctif-Archives-Supabase.zip. Leurs fichiers ont été comparés par empreinte SHA-256. Les fichiers du briefing, sa liaison, les retours d'amélioration et le mode chantier sont conservés. Le cache du journal est renouvelé pour charger le correctif PDF.

Cette vérification porte sur les dernières livraisons retrouvées, pas sur une lecture du dépôt GitHub actuellement publié. L'installateur vérifie donc le dépôt réel avant toute écriture : un fichier concerné différent ou plus récent provoque un refus explicite, sans remplacement partiel. Ne pas décompresser le pack directement à la racine d'un dépôt.

## Changements
- Le portail propose Rapport journalier et transmet l'identifiant du chantier actif à la PWA AINM. Le briefing conserve son ouverture intégrée actuelle.
- Rapport AINM : PDF sur SharePoint et dans Documents → Rapports journaliers du chantier, sans entrée dans le fil. Conservation locale et reprise du PDF identique après échec partiel. Nouveau rapport seulement après les deux confirmations.
- Briefing : comportement conservé, PDF dans le fil et Sécurité → Briefings, avec envoi SharePoint existant.
- Le bouton bleu Ouvrir des PDF est désormais un bouton du journal, ouvrant le lecteur de l'appareil. Il remplace l'aperçu PDF embarqué qui affichait le bouton inactif sur Android. Le bouton inférieur utilise la même ouverture. Les deux renouvellent le lien privé et empêchent l'ouverture après un changement de compte. Les aperçus image et texte sont conservés.
- La migration AINM porte désormais le numéro **20260907000700**. Le numéro **20260907000500** était déjà utilisé par les retours d'amélioration V14.5. Aucune migration historique n'est remplacée. Les droits AINM utilisent la fonction actuelle du journal, y compris le blocage des comptes révoqués.

## Installation Termux
Télécharger `Journal-V14.7-Rapport-V10.2-Mise-a-jour.zip` dans Téléchargements.

```bash
mkdir -p "$HOME/mise-a-jour-journal-v14.7"
unzip -o "$HOME/storage/downloads/Journal-V14.7-Rapport-V10.2-Mise-a-jour.zip" -d "$HOME/mise-a-jour-journal-v14.7"
cd "$HOME/mise-a-jour-journal-v14.7"
python installer.py --journal "$HOME/Journal-de-chantier-SNCF" --rapport "$HOME/projets/rapport-journalier-ainm-pwa" --verifier
```

Si l'un des chemins n'existe pas, retrouver le dossier réel avant de poursuivre. Le script vérifie aussi que chaque dépôt pointe vers la bonne application GitHub. Python, Git et unzip doivent être présents dans Termux.

Lorsque la vérification est réussie :

```bash
python installer.py --journal "$HOME/Journal-de-chantier-SNCF" --rapport "$HOME/projets/rapport-journalier-ainm-pwa"
```

Les deux dépôts sont contrôlés avant le premier remplacement. Le script conserve une sauvegarde des seuls fichiers modifiés, ne supprime pas les autres fichiers et restaure les originaux si une copie échoue. Les dépôts doivent être propres ; enregistrer les modifications locales avant d'installer. Ne pas utiliser une commande de nettoyage ou de retour forcé pour contourner un refus.

Publier le journal :

```bash
(
set -e
cd "$HOME/Journal-de-chantier-SNCF"
git diff --stat
git add -A
git commit -m "V14.7 : rapport journalier et ouverture PDF, correctifs briefing conservés"
git push
)
```

Dans GitHub Actions, attendre la réussite de **Installer les archives des rapports journaliers**. Le workflow utilise les secrets existants SUPABASE_PROJECT_ID et SUPABASE_DB_URL et le transport PostgreSQL corrigé du briefing. Il n'installe que la nouvelle migration AINM, dans une transaction enregistrée. Le workflow briefing et son correctif sont conservés ; si GitHub lance aussi Installer les archives briefing, attendre sa réussite.

Puis publier le rapport :

```bash
(
set -e
cd "$HOME/projets/rapport-journalier-ainm-pwa"
git diff --stat
git add -A
git commit -m "V10.2 : compatibilité avec le journal V14.7 et ses droits actuels"
git push
)
```

Il est possible d'installer un dépôt à la fois en ne passant que --journal ou --rapport. Ne pas publier le rapport avant la réussite de la migration correspondante.

Après GitHub Pages, fermer et rouvrir les deux PWA avec Internet. Ne pas effacer les données Chrome : elles contiennent les brouillons et les PDF en attente. Vérifier V10.2 dans AINM ; le journal conserve son interface sans numéro de version visible.

## Première vérification sur téléphone
1. Ouvrir un briefing depuis le journal : vérifier qu'il s'ouvre toujours et que son PDF va dans le fil, ses archives et SharePoint.
2. Dans Documents, cliquer sur le bouton bleu Ouvrir d'un PDF puis essayer le bouton inférieur.
3. Depuis le chantier souhaité, ouvrir Rapport journalier dans Applications. Vérifier le chantier affiché et envoyer un petit PDF de test.
4. Vérifier les copies SharePoint et Documents → Rapports journaliers, ainsi que l'absence d'une publication AINM dans le fil.
5. Si un envoi reste en attente, utiliser Reprendre l'archivage. Le PDF initial est conservé, même si le formulaire a changé.

Les deux PWA doivent utiliser le même profil Chrome sur les URL GitHub Pages fournies pour partager la connexion du journal. Après une connexion dans le journal, revenir au rapport et utiliser Actualiser la connexion si nécessaire. Un autre domaine nécessiterait un parcours d'authentification adapté.

Une confirmation SharePoint inconnue ne déclenche pas de renvoi automatique : l'application conserve le PDF et relit l'état fourni par la passerelle. Si cet état ne revient jamais, faire vérifier la passerelle ; son code serveur n'est pas fourni ici. Le PDF conservé reste téléchargeable.

## Vérifications réalisées
- PostgreSQL en mémoire (PGlite), avec les migrations et le schéma de test du journal : coexistence briefing/rapport, conservation historique, fil inchangé pour AINM, dossier unique, finalisation idempotente, PDF incomplet refusé, accès interchantier et autres comptes refusés, lecteur/non-membre/compte révoqué refusés, migration rejouable.
- Tests du briefing et de ses correctifs de déploiement conservés et réussis.
- Tests JavaScript : ouverture bleue et inférieure, lien signé renouvelé, fenêtre créée dans le clic, compte changé/erreur traités, contexte AINM et ouverture briefing conservée.
- Tests simulés AINM : échecs et reprises après rechargement, PDF initial conservé, absence de renvoi SharePoint confirmé ou incertain, onglets et verrou administrateur.
- Installateur : bases V14.6 reconnues avec ou sans les deux correctifs, installation répétée sans réécriture, version inconnue ou dépôt sale refusé avant modification, fichiers supplémentaires préservés.

Les tests PostgreSQL utilisent une base jetable et des données fictives : aucune connexion à Supabase en production. Aucun commit, push ni déploiement réalisé dans cette discussion. L'ouverture Android et les envois réels restent à qualifier après installation.
