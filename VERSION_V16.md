# V16 — fil local instantané

Base : V15.10.6 stable.

- Le dernier fil consulté est conservé dans IndexedDB, par utilisateur et par chantier.
- Les photos récemment affichées sont gardées localement et réutilisées à la réouverture.
- La synchronisation Supabase continue ensuite en arrière-plan et remplace le cache par l'état serveur.
- Deux originaux maximum sont envoyés simultanément pour accélérer les albums sans saturer le téléphone.
- Les originaux restent strictement inchangés pour le zoom et le PDF.
- Aucun changement SQL ou Supabase n'est requis.
