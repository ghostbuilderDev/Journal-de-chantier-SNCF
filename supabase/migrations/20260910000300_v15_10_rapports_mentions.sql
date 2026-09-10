BEGIN;
-- V15.10. Shared daily reports and explicit mention routing. No existing CR or message is deleted.
create schema if not exists journal_report_private;
revoke all on schema journal_report_private from public,anon,authenticated;
create table if not exists journal_report_private.reports(
 id uuid primary key, chantier_id uuid not null references public.chantiers(id) on delete cascade,
 document jsonb not null, version integer not null default 1, state text not null default 'draft' check(state in ('draft','validated')),
 creator_id uuid not null, creator_name text not null, created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(), validated_by uuid, validated_name text, validated_at timestamptz
);
create table if not exists journal_report_private.participants(
 report_id uuid references journal_report_private.reports(id) on delete cascade,user_id uuid not null,can_edit boolean not null default true,
 primary key(report_id,user_id)
);
create table if not exists journal_report_private.history(
 id bigint generated always as identity primary key, report_id uuid not null references journal_report_private.reports(id) on delete cascade,
 actor_id uuid not null,actor_name text not null,event text not null,detail jsonb not null default '{}',created_at timestamptz not null default now()
);
create table if not exists journal_report_private.receipts(
 report_id uuid references journal_report_private.reports(id) on delete cascade,request_id uuid not null,actor_id uuid not null,fingerprint text not null,
 primary key(report_id,request_id)
);
alter table journal_report_private.reports enable row level security;
alter table journal_report_private.participants enable row level security;
alter table journal_report_private.history enable row level security;
alter table journal_report_private.receipts enable row level security;
create index if not exists journal_report_site on journal_report_private.reports(chantier_id,updated_at desc);
create index if not exists journal_report_user on journal_report_private.participants(user_id,report_id);
create or replace function journal_report_private.allowed(p_user uuid,p_id uuid,p_write boolean default false) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select journal_cr_private.member(p_user,r.chantier_id) and (not p_write or public.journal_v142_can_assign(p_user,r.chantier_id)) and (
 exists(select 1 from public.journal_administrators where user_id=p_user and role in ('proprietaire','administrateur_general')) or
 exists(select 1 from public.chantier_members where user_id=p_user and chantier_id=r.chantier_id and role='administrateur') or
 exists(select 1 from journal_report_private.participants where report_id=r.id and user_id=p_user and (not p_write or can_edit)))
 from journal_report_private.reports r where r.id=p_id),false);
$$;
alter table journal_cr_private.notifications add column if not exists daily_report_id uuid references journal_report_private.reports(id) on delete cascade;
alter table journal_cr_private.notifications add column if not exists actor_name text;
alter table journal_cr_private.notifications add column if not exists excerpt text;
alter table journal_cr_private.notifications add column if not exists is_mention boolean not null default false;
alter table journal_cr_private.notifications drop constraint if exists notifications_kind_check;
alter table journal_cr_private.notifications add constraint notifications_kind_check check(kind in ('message','cr','daily_report'));
do $$begin
 if to_regprocedure('journal_cr_private.notification_allowed_v159(journal_cr_private.notifications)') is null then alter function journal_cr_private.notification_allowed(journal_cr_private.notifications) rename to notification_allowed_v159;end if;
end$$;
create or replace function journal_cr_private.notification_allowed(n journal_cr_private.notifications) returns boolean language sql stable security definer set search_path='' as $$
 select case when n.kind='daily_report' then journal_report_private.allowed(n.user_id,n.daily_report_id,false) else journal_cr_private.notification_allowed_v159(n) end;
$$;
create or replace function journal_report_private.detail(p_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select to_jsonb(r)||jsonb_build_object('chantier',c.name,'can_edit',r.state='draft' and journal_report_private.allowed(auth.uid(),r.id,true),
 'participants',coalesce((select jsonb_agg(jsonb_build_object('id',a.user_id,'name',p.full_name,'can_edit',a.can_edit)) from journal_report_private.participants a left join public.profiles p on p.id=a.user_id where a.report_id=r.id),'[]'),
 'history',coalesce((select jsonb_agg(to_jsonb(h)-'report_id' order by h.id) from journal_report_private.history h where h.report_id=r.id),'[]'))
 from journal_report_private.reports r join public.chantiers c on c.id=r.chantier_id where r.id=p_id;
$$;
create or replace function public.journal_report_api(p_action text,p_payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
 declare uid uuid:=auth.uid();rid uuid:=(p_payload->>'id')::uuid;sid uuid:=(p_payload->>'chantier_id')::uuid;
 req uuid:=(p_payload->>'request_id')::uuid;r journal_report_private.reports;doc jsonb;users uuid[];target uuid;nid uuid;fingerprint text;receipt journal_report_private.receipts;
 begin
 if uid is null or not public.journal_v142_is_active() then raise exception 'Connexion active requise';end if;
 if octet_length(p_payload::text)>33554432 then raise exception 'Rapport trop volumineux (32 Mo maximum). La saisie locale est conservée.';end if;
 if p_action='directory' then
  if not journal_cr_private.member(uid,sid) then raise exception 'Chantier inaccessible';end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.full_name,'company',p.company,'can_assign',public.journal_v142_can_assign(p.id,sid)) order by p.full_name,p.id) from public.profiles p where journal_cr_private.member(p.id,sid)),'[]');
 elsif p_action='list' then
  return coalesce((select jsonb_agg(to_jsonb(q)) from (select r.id,r.chantier_id,c.name chantier,r.document->'meta'->>'reportNo' report_no,r.document->'meta'->>'date' report_date,r.state,r.version,r.updated_at from journal_report_private.reports r join public.chantiers c on c.id=r.chantier_id where (sid is null or r.chantier_id=sid) and journal_report_private.allowed(uid,r.id,false) order by r.updated_at desc limit 200)q),'[]');
 elsif p_action='create' then
  if rid is null or req is null or not public.journal_v142_can_write(sid) then raise exception 'Droits de contribution au chantier requis';end if;
  perform pg_advisory_xact_lock(hashtextextended(rid::text,1510));
  if not exists(select 1 from journal_report_private.reports where id=rid) then
   doc:=p_payload->'document';
   if jsonb_typeof(doc)<>'object' or doc->>'schema' is distinct from '1' or jsonb_typeof(doc->'meta') is distinct from 'object' then raise exception 'Format du rapport invalide';end if;
   doc:=(doc #- '{settings,admin}') - 'collaboration';
   insert into journal_report_private.reports(id,chantier_id,document,creator_id,creator_name) values(rid,sid,doc,uid,journal_cr_private.person());
   insert into journal_report_private.participants values(rid,uid,true);
   insert into journal_report_private.history(report_id,actor_id,actor_name,event) values(rid,uid,journal_cr_private.person(),'Création');
   insert into journal_report_private.receipts values(rid,req,uid,md5(p_action||p_payload::text));
   return journal_report_private.detail(rid);
  end if;
 end if;
 select * into r from journal_report_private.reports where id=rid for update;
 if not found or not journal_report_private.allowed(uid,rid,false) then raise exception 'Rapport inaccessible avec ce compte';end if;
 if p_action='detail' then return journal_report_private.detail(rid);end if;
 if req is null then raise exception 'Identifiant de sauvegarde requis';end if;
 fingerprint:=md5(p_action||p_payload::text);
 select * into receipt from journal_report_private.receipts where report_id=rid and request_id=req;
 if found then
  if receipt.actor_id<>uid or receipt.fingerprint<>fingerprint then raise exception 'Requête déjà utilisée avec une autre saisie';end if;
  return journal_report_private.detail(rid);
 end if;
 if not journal_report_private.allowed(uid,rid,true) or r.state<>'draft' then raise exception 'Rapport transféré ou validé : modification non autorisée';end if;
 if r.version is distinct from (p_payload->>'version')::integer then raise exception 'Un autre participant a modifié ce rapport. Rechargez la version partagée ; votre saisie locale est conservée.';end if;
 if p_action='save' then
  doc:=p_payload->'document';
  if jsonb_typeof(doc) is distinct from 'object' or doc->>'schema' is distinct from '1' or jsonb_typeof(doc->'meta') is distinct from 'object' then raise exception 'Format du rapport invalide';end if;
  doc:=(doc #- '{settings,admin}') - 'collaboration';
  update journal_report_private.reports set document=doc where id=rid;
  insert into journal_report_private.history(report_id,actor_id,actor_name,event) values(rid,uid,journal_cr_private.person(),'Contribution enregistrée');
 elsif p_action='transfer' then
  select array_agg(distinct value::uuid) into users from jsonb_array_elements_text(p_payload->'users');
  if coalesce(cardinality(users),0)<1 or cardinality(users)>30 then raise exception 'Choisir au moins un destinataire (30 maximum)';end if;
  foreach target in array users loop
   if target=uid or not public.journal_v142_can_assign(target,r.chantier_id) then raise exception 'Destinataire non autorisé à compléter ce chantier';end if;
  end loop;
  update journal_report_private.participants set can_edit=false where report_id=rid;
  foreach target in array users loop
   insert into journal_report_private.participants values(rid,target,true) on conflict(report_id,user_id) do update set can_edit=true;
   insert into journal_cr_private.notifications(user_id,chantier_id,kind,daily_report_id,title,actor_name,excerpt,dedup)
   values(target,r.chantier_id,'daily_report',rid,'Rapport journalier transféré',journal_cr_private.person(),left(r.document->'meta'->>'reportNo',100),'report:'||rid||':'||req||':'||target) returning id into nid;
   insert into journal_cr_private.pushes(notification_id,device_id) select nid,device_id from journal_cr_private.devices where user_id=target;
  end loop;
  insert into journal_report_private.history(report_id,actor_id,actor_name,event,detail) values(rid,uid,journal_cr_private.person(),'Transfert',jsonb_build_object('recipients',(select jsonb_agg(jsonb_build_object('id',id,'name',full_name)) from public.profiles where id=any(users))));
  perform journal_cr_private.kick();
 elsif p_action='validate' then
  if p_payload->>'confirmed' is distinct from 'true' then raise exception 'Confirmer la validation définitive';end if;
  if coalesce(r.document->'meta'->>'operation','')='' or coalesce(r.document->'meta'->>'date','')='' or coalesce(r.document->'meta'->>'reportNo','')='' then raise exception 'Renseigner opération, numéro et date du rapport';end if;
  if coalesce((r.document->'meta'->>'cancelled')::boolean,false) then
   if coalesce(r.document->'meta'->>'cancelReason','')='' then raise exception 'Préciser le motif d’annulation';end if;
  elsif jsonb_array_length(coalesce(r.document->'tasks','[]'))=0 then raise exception 'Ajouter les travaux réalisés avant validation';end if;
  update journal_report_private.reports set state='validated',validated_by=uid,validated_name=journal_cr_private.person(),validated_at=now() where id=rid;
  insert into journal_report_private.history(report_id,actor_id,actor_name,event) values(rid,uid,journal_cr_private.person(),'Validation définitive');
 else raise exception 'Opération inconnue';end if;
 update journal_report_private.reports set version=version+1,updated_at=now() where id=rid;
 insert into journal_report_private.receipts values(rid,req,uid,fingerprint);
 return journal_report_private.detail(rid);
 end;
$$;
-- All existing message writes retain their role checks. Mention recipients are checked here as well.
alter table public.chantier_messages add column if not exists mentioned_users uuid[] not null default '{}';
create or replace function journal_cr_private.message_notification() returns trigger language plpgsql security definer set search_path='' as $$
 declare u uuid;mentioned boolean;label text;nid uuid;token text;
 begin
 if new.deleted_at is not null then return new;end if;
 if array_position(new.mentioned_users,null) is not null then raise exception 'Mention invalide';end if;
 if cardinality(new.mentioned_users)>100 then raise exception '100 mentions maximum par message';end if;
 if exists(select 1 from unnest(new.mentioned_users) x where not journal_cr_private.member(x,new.chantier_id)) then raise exception 'Une personne mentionnée ne fait plus partie du chantier';end if;
 for u in select user_id from public.chantier_members where chantier_id=new.chantier_id union select user_id from public.journal_administrators where role in ('proprietaire','administrateur_general') loop
  if u=new.author_id or not journal_cr_private.member(u,new.chantier_id) then continue;end if;
  select full_name into label from public.profiles where id=u;
  token:='@'||regexp_replace(trim(coalesce(label,'')),'\s+','.','g');
  -- Legacy clients can still mention a full name. Compare complete tokens, never name prefixes.
  mentioned:=u=any(new.mentioned_users) or (' '||lower(coalesce(new.body,''))||' ') ~ ('(^|[[:space:]])'||regexp_replace(lower(token),'([.\\+*?\[\](){}^$|])','\\\1','g')||'([[:space:],;:!?]|$)');
  if tg_op='UPDATE' and not mentioned then continue;end if;
  perform journal_cr_private.notify(u,new.chantier_id,null,null,new.id,case when mentioned then 'Vous avez été mentionné(e)' else 'Nouveau message' end,'message:'||new.id||':'||u);
  update journal_cr_private.notifications set actor_name=(select full_name from public.profiles where id=new.author_id),excerpt=left(new.body,220),
   title=case when mentioned then 'Vous avez été mentionné(e)' else title end,
   read_at=case when mentioned and not is_mention then null else read_at end,
   created_at=case when mentioned and not is_mention then now() else created_at end,is_mention=is_mention or mentioned
   where dedup='message:'||new.id||':'||u;
 end loop;
 return new;
 end;
$$;
drop trigger if exists journal_v15_message_notification on public.chantier_messages;
create trigger journal_v15_message_notification after insert or update of body,mentioned_users on public.chantier_messages for each row execute function journal_cr_private.message_notification();
revoke all on all tables in schema journal_report_private from public,anon,authenticated;
revoke all on all functions in schema journal_report_private from public,anon,authenticated;
revoke all on function journal_cr_private.notification_allowed_v159(journal_cr_private.notifications) from public,anon,authenticated;
revoke all on function public.journal_report_api(text,jsonb) from public,anon;
grant execute on function public.journal_report_api(text,jsonb) to authenticated;

revoke all on function journal_cr_private.notification_allowed(journal_cr_private.notifications) from public,anon,authenticated;

-- Preserve all existing CR APIs; prioritize unread personal alerts over ordinary feed activity.
do $$begin
 if to_regprocedure('journal_cr_private.api_v159(text,jsonb)') is null then
  alter function public.journal_cr_api(text,jsonb) set schema journal_cr_private;
  alter function journal_cr_private.journal_cr_api(text,jsonb) rename to api_v159;
 end if;
end$$;
create or replace function public.journal_cr_api(p_action text,p_payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
 begin
 if auth.uid() is null or not public.journal_v142_is_active() then raise exception 'Connexion active requise';end if;
 if p_action='inbox' then
  return coalesce((select jsonb_agg(to_jsonb(q) order by q.created_at desc) from (
   select n.* from journal_cr_private.notifications n where n.user_id=auth.uid() and journal_cr_private.notification_allowed(n)
   order by case when n.read_at is null and (n.is_mention or n.kind='daily_report') then 0 else 1 end,n.created_at desc limit 200)q),'[]');
 elsif p_action='notification' then
  return (select to_jsonb(n) from journal_cr_private.notifications n where n.id=(p_payload->>'id')::uuid and n.user_id=auth.uid() and journal_cr_private.notification_allowed(n));
 end if;
 return journal_cr_private.api_v159(p_action,p_payload);
 end;
$$;
revoke all on function journal_cr_private.api_v159(text,jsonb) from public,anon,authenticated;
revoke all on function public.journal_cr_api(text,jsonb) from public,anon;
grant execute on function public.journal_cr_api(text,jsonb) to authenticated;

COMMIT;
