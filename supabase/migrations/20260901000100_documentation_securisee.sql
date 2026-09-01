-- Journal Chantier Connecté — V13.3 Documentation sécurisée
-- À exécuter UNE SEULE FOIS dans Supabase → SQL Editor.
-- Prérequis : schéma rôles V7 / administration V11 déjà en place.
-- Cette migration crée une bibliothèque indépendante des pièces jointes du fil :
-- Sécurité, Plans et Documents qualité, avec sous-dossiers illimités.

begin;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Droits métiers réutilisés par la bibliothèque et par le stockage privé.
-- ---------------------------------------------------------------------------
create or replace function public.journal_can_access_chantier(p_chantier_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and (
    exists (
      select 1
      from public.journal_administrators administrator
      where administrator.user_id = auth.uid()
        and administrator.role in ('proprietaire', 'administrateur_general')
    )
    or exists (
      select 1
      from public.chantier_members member
      where member.chantier_id = p_chantier_id
        and member.user_id = auth.uid()
    )
  );
$$;

create or replace function public.journal_can_manage_chantier_documents(p_chantier_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and (
    exists (
      select 1
      from public.journal_administrators administrator
      where administrator.user_id = auth.uid()
        and administrator.role in ('proprietaire', 'administrateur_general')
    )
    or exists (
      select 1
      from public.chantier_members member
      where member.chantier_id = p_chantier_id
        and member.user_id = auth.uid()
        and member.role = 'administrateur'
    )
  );
$$;

create or replace function public.can_manage_chantier_documents(p_chantier_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.journal_can_manage_chantier_documents(p_chantier_id);
$$;

-- ---------------------------------------------------------------------------
-- Arborescence documentaire et métadonnées des fichiers.
-- Les utilisateurs authentifiés ont uniquement SELECT. Toutes les écritures
-- passent par les fonctions contrôlées ci-dessous.
-- ---------------------------------------------------------------------------
create table if not exists public.chantier_document_folders (
  id uuid primary key default gen_random_uuid(),
  chantier_id uuid not null references public.chantiers(id) on delete cascade,
  parent_id uuid references public.chantier_document_folders(id) on delete restrict,
  root_code text not null check (root_code in ('securite', 'plans', 'qualite')),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  is_root boolean not null default false,
  created_by uuid,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((is_root and parent_id is null) or (not is_root and parent_id is not null))
);

create table if not exists public.chantier_documents (
  id uuid primary key,
  chantier_id uuid not null references public.chantiers(id) on delete cascade,
  folder_id uuid not null references public.chantier_document_folders(id) on delete restrict,
  storage_path text not null unique,
  file_name text not null check (char_length(btrim(file_name)) between 1 and 180),
  mime_type text not null default 'application/octet-stream',
  bytes bigint not null default 0 check (bytes >= 0 and bytes <= 52428800),
  description text,
  version_label text,
  created_by uuid not null,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists chantier_document_folders_chantier_parent_idx
  on public.chantier_document_folders (chantier_id, parent_id, name);
create unique index if not exists chantier_document_folders_root_unique
  on public.chantier_document_folders (chantier_id, root_code)
  where is_root;
create index if not exists chantier_documents_chantier_folder_idx
  on public.chantier_documents (chantier_id, folder_id, created_at desc);

create or replace function public.validate_chantier_document_folder()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parent public.chantier_document_folders%rowtype;
begin
  if new.is_root then
    if new.parent_id is not null then
      raise exception 'Un dossier racine ne peut pas avoir de parent.';
    end if;
  else
    if new.parent_id is null then
      raise exception 'Un sous-dossier doit avoir un parent.';
    end if;
    select * into v_parent from public.chantier_document_folders where id = new.parent_id;
    if not found then
      raise exception 'Dossier parent introuvable.';
    end if;
    if v_parent.chantier_id <> new.chantier_id then
      raise exception 'Le dossier parent appartient à un autre chantier.';
    end if;
    new.root_code := v_parent.root_code;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists validate_chantier_document_folder_before_write on public.chantier_document_folders;
create trigger validate_chantier_document_folder_before_write
before insert or update on public.chantier_document_folders
for each row execute function public.validate_chantier_document_folder();

create or replace function public.validate_chantier_document()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_folder public.chantier_document_folders%rowtype;
begin
  select * into v_folder from public.chantier_document_folders where id = new.folder_id;
  if not found then
    raise exception 'Dossier de destination introuvable.';
  end if;
  if v_folder.chantier_id <> new.chantier_id then
    raise exception 'Le dossier de destination appartient à un autre chantier.';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists validate_chantier_document_before_write on public.chantier_documents;
create trigger validate_chantier_document_before_write
before insert or update on public.chantier_documents
for each row execute function public.validate_chantier_document();

-- Chaque chantier, existant ou créé à l'avenir, reçoit ses trois dossiers
-- racine. Ils restent protégés ; seuls leurs sous-dossiers sont modifiables.
create or replace function public.seed_chantier_document_roots(p_chantier_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_chantier_id is null then
    return;
  end if;
  insert into public.chantier_document_folders (chantier_id, parent_id, root_code, name, is_root)
  values
    (p_chantier_id, null, 'securite', 'Sécurité', true),
    (p_chantier_id, null, 'plans', 'Plans', true),
    (p_chantier_id, null, 'qualite', 'Documents qualité', true)
  on conflict do nothing;
end;
$$;

create or replace function public.seed_chantier_document_roots_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.seed_chantier_document_roots(new.id);
  return new;
end;
$$;

drop trigger if exists seed_chantier_document_roots_after_insert on public.chantiers;
create trigger seed_chantier_document_roots_after_insert
after insert on public.chantiers
for each row execute function public.seed_chantier_document_roots_after_insert();

select public.seed_chantier_document_roots(id) from public.chantiers;

-- ---------------------------------------------------------------------------
-- RLS : tous les membres du chantier peuvent lister et consulter les fichiers.
-- Les opérations de gestion sont volontairement impossibles en accès direct.
-- ---------------------------------------------------------------------------
alter table public.chantier_document_folders enable row level security;
alter table public.chantier_documents enable row level security;

revoke all on table public.chantier_document_folders from anon, authenticated;
revoke all on table public.chantier_documents from anon, authenticated;
grant select on table public.chantier_document_folders to authenticated;
grant select on table public.chantier_documents to authenticated;

drop policy if exists journal_document_folders_read on public.chantier_document_folders;
create policy journal_document_folders_read
on public.chantier_document_folders
for select to authenticated
using (public.journal_can_access_chantier(chantier_id));

drop policy if exists journal_documents_read on public.chantier_documents;
create policy journal_documents_read
on public.chantier_documents
for select to authenticated
using (public.journal_can_access_chantier(chantier_id));

-- ---------------------------------------------------------------------------
-- Fonctions d'administration documentaire. Elles complètent RLS afin qu'un
-- membre ne puisse pas contourner l'interface en appelant l'API directement.
-- ---------------------------------------------------------------------------
create or replace function public.create_chantier_document_folder(
  p_chantier_id uuid,
  p_parent_id uuid,
  p_name text
)
returns public.chantier_document_folders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parent public.chantier_document_folders%rowtype;
  v_folder public.chantier_document_folders%rowtype;
begin
  if not public.journal_can_manage_chantier_documents(p_chantier_id) then
    raise exception 'Seuls les administrateurs peuvent créer un sous-dossier.';
  end if;
  if p_parent_id is null or p_name is null or char_length(btrim(p_name)) = 0 then
    raise exception 'Le dossier parent et son nom sont obligatoires.';
  end if;
  select * into v_parent from public.chantier_document_folders where id = p_parent_id;
  if not found or v_parent.chantier_id <> p_chantier_id then
    raise exception 'Dossier parent invalide.';
  end if;
  insert into public.chantier_document_folders (
    chantier_id, parent_id, root_code, name, is_root, created_by, created_by_name
  ) values (
    p_chantier_id, p_parent_id, v_parent.root_code, btrim(p_name), false, auth.uid(),
    coalesce((select nullif(btrim(full_name), '') from public.profiles where id = auth.uid()), 'Administrateur')
  ) returning * into v_folder;
  return v_folder;
end;
$$;

create or replace function public.rename_chantier_document_folder(
  p_folder_id uuid,
  p_name text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_folder public.chantier_document_folders%rowtype;
begin
  select * into v_folder from public.chantier_document_folders where id = p_folder_id;
  if not found then
    raise exception 'Dossier introuvable.';
  end if;
  if not public.journal_can_manage_chantier_documents(v_folder.chantier_id) then
    raise exception 'Seuls les administrateurs peuvent modifier un dossier.';
  end if;
  if v_folder.is_root then
    raise exception 'Les dossiers racine sont protégés.';
  end if;
  if p_name is null or char_length(btrim(p_name)) = 0 then
    raise exception 'Le nom du dossier est obligatoire.';
  end if;
  update public.chantier_document_folders
    set name = btrim(p_name), updated_at = now()
    where id = p_folder_id;
end;
$$;

create or replace function public.delete_chantier_document_folder(p_folder_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_folder public.chantier_document_folders%rowtype;
begin
  select * into v_folder from public.chantier_document_folders where id = p_folder_id;
  if not found then
    raise exception 'Dossier introuvable.';
  end if;
  if not public.journal_can_manage_chantier_documents(v_folder.chantier_id) then
    raise exception 'Seuls les administrateurs peuvent supprimer un dossier.';
  end if;
  if v_folder.is_root then
    raise exception 'Les dossiers racine sont protégés.';
  end if;
  if exists (select 1 from public.chantier_document_folders where parent_id = p_folder_id) then
    raise exception 'Le sous-dossier contient encore des sous-dossiers.';
  end if;
  if exists (select 1 from public.chantier_documents where folder_id = p_folder_id) then
    raise exception 'Le sous-dossier contient encore des documents.';
  end if;
  delete from public.chantier_document_folders where id = p_folder_id;
end;
$$;

create or replace function public.create_chantier_document_metadata(
  p_document_id uuid,
  p_chantier_id uuid,
  p_folder_id uuid,
  p_storage_path text,
  p_file_name text,
  p_mime_type text,
  p_bytes bigint,
  p_description text default '',
  p_version_label text default ''
)
returns public.chantier_documents
language plpgsql
security definer
set search_path = public
as $$
declare
  v_folder public.chantier_document_folders%rowtype;
  v_document public.chantier_documents%rowtype;
  v_author_name text;
begin
  if not public.journal_can_manage_chantier_documents(p_chantier_id) then
    raise exception 'Seuls les administrateurs peuvent intégrer un document.';
  end if;
  if p_document_id is null or p_folder_id is null or p_storage_path is null then
    raise exception 'Informations documentaires incomplètes.';
  end if;
  if p_file_name is null or char_length(btrim(p_file_name)) = 0 then
    raise exception 'Le nom du document est obligatoire.';
  end if;
  if coalesce(p_bytes, 0) < 0 or coalesce(p_bytes, 0) > 52428800 then
    raise exception 'La taille du document est invalide ou dépasse 50 Mo.';
  end if;
  if p_storage_path !~ ('^documents/' || p_chantier_id::text || '/' || p_document_id::text || '/[^/]+$') then
    raise exception 'Chemin de stockage documentaire invalide.';
  end if;
  select * into v_folder from public.chantier_document_folders where id = p_folder_id;
  if not found or v_folder.chantier_id <> p_chantier_id then
    raise exception 'Dossier de destination invalide.';
  end if;
  if not exists (
    select 1 from storage.objects
    where bucket_id = 'chantier-documents' and name = p_storage_path
  ) then
    raise exception 'Le fichier n’a pas été reçu dans le stockage sécurisé.';
  end if;
  select coalesce(nullif(btrim(full_name), ''), email, 'Administrateur')
    into v_author_name
    from public.profiles
    where id = auth.uid();
  insert into public.chantier_documents (
    id, chantier_id, folder_id, storage_path, file_name, mime_type, bytes,
    description, version_label, created_by, created_by_name
  ) values (
    p_document_id, p_chantier_id, p_folder_id, p_storage_path, btrim(p_file_name),
    coalesce(nullif(btrim(p_mime_type), ''), 'application/octet-stream'), coalesce(p_bytes, 0),
    nullif(btrim(coalesce(p_description, '')), ''), nullif(btrim(coalesce(p_version_label, '')), ''),
    auth.uid(), coalesce(v_author_name, 'Administrateur')
  ) returning * into v_document;
  return v_document;
end;
$$;

create or replace function public.update_chantier_document_metadata(
  p_document_id uuid,
  p_file_name text,
  p_description text default '',
  p_version_label text default ''
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_document public.chantier_documents%rowtype;
begin
  select * into v_document from public.chantier_documents where id = p_document_id;
  if not found then
    raise exception 'Document introuvable.';
  end if;
  if not public.journal_can_manage_chantier_documents(v_document.chantier_id) then
    raise exception 'Seuls les administrateurs peuvent modifier un document.';
  end if;
  if p_file_name is null or char_length(btrim(p_file_name)) = 0 then
    raise exception 'Le nom du document est obligatoire.';
  end if;
  update public.chantier_documents
    set file_name = btrim(p_file_name),
        description = nullif(btrim(coalesce(p_description, '')), ''),
        version_label = nullif(btrim(coalesce(p_version_label, '')), ''),
        updated_at = now()
    where id = p_document_id;
end;
$$;

create or replace function public.delete_chantier_document(p_document_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_document public.chantier_documents%rowtype;
begin
  select * into v_document from public.chantier_documents where id = p_document_id;
  if not found then
    raise exception 'Document introuvable.';
  end if;
  if not public.journal_can_manage_chantier_documents(v_document.chantier_id) then
    raise exception 'Seuls les administrateurs peuvent supprimer un document.';
  end if;
  delete from public.chantier_documents where id = p_document_id;
  return v_document.storage_path;
end;
$$;

-- ---------------------------------------------------------------------------
-- Bucket distinct, privé, et règles Storage alignées sur les mêmes droits.
-- Une URL de consultation est temporaire et n'est jamais affichée dans l'UI
-- aux personnes non administratrices.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('chantier-documents', 'chantier-documents', false, 52428800)
on conflict (id) do update set public = false;

create or replace function public.journal_document_path_chantier_id(p_path text)
returns uuid
language plpgsql
immutable
strict
as $$
begin
  if p_path !~ '^documents/[0-9a-fA-F-]{36}/[0-9a-fA-F-]{36}/[^/]+$' then
    return null;
  end if;
  return split_part(p_path, '/', 2)::uuid;
exception when invalid_text_representation then
  return null;
end;
$$;

grant select, insert, update, delete on storage.objects to authenticated;

drop policy if exists journal_document_storage_read on storage.objects;
create policy journal_document_storage_read
on storage.objects
for select to authenticated
using (
  bucket_id = 'chantier-documents'
  and public.journal_can_access_chantier(public.journal_document_path_chantier_id(name))
);

drop policy if exists journal_document_storage_insert on storage.objects;
create policy journal_document_storage_insert
on storage.objects
for insert to authenticated
with check (
  bucket_id = 'chantier-documents'
  and public.journal_can_manage_chantier_documents(public.journal_document_path_chantier_id(name))
);

drop policy if exists journal_document_storage_update on storage.objects;
create policy journal_document_storage_update
on storage.objects
for update to authenticated
using (
  bucket_id = 'chantier-documents'
  and public.journal_can_manage_chantier_documents(public.journal_document_path_chantier_id(name))
)
with check (
  bucket_id = 'chantier-documents'
  and public.journal_can_manage_chantier_documents(public.journal_document_path_chantier_id(name))
);

drop policy if exists journal_document_storage_delete on storage.objects;
create policy journal_document_storage_delete
on storage.objects
for delete to authenticated
using (
  bucket_id = 'chantier-documents'
  and public.journal_can_manage_chantier_documents(public.journal_document_path_chantier_id(name))
);

-- Actualisation automatique sur les autres appareils quand Supabase Realtime
-- est activé dans le projet. L'absence de publication n'empêche pas l'usage.
do $$
begin
  alter publication supabase_realtime add table public.chantier_document_folders;
exception when duplicate_object then null;
when undefined_object then null;
end;
$$;
do $$
begin
  alter publication supabase_realtime add table public.chantier_documents;
exception when duplicate_object then null;
when undefined_object then null;
end;
$$;

revoke all on function public.journal_can_access_chantier(uuid) from public;
revoke all on function public.journal_can_manage_chantier_documents(uuid) from public;
revoke all on function public.can_manage_chantier_documents(uuid) from public;
revoke all on function public.create_chantier_document_folder(uuid, uuid, text) from public;
revoke all on function public.rename_chantier_document_folder(uuid, text) from public;
revoke all on function public.delete_chantier_document_folder(uuid) from public;
revoke all on function public.create_chantier_document_metadata(uuid, uuid, uuid, text, text, text, bigint, text, text) from public;
revoke all on function public.update_chantier_document_metadata(uuid, text, text, text) from public;
revoke all on function public.delete_chantier_document(uuid) from public;
revoke all on function public.journal_document_path_chantier_id(text) from public;

grant execute on function public.journal_can_access_chantier(uuid) to authenticated;
grant execute on function public.journal_can_manage_chantier_documents(uuid) to authenticated;
grant execute on function public.can_manage_chantier_documents(uuid) to authenticated;
grant execute on function public.create_chantier_document_folder(uuid, uuid, text) to authenticated;
grant execute on function public.rename_chantier_document_folder(uuid, text) to authenticated;
grant execute on function public.delete_chantier_document_folder(uuid) to authenticated;
grant execute on function public.create_chantier_document_metadata(uuid, uuid, uuid, text, text, text, bigint, text, text) to authenticated;
grant execute on function public.update_chantier_document_metadata(uuid, text, text, text) to authenticated;
grant execute on function public.delete_chantier_document(uuid) to authenticated;
grant execute on function public.journal_document_path_chantier_id(text) to authenticated;

commit;
