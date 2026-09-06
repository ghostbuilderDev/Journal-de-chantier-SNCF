-- Journal Chantier Connecté V14.2 — extension de la base existante, pas un schéma vierge.
-- Toute incompatibilité annule intégralement cette migration.
begin;

-- Schéma historique absent du transfert : vérifier ce que l'on sait réellement.
do $$
declare r record;
begin
  for r in select * from (values
    ('profiles','id','uuid'),('profiles','full_name','text'),('profiles','company','text'),
    ('profiles','email','text'),('chantiers','id','uuid'),('chantiers','name','text'),
    ('journal_administrators','user_id','uuid'),('journal_administrators','role','text'),
    ('chantier_members','chantier_id','uuid'),('chantier_members','user_id','uuid'),('chantier_members','role','text'),
    ('journal_access_requests','user_id','uuid'),('journal_access_requests','status','text'),
    ('action_items','id','uuid'),('action_items','chantier_id','uuid'),('action_items','created_by','uuid'),
    ('action_items','message_id','uuid'),('action_items','title','text'),('action_items','assignee','text'),('action_items','due_date','date'),
    ('chantier_messages','id','uuid'),('chantier_messages','chantier_id','uuid'),('chantier_messages','body','text')
  ) as expected(tbl,col,typ) loop
    if not exists (select 1 from pg_attribute a join pg_class c on c.oid=a.attrelid
      join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=r.tbl
      and a.attname=r.col and a.attnum>0 and not a.attisdropped
      and (format_type(a.atttypid,null)=r.typ or (r.typ='text' and format_type(a.atttypid,null)='character varying'))) then
      raise exception 'V14.2 interrompue : colonne attendue public.%.% de type % absente ou différente. Exporter le schéma réel avant de poursuivre.',r.tbl,r.col,r.typ;
    end if;
  end loop;
  if to_regprocedure('public.journal_can_access_chantier(uuid)') is null
    or to_regprocedure('public.journal_can_manage_chantier_documents(uuid)') is null
    or to_regprocedure('public.journal_is_owner()') is null then
    raise exception 'V14.2 exige les migrations historiques et documentaires V13/V14 déjà installées.';
  end if;
  if exists (select 1 from pg_trigger where tgrelid in ('auth.users'::regclass,'public.profiles'::regclass) and not tgisinternal and (tgtype & 8)<>0) then
    raise exception 'V14.2 : un trigger DELETE personnalisé existe sur Auth/profiles. Vérifier ses effets avant de permettre la suppression de comptes.';
  end if;
  if exists (select 1 from pg_attribute a where a.attrelid in ('public.chantier_members'::regclass,'public.journal_administrators'::regclass)
    and a.attnum>0 and not a.attisdropped and a.attnotnull and not a.atthasdef and a.attidentity=''
    and a.attname not in ('chantier_id','user_id','role')) then
    raise exception 'V14.2 : colonnes obligatoires historiques supplémentaires sur les attributions. Exporter le schéma avant de poursuivre.';
  end if;
  -- Une contrainte UNIQUE(user_id) aurait un sens différent du modèle N chantiers.
  if exists (select 1 from pg_index i join pg_attribute a on a.attrelid=i.indrelid and a.attnum=i.indkey[0]
    where i.indrelid='public.chantier_members'::regclass and i.indisunique and i.indnkeyatts=1 and a.attname='user_id') then
    raise exception 'V14.2 : chantier_members possède UNIQUE(user_id). Faire vérifier cette contrainte historique avant migration ; aucune contrainte n’a été supprimée.';
  end if;
end $$;

-- Pas de FK vers Auth : le blocage survit à la suppression d'un compte et à son JWT.
create table public.journal_user_access_blocks (
  user_id uuid primary key,
  blocked_at timestamptz not null default now(),
  blocked_by uuid,
  reason text not null default 'revoked' check (reason in ('revoked','deleting','deleted'))
);
alter table public.journal_user_access_blocks enable row level security;
revoke all on public.journal_user_access_blocks from public, anon, authenticated;

create or replace function public.journal_v142_is_active()
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
    and exists (select 1 from auth.users u where u.id=auth.uid())
    and not exists (select 1 from public.journal_user_access_blocks b where b.user_id=auth.uid());
$$;
create or replace function public.journal_is_owner()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.journal_v142_is_active() and exists (
    select 1 from public.journal_administrators where user_id=auth.uid() and role='proprietaire');
$$;
create or replace function public.journal_can_access_chantier(p_chantier_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.journal_v142_is_active() and (
    exists (select 1 from public.journal_administrators where user_id=auth.uid() and role in ('proprietaire','administrateur_general'))
    or exists (select 1 from public.chantier_members where user_id=auth.uid() and chantier_id=p_chantier_id));
$$;
create or replace function public.journal_can_manage_chantier_documents(p_chantier_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.journal_v142_is_active() and (
    exists (select 1 from public.journal_administrators where user_id=auth.uid() and role in ('proprietaire','administrateur_general'))
    or exists (select 1 from public.chantier_members where user_id=auth.uid() and chantier_id=p_chantier_id and role='administrateur'));
$$;
create function public.journal_v142_can_write(p_chantier_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.journal_can_manage_chantier_documents(p_chantier_id)
    or (public.journal_v142_is_active() and exists (
      select 1 from public.chantier_members where user_id=auth.uid() and chantier_id=p_chantier_id and role in ('membre','administrateur')));
$$;
create function public.journal_v142_can_assign(p_user_id uuid,p_chantier_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from auth.users u join public.profiles p on p.id=u.id where u.id=p_user_id)
    and not exists (select 1 from public.journal_user_access_blocks where user_id=p_user_id)
    and (exists (select 1 from public.journal_administrators where user_id=p_user_id and role in ('proprietaire','administrateur_general'))
      or exists (select 1 from public.chantier_members where user_id=p_user_id and chantier_id=p_chantier_id and role in ('membre','administrateur')));
$$;

-- Seulement les identités utiles à l'annuaire ; jamais les emails ni les rôles globaux.
create function public.list_journal_user_directory(p_chantier_id uuid default null)
returns table(id uuid,full_name text,company text,can_assign boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.journal_v142_is_active() or not (
    exists (select 1 from public.journal_administrators where user_id=auth.uid() and role in ('proprietaire','administrateur_general'))
    or exists (select 1 from public.chantier_members where user_id=auth.uid())) then
    raise exception 'Un accès validé à l’application est nécessaire pour consulter les collaborateurs.' using errcode='42501';
  end if;
  if p_chantier_id is not null and not public.journal_can_access_chantier(p_chantier_id) then
    raise exception 'Chantier non autorisé.' using errcode='42501';
  end if;
  return query select u.id,
    coalesce(nullif(btrim(p.full_name),''),nullif(btrim(u.raw_user_meta_data->>'full_name'),''),
      nullif(btrim(concat_ws(' ',u.raw_user_meta_data->>'first_name',u.raw_user_meta_data->>'last_name')),''),'Nom non renseigné')::text,
    p.company::text,
    case when p_chantier_id is null then false else public.journal_v142_can_assign(u.id,p_chantier_id) end
    from auth.users u left join public.profiles p on p.id=u.id
    where not exists (select 1 from public.journal_user_access_blocks b where b.user_id=u.id)
    order by lower(coalesce(nullif(btrim(p.full_name),''),u.raw_user_meta_data->>'full_name',
      nullif(btrim(concat_ws(' ',u.raw_user_meta_data->>'first_name',u.raw_user_meta_data->>'last_name')),''),'')),u.id;
end $$;

alter table public.action_items add column assignee_user_id uuid references public.profiles(id) on delete set null;
alter table public.action_items add column due_mode text;
update public.action_items set due_mode=case when due_date is null then 'none' else 'date' end;
alter table public.action_items alter column due_mode set default 'none';
alter table public.action_items alter column due_mode set not null;
alter table public.action_items add constraint action_items_due_mode_check check (due_mode in ('none','date','immediate'));
create index action_items_assignee_user_id_idx on public.action_items(assignee_user_id) where assignee_user_id is not null;
alter table public.chantier_messages add column action_id uuid references public.action_items(id) on delete set null;
create index chantier_messages_action_id_idx on public.chantier_messages(action_id) where action_id is not null;

-- Les contraintes de corps existantes restent valables pour tout texte non vide.
-- Le texte vide devient valide afin de permettre le dépôt d'une photo seule.
do $$
declare r record;
begin
  for r in select c.conname,cardinality(c.conkey) as arity,pg_get_expr(c.conbin,c.conrelid) as expression
    from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum=any(c.conkey)
    where c.conrelid='public.chantier_messages'::regclass and c.contype='c' and a.attname='body' loop
    if r.arity<>1 then raise exception 'V14.2 : contrainte multi-colonnes % sur le texte des messages ; vérifier le schéma avant de l’adapter.',r.conname; end if;
    execute format('alter table public.chantier_messages drop constraint %I',r.conname);
    execute format('alter table public.chantier_messages add constraint %I check (body = '''' or (%s))',r.conname,r.expression);
  end loop;
  -- Retirer uniquement une borne temporelle portant exclusivement sur due_date.
  for r in select c.conname from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
    where c.conrelid='public.action_items'::regclass and c.contype='c' and cardinality(c.conkey)=1 and a.attname='due_date'
      and pg_get_expr(c.conbin,c.conrelid) ~* '(current_date|now\(\)|current_timestamp)' loop
    execute format('alter table public.action_items drop constraint %I',r.conname);
  end loop;
end $$;

create function public.journal_v142_validate_action()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Les maintenances système (migration / suppression Auth) n'ont pas d'auth.uid().
  if auth.uid() is not null then
    if not public.journal_v142_is_active() or not public.journal_v142_can_write(new.chantier_id) then
      raise exception 'Écriture non autorisée sur ce chantier.' using errcode='42501';
    end if;
    if tg_op='INSERT' then
      new.created_by:=auth.uid();
    else
      -- Après suppression d'un compte, les identités historiques peuvent être
      -- NULL. Une expression NULL doit refuser l'écriture, y compris lorsqu'une
      -- ancienne RPC SECURITY DEFINER contourne les politiques RLS de la table.
      if not coalesce(old.created_by=auth.uid() or old.assignee_user_id=auth.uid() or public.journal_can_manage_chantier_documents(old.chantier_id),false) then
        raise exception 'Seuls le créateur, le pilote ou un administrateur du chantier peuvent modifier cette action.' using errcode='42501';
      end if;
      if new.id is distinct from old.id or new.chantier_id is distinct from old.chantier_id or new.created_by is distinct from old.created_by then
        raise exception 'L’identité, le chantier et le créateur de l’action ne peuvent pas changer.';
      end if;
    end if;
  end if;
  if new.message_id is not null and not exists (select 1 from public.chantier_messages m where m.id=new.message_id and m.chantier_id=new.chantier_id) then
    raise exception 'Le message source doit appartenir au même chantier.';
  end if;
  if new.assignee_user_id is not null and (tg_op='INSERT' or new.assignee_user_id is distinct from old.assignee_user_id) then
    if not public.journal_v142_can_assign(new.assignee_user_id,new.chantier_id) then
      raise exception 'Le pilote doit disposer d’un accès contributeur ou administrateur à ce chantier.';
    end if;
    select p.full_name into new.assignee from public.profiles p where p.id=new.assignee_user_id;
  end if;
  -- Compatibilité avec les téléphones encore ouverts sur l'ancienne version.
  if tg_op='INSERT' and new.due_mode='none' and new.due_date is not null then new.due_mode:='date'; end if;
  if tg_op='UPDATE' and new.due_mode=old.due_mode and new.due_date is distinct from old.due_date then
    new.due_mode:=case when new.due_date is null then 'none' else 'date' end;
  end if;
  if new.due_mode='date' and new.due_date is null then raise exception 'Choisis une date d’échéance.'; end if;
  if new.due_mode in ('none','immediate') then new.due_date:=null; end if;
  return new;
end $$;
create trigger journal_v142_validate_action before insert or update on public.action_items
for each row execute function public.journal_v142_validate_action();

create function public.journal_v142_validate_action_link()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.action_id is not null and not exists (select 1 from public.action_items a where a.id=new.action_id and a.chantier_id=new.chantier_id) then
    raise exception 'L’action liée doit appartenir au même chantier.';
  end if;
  return new;
end $$;
create trigger journal_v142_validate_action_link before insert or update of action_id,chantier_id on public.chantier_messages
for each row execute function public.journal_v142_validate_action_link();

-- Les politiques historiques des actions sont remplacées explicitement : une
-- ancienne politique permissive ne doit jamais contourner les droits du pilote.
do $$ declare r record; begin
  for r in select policyname from pg_policies where schemaname='public' and tablename='action_items' loop
    execute format('drop policy %I on public.action_items',r.policyname);
  end loop;
end $$;
alter table public.action_items enable row level security;
revoke all on public.action_items from anon;
grant select,insert,update,delete on public.action_items to authenticated;
create policy journal_v142_actions_read on public.action_items for select to authenticated using (public.journal_can_access_chantier(chantier_id));
create policy journal_v142_actions_insert on public.action_items for insert to authenticated with check (created_by=auth.uid() and public.journal_v142_can_write(chantier_id));
create policy journal_v142_actions_update on public.action_items for update to authenticated
using (public.journal_v142_can_write(chantier_id) and (created_by=auth.uid() or assignee_user_id=auth.uid() or public.journal_can_manage_chantier_documents(chantier_id)))
with check (public.journal_v142_can_write(chantier_id));
create policy journal_v142_actions_delete on public.action_items for delete to authenticated
using (public.journal_v142_can_write(chantier_id) and (created_by=auth.uid() or public.journal_can_manage_chantier_documents(chantier_id)));

create function public.journal_v142_guard_active_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and not public.journal_v142_is_active() then
    raise exception 'Les accès de ce compte ont été retirés.' using errcode='42501';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;

-- Garde restrictive : les anciens JWT ne conservent aucun accès après révocation.
-- Les règles existantes continuent à limiter les rôles et les opérations métier.
do $$
declare r record; v_using text;
begin
  for r in select c.oid,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r' and c.relname in (
      'profiles','chantiers','chantier_members','journal_administrators','journal_access_requests','action_items',
      'chantier_messages','chantier_attachments','chantier_daily_logs','chantier_risks','chantier_message_reactions',
      'chantier_read_states','chantier_document_folders','chantier_documents','journal_portal_apps') loop
    execute format('alter table public.%I enable row level security',r.relname);
    execute format('create trigger journal_v142_guard_active_write before insert or update or delete on public.%I for each row execute function public.journal_v142_guard_active_write()',r.relname);
    execute format('create policy journal_v142_active on public.%I as restrictive for all to authenticated using (public.journal_v142_is_active()) with check (public.journal_v142_is_active())',r.relname);
    if r.relname='chantiers' then v_using:='public.journal_can_access_chantier(id)';
    elsif r.relname not in ('chantier_members') and exists (select 1 from pg_attribute where attrelid=r.oid and attname='chantier_id' and not attisdropped) then
      v_using:='public.journal_can_access_chantier(chantier_id)';
    else v_using:=null; end if;
    if v_using is not null then
      if r.relname<>'chantiers' then
        execute format('create policy journal_v142_scope_insert on public.%I as restrictive for insert to authenticated with check (%s)',r.relname,v_using);
      end if;
      execute format('create policy journal_v142_scope_read on public.%I as restrictive for select to authenticated using (%s)',r.relname,v_using);
      execute format('create policy journal_v142_scope_update on public.%I as restrictive for update to authenticated using (%s) with check (%s)',r.relname,v_using,v_using);
      execute format('create policy journal_v142_scope_delete on public.%I as restrictive for delete to authenticated using (%s)',r.relname,v_using);
    end if;
  end loop;
end $$;
-- Les droits passent exclusivement par les RPC d'administration. Les anciennes
-- politiques permissives ne doivent jamais permettre de s'attribuer un rôle.
revoke insert,update,delete on public.journal_administrators,public.chantier_members from public,anon,authenticated;
-- L'annuaire et le tableau d'administration utilisent des RPC dédiées ; le profil
-- lu/modifié directement reste celui de la session uniquement.
create policy journal_v142_profile_self on public.profiles as restrictive for all to authenticated
using (id=auth.uid()) with check (id=auth.uid());

-- Le frontend utilise déjà des URLs signées ; aucun accès public permanent.
update storage.buckets set public=false where id in ('chantier-files','chantier-documents','chantier-cover-images');
create policy journal_v142_storage_active on storage.objects as restrictive for all to authenticated
using (bucket_id not in ('chantier-files','chantier-documents','chantier-cover-images') or public.journal_v142_is_active())
with check (bucket_id not in ('chantier-files','chantier-documents','chantier-cover-images') or public.journal_v142_is_active());

create function public.journal_v142_administration_dashboard()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if not public.journal_v142_is_active() or not exists (select 1 from public.journal_administrators where user_id=auth.uid() and role in ('proprietaire','administrateur_general')) then
    raise exception 'Administration non autorisée.' using errcode='42501';
  end if;
  select coalesce(jsonb_agg(rowdata order by lower(rowdata->>'full_name')),'[]'::jsonb) into result from (
    select jsonb_build_object('id',u.id,'user_id',u.id,'email',coalesce(p.email,u.email),'full_name',
      coalesce(nullif(btrim(p.full_name),''),nullif(btrim(u.raw_user_meta_data->>'full_name'),''),
        nullif(btrim(concat_ws(' ',u.raw_user_meta_data->>'first_name',u.raw_user_meta_data->>'last_name')),''),
        case when b.reason in ('deleting','deleted') then 'Compte en cours de suppression' else 'Nom non renseigné' end),'company',p.company,
      'global_role',coalesce((select a.role from public.journal_administrators a where a.user_id=u.id limit 1),''),
      'request_status',case when b.user_id is not null then 'refusee' else coalesce((select q.status from public.journal_access_requests q where q.user_id=u.id limit 1),'acceptee') end,
      'access_revoked',b.user_id is not null,
      'chantiers',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'chantier_id',c.id,'name',c.name,'role',m.role) order by c.name)
        from public.chantier_members m join public.chantiers c on c.id=m.chantier_id where m.user_id=u.id),'[]'::jsonb)) as rowdata
    from auth.users u left join public.profiles p on p.id=u.id left join public.journal_user_access_blocks b on b.user_id=u.id
  ) q;
  return result;
end $$;

create function public.journal_v142_set_user_access(p_user_id uuid,p_global_role text,p_memberships jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  if not public.journal_is_owner() then raise exception 'Seul le propriétaire principal peut modifier les droits.' using errcode='42501'; end if;
  if p_user_id=auth.uid() or exists (select 1 from public.journal_administrators where user_id=p_user_id and role='proprietaire') then raise exception 'Le propriétaire principal est protégé.'; end if;
  if not exists (select 1 from public.profiles p join auth.users u on u.id=p.id where p.id=p_user_id) then raise exception 'Compte introuvable.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,142));
  if exists (select 1 from public.journal_user_access_blocks where user_id=p_user_id and reason in ('deleting','deleted')) then raise exception 'Suppression du compte en cours ; les accès ne peuvent pas être rétablis.'; end if;
  if p_global_role is null or p_global_role not in ('','administrateur_general') then raise exception 'Rôle global invalide.'; end if;
  if p_memberships is null or jsonb_typeof(p_memberships)<>'array' then raise exception 'La liste des chantiers est obligatoire.'; end if;
  if jsonb_array_length(p_memberships)>500 then raise exception 'Trop de chantiers dans cette demande.'; end if;
  if exists (select 1 from jsonb_array_elements(p_memberships) v where jsonb_typeof(v)<>'object' or (v->>'role') is null or (v->>'role') not in ('membre','lecture','administrateur') or (v->>'chantier_id') is null) then raise exception 'Attribution de chantier invalide.'; end if;
  if (select count(*) from jsonb_array_elements(p_memberships))<>(select count(distinct v->>'chantier_id') from jsonb_array_elements(p_memberships) v) then raise exception 'Un chantier apparaît plusieurs fois.'; end if;
  for r in select (v->>'chantier_id')::uuid chantier_id,v->>'role' role from jsonb_array_elements(p_memberships) v loop
    if not exists (select 1 from public.chantiers where id=r.chantier_id) then raise exception 'Chantier introuvable : %.',r.chantier_id; end if;
  end loop;
  if p_global_role='' and jsonb_array_length(p_memberships)=0 then
    raise exception 'Choisis au moins un chantier ou utilise Retirer tous les accès.';
  end if;
  perform public.journal_v142_assert_account_cleanup_safe();
  -- Une liste unique remplace toutes les attributions dans une seule transaction.
  delete from public.chantier_members where user_id=p_user_id;
  delete from public.journal_administrators where user_id=p_user_id;
  if p_global_role='administrateur_general' then
    insert into public.journal_administrators(user_id,role) values (p_user_id,p_global_role);
  end if;
  for r in select (v->>'chantier_id')::uuid chantier_id,v->>'role' role from jsonb_array_elements(p_memberships) v loop
    insert into public.chantier_members(chantier_id,user_id,role) values (r.chantier_id,p_user_id,r.role);
  end loop;
  update public.journal_access_requests set status='acceptee' where user_id=p_user_id;
  delete from public.journal_user_access_blocks where user_id=p_user_id;
end $$;

create function public.journal_v142_revoke_user_access(p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.journal_is_owner() then raise exception 'Seul le propriétaire principal peut retirer tous les accès.' using errcode='42501'; end if;
  if p_user_id=auth.uid() or exists (select 1 from public.journal_administrators where user_id=p_user_id and role='proprietaire') then raise exception 'Le propriétaire principal est protégé.'; end if;
  if not exists (select 1 from auth.users where id=p_user_id) then raise exception 'Compte introuvable.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,142));
  perform public.journal_v142_assert_account_cleanup_safe();
  insert into public.journal_user_access_blocks(user_id,blocked_by) values(p_user_id,auth.uid())
    on conflict(user_id) do update set blocked_at=now(),blocked_by=auth.uid();
  delete from public.chantier_members where user_id=p_user_id;
  delete from public.journal_administrators where user_id=p_user_id;
  update public.journal_access_requests set status='refusee' where user_id=p_user_id;
end $$;

-- L'ancien bouton de retrait appelle aussi la nouvelle révocation effective.
-- Ne remplacer que sa signature connue, sans supposer son type de retour.
do $$
declare v_return text;
begin
  select format_type(p.prorettype,null) into v_return from pg_proc p where p.oid=to_regprocedure('public.revoke_journal_user_access(uuid)');
  if v_return='void' then
    execute 'create or replace function public.revoke_journal_user_access(p_user_id uuid) returns void language plpgsql security definer set search_path = '''' as $f$ begin perform public.journal_v142_revoke_user_access(p_user_id); end $f$';
  end if;
end $$;

-- Suppression Auth : préserver les contributions malgré les FK historiques.
-- Seules les colonnes d'identité explicitement reconnues peuvent être détachées.
-- Une FK inconnue vers Auth/profiles arrête la migration avant tout changement.
do $$
declare r record; v_allowed boolean; v_definition text;
begin
  for r in select c.oid,c.conname,c.conrelid,c.confrelid,c.conkey,c.confkey,c.confdeltype,
    n.nspname as schema_name,t.relname as table_name,a.attname as column_name,ra.attname as target_column
    from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace
    left join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
    left join pg_attribute ra on ra.attrelid=c.confrelid and ra.attnum=c.confkey[1]
    where c.contype='f' and c.confrelid in ('auth.users'::regclass,'public.profiles'::regclass)
      and n.nspname not in ('auth','storage') loop
    if cardinality(r.conkey)<>1 or cardinality(r.confkey)<>1 or r.target_column<>'id' or r.schema_name<>'public' then
      raise exception 'Suppression sûre non garantie : FK historique inconnue %.%. Exporter le schéma réel.',r.table_name,r.conname;
    end if;
    if (r.table_name='profiles' and r.column_name='id') or
      (r.table_name in ('chantier_members','journal_administrators','journal_access_requests','chantier_read_states','chantier_message_reactions') and r.column_name='user_id') then
      continue; -- Ces seules lignes liées au compte peuvent être supprimées.
    end if;
    v_allowed:=(r.table_name in ('chantiers','chantier_messages','chantier_attachments','action_items','chantier_daily_logs','chantier_risks','chantier_documents','chantier_document_folders','journal_portal_apps')
      and r.column_name in ('created_by','author_id','uploaded_by','closed_by','assignee_user_id','updated_by','owner_id'))
      or (r.table_name in ('journal_access_requests','journal_administrators','chantier_members') and r.column_name in ('reviewed_by','approved_by','granted_by','created_by','added_by'));
    if not v_allowed then raise exception 'Suppression sûre non garantie : FK inconnue %.% (%). Exporter le schéma réel.',r.table_name,r.column_name,r.conname; end if;
    -- Les noms déjà consignés dans le journal restent inchangés.
    execute format('alter table public.%I alter column %I drop not null',r.table_name,r.column_name);
    v_definition:=pg_get_constraintdef(r.oid);
    v_definition:=regexp_replace(v_definition,' ON DELETE (NO ACTION|RESTRICT|CASCADE|SET NULL|SET DEFAULT)','');
    -- Ajouter avant DEFERRABLE / NOT VALID éventuels.
    v_definition:=regexp_replace(v_definition,'( DEFERRABLE| NOT DEFERRABLE| NOT VALID|$)',' ON DELETE SET NULL\1');
    execute format('alter table public.%I drop constraint %I',r.table_name,r.conname);
    execute format('alter table public.%I add constraint %I %s',r.table_name,r.conname,v_definition);
  end loop;
end $$;

-- Supprimer/remplacer les droits ne doit pas effacer une table métier reliée
-- indirectement au compte via un membership, une demande d'accès ou un reçu.
create function public.journal_v142_assert_account_cleanup_safe()
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_accounts oid[]:=array['auth.users'::regclass,'public.profiles'::regclass,
    'public.chantier_members'::regclass,'public.journal_administrators'::regclass,
    'public.journal_access_requests'::regclass,
    to_regclass('public.chantier_read_states'),to_regclass('public.chantier_message_reactions')]::oid[];
  r record;
begin
  if exists (select 1 from pg_trigger where tgrelid=any(v_accounts) and not tgisinternal
    and (tgtype & 8)<>0 and tgfoid<>'public.journal_v142_guard_active_write()'::regprocedure) then
    raise exception 'Suppression interrompue : trigger DELETE personnalisé sur les comptes ou leurs droits. Faire contrôler le schéma.';
  end if;
  for r in select c.conname,n.nspname,t.relname from pg_constraint c
    join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace
    where c.contype='f' and c.confdeltype='c' and c.confrelid=any(v_accounts)
      and n.nspname not in ('auth','storage')
      and not exists(select 1 from unnest(v_accounts) account_oid where account_oid=c.conrelid) loop
    raise exception 'Suppression interrompue : cascade indirecte vers %.% (%). Faire contrôler le schéma.',r.nspname,r.relname,r.conname;
  end loop;
end $$;
select public.journal_v142_assert_account_cleanup_safe();

-- Appel interne Edge uniquement. L'identité de l'opérateur est validée via Auth
-- avant l'appel, puis ses droits sont relus ici pour éviter une course de rôle.
create function public.journal_v142_prepare_user_deletion(p_actor_id uuid,p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  if not exists (select 1 from auth.users u join public.journal_administrators a on a.user_id=u.id where u.id=p_actor_id and a.role='proprietaire')
    or exists (select 1 from public.journal_user_access_blocks where user_id=p_actor_id) then raise exception 'Propriétaire principal requis.' using errcode='42501'; end if;
  if p_user_id=p_actor_id or exists (select 1 from public.journal_administrators where user_id=p_user_id and role='proprietaire') then raise exception 'Le propriétaire principal est protégé.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,142));
  if not exists (select 1 from auth.users where id=p_user_id) then raise exception 'Compte introuvable.'; end if;
  perform public.journal_v142_assert_account_cleanup_safe();
  if exists (select 1 from pg_trigger where tgrelid in ('auth.users'::regclass,'public.profiles'::regclass) and not tgisinternal and (tgtype & 8)<>0 and tgfoid<>'public.journal_v142_guard_active_write()'::regprocedure) then
    raise exception 'Suppression interrompue : trigger DELETE ajouté depuis V14.2. Faire contrôler le schéma.';
  end if;
  for r in select c.conname,c.confdeltype,n.nspname,t.relname,a.attname,cardinality(c.conkey) as arity
    from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace
    left join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
    where c.contype='f' and c.confrelid in ('auth.users'::regclass,'public.profiles'::regclass) and n.nspname not in ('auth','storage') loop
    if r.nspname='public' and r.arity=1 and ((r.relname='profiles' and r.attname='id') or
      (r.relname in ('chantier_members','journal_administrators','journal_access_requests','chantier_read_states','chantier_message_reactions') and r.attname='user_id')) then continue; end if;
    if r.confdeltype<>'n' then raise exception 'Suppression interrompue : FK % ne préserve pas son historique. Faire contrôler le schéma.',r.conname; end if;
  end loop;
  insert into public.journal_user_access_blocks(user_id,blocked_by,reason) values(p_user_id,p_actor_id,'deleting')
    on conflict(user_id) do update set reason='deleting',blocked_at=now(),blocked_by=p_actor_id;
  delete from public.chantier_members where user_id=p_user_id;
  delete from public.journal_administrators where user_id=p_user_id;
  delete from public.journal_access_requests where user_id=p_user_id;
  for r in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('chantier_read_states','chantier_message_reactions') and c.relkind='r' loop
    execute format('delete from public.%I where user_id=$1',r.relname) using p_user_id;
  end loop;
  -- Les FK auteur sont SET NULL ; aucun chantier/message/action/document supprimé.
  delete from public.profiles where id=p_user_id;
  -- Supabase interdit de supprimer le propriétaire de fichiers Storage.
  -- Réattribuer les métadonnées au propriétaire principal conserve les objets.
  if exists (select 1 from pg_attribute where attrelid='storage.objects'::regclass and attname='owner_id' and not attisdropped) then
    execute 'update storage.objects set owner_id=$1 where owner_id=$2' using p_actor_id::text,p_user_id::text;
  end if;
  if exists (select 1 from pg_attribute where attrelid='storage.objects'::regclass and attname='owner' and not attisdropped) then
    execute 'update storage.objects set owner=$1 where owner=$2' using p_actor_id,p_user_id;
  end if;
  if exists (select 1 from pg_attribute where attrelid='storage.buckets'::regclass and attname='owner' and not attisdropped) then
    execute 'update storage.buckets set owner=$1 where owner=$2' using p_actor_id,p_user_id;
  end if;
  if exists (select 1 from pg_attribute where attrelid='storage.buckets'::regclass and attname='owner_id' and not attisdropped) then
    execute 'update storage.buckets set owner_id=$1 where owner_id=$2' using p_actor_id::text,p_user_id::text;
  end if;
end $$;

create function public.journal_v142_finish_user_deletion(p_actor_id uuid,p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from auth.users u join public.journal_administrators a on a.user_id=u.id where u.id=p_actor_id and a.role='proprietaire')
    or exists (select 1 from public.journal_user_access_blocks where user_id=p_actor_id) then raise exception 'Propriétaire principal requis.' using errcode='42501'; end if;
  if exists (select 1 from auth.users where id=p_user_id) then raise exception 'La suppression Auth doit être terminée.'; end if;
  -- Certaines bases historiques n'ont pas le CASCADE profile -> Auth.
  delete from public.profiles where id=p_user_id;
  update public.journal_user_access_blocks set reason='deleted' where user_id=p_user_id;
end $$;

-- Aucune fonction SECURITY DEFINER nouvelle ne garde EXECUTE pour PUBLIC.
do $$ declare r record; begin
  for r in select p.oid::regprocedure signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and (p.proname like 'journal_v142_%' or p.proname='list_journal_user_directory') loop
    execute format('revoke all on function %s from public,anon,authenticated',r.signature);
    if r.proname in ('journal_v142_prepare_user_deletion','journal_v142_finish_user_deletion') then
      execute format('grant execute on function %s to service_role',r.signature);
    elsif r.proname not in ('journal_v142_validate_action','journal_v142_validate_action_link','journal_v142_guard_active_write','journal_v142_can_assign','journal_v142_assert_account_cleanup_safe') then
      execute format('grant execute on function %s to authenticated',r.signature);
    end if;
  end loop;
end $$;
revoke all on function public.journal_is_owner() from public,anon;
revoke all on function public.journal_can_access_chantier(uuid) from public,anon;
revoke all on function public.journal_can_manage_chantier_documents(uuid) from public,anon;
grant execute on function public.journal_is_owner() to authenticated;
grant execute on function public.journal_can_access_chantier(uuid) to authenticated;
grant execute on function public.journal_can_manage_chantier_documents(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
