# Briefing intégré au journal de chantier

Base : Journal V14.5 (retours application) et application briefing fournie le 7 septembre 2026. Le rapport journalier AINM est une autre application : cette intégration porte sur le journal partagé qui héberge les fils et les documents des chantiers.

## Utilisation après installation

1. Se connecter au journal et sélectionner le chantier, par exemple Montreux.
2. Dans les applications, ouvrir « Briefing au pied de l’opération ». Il est désormais fourni avec le journal ; aucun lien supplémentaire n’est nécessaire. Les cartes portant l’icône Briefing ouvrent cette version intégrée.
3. Compléter et faire signer le briefing. Son chantier est fixé à celui du journal.
4. Utiliser le bouton d’enregistrement habituel : le PDF signé est enregistré dans le fil du chantier et dans **Plans & documents → Sécurité → Briefings**. Un bouton dans le fil ouvre le même document privé.
5. L’envoi SharePoint habituel est ensuite lancé. La passerelle existante ne fournit pas de confirmation à ce stade : le lancement de l’envoi ne prouve pas son archivage SharePoint.

Une erreur d’enregistrement dans le journal conserve les signatures. Garder la page ouverte et réessayer : le même PDF et le même identifiant sont repris, même si la réponse du serveur s’est perdue. Après un échec, la reprise transmet le PDF déjà généré ; ne pas modifier le briefing entre ces tentatives. Une fermeture/recharge interrompt cette reprise en mémoire. Le PDF déjà archivé reste dans les archives même si son message est supprimé du fil.

Les membres autorisés à écrire peuvent déposer un briefing. Les lecteurs ne peuvent pas publier. Aucun accès administrateur supplémentaire n’est donné aux membres. Le PDF reste privé, avec les droits du chantier.

## Installation dans le dépôt existant

Cette archive n’a pas été publiée. Ne pas remplacer aveuglément le dépôt en production par tout son contenu.

Extraire le ZIP, puis lancer depuis le dossier extrait :

```sh
python scripts/install-briefing.py "$HOME/Journal-de-chantier-SNCF"
```

Adapter le chemin à celui du dépôt sur le téléphone. Le script vérifie que les fichiers concernés correspondent à la base V14.5 ou à cette mise à jour. Il refuse de remplacer une version différente et n’effectue ni commit ni push. Il prépare seulement les fichiers nécessaires et affiche les commandes suivantes.

Après vérification, commit et push sur main, attendre le succès de l’action **Installer les archives briefing** et du déploiement GitHub Pages. L’action utilise les secrets GitHub du journal déjà prévus : SUPABASE_PROJECT_ID et SUPABASE_DB_URL. Elle exécute les tests, applique uniquement la nouvelle migration et vérifie les droits. Elle ne relance pas les anciennes migrations. L’URL publique habituelle du journal reste celle à utiliser.

Si l’action n’est pas utilisée, un administrateur peut appliquer uniquement `supabase/migrations/20260907000600_briefing_archive.sql` dans SQL Editor du projet Supabase du journal avant de publier les fichiers web.

## Validation et limites

Tests PostgreSQL en mémoire : migration rejouable, refus hors chantier, refus lecteur et compte non autorisé, réception du fichier obligatoire, reprise sans doublon, annulation complète si la publication dans le fil échoue.

Le stockage du fichier précède la transaction SQL. Un échec peut laisser un PDF privé sans métadonnées ; il est réutilisé à la reprise. Aucune suppression automatique n’est tentée après une réponse SQL incertaine pour ne pas effacer une archive déjà validée.

Tests JavaScript avec transport simulé : chantier figé, origine des messages, changement de compte, erreur sans purge, reprise du même PDF et envoi SharePoint après succès. Contrôle de syntaxe de tous les scripts intégrés. Le contrôle visuel mobile n’a pas pu être exécuté (navigateur de test indisponible).

La connexion réelle à Supabase, la réception finale SharePoint et le déploiement GitHub doivent être vérifiés après installation avec un briefing d’essai signé. Aucun briefing réel n’a été publié pendant les tests.
