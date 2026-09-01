# Migrations Supabase

Ce dossier contient les changements de base de donnees du Journal Chantier.

## Regle de travail

- Chaque changement SQL est ajoute dans `migrations/` avec un nouveau nom commencant par une date UTC : `AAAAMMJJHHMMSS_description.sql`.
- Une migration deja publiee ne doit jamais etre modifiee ni renommee.
- L'action GitHub `Deployer les migrations Supabase` applique automatiquement les nouvelles migrations uniquement apres leur publication sur `main`.
- L'action utilise `supabase db push` : Supabase conserve l'historique des migrations deja appliquees et ne les rejoue pas.

## Secrets GitHub requis

Dans `Settings` -> `Secrets and variables` -> `Actions`, creer les secrets suivants :

- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_DB_PASSWORD`
- `SUPABASE_PROJECT_ID`

Ne jamais placer une cle, un token ou un mot de passe dans ce dossier, dans `config.js`, ou dans un fichier versionne.

## Verification

Dans GitHub, ouvrir l'onglet `Actions`, puis le workflow `Deployer les migrations Supabase`.
Le premier deploiement doit appliquer `20260901000100_documentation_securisee.sql` une seule fois.
