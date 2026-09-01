# Journal Chantier Connecté — V14.1

Cette mise à jour simplifie la fiche chantier sans supprimer les informations
existantes de la base :

- suppression du catalogue Briefing et du code F dans la création de chantier ;
- champ **Nom du chantier** unique ;
- champs **Ligne** et **Voie** séparés ;
- conservation des PK, dates, phase, entreprises, photo de couverture et contexte ;
- phases : `Phase prépa`, `Phase réalisation`, `Phase finition` et `Réception du chantier` ;
- nouvelle présentation des commandes Terrain et Carnet PDF, avec des icônes plus légères ;
- couverture PDF mise à jour avec les nouveaux repères Ligne, Voie, PK et phase.

## Mise à jour depuis Termux

Télécharger le ZIP `Journal-Chantier-V14.1-Interface-Simplifiee.zip` dans le
dossier **Download**, puis exécuter la commande fournie avec cette version.

Après le `git push`, GitHub publie l’application et applique automatiquement
la migration `20260901000400_v14_1_fiche_chantier_simplifiee.sql`. Il n’est pas
nécessaire d’ouvrir l’éditeur SQL Supabase ni de relancer l’action manuellement.

Les droits, les photos, la bibliothèque documentaire et le portail
d’applications restent inchangés.
