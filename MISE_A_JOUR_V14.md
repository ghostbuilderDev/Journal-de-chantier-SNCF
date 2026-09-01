# Journal Chantier Connecté — V14

Cette mise à jour ajoute :

- la fiche chantier enrichie avec le catalogue des opérations F du Briefing ;
- les entreprises majeures sélectionnables, avec ajout libre ;
- les responsables, dates, phase, ligne et PK ;
- une photo de couverture privée pour le carnet PDF ;
- l’espace **Mes applications**, administrable par le propriétaire principal ;
- la migration Supabase automatique correspondante.

## Mise à jour depuis Termux

Télécharger le ZIP V14 dans le dossier **Download**, puis exécuter une seule fois la commande fournie avec cette version.

Le `git push` déclenche automatiquement :

1. la publication GitHub Pages ;
2. l’action **Deployer les migrations Supabase** ;
3. l’installation de la migration `20260901000300_v14_chantiers_et_portail_applications.sql`.

Il n’est pas nécessaire de relancer manuellement l’action GitHub. Attendre simplement que les deux coches deviennent vertes dans l’onglet **Actions**.

## Portail d’applications

Dans **Mes applications**, le propriétaire principal peut ajouter un lien `https://` vers une application déjà publiée, notamment le Briefing au pied de l’opération, le Rapport journalier ou une autre PWA. Les applications sont ouvertes dans une nouvelle page, sans transmettre la session du Journal chantier.

## Stockage de la couverture

La photo de couverture est stockée dans le bucket Supabase privé `chantier-cover-images`. Elle reste consultable uniquement par les membres autorisés du chantier ; seuls les administrateurs peuvent la modifier.
