-- V15.4: one shared production entry, immutable CR snapshots, email preview.
-- Additive; no historical messages, recipients or validated versions removed.
create table if not exists journal_cr_private.production_sheets(
 id uuid primary key, chantier_id uuid not null references public.chantiers(id) on delete cascade,
 night date not null, message_id uuid not null unique, items jsonb not null,
 version integer not null default 1, author_id uuid not null, author_name text not null,
 updated_by uuid not null, updated_name text not null, updated_at timestamptz not null default now(),
 created_at timestamptz not null default now()
);
create index if not exists production_night on journal_cr_private.production_sheets(chantier_id,night);
create table if not exists journal_cr_private.production_history(
 id bigint generated always as identity primary key, sheet_id uuid not null references journal_cr_private.production_sheets(id) on delete cascade,
 version integer not null, items jsonb not null, actor_name text not null, created_at timestamptz not null default now()
);
alter table public.chantier_messages add column if not exists production_id uuid;
alter table public.chantier_messages add column if not exists production_night date;
revoke all on journal_cr_private.production_sheets,journal_cr_private.production_history from public,anon,authenticated,service_role;

create or replace function journal_cr_private.production_text(p_items jsonb) returns text language sql immutable set search_path='' as $$
 select coalesce(string_agg(' • '||(x->>'title')||' — '||case when x->>'progress' is null then 'avancement à confirmer' else (x->>'progress')||' % réalisé' end||case when (x->>'additional')::boolean then ' (travail ajouté)' else '' end,E'\n' order by ord),'')
 from jsonb_array_elements(p_items) with ordinality q(x,ord);
$$;
create or replace function journal_cr_private.sync_production(p_site uuid,p_night date) returns void language plpgsql security definer set search_path='' as $$
declare sheets jsonb;lines jsonb;complete boolean;
begin
 select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at,p.id),'[]') into sheets from journal_cr_private.production_sheets p where chantier_id=p_site and night=p_night;
 if jsonb_array_length(sheets)=0 then return;end if;
 select jsonb_agg(x),bool_and(x->>'progress' is not null) into lines,complete from jsonb_array_elements(sheets) s cross join lateral jsonb_array_elements(s->'items') x;
 update journal_cr_private.sections s set value=s.value||jsonb_build_object('production_sheets',sheets,'production_text',journal_cr_private.production_text(lines)),
 status=case when complete then 'complete' else 'en_cours' end,version=s.version+1
 from journal_cr_private.reports r where s.report_id=r.id and s.key='technique' and r.chantier_id=p_site and r.night=p_night and r.state='draft'
 and (s.value->'production_sheets' is distinct from sheets or s.status<>case when complete then 'complete' else 'en_cours' end);
end $$;

create or replace function public.journal_production_api(p_action text,p_payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();sid uuid:=(p_payload->>'chantier_id')::uuid;d date:=(p_payload->>'night')::date;
 pid uuid;mid uuid;old journal_cr_private.production_sheets;v_items jsonb:=p_payload->'items';x jsonb;v_body text;v integer;res jsonb;
begin
 if uid is null or sid is null or d is null or not journal_cr_private.member(uid,sid) then raise exception 'Production inaccessible';end if;
 if p_action='list' then
  return (select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('history',(select coalesce(jsonb_agg(to_jsonb(h) order by h.version desc),'[]') from journal_cr_private.production_history h where h.sheet_id=p.id)) order by p.created_at,p.id),'[]') from journal_cr_private.production_sheets p where chantier_id=sid and night=d);
 end if;
 if p_action<>'save' or not public.journal_v142_can_write(sid) then raise exception 'Accès en écriture requis';end if;
 perform pg_advisory_xact_lock(hashtextextended(sid::text||d::text,0));
 if exists(select 1 from journal_cr_private.reports where chantier_id=sid and night=d and state<>'draft') then raise exception 'CR déjà validé : demander un rectificatif à l’encadrant avant de modifier la production';end if;
 if jsonb_typeof(v_items) is distinct from 'array' or jsonb_array_length(v_items) not between 1 and 60 then raise exception 'Indiquer entre 1 et 60 travaux';end if;
 for x in select * from jsonb_array_elements(v_items) loop
  if length(trim(coalesce(x->>'title',''))) not between 1 and 500 then raise exception 'Chaque travail doit avoir un intitulé (500 caractères maximum)';end if;
  if x->>'progress' is not null and (jsonb_typeof(x->'progress')<>'number' or (x->>'progress')::numeric not between 0 and 100) then raise exception 'Avancement attendu entre 0 et 100 %%';end if;
  if jsonb_typeof(x->'additional') is distinct from 'boolean' then raise exception 'Type de travail invalide';end if;
 end loop;
 select jsonb_agg(jsonb_build_object('title',trim(q.item->>'title'),'progress',q.item->'progress','additional',q.item->'additional') order by q.ord) into v_items from jsonb_array_elements(v_items) with ordinality q(item,ord);
 pid:=(p_payload->>'id')::uuid;if pid is null then raise exception 'Référence de production requise';end if;
 select * into old from journal_cr_private.production_sheets where id=pid for update;
 if found then
  if old.chantier_id<>sid or old.night<>d then raise exception 'Production inaccessible';end if;
  -- Lost response retries return the existing record instead of duplicating it.
  if old.items=v_items then return to_jsonb(old);end if;
  if old.version<>coalesce((p_payload->>'version')::integer,0) then raise exception 'Production modifiée par un collègue. Rouvrir avant de compléter';end if;
  mid:=old.message_id;v:=old.version+1;
  update journal_cr_private.production_sheets set items=v_items,version=v,updated_by=uid,updated_name=journal_cr_private.person(),updated_at=now() where id=pid;
 else
  if coalesce((p_payload->>'version')::integer,0)<>0 then raise exception 'Production introuvable';end if;
  mid:=gen_random_uuid();v:=1;
  insert into journal_cr_private.production_sheets(id,chantier_id,night,message_id,items,author_id,author_name,updated_by,updated_name)
  values(pid,sid,d,mid,v_items,uid,journal_cr_private.person(),uid,journal_cr_private.person());
 end if;
 v_body:='Production · séance du '||to_char(d,'DD/MM/YYYY')||E'\n'||journal_cr_private.production_text(v_items);
 if old.id is null then
  insert into public.chantier_messages(id,chantier_id,author_id,author_name,body,message_type,production_id,production_night) values(mid,sid,uid,journal_cr_private.person(),v_body,'Production',pid,d);
 else
  update public.chantier_messages set body='Production · séance du '||to_char(d,'DD/MM/YYYY')||E'\n'||journal_cr_private.production_text(v_items),edited_at=now() where id=mid;
 end if;
 insert into journal_cr_private.production_history(sheet_id,version,items,actor_name) values(pid,v,v_items,journal_cr_private.person());
 perform journal_cr_private.sync_production(sid,d);
 select to_jsonb(p) into res from journal_cr_private.production_sheets p where id=pid;return res;
end $$;
revoke all on function public.journal_production_api(text,jsonb) from public,anon,service_role;
grant execute on function public.journal_production_api(text,jsonb) to authenticated;

do $$ begin
 if to_regprocedure('journal_cr_private.api_v153(text,jsonb)') is null then alter function public.journal_cr_api(text,jsonb) set schema journal_cr_private;alter function journal_cr_private.journal_cr_api(text,jsonb) rename to api_v153;end if;
 if to_regprocedure('journal_cr_private.email_text_v153(jsonb)') is null then alter function journal_cr_private.email_text(jsonb) rename to email_text_v153;end if;
end $$;
create or replace function journal_cr_private.email_text(p_snapshots jsonb) returns text language plpgsql stable set search_path='' as $$
declare r jsonb;s jsonb;sections jsonb;reports jsonb:='[]';
begin
 for r in select * from jsonb_array_elements(p_snapshots) loop
  sections:='[]';
  for s in select * from jsonb_array_elements(r->'sections') loop
   if s->>'key'='technique' and coalesce(s#>>'{value,production_text}','')<>'' then
    s:=jsonb_set(s,'{value,body}',to_jsonb(concat_ws(E'\n',s#>>'{value,production_text}',nullif(s#>>'{value,body}',''))));
   end if;sections:=sections||jsonb_build_array(s);
  end loop;
  reports:=reports||jsonb_build_array(jsonb_set(r,'{sections}',sections));
 end loop;
 return journal_cr_private.email_text_v153(reports);
end $$;
create or replace function public.journal_cr_api(p_action text,p_payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare result jsonb;r journal_cr_private.reports;rid uuid;ids uuid[];snapshots jsonb:='[]';recipients jsonb;one jsonb;sheet jsonb;sid uuid;night date;existed boolean;
begin
 if auth.uid() is null then raise exception 'Connexion requise';end if;
 if p_action='email_access' then
  sid:=(p_payload->>'chantier_id')::uuid;if not journal_cr_private.manager(sid) then raise exception 'Réservé à l’encadrant';end if;return jsonb_build_object('allowed',true);
 elsif p_action='preview' then
  select array_agg(distinct x::uuid order by x::uuid) into ids from jsonb_array_elements_text(p_payload->'ids') x;
  if coalesce(cardinality(ids),0) not between 1 and 20 then raise exception 'Sélectionner des CR validés';end if;
  foreach rid in array ids loop
   select * into r from journal_cr_private.reports where id=rid;
   if not found or not journal_cr_private.manager(r.chantier_id) or r.state not in ('validated','sent') then raise exception 'Sélectionner des CR validés accessibles';end if;
   select data into one from journal_cr_private.snapshots where report_id=rid and revision=r.revision;
   if one is null or jsonb_array_length(r.recipients)=0 then raise exception 'Version validée ou destinataires manquants';end if;
   if recipients is not null and recipients<>r.recipients then raise exception 'Ces CR n’ont pas les mêmes destinataires';end if;
   recipients:=r.recipients;snapshots:=snapshots||jsonb_build_array(one);
  end loop;
  select jsonb_agg(s0.data order by r0.night,c.name) into snapshots from journal_cr_private.reports r0 join public.chantiers c on c.id=r0.chantier_id join journal_cr_private.snapshots s0 on s0.report_id=r0.id and s0.revision=r0.revision where r0.id=any(ids);
  return jsonb_build_object('recipients',recipients,'subject','CR encadrement · '||cardinality(ids)||' chantier(s)','body',journal_cr_private.email_text(snapshots));
 end if;
 if p_action='create' then
  sid:=(p_payload->>'chantier_id')::uuid;night:=(p_payload->>'night')::date;
  perform pg_advisory_xact_lock(hashtextextended(sid::text||night::text,0));
  select exists(select 1 from journal_cr_private.reports r0 where r0.chantier_id=sid and r0.night=night) into existed;
 end if;
 if p_action in ('validate','production_save','production_progress') then
  rid:=(p_payload->>'id')::uuid;select * into r from journal_cr_private.reports where id=rid;
  if not found or not journal_cr_private.section_access(rid,'technique') and p_action<>'validate' then raise exception 'Production inaccessible';end if;
  if p_action='validate' and not journal_cr_private.manager(r.chantier_id) then raise exception 'Validation réservée à l’encadrant';end if;
  perform pg_advisory_xact_lock(hashtextextended(r.chantier_id::text||r.night::text,0));
  if p_action='production_progress' then
   if r.state<>'draft' then raise exception 'CR figé : créer un rectificatif';end if;
   if (select version from journal_cr_private.sections where report_id=rid and key='technique')<>coalesce((p_payload->>'version')::integer,-1) then raise exception 'Production modifiée par un collègue. Rouvrir avant de compléter';end if;
   for sheet in select * from jsonb_array_elements(p_payload->'sheets') loop
    perform public.journal_production_api('save',sheet||jsonb_build_object('chantier_id',r.chantier_id,'night',r.night));
   end loop;
   if length(trim(coalesce(p_payload->>'body','')))>0 then perform journal_cr_private.api_v153('production_save',p_payload||jsonb_build_object('key','technique','version',(select version from journal_cr_private.sections where report_id=rid and key='technique')));end if;
   if length(trim(coalesce(p_payload->>'body','')))=0 then update journal_cr_private.sections set value=value-'body' where report_id=rid and key='technique';end if;
   perform journal_cr_private.sync_production(r.chantier_id,r.night);return '{}';
  end if;
  perform journal_cr_private.sync_production(r.chantier_id,r.night);
  if p_action='validate' and exists(select 1 from journal_cr_private.production_sheets p cross join lateral jsonb_array_elements(p.items) x where p.chantier_id=r.chantier_id and p.night=r.night and x->>'progress' is null) then raise exception 'Production réalisée : renseigner le pourcentage de chaque travail (0 %% si non réalisé)';end if;
 end if;
 result:=journal_cr_private.api_v153(p_action,p_payload);
 if p_action='create' then
  rid:=(result->>'id')::uuid;select * into r from journal_cr_private.reports where id=rid;
  perform journal_cr_private.sync_production(r.chantier_id,r.night);
  -- A new test CR never silently copies yesterday's recipients.
  if coalesce((p_payload->>'test_audience')::boolean,false) and not existed then update journal_cr_private.reports set recipients='[]' where id=rid;end if;
 elsif p_action='production_save' then perform journal_cr_private.sync_production(r.chantier_id,r.night);
 end if;
 return result;
end $$;
revoke all on function public.journal_cr_api(text,jsonb) from public,anon,service_role;
grant execute on function public.journal_cr_api(text,jsonb) to authenticated;
revoke all on all functions in schema journal_cr_private from public,anon,authenticated,service_role;
NOTIFY pgrst, 'reload schema';
