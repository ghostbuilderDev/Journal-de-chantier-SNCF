-- Journal Chantier Connecté — V13.3.3
-- Actions : remise à zéro réservée au propriétaire principal.
-- Documentation : dossiers principaux personnalisés, en plus de Sécurité,
-- Plans et Documents qualité qui restent protégés.

begin;

-- Autorise les rubriques personnalisées sans toucher aux trois racines
-- normalisées déjà présentes dans chaque chantier.
do $$
declare
  v_constraint_name text;
begin
  select constraint_name into v_constraint_name
  from information_schema.table_constraints
  where table_schema = 'public'
    and table_name = 'chantier_document_folders'
    and constraint_type = 'CHECK'
    and constraint_name like '%root_code%'
  limit 1;
  if v_constraint_name is not null then
    execute format('alter table public.chantier_document_folders drop constraint %I', v_constraint_name);
  end if;
end;
$$;

alter table public.chantier_document_folders
  add constraint chantier_document_folders_root_code_check
  check (root_code in ('securite', 'plans', 'qualite', 'personnalise'));

drop index if exists public.chantier_document_folders_root_unique;
create unique index chantier_document_folders_standard_root_unique
  on public.chantier_document_folders (
    chantier_id,
    (case when root_code in ('securite', 'plans', 'qualite') then root_code else null end)
  )
  where is_root;

create or replace function public.create_chantier_document_root_folder(
  p_chantier_id uuid,
  p_name text
)
returns public.chantier_document_folders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_folder public.chantier_document_folders%rowtype;
begin
  if not public.journal_can_manage_chantier_documents(p_chantier_id) then
    raise exception 'Seuls les administrateurs peuvent créer un dossier principal.';
  end if;
  if p_name is null or char_length(btrim(p_name)) = 0 then
    raise exception 'Le nom du dossier principal est obligatoire.';
  end if;
  if exists (
    select 1 from public.chantier_document_folders
    where chantier_id = p_chantier_id and is_root
      and lower(btrim(name)) = lower(btrim(p_name))
  ) then
    raise exception 'Un dossier principal porte déjà ce nom.';
  end if;
  insert into public.chantier_document_folders (
    chantier_id, parent_id, root_code, name, is_root, created_by, created_by_name
  ) values (
    p_chantier_id, null, 'personnalise', btrim(p_name), true, auth.uid(),
    coalesce((select nullif(btrim(full_name), '') from public.profiles where id = auth.uid()), 'Administrateur')
  ) returning * into v_folder;
  return v_folder;
end;
$$;

-- Les trois racines normalisées restent protégées. Les rubriques créées par
-- l'administration peuvent être renommées ou supprimées quand elles sont vides.
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
  if not found then raise exception 'Dossier introuvable.'; end if;
  if not public.journal_can_manage_chantier_documents(v_folder.chantier_id) then raise exception 'Seuls les administrateurs peuvent modifier un dossier.'; end if;
  if v_folder.is_root and v_folder.root_code in ('securite', 'plans', 'qualite') then raise exception 'Les dossiers racine normalisés sont protégés.'; end if;
  if p_name is null or char_length(btrim(p_name)) = 0 then raise exception 'Le nom du dossier est obligatoire.'; end if;
  update public.chantier_document_folders set name = btrim(p_name), updated_at = now() where id = p_folder_id;
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
  if not found then raise exception 'Dossier introuvable.'; end if;
  if not public.journal_can_manage_chantier_documents(v_folder.chantier_id) then raise exception 'Seuls les administrateurs peuvent supprimer un dossier.'; end if;
  if v_folder.is_root and v_folder.root_code in ('securite', 'plans', 'qualite') then raise exception 'Les dossiers racine normalisés sont protégés.'; end if;
  if exists (select 1 from public.chantier_document_folders where parent_id = p_folder_id) then raise exception 'Le dossier contient encore des sous-dossiers.'; end if;
  if exists (select 1 from public.chantier_documents where folder_id = p_folder_id) then raise exception 'Le dossier contient encore des documents.'; end if;
  delete from public.chantier_document_folders where id = p_folder_id;
end;
$$;

create or replace function public.reset_journal_chantier_actions(p_chantier_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  if auth.uid() is null or not exists (
    select 1 from public.journal_administrators
    where user_id = auth.uid() and role = 'proprietaire'
  ) then
    raise exception 'Cette opération est réservée au propriétaire principal.';
  end if;
  delete from public.action_items where chantier_id = p_chantier_id;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.create_chantier_document_root_folder(uuid, text) from public;
revoke all on function public.reset_journal_chantier_actions(uuid) from public;
grant execute on function public.create_chantier_document_root_folder(uuid, text) to authenticated;
grant execute on function public.rename_chantier_document_folder(uuid, text) to authenticated;
grant execute on function public.delete_chantier_document_folder(uuid) to authenticated;
grant execute on function public.reset_journal_chantier_actions(uuid) to authenticated;

commit;
