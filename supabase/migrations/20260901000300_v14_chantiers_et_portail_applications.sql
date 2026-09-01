-- Journal Chantier Connecté — V14
-- Création de chantier enrichie, photo de couverture privée et portail
-- d'applications administrable par le propriétaire principal.
-- Prérequis : migrations V7 / V11 / V13.3 déjà présentes.

begin;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Fiche opérationnelle du chantier. Les colonnes sont toutes facultatives afin
-- de préserver les chantiers existants et de permettre une saisie progressive.
-- ---------------------------------------------------------------------------
alter table public.chantiers
  add column if not exists briefing_operation_code text,
  add column if not exists line_code text,
  add column if not exists pk_start text,
  add column if not exists pk_end text,
  add column if not exists project_manager text,
  add column if not exists operation_manager text,
  add column if not exists participating_companies jsonb not null default '[]'::jsonb,
  add column if not exists operation_phase text,
  add column if not exists planned_start date,
  add column if not exists planned_end date,
  add column if not exists cover_storage_path text,
  add column if not exists sharepoint_folder_path text;

alter table public.chantiers
  drop constraint if exists chantiers_planned_dates_check;
alter table public.chantiers
  add constraint chantiers_planned_dates_check
  check (planned_end is null or planned_start is null or planned_end >= planned_start);

alter table public.chantiers
  drop constraint if exists chantiers_cover_storage_path_check;
alter table public.chantiers
  add constraint chantiers_cover_storage_path_check
  check (
    cover_storage_path is null
    or cover_storage_path ~ ('^covers/' || id::text || '/[0-9a-fA-F-]{36}[.](jpg|jpeg|png|webp)$')
  );

comment on column public.chantiers.briefing_operation_code is 'Code F ou référence de l’opération issue du Briefing au pied de l’opération.';
comment on column public.chantiers.participating_companies is 'Entreprises majeures participant à l’opération.';
comment on column public.chantiers.cover_storage_path is 'Chemin privé de la photographie de couverture du carnet PDF.';

-- ---------------------------------------------------------------------------
-- Photo de couverture : bucket privé, distinct des photos de discussion et
-- des documents. Tous les membres consultent ; seuls les administrateurs du
-- chantier peuvent déposer, remplacer ou retirer une couverture.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('chantier-cover-images', 'chantier-cover-images', false, 8388608)
on conflict (id) do update set public = false, file_size_limit = 8388608;

create or replace function public.journal_cover_path_chantier_id(p_path text)
returns uuid
language plpgsql
immutable
strict
as $$
begin
  if p_path !~ '^covers/[0-9a-fA-F-]{36}/[0-9a-fA-F-]{36}[.](jpg|jpeg|png|webp)$' then
    return null;
  end if;
  return split_part(p_path, '/', 2)::uuid;
exception when invalid_text_representation then
  return null;
end;
$$;

grant select, insert, update, delete on storage.objects to authenticated;

drop policy if exists journal_cover_images_read on storage.objects;
create policy journal_cover_images_read
on storage.objects
for select to authenticated
using (
  bucket_id = 'chantier-cover-images'
  and public.journal_can_access_chantier(public.journal_cover_path_chantier_id(name))
);

drop policy if exists journal_cover_images_insert on storage.objects;
create policy journal_cover_images_insert
on storage.objects
for insert to authenticated
with check (
  bucket_id = 'chantier-cover-images'
  and public.journal_can_manage_chantier_documents(public.journal_cover_path_chantier_id(name))
);

drop policy if exists journal_cover_images_update on storage.objects;
create policy journal_cover_images_update
on storage.objects
for update to authenticated
using (
  bucket_id = 'chantier-cover-images'
  and public.journal_can_manage_chantier_documents(public.journal_cover_path_chantier_id(name))
)
with check (
  bucket_id = 'chantier-cover-images'
  and public.journal_can_manage_chantier_documents(public.journal_cover_path_chantier_id(name))
);

drop policy if exists journal_cover_images_delete on storage.objects;
create policy journal_cover_images_delete
on storage.objects
for delete to authenticated
using (
  bucket_id = 'chantier-cover-images'
  and public.journal_can_manage_chantier_documents(public.journal_cover_path_chantier_id(name))
);

-- ---------------------------------------------------------------------------
-- Portail "Mes applications". Une application est un lien HTTPS ouvert dans
-- une nouvelle page : aucune page externe n'est intégrée dans un iframe, afin
-- de ne jamais lui transmettre la session ni le contexte du journal.
-- ---------------------------------------------------------------------------
create table if not exists public.journal_portal_apps (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 100),
  url text not null check (url ~* '^https://'),
  description text,
  icon_key text not null default 'app' check (icon_key in ('app', 'briefing', 'report', 'tool', 'folder', 'safety')),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists journal_portal_apps_created_at_idx
  on public.journal_portal_apps (created_at desc);

alter table public.journal_portal_apps enable row level security;
revoke all on table public.journal_portal_apps from anon, authenticated;
grant select on table public.journal_portal_apps to authenticated;

drop policy if exists journal_portal_apps_read on public.journal_portal_apps;
create policy journal_portal_apps_read
on public.journal_portal_apps
for select to authenticated
using (auth.uid() is not null);

create or replace function public.journal_is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
    and exists (
      select 1
      from public.journal_administrators
      where user_id = auth.uid()
        and role = 'proprietaire'
    );
$$;

create or replace function public.create_journal_portal_app(
  p_name text,
  p_url text,
  p_description text default '',
  p_icon_key text default 'app'
)
returns public.journal_portal_apps
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app public.journal_portal_apps%rowtype;
begin
  if not public.journal_is_owner() then
    raise exception 'Seul le propriétaire principal peut ajouter une application.';
  end if;
  if p_name is null or char_length(btrim(p_name)) = 0 then
    raise exception 'Le nom de l’application est obligatoire.';
  end if;
  if p_url is null or btrim(p_url) !~* '^https://' then
    raise exception 'Le lien de l’application doit commencer par https://';
  end if;
  if coalesce(p_icon_key, 'app') not in ('app', 'briefing', 'report', 'tool', 'folder', 'safety') then
    raise exception 'Icône d’application invalide.';
  end if;
  insert into public.journal_portal_apps (name, url, description, icon_key, created_by)
  values (
    btrim(p_name), btrim(p_url), nullif(btrim(coalesce(p_description, '')), ''),
    coalesce(p_icon_key, 'app'), auth.uid()
  )
  returning * into v_app;
  return v_app;
end;
$$;

create or replace function public.update_journal_portal_app(
  p_id uuid,
  p_name text,
  p_url text,
  p_description text default '',
  p_icon_key text default 'app'
)
returns public.journal_portal_apps
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app public.journal_portal_apps%rowtype;
begin
  if not public.journal_is_owner() then
    raise exception 'Seul le propriétaire principal peut modifier une application.';
  end if;
  if p_name is null or char_length(btrim(p_name)) = 0 then
    raise exception 'Le nom de l’application est obligatoire.';
  end if;
  if p_url is null or btrim(p_url) !~* '^https://' then
    raise exception 'Le lien de l’application doit commencer par https://';
  end if;
  if coalesce(p_icon_key, 'app') not in ('app', 'briefing', 'report', 'tool', 'folder', 'safety') then
    raise exception 'Icône d’application invalide.';
  end if;
  update public.journal_portal_apps
     set name = btrim(p_name),
         url = btrim(p_url),
         description = nullif(btrim(coalesce(p_description, '')), ''),
         icon_key = coalesce(p_icon_key, 'app'),
         updated_at = now()
   where id = p_id
   returning * into v_app;
  if not found then
    raise exception 'Application introuvable.';
  end if;
  return v_app;
end;
$$;

create or replace function public.delete_journal_portal_app(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.journal_is_owner() then
    raise exception 'Seul le propriétaire principal peut retirer une application.';
  end if;
  delete from public.journal_portal_apps where id = p_id;
  if not found then
    raise exception 'Application introuvable.';
  end if;
end;
$$;

-- L'actualisation en direct du portail est pratique mais reste optionnelle :
-- l'application conserve un affichage normal si la publication est absente.
do $$
begin
  alter publication supabase_realtime add table public.journal_portal_apps;
exception when duplicate_object then null;
when undefined_object then null;
end;
$$;

revoke all on function public.journal_cover_path_chantier_id(text) from public;
revoke all on function public.journal_is_owner() from public;
revoke all on function public.create_journal_portal_app(text, text, text, text) from public;
revoke all on function public.update_journal_portal_app(uuid, text, text, text, text) from public;
revoke all on function public.delete_journal_portal_app(uuid) from public;

grant execute on function public.journal_cover_path_chantier_id(text) to authenticated;
grant execute on function public.journal_is_owner() to authenticated;
grant execute on function public.create_journal_portal_app(text, text, text, text) to authenticated;
grant execute on function public.update_journal_portal_app(uuid, text, text, text, text) to authenticated;
grant execute on function public.delete_journal_portal_app(uuid) to authenticated;

commit;
