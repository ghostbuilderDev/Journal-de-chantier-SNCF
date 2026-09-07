-- Journal Chantier V14.5 : retours communs sur l'application, sans fil chantier ni push.
-- Migration additive et transactionnelle. Aucune FK vers Auth/profiles.
begin;
do $$ begin
  if to_regprocedure('public.journal_v142_is_active()') is null
     or to_regprocedure('public.journal_v142_assert_account_cleanup_safe()') is null then
    raise exception 'Le fil des améliorations exige V14.2 validée.';
  end if;
  if not exists(select 1 from pg_attribute where attrelid='storage.objects'::regclass and attname='metadata' and not attisdropped)
    or not exists(select 1 from pg_attribute where attrelid='storage.buckets'::regclass and attname='file_size_limit' and not attisdropped)
    or not exists(select 1 from pg_attribute where attrelid='storage.buckets'::regclass and attname='allowed_mime_types' and not attisdropped) then
    raise exception 'Le stockage Supabase des captures ne présente pas les colonnes standard attendues.';
  end if;
end $$;
create schema journal_feedback_private;
revoke all on schema journal_feedback_private from public,anon,authenticated,service_role;
create table journal_feedback_private.threads (
  id uuid primary key,author_id uuid not null,
  title text not null check(char_length(btrim(title)) between 1 and 100),
  body text not null check(char_length(btrim(body)) between 1 and 4000),
  category text not null check(category in ('bug','improvement')),
  status text not null default 'new' check(status in ('new','planned','in_progress','done')),
  image_path text unique,created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
create table journal_feedback_private.replies (
  id uuid primary key,thread_id uuid not null references journal_feedback_private.threads(id) on delete cascade,
  author_id uuid not null,body text not null check(char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp()
);
create index journal_feedback_threads_recent on journal_feedback_private.threads(created_at desc,id desc);
create index journal_feedback_threads_filtered on journal_feedback_private.threads(status,category,created_at desc,id desc);
create index journal_feedback_replies_recent on journal_feedback_private.replies(thread_id,created_at desc,id desc);
alter table journal_feedback_private.threads enable row level security;
alter table journal_feedback_private.replies enable row level security;
revoke all on all tables in schema journal_feedback_private from public,anon,authenticated,service_role;

create function journal_feedback_private.assert_active() returns void language plpgsql set search_path='' as $$
begin
  if not public.journal_v142_is_active() then raise exception using errcode='42501',message='Connectez-vous avec un compte autorisé pour accéder aux améliorations.'; end if;
end $$;
create function journal_feedback_private.can_manage() returns boolean language sql stable set search_path='' as $$
  select public.journal_v142_is_active() and exists(select 1 from public.journal_administrators where user_id=auth.uid() and role in ('proprietaire','administrateur_general'));
$$;
create function journal_feedback_private.author_name(p_id uuid) returns text language sql stable set search_path='' as $$
  select coalesce((select coalesce(nullif(btrim(p.full_name),''),nullif(btrim(u.raw_user_meta_data->>'full_name'),''),
    nullif(btrim(concat_ws(' ',u.raw_user_meta_data->>'first_name',u.raw_user_meta_data->>'last_name')),''),'Nom non renseigné')
    from auth.users u left join public.profiles p on p.id=u.id where u.id=p_id),'Compte supprimé');
$$;
create function journal_feedback_private.thread_json(p_row journal_feedback_private.threads) returns jsonb language sql stable set search_path='' as $$
  select to_jsonb(p_row)||jsonb_build_object('author_name',journal_feedback_private.author_name(p_row.author_id),
    'reply_count',(select count(*) from journal_feedback_private.replies where thread_id=p_row.id),
    'reply_updated_at',(select max(updated_at) from journal_feedback_private.replies where thread_id=p_row.id),
    'can_edit',p_row.author_id=auth.uid(),'can_delete',p_row.author_id=auth.uid() or journal_feedback_private.can_manage());
$$;
create function journal_feedback_private.reply_json(p_row journal_feedback_private.replies) returns jsonb language sql stable set search_path='' as $$
  select to_jsonb(p_row)||jsonb_build_object('author_name',journal_feedback_private.author_name(p_row.author_id),
    'can_edit',p_row.author_id=auth.uid(),'can_delete',p_row.author_id=auth.uid() or journal_feedback_private.can_manage());
$$;
create function journal_feedback_private.valid_image_path(p_name text,p_author uuid,p_thread uuid default null) returns boolean language sql immutable set search_path='' as $$
  select coalesce(p_name ~ ('^'||p_author::text||'/'||coalesce(p_thread::text,'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}')||'/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](jpg|jpeg|png|webp)$'),false);
$$;
create function journal_feedback_private.validate_thread(p_title text,p_body text,p_category text) returns void language plpgsql set search_path='' as $$
begin
  if p_title is null or char_length(btrim(p_title)) not between 1 and 100 then raise exception 'Le titre doit contenir de 1 à 100 caractères.'; end if;
  if p_body is null or char_length(btrim(p_body)) not between 1 and 4000 then raise exception 'La description doit contenir de 1 à 4000 caractères.'; end if;
  if p_category is null or p_category not in ('bug','improvement') then raise exception 'Choisissez un problème ou une amélioration.'; end if;
end $$;
create function journal_feedback_private.validate_reply(p_body text) returns void language plpgsql set search_path='' as $$
begin
  if p_body is null or char_length(btrim(p_body)) not between 1 and 2000 then raise exception 'La réponse doit contenir de 1 à 2000 caractères.'; end if;
end $$;

create function public.journal_feedback_context() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  perform journal_feedback_private.assert_active();
  return jsonb_build_object('user_id',auth.uid(),'can_manage',journal_feedback_private.can_manage());
end $$;
create function public.journal_feedback_get(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v journal_feedback_private.threads;
begin
  perform journal_feedback_private.assert_active();
  select * into v from journal_feedback_private.threads where id=p_id;
  if not found then raise exception 'Ce retour est introuvable ou a été supprimé.'; end if;
  return journal_feedback_private.thread_json(v);
end $$;
create function public.journal_feedback_list(p_before_created_at timestamptz default null,p_before_id uuid default null,p_status text default null,p_category text default null,p_limit integer default 30)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_items jsonb;v_limit integer;v_more boolean;v_last jsonb;
begin
  perform journal_feedback_private.assert_active();
  if (p_before_created_at is null)<>(p_before_id is null) then raise exception 'Le curseur de pagination est incomplet.'; end if;
  if p_status is not null and p_status not in ('new','planned','in_progress','done') then raise exception 'Statut inconnu.'; end if;
  if p_category is not null and p_category not in ('bug','improvement') then raise exception 'Type de retour inconnu.'; end if;
  v_limit:=greatest(1,least(coalesce(p_limit,30),50));
  select coalesce(jsonb_agg(journal_feedback_private.thread_json(t) order by t.created_at desc,t.id desc),'[]'::jsonb)
    into v_items from (select t.* from journal_feedback_private.threads t
      where (p_before_created_at is null or (t.created_at,t.id)<(p_before_created_at,p_before_id))
        and (p_status is null or t.status=p_status) and (p_category is null or t.category=p_category)
      order by t.created_at desc,t.id desc limit v_limit+1) t;
  v_more:=jsonb_array_length(v_items)>v_limit;
  if v_more then v_items:=v_items-v_limit; end if;
  v_last:=v_items->(jsonb_array_length(v_items)-1);
  return jsonb_build_object('items',v_items,'next_cursor',case when v_more then jsonb_build_object('created_at',v_last->'created_at','id',v_last->'id') else null end);
end $$;
create function public.journal_feedback_replies(p_thread_id uuid,p_before_created_at timestamptz default null,p_before_id uuid default null,p_limit integer default 30)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_items jsonb;v_limit integer;v_more boolean;v_last jsonb;
begin
  perform journal_feedback_private.assert_active();
  if not exists(select 1 from journal_feedback_private.threads where id=p_thread_id) then raise exception 'Ce retour est introuvable ou a été supprimé.'; end if;
  if (p_before_created_at is null)<>(p_before_id is null) then raise exception 'Le curseur de pagination est incomplet.'; end if;
  v_limit:=greatest(1,least(coalesce(p_limit,30),50));
  select coalesce(jsonb_agg(journal_feedback_private.reply_json(t) order by t.created_at desc,t.id desc),'[]'::jsonb)
    into v_items from (select t.* from journal_feedback_private.replies t
      where t.thread_id=p_thread_id and (p_before_created_at is null or (t.created_at,t.id)<(p_before_created_at,p_before_id))
      order by t.created_at desc,t.id desc limit v_limit+1) t;
  v_more:=jsonb_array_length(v_items)>v_limit;
  if v_more then v_items:=v_items-v_limit; end if;
  v_last:=v_items->(jsonb_array_length(v_items)-1);
  return jsonb_build_object('items',v_items,'next_cursor',case when v_more then jsonb_build_object('created_at',v_last->'created_at','id',v_last->'id') else null end);
end $$;

create function public.journal_feedback_create_thread(p_id uuid,p_title text,p_body text,p_category text,p_image_path text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v journal_feedback_private.threads;v_meta jsonb;
begin
  perform journal_feedback_private.assert_active();
  perform journal_feedback_private.validate_thread(p_title,p_body,p_category);
  if p_id is null then raise exception 'Identifiant de retour manquant.'; end if;
  if p_image_path is not null then
    if not journal_feedback_private.valid_image_path(p_image_path,auth.uid(),p_id) then raise exception 'Le chemin de la capture est invalide.'; end if;
    select metadata into v_meta from storage.objects where bucket_id='journal-feedback-images' and name=p_image_path;
    if not found or not coalesce(v_meta->>'size' ~ '^[0-9]{1,8}$',false) then raise exception 'La capture doit être chargée avant de publier le retour.'; end if;
    if (v_meta->>'size')::bigint not between 1 and 5242880
      or coalesce(v_meta->>'mimetype','') not in ('image/jpeg','image/png','image/webp') then
      raise exception 'La capture doit être une image JPEG, PNG ou WebP de 5 Mo maximum.';
    end if;
  end if;
  insert into journal_feedback_private.threads(id,author_id,title,body,category,image_path)
    values(p_id,auth.uid(),btrim(p_title),btrim(p_body),p_category,p_image_path) on conflict(id) do nothing;
  select * into v from journal_feedback_private.threads where id=p_id for update;
  if v.author_id<>auth.uid() or v.title<>btrim(p_title) or v.body<>btrim(p_body)
    or v.category<>p_category or v.image_path is distinct from p_image_path then
    raise exception 'Cet identifiant correspond déjà à un autre retour. Rechargez avant de réessayer.';
  end if;
  return journal_feedback_private.thread_json(v);
end $$;
create function public.journal_feedback_update_thread(p_id uuid,p_title text,p_body text,p_category text,p_expected_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v journal_feedback_private.threads;
begin
  perform journal_feedback_private.assert_active();
  perform journal_feedback_private.validate_thread(p_title,p_body,p_category);
  select * into v from journal_feedback_private.threads where id=p_id for update;
  if not found then raise exception 'Ce retour est introuvable ou a été supprimé.'; end if;
  if v.author_id<>auth.uid() then raise exception using errcode='42501',message='Seul l’auteur peut modifier le texte de ce retour.'; end if;
  if p_expected_updated_at is distinct from v.updated_at then raise exception using errcode='40001',message='Ce retour a été modifié. Rechargez-le avant de réessayer.'; end if;
  update journal_feedback_private.threads set title=btrim(p_title),body=btrim(p_body),category=p_category,
    updated_at=greatest(clock_timestamp(),v.updated_at+interval '1 microsecond') where id=p_id returning * into v;
  return journal_feedback_private.thread_json(v);
end $$;
create function public.journal_feedback_set_status(p_id uuid,p_status text,p_expected_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v journal_feedback_private.threads;
begin
  perform journal_feedback_private.assert_active();
  if not journal_feedback_private.can_manage() then raise exception using errcode='42501',message='Seul un administrateur général peut changer le statut.'; end if;
  if p_status is null or p_status not in ('new','planned','in_progress','done') then raise exception 'Statut inconnu.'; end if;
  select * into v from journal_feedback_private.threads where id=p_id for update;
  if not found then raise exception 'Ce retour est introuvable ou a été supprimé.'; end if;
  if p_expected_updated_at is distinct from v.updated_at then raise exception using errcode='40001',message='Ce retour a été modifié. Rechargez-le avant de réessayer.'; end if;
  update journal_feedback_private.threads set status=p_status,updated_at=greatest(clock_timestamp(),v.updated_at+interval '1 microsecond') where id=p_id returning * into v;
  return journal_feedback_private.thread_json(v);
end $$;
create function public.journal_feedback_delete_thread(p_id uuid,p_expected_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v journal_feedback_private.threads;
begin
  perform journal_feedback_private.assert_active();
  select * into v from journal_feedback_private.threads where id=p_id for update;
  if not found then raise exception 'Ce retour est introuvable ou a été supprimé.'; end if;
  if v.author_id<>auth.uid() and not journal_feedback_private.can_manage() then raise exception using errcode='42501',message='Vous ne pouvez pas supprimer ce retour.'; end if;
  if p_expected_updated_at is distinct from v.updated_at then raise exception using errcode='40001',message='Ce retour a été modifié. Rechargez-le avant de réessayer.'; end if;
  delete from journal_feedback_private.threads where id=p_id;
  return jsonb_build_object('deleted',true,'id',p_id,'image_path',v.image_path);
end $$;
create function public.journal_feedback_create_reply(p_id uuid,p_thread_id uuid,p_body text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v journal_feedback_private.replies;
begin
  perform journal_feedback_private.assert_active();
  perform journal_feedback_private.validate_reply(p_body);
  if p_id is null then raise exception 'Identifiant de réponse manquant.'; end if;
  perform 1 from journal_feedback_private.threads where id=p_thread_id for key share;
  if not found then raise exception 'Ce retour est introuvable ou a été supprimé.'; end if;
  insert into journal_feedback_private.replies(id,thread_id,author_id,body)
    values(p_id,p_thread_id,auth.uid(),btrim(p_body)) on conflict(id) do nothing;
  select * into v from journal_feedback_private.replies where id=p_id for update;
  if v.author_id<>auth.uid() or v.thread_id<>p_thread_id or v.body<>btrim(p_body) then
    raise exception 'Cet identifiant correspond déjà à une autre réponse. Rechargez avant de réessayer.';
  end if;
  return journal_feedback_private.reply_json(v);
end $$;
create function public.journal_feedback_update_reply(p_id uuid,p_body text,p_expected_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v journal_feedback_private.replies;
begin
  perform journal_feedback_private.assert_active();
  perform journal_feedback_private.validate_reply(p_body);
  select * into v from journal_feedback_private.replies where id=p_id for update;
  if not found then raise exception 'Cette réponse est introuvable ou a été supprimée.'; end if;
  if v.author_id<>auth.uid() then raise exception using errcode='42501',message='Seul l’auteur peut modifier cette réponse.'; end if;
  if p_expected_updated_at is distinct from v.updated_at then raise exception using errcode='40001',message='Cette réponse a été modifiée. Rechargez-la avant de réessayer.'; end if;
  update journal_feedback_private.replies set body=btrim(p_body),updated_at=greatest(clock_timestamp(),v.updated_at+interval '1 microsecond') where id=p_id returning * into v;
  return journal_feedback_private.reply_json(v);
end $$;
create function public.journal_feedback_delete_reply(p_id uuid,p_expected_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v journal_feedback_private.replies;
begin
  perform journal_feedback_private.assert_active();
  select * into v from journal_feedback_private.replies where id=p_id for update;
  if not found then raise exception 'Cette réponse est introuvable ou a été supprimée.'; end if;
  if v.author_id<>auth.uid() and not journal_feedback_private.can_manage() then raise exception using errcode='42501',message='Vous ne pouvez pas supprimer cette réponse.'; end if;
  if p_expected_updated_at is distinct from v.updated_at then raise exception using errcode='40001',message='Cette réponse a été modifiée. Rechargez-la avant de réessayer.'; end if;
  delete from journal_feedback_private.replies where id=p_id;
  return jsonb_build_object('deleted',true,'id',p_id);
end $$;

-- Les restrictions ciblent uniquement ce nouveau bucket ; une ancienne politique
-- permissive ne doit autoriser ni lecture anonyme ni modification de captures publiées.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('journal-feedback-images','journal-feedback-images',false,5242880,array['image/jpeg','image/png','image/webp']);
create function public.journal_feedback_image_access(p_name text,p_operation text) returns boolean
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.journal_v142_is_active() then return false; end if;
  if p_operation='read' then
    return exists(select 1 from journal_feedback_private.threads where image_path=p_name)
      or journal_feedback_private.valid_image_path(p_name,auth.uid()) or journal_feedback_private.can_manage();
  elsif p_operation='insert' then
    return journal_feedback_private.valid_image_path(p_name,auth.uid())
      and not exists(select 1 from journal_feedback_private.threads where id::text=split_part(p_name,'/',2));
  elsif p_operation='delete' then
    return (journal_feedback_private.valid_image_path(p_name,auth.uid()) or journal_feedback_private.can_manage())
      and not exists(select 1 from journal_feedback_private.threads where image_path=p_name);
  end if;
  return false;
end $$;
create policy journal_feedback_images_read on storage.objects for select to authenticated
 using(bucket_id='journal-feedback-images' and public.journal_feedback_image_access(name,'read'));
create policy journal_feedback_images_insert on storage.objects for insert to authenticated
 with check(bucket_id='journal-feedback-images' and public.journal_feedback_image_access(name,'insert'));
create policy journal_feedback_images_delete on storage.objects for delete to authenticated
 using(bucket_id='journal-feedback-images' and public.journal_feedback_image_access(name,'delete'));
create policy journal_feedback_images_read_guard on storage.objects as restrictive for select to anon,authenticated
 using(bucket_id<>'journal-feedback-images' or public.journal_feedback_image_access(name,'read'));
create policy journal_feedback_images_insert_guard on storage.objects as restrictive for insert to anon,authenticated
 with check(bucket_id<>'journal-feedback-images' or public.journal_feedback_image_access(name,'insert'));
create policy journal_feedback_images_update_guard on storage.objects as restrictive for update to anon,authenticated
 using(bucket_id<>'journal-feedback-images') with check(bucket_id<>'journal-feedback-images');
create policy journal_feedback_images_delete_guard on storage.objects as restrictive for delete to anon,authenticated
 using(bucket_id<>'journal-feedback-images' or public.journal_feedback_image_access(name,'delete'));

revoke all on all functions in schema journal_feedback_private from public,anon,authenticated,service_role;
do $$ declare r record;begin
  for r in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname like 'journal_feedback_%' loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',r.signature);
    execute format('grant execute on function %s to authenticated',r.signature);
  end loop;
end $$;
-- L'évaluation des politiques anon doit renvoyer false, sans donner accès au fil.
grant execute on function public.journal_feedback_image_access(text,text) to anon;
select public.journal_v142_assert_account_cleanup_safe();
notify pgrst,'reload schema';
commit;
