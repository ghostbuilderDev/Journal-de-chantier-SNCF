BEGIN;
-- V15.5: private supervision, explicit submission, recoverable removal, manual PDF.
alter table journal_cr_private.reports add column if not exists deleted_at timestamptz;
alter table journal_cr_private.reports add column if not exists deleted_by uuid;
alter table journal_cr_private.timings add column if not exists track text not null default '';
alter table journal_cr_private.week_plans add column if not exists responsible uuid;
create table if not exists journal_cr_private.field_requests (
 id uuid primary key default gen_random_uuid(), report_id uuid not null references journal_cr_private.reports(id) on delete cascade,
 section_key text not null check(section_key in ('catenaire','itc','arf','technique')),
 user_id uuid not null, state text not null default 'open' check(state in ('open','submitted')),
 draft jsonb not null default '{}', version integer not null default 1, base_version integer not null,
 generation integer not null default 1, dismissed_token text not null default '', muted boolean not null default false,
 correction text not null default '', reminder_for timestamptz, requested_at timestamptz not null default now(),
 saved_at timestamptz, submitted_at timestamptz, submitted_by uuid,
 unique(report_id,section_key)
);
do $$ begin
 if to_regprocedure('journal_cr_private.api_v154(text,jsonb)') is null then
  alter function public.journal_cr_api(text,jsonb) set schema journal_cr_private;
  alter function journal_cr_private.journal_cr_api(text,jsonb) rename to api_v154;
 end if;
 if to_regprocedure('journal_cr_private.production_api_v154(text,jsonb)') is null then
  alter function public.journal_production_api(text,jsonb) set schema journal_cr_private;
  alter function journal_cr_private.journal_production_api(text,jsonb) rename to production_api_v154;
 end if;
end $$;

create or replace function journal_cr_private.full_access(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select r.deleted_at is null and journal_cr_private.member(auth.uid(),r.chantier_id)
 and journal_cr_private.manager(r.chantier_id) from journal_cr_private.reports r where r.id=p_id),false);
$$;
create or replace function journal_cr_private.section_access(p_id uuid,p_key text) returns boolean language sql stable security definer set search_path='' as $$
 select journal_cr_private.full_access(p_id) or exists(select 1 from journal_cr_private.field_requests q
 join journal_cr_private.reports r on r.id=q.report_id where q.report_id=p_id and q.section_key=p_key and q.user_id=auth.uid()
 and q.state='open' and r.state='draft' and r.deleted_at is null and journal_cr_private.member(auth.uid(),r.chantier_id));
$$;

create or replace function journal_cr_private.field_data(p_id uuid,p_key text) returns jsonb language sql stable set search_path='' as $$
 select case when p_key in ('catenaire','itc') then jsonb_build_object('rows',coalesce((select jsonb_agg(jsonb_build_object(
 'id',t.id,'version',t.version,'label',t.label,'track',t.track,'selected',true,'planned_start',t.planned_start,'planned_end',t.planned_end,
 'start',t.actual_start,'end',t.actual_end,'comment',t.comment,'non_concerne',t.status='non_concerne') order by t.label,t.id)
 from journal_cr_private.timings t where t.report_id=p_id and t.section_key=p_key and t.active),'[]'))
 when p_key='arf' then jsonb_build_object('planned_start',s.value->'planned_start','planned_end',s.value->'planned_end',
 'start',s.value->'start','end',s.value->'end','comment',coalesce(s.value->>'precision',''),'non_concerne',s.status='non_concerne')
 else jsonb_build_object('mode',coalesce(s.value->>'production_mode',case when jsonb_array_length(coalesce(s.value->'production_sheets','[]'))>0 then 'items' else 'text' end),
 'body',coalesce(s.value->>'body',s.value->>'digest',''),'sheets',coalesce(s.value->'production_sheets','[]')) end
 from journal_cr_private.sections s where s.report_id=p_id and s.key=p_key;
$$;

create or replace function journal_cr_private.field_choices(p_id uuid,p_key text) returns jsonb language sql stable set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(q)),'[]') from (
 select distinct c.label,c.chantier from journal_cr_private.catalog c where c.section_key=p_key
 union select distinct t.label,ch.name from journal_cr_private.timings t join journal_cr_private.reports r on r.id=t.report_id
 join public.chantiers ch on ch.id=r.chantier_id where t.section_key=p_key and r.chantier_id=(select chantier_id from journal_cr_private.reports where id=p_id)
 order by label limit 250) q;
$$;

create or replace function journal_cr_private.check_field(p_id uuid,p_key text,p_data jsonb,p_final boolean) returns void language plpgsql set search_path='' as $$
declare d date;x jsonb;ps timestamptz;pe timestamptz;rs timestamptz;re timestamptz;non boolean;
begin
 select night into d from journal_cr_private.reports where id=p_id;
 if jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text)>200000 then raise exception 'Saisie invalide ou trop volumineuse';end if;
 if p_key in ('catenaire','itc') then
  if jsonb_typeof(p_data->'rows') is distinct from 'array' or jsonb_array_length(p_data->'rows')>40 then raise exception '40 lignes maximum';end if;
  if p_final and jsonb_array_length(p_data->'rows')=0 then raise exception 'Renseigner au moins une référence, ou demander à l’administrateur de retirer cette demande';end if;
  if exists(select 1 from jsonb_array_elements(p_data->'rows') a group by lower(trim(a->>'label')),lower(trim(coalesce(a->>'track',''))) having count(*)>1) then raise exception 'Référence et voie répétées dans le tableau';end if;
  if exists(select 1 from jsonb_array_elements(p_data->'rows') a where nullif(a->>'id','') is not null group by a->>'id' having count(*)>1) then raise exception 'Ligne répétée';end if;
 elsif p_key='technique' then
  if length(coalesce(p_data->>'body',''))>8000 then raise exception '8 000 caractères maximum';end if;
  if coalesce(p_data->>'mode','text') not in ('text','items') then raise exception 'Choisir texte libre ou avancement par travail';end if;
  if p_final and p_data->>'mode'='text' and length(trim(coalesce(p_data->>'body','')))=0 then raise exception 'Décrire les travaux réalisés avant envoi';end if;
  if p_final and p_data->>'mode'='items' and (jsonb_array_length(coalesce(p_data->'sheets','[]'))=0 or exists(select 1 from jsonb_array_elements(p_data->'sheets') q cross join lateral jsonb_array_elements(q->'items') item where item->>'progress' is null)) then raise exception 'Confirmer le pourcentage de chaque travail ou choisir le descriptif libre';end if;
  return;
 elsif p_key is distinct from 'arf' then raise exception 'Rubrique invalide';end if;
 for x in select * from jsonb_array_elements(case when p_key='arf' then jsonb_build_array(p_data) else p_data->'rows' end) loop
  if p_key<>'arf' and length(trim(coalesce(x->>'label',''))) not between 1 and 500 then raise exception 'Indiquer la référence SEL, Secteur ou ZEP';end if;
  if length(coalesce(x->>'track',''))>100 or length(coalesce(x->>'comment',''))>1000 then raise exception 'Voie ou commentaire trop long';end if;
  ps:=nullif(x->>'planned_start','')::timestamptz;pe:=nullif(x->>'planned_end','')::timestamptz;
  rs:=nullif(x->>'start','')::timestamptz;re:=nullif(x->>'end','')::timestamptz;
  non:=coalesce((x->>'non_concerne')::boolean,false);
  perform journal_cr_private.check_timing(d,ps,pe);perform journal_cr_private.check_timing(d,rs,re);
  if non and (rs is not null or re is not null) then raise exception 'Effacer les horaires réels pour indiquer Non pris';end if;
  if p_final and not non and (rs is null or re is null) then raise exception 'Renseigner le début et la fin réels de chaque ligne avant envoi';end if;
 end loop;
end $$;

create or replace function journal_cr_private.sync_production(p_site uuid,p_night date) returns void language plpgsql security definer set search_path='' as $$
declare sheets jsonb;lines jsonb;complete boolean;
begin
 select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at,p.id),'[]') into sheets from journal_cr_private.production_sheets p where chantier_id=p_site and night=p_night;
 if jsonb_array_length(sheets)=0 then return;end if;
 select jsonb_agg(x),bool_and(x->>'progress' is not null) into lines,complete from jsonb_array_elements(sheets) s cross join lateral jsonb_array_elements(s->'items') x;
 update journal_cr_private.sections s set value=s.value||jsonb_build_object('production_sheets',sheets,'production_text',journal_cr_private.production_text(lines)),
 status=case when s.value->>'production_mode'='text' then case when length(trim(coalesce(s.value->>'body','')))>0 then 'complete' else 'a_renseigner' end when complete then 'complete' else 'en_cours' end,version=s.version+1
 from journal_cr_private.reports r where s.report_id=r.id and s.key='technique' and r.chantier_id=p_site and r.night=p_night and r.state='draft' and r.deleted_at is null
 and s.value->'production_sheets' is distinct from sheets;
 update journal_cr_private.field_requests request_row set base_version=section_row.version,
 draft=jsonb_set(request_row.draft,'{sheets}',sheets),version=request_row.version+1
 from journal_cr_private.sections section_row join journal_cr_private.reports report_row on report_row.id=section_row.report_id
 where request_row.report_id=report_row.id and request_row.section_key='technique' and section_row.key='technique'
 and report_row.chantier_id=p_site and report_row.night=p_night and report_row.deleted_at is null and report_row.state='draft'
 and request_row.state='open' and request_row.saved_at is null and request_row.base_version<>section_row.version;
end $$;

create or replace function journal_cr_private.apply_field(p_id uuid,p_key text,p_data jsonb) returns void language plpgsql security definer set search_path='' as $$
declare r journal_cr_private.reports;s journal_cr_private.sections;t journal_cr_private.timings;x jsonb;tid uuid;kept uuid[]:='{}';non boolean;v_data jsonb;mode text;
begin
 select * into r from journal_cr_private.reports where id=p_id;
 select * into s from journal_cr_private.sections where report_id=p_id and key=p_key;
 perform journal_cr_private.check_field(p_id,p_key,p_data,false);
 if p_key in ('catenaire','itc') then
  for x in select * from jsonb_array_elements(p_data->'rows') loop
   tid:=nullif(x->>'id','')::uuid;
   if tid is not null then
    select * into t from journal_cr_private.timings where id=tid and report_id=p_id and section_key=p_key;
    if not found or t.version is distinct from (x->>'version')::integer then raise exception 'Ligne modifiée : rouvrir la demande';end if;
   else
    insert into journal_cr_private.timings(report_id,section_key,label) values(p_id,p_key,trim(x->>'label')) returning id into tid;
   end if;
   non:=coalesce((x->>'non_concerne')::boolean,false);
   update journal_cr_private.timings set label=trim(x->>'label'),track=case when p_key='itc' then trim(coalesce(x->>'track','')) else '' end,active=true,
    planned_start=nullif(x->>'planned_start','')::timestamptz,planned_end=nullif(x->>'planned_end','')::timestamptz,
    actual_start=nullif(x->>'start','')::timestamptz,actual_end=nullif(x->>'end','')::timestamptz,comment=trim(coalesce(x->>'comment','')),
    status=case when non then 'non_concerne' when nullif(x->>'start','') is not null and nullif(x->>'end','') is not null then 'complete' when nullif(x->>'start','') is not null or nullif(x->>'end','') is not null then 'en_cours' else 'a_renseigner' end,
    version=version+1,updated_by=auth.uid(),updated_name=journal_cr_private.person(),updated_at=now() where id=tid;
   kept:=array_append(kept,tid);
  end loop;
  update journal_cr_private.timings set active=false,version=version+1 where report_id=p_id and section_key=p_key and active and not(id=any(kept));
  update journal_cr_private.sections set value=value||'{"mode":"perimeters"}' where report_id=p_id and key=p_key;
  perform journal_cr_private.refresh_timing_section(p_id,p_key);
  if cardinality(kept)=0 then update journal_cr_private.sections set status='non_concerne' where report_id=p_id and key=p_key;end if;
 elsif p_key='arf' then
  non:=coalesce((p_data->>'non_concerne')::boolean,false);
  update journal_cr_private.sections set value=value||jsonb_build_object('planned_start',p_data->'planned_start','planned_end',p_data->'planned_end','start',p_data->'start','end',p_data->'end','precision',coalesce(p_data->>'comment','')),
   status=case when non then 'non_concerne' when nullif(p_data->>'start','') is not null and nullif(p_data->>'end','') is not null then 'complete' when nullif(p_data->>'start','') is not null or nullif(p_data->>'end','') is not null then 'en_cours' else 'a_renseigner' end,
   version=version+1,updated_by=auth.uid(),updated_name=journal_cr_private.person(),updated_at=now() where report_id=p_id and key=p_key;
 else
  mode:=coalesce(p_data->>'mode','text');
  if mode='items' then
   for x in select * from jsonb_array_elements(coalesce(p_data->'sheets','[]')) loop
    perform public.journal_production_api('save',x||jsonb_build_object('chantier_id',r.chantier_id,'night',r.night));
   end loop;
  end if;
  update journal_cr_private.sections set value=value||jsonb_build_object('body',trim(coalesce(p_data->>'body','')),'production_mode',mode),version=version+1,
   status=case when mode='text' then case when length(trim(coalesce(p_data->>'body','')))>0 then 'complete' else 'a_renseigner' end
    when jsonb_array_length(coalesce(p_data->'sheets','[]'))>0 and not exists(select 1 from jsonb_array_elements(p_data->'sheets') q cross join lateral jsonb_array_elements(q->'items') item where item->>'progress' is null) then 'complete' else 'en_cours' end,
   updated_by=auth.uid(),updated_name=journal_cr_private.person(),updated_at=now() where report_id=p_id and key=p_key;
 end if;
 update journal_cr_private.reports set updated_at=now() where id=p_id;
 perform journal_cr_private.log(p_id,'saisie_v155',p_key,jsonb_build_object('before',s.value,'after',p_data));
end $$;

create or replace function journal_cr_private.ensure_report(p_site uuid,p_night date,p_actor uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare rid uuid;
begin
 insert into journal_cr_private.reports(chantier_id,night,created_by) values(p_site,p_night,p_actor) on conflict(chantier_id,night) do nothing returning id into rid;
 if rid is not null then
  insert into journal_cr_private.sections(report_id,key,status) select rid,k,case when k='synthese' then 'non_concerne' else 'a_renseigner' end from unnest(array['catenaire','itc','arf','technique','securite','synthese']) k;
 else select id into rid from journal_cr_private.reports where chantier_id=p_site and night=p_night;end if;
 return rid;
end $$;
create or replace function journal_cr_private.can_fill_production(p_site uuid,p_night date) returns boolean language sql stable security definer set search_path='' as $$
 select journal_cr_private.member(auth.uid(),p_site) and exists(select 1 from journal_cr_private.field_requests req join journal_cr_private.reports rep on rep.id=req.report_id
 where rep.chantier_id=p_site and rep.night=p_night and rep.state='draft' and rep.deleted_at is null and req.section_key='technique' and req.user_id=auth.uid() and req.state='open');
$$;
create or replace function journal_cr_private.production_api_v154(p_action text,p_payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();sid uuid:=(p_payload->>'chantier_id')::uuid;d date:=(p_payload->>'night')::date;
 pid uuid;mid uuid;old journal_cr_private.production_sheets;v_items jsonb:=p_payload->'items';x jsonb;v_body text;v integer;res jsonb;
begin
 if uid is null or sid is null or d is null or not journal_cr_private.member(uid,sid) then raise exception 'Production inaccessible';end if;
 if p_action='list' then
  return (select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('history',(select coalesce(jsonb_agg(to_jsonb(h) order by h.version desc),'[]') from journal_cr_private.production_history h where h.sheet_id=p.id)) order by p.created_at,p.id),'[]') from journal_cr_private.production_sheets p where chantier_id=sid and night=d);
 end if;
 if p_action<>'save' or not (public.journal_v142_can_write(sid) or journal_cr_private.can_fill_production(sid,d)) then raise exception 'Accès en écriture requis';end if;
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
create or replace function public.journal_production_api(p_action text,p_payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare sid uuid:=(p_payload->>'chantier_id')::uuid;d date:=(p_payload->>'night')::date;rid uuid;result jsonb;
begin
 if auth.uid() is null or not public.journal_v142_is_active() or not journal_cr_private.member(auth.uid(),sid) then raise exception 'Production inaccessible';end if;
 if p_action='save' then
  if not (public.journal_v142_can_write(sid) or journal_cr_private.can_fill_production(sid,d)) then raise exception 'Accès en écriture requis';end if;
  perform pg_advisory_xact_lock(hashtextextended(sid::text||d::text,0));
  if exists(select 1 from journal_cr_private.field_requests q join journal_cr_private.reports r on r.id=q.report_id where r.chantier_id=sid and r.night=d and r.deleted_at is null and q.section_key='technique' and q.state='submitted') and not journal_cr_private.manager(sid) then raise exception 'Informations transmises : demander une correction à l’administrateur';end if;
  rid:=journal_cr_private.ensure_report(sid,d,auth.uid());
 end if;
 result:=journal_cr_private.production_api_v154(p_action,p_payload);
 return result;
end $$;

create or replace function journal_cr_private.dispatch_field(p_id uuid,p_key text,p_reason text default '') returns uuid language plpgsql security definer set search_path='' as $$
declare r journal_cr_private.reports;s journal_cr_private.sections;q journal_cr_private.field_requests;
begin
 select * into r from journal_cr_private.reports where id=p_id;select * into s from journal_cr_private.sections where report_id=p_id and key=p_key;
 if not journal_cr_private.manager(r.chantier_id) or r.state<>'draft' or r.deleted_at is not null then raise exception 'Envoi de demande réservé à l’administrateur';end if;
 if s.responsible is null or not journal_cr_private.member(s.responsible,r.chantier_id) then raise exception 'Désigner un responsable ayant accès au chantier';end if;
 insert into journal_cr_private.field_requests(report_id,section_key,user_id,base_version,draft,correction)
 values(p_id,p_key,s.responsible,s.version,journal_cr_private.field_data(p_id,p_key),left(coalesce(p_reason,''),1000))
 on conflict(report_id,section_key) do update set user_id=excluded.user_id,base_version=excluded.base_version,draft=excluded.draft,
 state='open',version=journal_cr_private.field_requests.version+1,generation=journal_cr_private.field_requests.generation+1,
 correction=excluded.correction,muted=false,dismissed_token='',reminder_for=null,saved_at=null,submitted_at=null,submitted_by=null,requested_at=now() returning * into q;
 perform journal_cr_private.notify(q.user_id,r.chantier_id,r.id,p_key,null,case when p_reason<>'' then 'Correction demandée : saisie chantier' else 'Demande de saisie chantier' end,'v155-request:'||q.id||':'||q.generation);
 perform journal_cr_private.log(p_id,'demande_envoyee',p_key,jsonb_build_object('responsible',q.user_id,'reason',p_reason));return q.id;
end $$;

create or replace function journal_cr_private.tasks(p_user uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(x) order by night desc,chantier,section_key),'[]') from (
 select q.id,q.report_id,q.section_key,q.user_id,q.version,q.saved_at,q.correction,q.muted,q.dismissed_token,
 q.generation::text||':'||coalesce(q.reminder_for::text,'initial') token,q.reminder_for is not null reminder,r.chantier_id,r.night,c.name chantier,
 case when q.section_key='arf' then nullif(q.draft->>'planned_end','')::timestamptz else (select min(nullif(x->>'planned_end','')::timestamptz) from jsonb_array_elements(coalesce(q.draft->'rows','[]')) x where nullif(x->>'end','') is null) end expected_end
 from journal_cr_private.field_requests q join journal_cr_private.reports r on r.id=q.report_id join public.chantiers c on c.id=r.chantier_id
 where q.user_id=p_user and q.state='open' and r.state='draft' and r.deleted_at is null and journal_cr_private.member(p_user,r.chantier_id)) x;
$$;
create or replace function journal_cr_private.remind_due() returns void language plpgsql security definer set search_path='' as $$
declare q record;t jsonb;due timestamptz;
begin
 for q in select f.* from journal_cr_private.field_requests f join journal_cr_private.reports r on r.id=f.report_id where f.state='open' and not f.muted and r.state='draft' and r.deleted_at is null for update of f skip locked loop
  select x into t from jsonb_array_elements(journal_cr_private.tasks(q.user_id)) x where x->>'id'=q.id::text;
  due:=nullif(t->>'expected_end','')::timestamptz;
  if due between now()-interval '12 hours' and now()+interval '1 hour' and q.reminder_for is distinct from due then
   update journal_cr_private.field_requests set reminder_for=due where id=q.id;
   perform journal_cr_private.notify(q.user_id,(t->>'chantier_id')::uuid,q.report_id,q.section_key,null,'Fin de séance : pensez à envoyer vos informations','v155-end:'||q.id||':'||q.generation||':'||due);
  end if;
 end loop;
end $$;
create or replace function journal_cr_private.notification_allowed(n journal_cr_private.notifications) returns boolean language sql stable security definer set search_path='' as $$
 select case when n.kind<>'cr' then journal_cr_private.notification_allowed_v151(n) else
 exists(select 1 from journal_cr_private.field_requests q join journal_cr_private.reports r on r.id=q.report_id
 where q.report_id=n.report_id and q.section_key=n.section_key and q.user_id=n.user_id and q.state='open' and r.state='draft' and r.deleted_at is null
 and journal_cr_private.member(n.user_id,r.chantier_id) and (n.dedup not like 'v155-end:%' or not q.muted)) end;
$$;

create or replace function public.journal_cr_api(p_action text,p_payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();rid uuid;sid uuid;k text:=p_payload->>'key';r journal_cr_private.reports;s journal_cr_private.sections;
 q journal_cr_private.field_requests;result jsonb;x jsonb;ids uuid[];plan journal_cr_private.week_plans;d date;new_report boolean;target uuid;
begin
 if uid is null or not public.journal_v142_is_active() then raise exception 'Connexion active requise';end if;
 if octet_length(p_payload::text)>300000 then raise exception 'Demande trop volumineuse';end if;
 if p_action='context' then
  return jsonb_build_object('sites',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name) order by c.name),'[]') from public.chantiers c where journal_cr_private.member(uid,c.id) and journal_cr_private.manager(c.id)));
 elsif p_action='list' then
  return (select coalesce(jsonb_agg(to_jsonb(listed_row) order by listed_row.night desc,listed_row.chantier,listed_row.id),'[]') from (
   select listed_report.id,listed_report.chantier_id,c.name chantier,listed_report.night,listed_report.state,listed_report.revision,listed_report.deleted_at,listed_report.updated_at,true manager,0 mine,
   (select count(*) from journal_cr_private.sections listed_section where listed_section.report_id=listed_report.id and listed_section.key<>'synthese' and listed_section.status in ('complete','non_concerne')) completed,5 total,
   (select count(*) from journal_cr_private.field_requests f where f.report_id=listed_report.id and f.state='open') pending
   from journal_cr_private.reports listed_report join public.chantiers c on c.id=listed_report.chantier_id where journal_cr_private.member(uid,listed_report.chantier_id) and journal_cr_private.manager(listed_report.chantier_id)
   and (listed_report.deleted_at is not null)=coalesce((p_payload->>'deleted')::boolean,false)
   order by listed_report.night desc,c.name,listed_report.id limit 200 offset greatest(least(coalesce((p_payload->>'offset')::int,0),100000),0)) listed_row);
 elsif p_action='tasks' then return journal_cr_private.tasks(uid);
 elsif p_action in ('task_detail','task_save','task_submit','task_ack') then
  select report_id into rid from journal_cr_private.field_requests where id=(p_payload->>'task_id')::uuid and user_id=uid;
  select * into r from journal_cr_private.reports where id=rid;
  if not found or r.deleted_at is not null or r.state<>'draft' or not journal_cr_private.member(uid,r.chantier_id) then raise exception 'Demande inaccessible';end if;
  perform pg_advisory_xact_lock(hashtextextended(r.chantier_id::text||r.night::text,0));
  select * into r from journal_cr_private.reports where id=rid for update;
  if r.deleted_at is not null or r.state<>'draft' then raise exception 'Demande fermée';end if;
  select * into q from journal_cr_private.field_requests where id=(p_payload->>'task_id')::uuid and user_id=uid for update;
  if not found then raise exception 'Demande réattribuée';end if;
  if q.state='submitted' then
   if p_action='task_submit' and (p_payload->>'version')::int=q.version-1 and p_payload->'data'=q.draft and coalesce((p_payload->>'confirmed')::boolean,false) then return jsonb_build_object('submitted',true);end if;
   raise exception 'Demande déjà transmise ou réattribuée';
  end if;
  k:=q.section_key;
  if p_action='task_ack' then
   if p_payload->>'token' is distinct from q.generation::text||':'||coalesce(q.reminder_for::text,'initial') then raise exception 'Demande actualisée : rouvrir les demandes';end if;
   update journal_cr_private.field_requests set dismissed_token=p_payload->>'token',muted=coalesce((p_payload->>'muted')::boolean,muted) where id=q.id;return '{}';
  elsif p_action in ('task_save','task_submit') then
   if q.version is distinct from (p_payload->>'version')::int then raise exception 'Saisie modifiée sur un autre appareil : rouvrir la demande';end if;
   select * into s from journal_cr_private.sections where report_id=rid and key=k;
   if s.version<>q.base_version then raise exception 'Configuration modifiée par l’administrateur : lui demander de renvoyer la demande';end if;
   perform journal_cr_private.check_field(rid,k,p_payload->'data',p_action='task_submit');
   update journal_cr_private.field_requests set draft=p_payload->'data',version=version+1,saved_at=now() where id=q.id;
   if p_action='task_submit' then
    if not coalesce((p_payload->>'confirmed')::boolean,false) then raise exception 'Confirmer l’envoi définitif';end if;
    perform journal_cr_private.apply_field(rid,k,p_payload->'data');
    update journal_cr_private.field_requests set state='submitted',submitted_at=now(),submitted_by=uid where id=q.id;
    perform journal_cr_private.log(rid,'informations_transmises',k,jsonb_build_object('request_id',q.id));
   end if;
  end if;
  return (select jsonb_build_object('id',r.id,'chantier_id',r.chantier_id,'chantier',(select name from public.chantiers where id=r.chantier_id),'night',r.night,'state',r.state,'manager',false,
   'task',to_jsonb(f),'key',k,'data',f.draft,'choices',journal_cr_private.field_choices(rid,k)) from journal_cr_private.field_requests f where id=q.id);
 elsif p_action in ('prepare_send','preview','email_access','audience') then raise exception 'V15.5 : générer le PDF puis utiliser le partage manuel';
 elsif p_action in ('inbox','read','device','device_remove','push_config') then return journal_cr_private.api_v154(p_action,p_payload);
 elsif p_action='create' then
  sid:=(p_payload->>'chantier_id')::uuid;d:=(p_payload->>'night')::date;
  if not journal_cr_private.manager(sid) or not journal_cr_private.member(uid,sid) then raise exception 'Préparation réservée à l’administrateur du chantier';end if;
  if d is null or d not between current_date-366 and current_date+31 then raise exception 'Date de nuit invalide';end if;
  perform pg_advisory_xact_lock(hashtextextended(sid::text||d::text,0));
  new_report:=not exists(select 1 from journal_cr_private.reports where chantier_id=sid and night=d);
  rid:=journal_cr_private.ensure_report(sid,d,uid);
  if exists(select 1 from journal_cr_private.reports where id=rid and deleted_at is not null) then raise exception 'Ce CR a été supprimé : le restaurer depuis les CR supprimés';end if;
  if new_report and coalesce((p_payload->>'reuse')::boolean,false) then
   for plan in select * from journal_cr_private.week_plans where chantier_id=sid and week_start=date_trunc('week',d::timestamp)::date loop
    if plan.section_key='arf' then
     x:=jsonb_build_object('planned_start',journal_cr_private.shift_hour((plan.rows->0->>'planned_start')::timestamptz,d-plan.night),'planned_end',journal_cr_private.shift_hour((plan.rows->0->>'planned_end')::timestamptz,d-plan.night));
    else
     select jsonb_build_object('rows',coalesce(jsonb_agg(jsonb_build_object('label',v->>'label','track',coalesce(v->>'track',''),'planned_start',journal_cr_private.shift_hour((v->>'planned_start')::timestamptz,d-plan.night),'planned_end',journal_cr_private.shift_hour((v->>'planned_end')::timestamptz,d-plan.night))),'[]')) into x from jsonb_array_elements(plan.rows) v;
    end if;
    perform journal_cr_private.apply_field(rid,plan.section_key,x);
    update journal_cr_private.sections set responsible=case when journal_cr_private.member(plan.responsible,sid) then plan.responsible end where report_id=rid and key=plan.section_key;
   end loop;
  end if;
  perform journal_cr_private.sync_production(sid,d);return jsonb_build_object('id',rid);
 elsif p_action in ('delete_reports','restore_reports') then
  select array_agg(distinct v::uuid) into ids from jsonb_array_elements_text(p_payload->'ids') v;
  if coalesce(cardinality(ids),0) not between 1 and 200 then raise exception 'Sélectionner les CR concernés';end if;
  perform 1 from journal_cr_private.reports where id=any(ids) order by id for update;
  if (select count(*) from journal_cr_private.reports where id=any(ids) and journal_cr_private.manager(chantier_id) and journal_cr_private.member(uid,chantier_id))<>cardinality(ids) then raise exception 'Suppression réservée aux administrateurs des chantiers concernés';end if;
  if p_action='delete_reports' and exists(select 1 from journal_cr_private.deliveries where report_ids&&ids and state in ('pending','sent','uncertain')) then raise exception 'Un CR sélectionné possède un envoi email déjà engagé : conserver son historique';end if;
  foreach rid in array ids loop
   update journal_cr_private.reports set deleted_at=case when p_action='delete_reports' then now() end,deleted_by=case when p_action='delete_reports' then uid end,updated_at=now() where id=rid;
   if p_action='restore_reports' then update journal_cr_private.field_requests set generation=generation+1,dismissed_token='' where report_id=rid and state='open';end if;
   perform journal_cr_private.log(rid,case when p_action='delete_reports' then 'suppression' else 'restauration' end,null);
  end loop;return '{}';
 end if;
 rid:=(p_payload->>'id')::uuid;select * into r from journal_cr_private.reports where id=rid;
 if not found or not journal_cr_private.full_access(rid) then raise exception 'CR réservé à l’administrateur du chantier';end if;
 perform pg_advisory_xact_lock(hashtextextended(r.chantier_id::text||r.night::text,0));
 select * into r from journal_cr_private.reports where id=rid for update;
 if r.deleted_at is not null then raise exception 'CR supprimé';end if;
 if p_action='detail' then
  result:=journal_cr_private.api_v154('detail',p_payload);
  return result||jsonb_build_object('field_requests',(select coalesce(jsonb_agg(to_jsonb(request_row)-'draft'),'[]') from journal_cr_private.field_requests request_row where request_row.report_id=rid),'choices',journal_cr_private.field_choices(rid,'catenaire'),'itc_choices',journal_cr_private.field_choices(rid,'itc'),'delivery_mode','manual_pdf');
 elsif p_action='pdf_snapshot' then
  if r.state='draft' then result:=journal_cr_private.snapshot(rid);else select data into result from journal_cr_private.snapshots where report_id=rid and revision=r.revision;end if;
  return result||jsonb_build_object('state',r.state,'delivery_mode','manual_pdf');
 elsif p_action='validate' then
  if r.state<>'draft' then return '{}';end if;
  if exists(select 1 from journal_cr_private.field_requests where report_id=rid and state='open') then raise exception 'Attendre l’envoi définitif des demandes encore ouvertes';end if;
  if exists(select 1 from journal_cr_private.sections where report_id=rid and key<>'synthese' and status not in ('complete','non_concerne')) then raise exception 'Compléter les rubriques indiquées dans le récapitulatif';end if;
  insert into journal_cr_private.snapshots(report_id,revision,data,validated_by,validated_name) values(rid,r.revision,journal_cr_private.snapshot(rid),uid,journal_cr_private.person());
  update journal_cr_private.reports set state='validated',updated_at=now() where id=rid;
  perform journal_cr_private.log(rid,'validation',null);return '{}';
 elsif p_action='field_configure' then
  if r.state<>'draft' or k not in ('catenaire','itc','arf','technique') or k is null then raise exception 'Rubrique non modifiable';end if;
  select * into s from journal_cr_private.sections where report_id=rid and key=k for update;
  if s.version is distinct from (p_payload->>'version')::int then raise exception 'Rubrique modifiée : actualiser avant d’enregistrer';end if;
  target:=nullif(p_payload->>'responsible','')::uuid;
  if target is not null and not journal_cr_private.member(target,r.chantier_id) then raise exception 'Responsable sans accès au chantier';end if;
  if target is not null and not coalesce((p_payload->>'dispatch')::boolean,false) and exists(select 1 from journal_cr_private.field_requests where report_id=rid and section_key=k and state='open') then raise exception 'Une demande est ouverte : utiliser Enregistrer et renvoyer pour transmettre la nouvelle configuration';end if;
  if target is null then delete from journal_cr_private.field_requests where report_id=rid and section_key=k;end if;
  perform journal_cr_private.apply_field(rid,k,p_payload->'data');
  update journal_cr_private.sections set responsible=target where report_id=rid and key=k;
  if coalesce((p_payload->>'remember_week')::boolean,false) and k<>'technique' then
   x:=journal_cr_private.field_data(rid,k);
   if k='arf' then x:=jsonb_build_array(jsonb_build_object('planned_start',x->'planned_start','planned_end',x->'planned_end'));
   else select coalesce(jsonb_agg(jsonb_build_object('label',v->'label','track',v->'track','planned_start',v->'planned_start','planned_end',v->'planned_end')),'[]') into x from jsonb_array_elements(x->'rows') v;end if;
   insert into journal_cr_private.week_plans(chantier_id,week_start,section_key,night,rows,responsible) values(r.chantier_id,date_trunc('week',r.night::timestamp)::date,k,r.night,x,target)
   on conflict(chantier_id,week_start,section_key) do update set night=excluded.night,rows=excluded.rows,responsible=excluded.responsible,updated_at=now();
  end if;
  if coalesce((p_payload->>'dispatch')::boolean,false) then perform journal_cr_private.dispatch_field(rid,k,p_payload->>'correction');end if;
  return '{}';
 elsif p_action='request_resend' then
  if r.state<>'draft' then raise exception 'Créer un rectificatif avant de demander une correction';end if;
  return jsonb_build_object('task_id',journal_cr_private.dispatch_field(rid,k,p_payload->>'reason'));
 end if;
 -- Legacy manager clients keep safe editing and push support; members cannot call these paths.
 return journal_cr_private.api_v154(p_action,p_payload);
end $$;

-- Make production-only nights visible on every device, without automatic assignments.
do $$ declare p record;rid uuid;begin
 for p in select distinct on(chantier_id,night) chantier_id,night,author_id from journal_cr_private.production_sheets order by chantier_id,night,created_at loop
  rid:=journal_cr_private.ensure_report(p.chantier_id,p.night,p.author_id);perform journal_cr_private.sync_production(p.chantier_id,p.night);
 end loop;
end $$;
-- Preserve the previously assigned, unfinished timing requests on upgrade.
insert into journal_cr_private.field_requests(report_id,section_key,user_id,base_version,draft)
 select distinct on(c.report_id,c.section_key) c.report_id,c.section_key,c.user_id,s.version,journal_cr_private.field_data(c.report_id,c.section_key)
 from journal_cr_private.request_candidates c join journal_cr_private.sections s on s.report_id=c.report_id and s.key=c.section_key
 order by c.report_id,c.section_key,(c.user_id=s.responsible) desc,c.user_id on conflict(report_id,section_key) do nothing;

revoke all on journal_cr_private.field_requests from public,anon,authenticated,service_role;
revoke all on all functions in schema journal_cr_private from public,anon,authenticated,service_role;
revoke all on function public.journal_cr_api(text,jsonb),public.journal_production_api(text,jsonb) from public,anon,service_role;
grant execute on function public.journal_cr_api(text,jsonb),public.journal_production_api(text,jsonb) to authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
