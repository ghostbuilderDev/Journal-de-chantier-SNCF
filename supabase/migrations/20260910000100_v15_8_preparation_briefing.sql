BEGIN;
-- V15.8: explicit CR preparation copy and briefing attendance sessions.
alter table journal_cr_private.reports add column if not exists preparation_key uuid;
alter table journal_cr_private.reports add column if not exists copied_from uuid;
create unique index if not exists cr_preparation_key on journal_cr_private.reports(preparation_key) where preparation_key is not null;
do $$ begin
 if to_regprocedure('journal_cr_private.api_v157(text,jsonb)') is null then
  alter function public.journal_cr_api(text,jsonb) set schema journal_cr_private;
  alter function journal_cr_private.journal_cr_api(text,jsonb) rename to api_v157;
 end if;
end $$;
create or replace function public.journal_cr_api(p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare sid uuid;d date;src journal_cr_private.reports;existing journal_cr_private.reports;rid uuid;request_key uuid;x jsonb;k text;result jsonb;fresh boolean;
begin
 if auth.uid() is null or not public.journal_v142_is_active() then raise exception 'Connexion active requise';end if;
 if octet_length(p_payload::text)>300000 then raise exception 'Demande trop volumineuse';end if;
 if p_action in ('previous_options','copy_previous') then
  sid:=(p_payload->>'chantier_id')::uuid;d:=(p_payload->>'night')::date;
  if not journal_cr_private.manager(sid) or not journal_cr_private.member(auth.uid(),sid) then raise exception 'Préparation réservée aux administrateurs du chantier';end if;
  if d is null or d not between current_date-366 and current_date+31 then raise exception 'Date de nuit invalide';end if;
  if p_action='previous_options' then
   return (select coalesce(jsonb_agg(to_jsonb(q)),'[]') from (select id,night,state from journal_cr_private.reports where chantier_id=sid and night<d and deleted_at is null order by night desc limit 40) q);
  end if;
  request_key:=(p_payload->>'request_id')::uuid;
  if request_key is null then raise exception 'Identifiant de préparation requis';end if;
  perform pg_advisory_xact_lock(hashtextextended(sid::text||d::text,0));
  select * into existing from journal_cr_private.reports where chantier_id=sid and night=d;
  if found then
   if existing.preparation_key=request_key and existing.copied_from=(p_payload->>'source_id')::uuid and existing.deleted_at is null then return jsonb_build_object('id',existing.id);end if;
   raise exception 'Un CR existe déjà pour cette nuit. Ouvrez-le pour éviter d’écraser ses saisies.';
  end if;
  select * into src from journal_cr_private.reports where id=(p_payload->>'source_id')::uuid and chantier_id=sid and night<d and deleted_at is null for share;
  if not found then raise exception 'La saisie précédente est indisponible sur ce chantier';end if;
  rid:=journal_cr_private.ensure_report(sid,d,auth.uid());
  update journal_cr_private.reports set preparation_key=request_key,copied_from=src.id where id=rid;
  foreach k in array array['catenaire','itc'] loop
   select jsonb_build_object('rows',coalesce(jsonb_agg(jsonb_build_object('label',t.label,'track',t.track,
    'planned_start',journal_cr_private.shift_hour(t.planned_start,d-src.night),'planned_end',journal_cr_private.shift_hour(t.planned_end,d-src.night)) order by t.label,t.id),'[]')) into x
   from journal_cr_private.timings t where t.report_id=src.id and t.section_key=k and t.active;
   perform journal_cr_private.apply_field(rid,k,x);
  end loop;
  update journal_cr_private.sections s set responsible=case when journal_cr_private.member(old.responsible,sid) then old.responsible end
   from journal_cr_private.sections old where s.report_id=rid and old.report_id=src.id and old.key=s.key and s.key in ('catenaire','itc','arf');
  -- ARF starts empty; no results, notes, requests, status, validation or audit copied.
  perform journal_cr_private.log(rid,'configuration_reprise',null,jsonb_build_object('source_id',src.id,'source_night',src.night));
  perform journal_cr_private.sync_production(sid,d);
  return jsonb_build_object('id',rid);
 end if;
 -- Old clients may still send planned ARF values. Ignore them for new saves.
 if p_action in ('field_configure','task_save','task_submit') then
  k:=p_payload->>'key';
  if p_action in ('task_save','task_submit') then select section_key into k from journal_cr_private.field_requests where id=(p_payload->>'task_id')::uuid;end if;
  if k='arf' then p_payload:=jsonb_set(p_payload,'{data}',coalesce(p_payload->'data','{}')||'{"planned_start":null,"planned_end":null}')||'{"remember_week":false}';end if;
 end if;
 if p_action='create' then
  fresh:=not exists(select 1 from journal_cr_private.reports where chantier_id=(p_payload->>'chantier_id')::uuid and night=(p_payload->>'night')::date);
 end if;
 result:=journal_cr_private.api_v157(p_action,p_payload);
 if p_action='create' and fresh then
  update journal_cr_private.sections set value=value-'planned_start'-'planned_end',due_at=null where report_id=(result->>'id')::uuid and key='arf';
 end if;
 return result;
end $$;
revoke all on function journal_cr_private.api_v157(text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.journal_cr_api(text,jsonb) from public,anon,service_role;
grant execute on function public.journal_cr_api(text,jsonb) to authenticated;

create schema if not exists journal_briefing_private;
revoke all on schema journal_briefing_private from public,anon,authenticated,service_role;
create table if not exists journal_briefing_private.sessions (
 id uuid primary key,chantier_id uuid not null references public.chantiers(id) on delete cascade,
 created_by uuid not null,briefing_date date not null,title text not null,token_hash text not null unique,
 state text not null default 'open' check(state in ('open','closed')),expires_at timestamptz not null default now()+interval '18 hours',
 created_at timestamptz not null default now(),closed_at timestamptz
);
create table if not exists journal_briefing_private.signatures (
 id uuid primary key,session_id uuid not null references journal_briefing_private.sessions(id) on delete cascade,
 nom text not null,prenom text not null,fonction text not null,entreprise text not null,signature text not null,
 created_at timestamptz not null default now()
);
create index if not exists briefing_signature_session on journal_briefing_private.signatures(session_id,created_at,id);
alter table journal_briefing_private.sessions enable row level security;
alter table journal_briefing_private.signatures enable row level security;
revoke all on all tables in schema journal_briefing_private from public,anon,authenticated,service_role;

-- Organizer transport only. A participant with the QR token cannot call this API.
create or replace function public.journal_briefing_manage(p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare s journal_briefing_private.sessions;sid uuid;token text;n integer;
begin
 if auth.uid() is null or not public.journal_v142_is_active() then raise exception 'Connexion active requise';end if;
 if octet_length(p_payload::text)>8000 then raise exception 'Demande trop volumineuse';end if;
 if p_action='open' then
  sid:=(p_payload->>'chantier_id')::uuid;
  if not public.journal_v142_can_write(sid) then raise exception 'Droit de contribution au chantier requis';end if;
  token:=p_payload->>'token';
  if token is null or token !~ '^[0-9a-f]{64}$' then raise exception 'Lien de signature invalide';end if;
  if length(trim(coalesce(p_payload->>'title',''))) not between 1 and 180 then raise exception 'Intitulé du briefing requis';end if;
  if (p_payload->>'date')::date is null or (p_payload->>'date')::date not between current_date-1 and current_date+7 then raise exception 'Vérifier la date du briefing';end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':briefing-open',0));
  select count(*) into n from journal_briefing_private.sessions where created_by=auth.uid() and created_at>now()-interval '1 day';
  if n>=100 and not exists(select 1 from journal_briefing_private.sessions where id=(p_payload->>'id')::uuid) then raise exception 'Trop de séances créées aujourd’hui';end if;
  insert into journal_briefing_private.sessions(id,chantier_id,created_by,briefing_date,title,token_hash)
   values((p_payload->>'id')::uuid,sid,auth.uid(),(p_payload->>'date')::date,trim(p_payload->>'title'),encode(sha256(convert_to(token,'UTF8')),'hex')) on conflict(id) do nothing;
 end if;
 select * into s from journal_briefing_private.sessions where id=(p_payload->>'id')::uuid for update;
 if not found or not public.journal_v142_can_write(s.chantier_id) or not (s.created_by=auth.uid() or public.journal_can_manage_chantier_documents(s.chantier_id)) then raise exception 'Séance inaccessible';end if;
 if p_action='open' and (s.chantier_id<>sid or s.created_by<>auth.uid() or s.token_hash<>encode(sha256(convert_to(token,'UTF8')),'hex') or s.briefing_date<>(p_payload->>'date')::date) then raise exception 'Cette séance correspond à une autre préparation';end if;
 if p_action='close' then update journal_briefing_private.sessions set state='closed',closed_at=coalesce(closed_at,now()) where id=s.id returning * into s;
 elsif p_action not in ('open','poll') then raise exception 'Opération inconnue';end if;
 return (to_jsonb(s)-'token_hash')||jsonb_build_object('signatures',(select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at,p.id),'[]') from journal_briefing_private.signatures p where p.session_id=s.id));
end $$;
revoke all on function public.journal_briefing_manage(text,jsonb) from public,anon,service_role;
grant execute on function public.journal_briefing_manage(text,jsonb) to authenticated;

-- Capability-limited public endpoint: only session title/date or one's own submit receipt.
create or replace function public.journal_briefing_sign(p_token text,p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare s journal_briefing_private.sessions;v journal_briefing_private.signatures;bytes bytea;key text;v_id uuid;w bigint;h bigint;
begin
 if p_token is null or p_token !~ '^[0-9a-f]{64}$' or octet_length(p_payload::text)>120000 then raise exception 'Lien ou saisie invalide';end if;
 select * into s from journal_briefing_private.sessions where token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex') for update;
 if not found then raise exception 'Lien de signature inconnu';end if;
 if not journal_cr_private.member(s.created_by,s.chantier_id) then raise exception 'Émargement indisponible';end if;
 if p_action='context' then return jsonb_build_object('id',s.id,'title',s.title,'date',s.briefing_date,'chantier',(select name from public.chantiers where id=s.chantier_id),'open',s.state='open' and s.expires_at>now());end if;
 if p_action<>'submit' then raise exception 'Opération inconnue';end if;
 v_id:=(p_payload->>'id')::uuid;
 if v_id is null then raise exception 'Identifiant de signature requis';end if;
 select * into v from journal_briefing_private.signatures where signatures.id=v_id;
 if found then
  if v.session_id<>s.id or v.nom<>trim(coalesce(p_payload->>'nom','')) or v.prenom<>trim(coalesce(p_payload->>'prenom','')) or v.fonction<>trim(coalesce(p_payload->>'fonction','')) or v.entreprise<>trim(coalesce(p_payload->>'entreprise','')) or v.signature<>coalesce(p_payload->>'signature','') then raise exception 'Cette validation a déjà été utilisée';end if;
  return jsonb_build_object('id',v.id,'received',true);
 end if;
 if s.state<>'open' or s.expires_at<=now() then raise exception 'L’émargement de cette séance est fermé';end if;
 if (select count(*) from journal_briefing_private.signatures where session_id=s.id)>=300 then raise exception 'Capacité de la séance atteinte';end if;
 foreach key in array array['nom','prenom','fonction','entreprise'] loop
  if length(trim(coalesce(p_payload->>key,''))) not between 1 and 120 or p_payload->>key ~ '[[:cntrl:]<>]' then raise exception 'Renseigner correctement le champ %',key;end if;
 end loop;
 if coalesce(p_payload->>'signature','') !~ '^data:image/png;base64,[A-Za-z0-9+/=]+$' then raise exception 'Signature PNG requise';end if;
 bytes:=decode(substr(p_payload->>'signature',23),'base64');
 if octet_length(bytes) not between 100 and 85000 or encode(substring(bytes from 1 for 8),'hex')<>'89504e470d0a1a0a' then raise exception 'Signature invalide ou trop volumineuse';end if;
 w:=get_byte(bytes,16)::bigint*16777216+get_byte(bytes,17)*65536+get_byte(bytes,18)*256+get_byte(bytes,19);
 h:=get_byte(bytes,20)::bigint*16777216+get_byte(bytes,21)*65536+get_byte(bytes,22)*256+get_byte(bytes,23);
 if w not between 1 and 1600 or h not between 1 and 800 then raise exception 'Dimensions de signature invalides';end if;
 insert into journal_briefing_private.signatures(id,session_id,nom,prenom,fonction,entreprise,signature)
  values(v_id,s.id,trim(p_payload->>'nom'),trim(p_payload->>'prenom'),trim(p_payload->>'fonction'),trim(p_payload->>'entreprise'),p_payload->>'signature');
 return jsonb_build_object('id',v_id,'received',true);
end $$;
revoke all on function public.journal_briefing_sign(text,text,jsonb) from public,service_role;
grant execute on function public.journal_briefing_sign(text,text,jsonb) to anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
