-- Journal Chantier Connecté — V14.1
-- La fiche chantier reste volontairement légère : Ligne et Voie sont deux
-- repères distincts. Les anciennes colonnes sont conservées afin de ne pas
-- perdre les informations déjà saisies dans les chantiers existants.

begin;

alter table public.chantiers
  add column if not exists track text;

comment on column public.chantiers.track is 'Voie associée au chantier, distincte de la ligne.';

commit;
