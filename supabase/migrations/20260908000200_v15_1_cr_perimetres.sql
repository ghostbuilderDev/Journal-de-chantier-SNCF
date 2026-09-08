BEGIN;
-- V15.1: additive evolution. Existing CRs and validated snapshots remain intact.
create table if not exists journal_cr_private.catalog (
 id text primary key, chantier text not null, section_key text not null check(section_key in ('catenaire','itc')),
 label text not null, sources jsonb not null default '[]', warning text not null default ''
);
create table if not exists journal_cr_private.contact_suggestions (
 id text primary key, name text not null, email text not null default '', evidence text not null,
 note text not null default ''
);
create table if not exists journal_cr_private.timings (
 id uuid primary key default gen_random_uuid(), report_id uuid not null, section_key text not null,
 catalog_id text, label text not null check(length(label) between 1 and 500),
 source jsonb not null default '[]', active boolean not null default true,
 responsible uuid, due_at timestamptz, planned_start timestamptz, planned_end timestamptz,
 actual_start timestamptz, actual_end timestamptz, comment text not null default '',
 status text not null default 'a_renseigner' check(status in ('a_renseigner','en_cours','complete','a_confirmer','non_concerne')),
 version integer not null default 1, updated_by uuid, updated_name text, updated_at timestamptz,
 foreign key(report_id,section_key) references journal_cr_private.sections(report_id,key) on delete cascade,
 unique(report_id,section_key,catalog_id)
);
create index if not exists cr_timings_report on journal_cr_private.timings(report_id,section_key);
create index if not exists cr_timings_responsible on journal_cr_private.timings(responsible) where active;
alter table journal_cr_private.reports add column if not exists program_group text not null default '';

-- Preserve the deployed V15 API as the implementation of unchanged actions.
do $$ begin
 if to_regprocedure('journal_cr_private.api_v15(text,jsonb)') is null then
  alter function public.journal_cr_api(text,jsonb) set schema journal_cr_private;
  alter function journal_cr_private.journal_cr_api(text,jsonb) rename to api_v15;
 end if;
end $$;

create or replace function journal_cr_private.section_access(p_id uuid,p_key text) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce((select journal_cr_private.member(auth.uid(),r.chantier_id) and
 (journal_cr_private.full_access(r.id) or s.responsible=auth.uid() or auth.uid()=any(s.contributors)
 or exists(select 1 from journal_cr_private.timings t where t.report_id=r.id and t.section_key=p_key and t.active and t.responsible=auth.uid()))
 from journal_cr_private.reports r join journal_cr_private.sections s on s.report_id=r.id where r.id=p_id and s.key=p_key),false);
$$;
create or replace function journal_cr_private.timing_json(p_id uuid,p_key text) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object('responsible_name',
 (select full_name from public.profiles where id=t.responsible)) order by t.active desc,t.label,t.id),'[]')
 from journal_cr_private.timings t where t.report_id=p_id and t.section_key=p_key;
$$;
create or replace function journal_cr_private.snapshot(p_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',r.id,'chantier_id',r.chantier_id,'chantier',c.name,'night',r.night,'revision',r.revision,'recipients',r.recipients,
 'sections',(select jsonb_agg(to_jsonb(s)||jsonb_build_object('items',journal_cr_private.timing_json(r.id,s.key),
 'notes',coalesce((select jsonb_agg(to_jsonb(n) order by n.created_at,n.id) from journal_cr_private.notes n where n.report_id=r.id and n.section_key=s.key),'[]'::jsonb)) order by s.key)
 from journal_cr_private.sections s where s.report_id=r.id))
 from journal_cr_private.reports r join public.chantiers c on c.id=r.chantier_id where r.id=p_id;
$$;
create or replace function journal_cr_private.check_timing(p_night date,p_start timestamptz,p_end timestamptz) returns void
language plpgsql immutable set search_path='' as $$
begin
 if p_start is not null and ((p_start at time zone 'Europe/Paris')::date not between p_night and p_night+1)
 or p_end is not null and ((p_end at time zone 'Europe/Paris')::date not between p_night and p_night+2)
 or p_start is not null and p_end is not null and (p_end<p_start or p_end-p_start>interval '36 hours') then
 raise exception 'Horaires incohérents avec la nuit sélectionnée'; end if;
end;
$$;
create or replace function journal_cr_private.refresh_timing_section(p_id uuid,p_key text) returns void
language plpgsql security definer set search_path='' as $$
declare n int; done int; started int; uncertain int;
begin
 select count(*),count(*) filter(where status in ('complete','non_concerne')),
 count(*) filter(where actual_start is not null or actual_end is not null),count(*) filter(where status='a_confirmer')
 into n,done,started,uncertain from journal_cr_private.timings where report_id=p_id and section_key=p_key and active;
 update journal_cr_private.sections set status=case when n=0 then 'a_renseigner' when uncertain>0 then 'a_confirmer'
 when done=n then 'complete' when started>0 or done>0 then 'en_cours' else 'a_renseigner' end,
 version=version+1,updated_by=auth.uid(),updated_name=journal_cr_private.person(),updated_at=now() where report_id=p_id and key=p_key;
 update journal_cr_private.reports set updated_at=now() where id=p_id;
end;
$$;
-- Import is invoked only through the authenticated database deployment transport.
-- Real contacts/planning stay out of the public repository and frontend assets.
create or replace function journal_cr_private.import_v151(p_data jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare x jsonb;
begin
 if p_data->>'format'<>'journal-cr-v15.1' or jsonb_typeof(p_data->'catalog')<>'array' or jsonb_typeof(p_data->'contacts')<>'array' then raise exception 'Import CR invalide'; end if;
 for x in select * from jsonb_array_elements(p_data->'catalog') loop
  insert into journal_cr_private.catalog(id,chantier,section_key,label,sources,warning)
  values(x->>'id',x->>'chantier',x->>'section_key',x->>'label',x->'sources',coalesce(x->>'warning',''))
  on conflict(id) do update set chantier=excluded.chantier,section_key=excluded.section_key,label=excluded.label,sources=excluded.sources,warning=excluded.warning;
 end loop;
 for x in select * from jsonb_array_elements(p_data->'contacts') loop
  insert into journal_cr_private.contact_suggestions(id,name,email,evidence,note)
  values(x->>'id',x->>'name',coalesce(x->>'email',''),x->>'evidence',coalesce(x->>'note','')) on conflict(id) do update
  set name=excluded.name,email=excluded.email,evidence=excluded.evidence,note=excluded.note;
 end loop;
end;
$$;

create or replace function public.journal_cr_api(p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare uid uuid:=auth.uid(); rid uuid; sid uuid; k text; r journal_cr_private.reports; s journal_cr_private.sections;
 t journal_cr_private.timings; c journal_cr_private.catalog; result jsonb; x jsonb; old jsonb; keys text[]; kept uuid[]; v_ids uuid[];
 target uuid; t0 timestamptz; t1 timestamptz; st text; note text; previous uuid; n int; u uuid; exists_before boolean;
begin
 if uid is null or not public.journal_v142_is_active() then raise exception 'Connexion active requise'; end if;
 if octet_length(p_payload::text)>200000 then raise exception 'Demande trop volumineuse'; end if;
 if p_action='catalog' then
  sid:=(p_payload->>'chantier_id')::uuid;
  if not journal_cr_private.manager(sid) then raise exception 'Catalogue réservé à l’encadrant'; end if;
  return jsonb_build_object('catalog',(select coalesce(jsonb_agg(to_jsonb(c) order by chantier,section_key,label),'[]') from journal_cr_private.catalog c),
  'contacts',(select coalesce(jsonb_agg(to_jsonb(c) order by name),'[]') from journal_cr_private.contact_suggestions c));
 elsif p_action='create' then
  sid:=(p_payload->>'chantier_id')::uuid;
  if not journal_cr_private.manager(sid) then raise exception 'Création réservée à l’encadrement du chantier'; end if;
  perform pg_advisory_xact_lock(hashtextextended(sid::text||coalesce(p_payload->>'night',''),0));
  select exists(select 1 from journal_cr_private.reports where chantier_id=sid and night=(p_payload->>'night')::date) into exists_before;
  result:=journal_cr_private.api_v15(p_action,p_payload||jsonb_build_object('reuse',false));rid:=(result->>'id')::uuid;
  if not exists_before then
   update journal_cr_private.sections set value='{"mode":"perimeters"}' where report_id=rid and key in ('catenaire','itc');
   if coalesce((p_payload->>'reuse')::boolean,false) then
    select id into previous from journal_cr_private.reports where chantier_id=sid and night<(p_payload->>'night')::date order by night desc limit 1;
    if previous is not null then
     update journal_cr_private.reports x set program_group=y.program_group,recipients=y.recipients,
     collaborators=array(select u from unnest(y.collaborators) u where journal_cr_private.member(u,sid))
     from journal_cr_private.reports y where x.id=rid and y.id=previous;
     update journal_cr_private.sections x set responsible=case when journal_cr_private.member(y.responsible,sid) then y.responsible end,
     contributors=array(select u from unnest(y.contributors) u where journal_cr_private.member(u,sid))
     from journal_cr_private.sections y where x.report_id=rid and y.report_id=previous and x.key=y.key;
     insert into journal_cr_private.timings(report_id,section_key,catalog_id,label,source,responsible)
     select rid,section_key,catalog_id,label,source,case when journal_cr_private.member(responsible,sid) then responsible end
     from journal_cr_private.timings where report_id=previous and active;
     for s in select * from journal_cr_private.sections where report_id=rid and responsible is not null loop
      perform journal_cr_private.notify(s.responsible,sid,rid,s.key,null,'CR off : rubrique à renseigner','assign:'||rid||':'||s.key||':1');
     end loop;
     for x in select distinct jsonb_build_object('section_key',section_key,'responsible',responsible) from journal_cr_private.timings where report_id=rid and responsible is not null loop
      perform journal_cr_private.notify((x->>'responsible')::uuid,sid,rid,x->>'section_key',null,'CR off : périmètres à renseigner','reuse-timing:'||rid||':'||(x->>'section_key')||':'||(x->>'responsible'));
     end loop;
    end if;
   end if;
  end if;
  return result;
 elsif p_action='list' then
  return (select coalesce(jsonb_agg(to_jsonb(q) order by q.night desc,q.chantier,q.id),'[]') from (
   select r.id,r.chantier_id,c.name chantier,r.night,r.state,r.revision,journal_cr_private.manager(r.chantier_id) manager,
   (select count(*) from journal_cr_private.sections s where s.report_id=r.id and journal_cr_private.section_access(r.id,s.key) and s.status in ('complete','non_concerne')) completed,
   (select count(*) from journal_cr_private.sections s where s.report_id=r.id and journal_cr_private.section_access(r.id,s.key)) total,
   (select count(*) from journal_cr_private.sections s where s.report_id=r.id and s.status not in ('complete','non_concerne') and (s.responsible=uid
   or exists(select 1 from journal_cr_private.timings t where t.report_id=r.id and t.section_key=s.key and t.active and t.responsible=uid and t.status not in ('complete','non_concerne')))) mine
   from journal_cr_private.reports r join public.chantiers c on c.id=r.chantier_id
   where journal_cr_private.member(uid,r.chantier_id) and exists(select 1 from journal_cr_private.sections s where s.report_id=r.id and journal_cr_private.section_access(r.id,s.key))
   and (not coalesce((p_payload->>'mine')::boolean,false) or exists(select 1 from journal_cr_private.sections s where s.report_id=r.id and s.status not in ('complete','non_concerne') and
   (s.responsible=uid or exists(select 1 from journal_cr_private.timings t where t.report_id=r.id and t.section_key=s.key and t.active and t.responsible=uid and t.status not in ('complete','non_concerne')))))
   order by r.night desc,c.name,r.id limit 200 offset greatest(0,least(coalesce((p_payload->>'offset')::int,0),100000))
  ) q);
 elsif p_action='detail' then
  result:=journal_cr_private.api_v15(p_action,p_payload);rid:=(result->>'id')::uuid;
  return result||jsonb_build_object('program_group',(select program_group from journal_cr_private.reports where id=rid),
  'sections',(select coalesce(jsonb_agg(x||jsonb_build_object('items',journal_cr_private.timing_json(rid,x->>'key'))),'[]') from jsonb_array_elements(result->'sections') x));
 elsif p_action not in ('timing_configure','timing_save','timing_assign','timing_plan','save','remind','validate','note') then
  return journal_cr_private.api_v15(p_action,p_payload);
 end if;
 rid:=(p_payload->>'id')::uuid;k:=p_payload->>'key';
 select * into r from journal_cr_private.reports where id=rid for update;
 if not found or not journal_cr_private.member(uid,r.chantier_id) then raise exception 'CR inaccessible'; end if;
 if r.state<>'draft' then raise exception 'CR figé : l’encadrant doit créer une nouvelle version'; end if;
 if p_action='validate' then
  if not journal_cr_private.manager(r.chantier_id) then raise exception 'Validation réservée à l’encadrant'; end if;
  if exists(select 1 from journal_cr_private.timings where report_id=rid and active and (status not in ('complete','non_concerne') or status='complete' and (actual_start is null or actual_end is null))) then raise exception 'Compléter chaque périmètre sélectionné avant validation'; end if;
  return journal_cr_private.api_v15(p_action,p_payload);
 end if;
 if not journal_cr_private.section_access(rid,k) then raise exception 'Rubrique inaccessible'; end if;
 select * into s from journal_cr_private.sections where report_id=rid and key=k for update;
 if p_action in ('save','remind','note') and (k not in ('catenaire','itc') or coalesce(s.value->>'mode','')<>'perimeters') then
  return journal_cr_private.api_v15(p_action,p_payload);
 end if;
 if k not in ('catenaire','itc') then raise exception 'Périmètres réservés aux ITC et consignations'; end if;
 if p_action='note' then
  result:=journal_cr_private.api_v15(p_action,p_payload);
  perform journal_cr_private.refresh_timing_section(rid,k);return result;
 end if;
 if p_action='save' then raise exception 'Les horaires de chaque périmètre doivent être enregistrés séparément. Actualiser l’application si nécessaire'; end if;
 if p_action='timing_configure' then
  if not journal_cr_private.manager(r.chantier_id) then raise exception 'Configuration réservée à l’encadrant'; end if;
  if s.version is distinct from (p_payload->>'version')::int then raise exception 'Rubrique modifiée : actualiser avant de configurer'; end if;
  if jsonb_typeof(p_payload->'catalog_ids')<>'array' or jsonb_typeof(p_payload->'keep_ids')<>'array' then raise exception 'Sélection invalide'; end if;
  select coalesce(array_agg(distinct x),'{}') into keys from jsonb_array_elements_text(p_payload->'catalog_ids') x;
  select coalesce(array_agg(distinct x::uuid),'{}') into kept from jsonb_array_elements_text(p_payload->'keep_ids') x;
  if cardinality(keys)+cardinality(kept)>100 then raise exception 'Sélection trop volumineuse'; end if;
  if exists(select 1 from unnest(keys) x where not exists(select 1 from journal_cr_private.catalog c where c.id=x and c.section_key=k)) then raise exception 'Référence de catalogue inconnue'; end if;
  if exists(select 1 from unnest(kept) x where not exists(select 1 from journal_cr_private.timings t where t.id=x and t.report_id=rid and t.section_key=k)) then raise exception 'Périmètre étranger au CR'; end if;
  old:=journal_cr_private.timing_json(rid,k);
  -- Explicit conversion retains the old global timing as a separate auditable row.
  if coalesce(s.value->>'mode','')<>'perimeters' and (s.value->>'start' is not null or s.value->>'end' is not null or coalesce(s.value->>'precision','')<>'') then
   insert into journal_cr_private.timings(report_id,section_key,label,actual_start,actual_end,comment,status,updated_by,updated_name,updated_at)
   values(rid,k,'Ancien périmètre global — à préciser',(s.value->>'start')::timestamptz,(s.value->>'end')::timestamptz,coalesce(s.value->>'precision',''),'a_confirmer',s.updated_by,s.updated_name,s.updated_at) returning id into target;
   kept:=array_append(kept,target);
  end if;
  if exists(select 1 from journal_cr_private.timings t where t.report_id=rid and t.section_key=k and t.active and not(t.id=any(kept)) and not(coalesce(t.catalog_id,'')=any(keys)) and (t.actual_start is not null or t.actual_end is not null)) and length(trim(coalesce(p_payload->>'reason','')))<5 then raise exception 'Indiquer le motif du retrait d’un périmètre déjà renseigné'; end if;
  update journal_cr_private.timings t set active=false,version=version+1 where t.report_id=rid and t.section_key=k and t.active and not(t.id=any(kept)) and not(coalesce(t.catalog_id,'')=any(keys));
  update journal_cr_private.timings t set active=true,version=version+1 where t.report_id=rid and t.section_key=k and not t.active and (t.id=any(kept) or coalesce(t.catalog_id,'')=any(keys));
  for c in select * from journal_cr_private.catalog where id=any(keys) loop
   insert into journal_cr_private.timings(report_id,section_key,catalog_id,label,source) values(rid,k,c.id,c.label,c.sources) on conflict(report_id,section_key,catalog_id) do nothing;
  end loop;
  note:=trim(coalesce(p_payload->>'manual_label',''));
  if length(note)>500 then raise exception 'Libellé trop long'; end if;
  if note<>'' then insert into journal_cr_private.timings(report_id,section_key,label) values(rid,k,note); end if;
  update journal_cr_private.sections set value=jsonb_build_object('mode','perimeters') where report_id=rid and key=k;
  update journal_cr_private.reports set program_group=left(coalesce(p_payload->>'program_group',program_group),200) where id=rid;
  perform journal_cr_private.refresh_timing_section(rid,k);
  if coalesce((p_payload->>'non_concerne')::boolean,false) then
   if exists(select 1 from journal_cr_private.timings where report_id=rid and section_key=k and active) then raise exception 'Décocher tous les périmètres pour déclarer la rubrique non concernée'; end if;
   update journal_cr_private.sections set status='non_concerne' where report_id=rid and key=k;
  end if;
  perform journal_cr_private.log(rid,'perimetres',k,jsonb_build_object('before',old,'after',journal_cr_private.timing_json(rid,k),'reason',left(coalesce(p_payload->>'reason',''),1000)));
  for u in select responsible from journal_cr_private.sections where report_id=rid and key=k and responsible is not null
  union select responsible from journal_cr_private.timings where report_id=rid and section_key=k and active and responsible is not null loop
   perform journal_cr_private.notify(u,r.chantier_id,rid,k,null,'CR off : périmètres mis à jour','scopes:'||rid||':'||k||':'||(s.version+1)||':'||u);
  end loop;
  return '{}';
 elsif p_action='remind' then
  if not journal_cr_private.manager(r.chantier_id) then raise exception 'Relance réservée à l’encadrant'; end if;
  n:=0;
  for u in select distinct coalesce(t.responsible,s.responsible) from journal_cr_private.timings t where t.report_id=rid and t.section_key=k and t.active and t.status not in ('complete','non_concerne') loop
   if u is not null then
    n:=n+1;
    perform journal_cr_private.notify(u,r.chantier_id,rid,k,null,'CR off : horaires attendus','timing-remind:'||rid||':'||k||':'||u||':'||floor(extract(epoch from now())/300)::text);
   end if;
  end loop;
  if n=0 then raise exception 'Aucun responsable à relancer sur les périmètres en attente'; end if;
  perform journal_cr_private.log(rid,'relance',k);return '{}';
 end if;
 if coalesce(s.value->>'mode','')<>'perimeters' then raise exception 'Configurer les périmètres de cette rubrique'; end if;
 select * into t from journal_cr_private.timings where id=(p_payload->>'timing_id')::uuid and report_id=rid and section_key=k and active for update;
 if not found then raise exception 'Périmètre introuvable ou retiré'; end if;
 if t.version is distinct from (p_payload->>'version')::int then raise exception 'Ce périmètre a été modifié par une autre personne : actualiser avant d’enregistrer'; end if;
 old:=to_jsonb(t);
 if p_action='timing_assign' then
  if not journal_cr_private.manager(r.chantier_id) then raise exception 'Attribution réservée à l’encadrant'; end if;
  note:=trim(coalesce(p_payload->>'label',t.label));
  if t.catalog_id is null and length(note) not between 1 and 500 then raise exception 'Préciser un libellé de périmètre de 1 à 500 caractères'; end if;
  target:=nullif(p_payload->>'responsible','')::uuid;
  if target is not null and not journal_cr_private.member(target,r.chantier_id) then raise exception 'Personne sans accès au chantier'; end if;
  update journal_cr_private.timings set label=case when t.catalog_id is null then note else t.label end,responsible=target,due_at=nullif(p_payload->>'due_at','')::timestamptz,version=version+1 where id=t.id;
  perform journal_cr_private.notify(coalesce(target,s.responsible),r.chantier_id,rid,k,null,'CR off : périmètre à renseigner','timing-assign:'||t.id||':'||(t.version+1));
 elsif p_action='timing_plan' then
  if not journal_cr_private.manager(r.chantier_id) then raise exception 'Prévision réservée à l’encadrant'; end if;
  t0:=nullif(p_payload->>'start','')::timestamptz;t1:=nullif(p_payload->>'end','')::timestamptz;
  perform journal_cr_private.check_timing(r.night,t0,t1);
  update journal_cr_private.timings set planned_start=t0,planned_end=t1,version=version+1 where id=t.id;
 else
  t0:=nullif(p_payload->>'start','')::timestamptz;t1:=nullif(p_payload->>'end','')::timestamptz;
  perform journal_cr_private.check_timing(r.night,t0,t1);
  st:=coalesce(p_payload->>'status','auto');note:=trim(coalesce(p_payload->>'comment',''));
  if length(note)>1000 then raise exception 'Remarque limitée à 1 000 caractères'; end if;
  if st='auto' then st:=case when t0 is not null and t1 is not null then 'complete' when t0 is not null or t1 is not null then 'en_cours' else 'a_renseigner' end; end if;
  if st not in ('a_renseigner','en_cours','complete','a_confirmer','non_concerne') then raise exception 'État invalide'; end if;
  if st='complete' and (t0 is null or t1 is null) then raise exception 'Début et fin requis pour ce périmètre'; end if;
  if st='non_concerne' and length(note)<3 then raise exception 'Préciser pourquoi ce périmètre est non concerné'; end if;
  update journal_cr_private.timings set actual_start=t0,actual_end=t1,status=st,comment=note,version=version+1,updated_by=uid,updated_name=journal_cr_private.person(),updated_at=now() where id=t.id;
 end if;
 perform journal_cr_private.refresh_timing_section(rid,k);
 perform journal_cr_private.log(rid,p_action,k,jsonb_build_object('before',old,'after',(select to_jsonb(x) from journal_cr_private.timings x where x.id=t.id)));
 return '{}';
end;
$$;

create or replace function journal_cr_private.notification_allowed(n journal_cr_private.notifications) returns boolean language sql stable security definer set search_path='' as $$
 select journal_cr_private.member(n.user_id,n.chantier_id) and (n.kind='message' and exists(select 1 from public.chantier_messages where id=n.message_id and deleted_at is null)
 or n.kind='cr' and exists(select 1 from journal_cr_private.reports r join journal_cr_private.sections s on s.report_id=r.id and s.key=n.section_key where r.id=n.report_id and
 (n.user_id=any(r.collaborators) or n.user_id=s.responsible or n.user_id=any(s.contributors)
 or exists(select 1 from journal_cr_private.timings t where t.report_id=r.id and t.section_key=n.section_key and t.active and t.responsible=n.user_id)
 or exists(select 1 from public.journal_administrators where user_id=n.user_id and role in ('proprietaire','administrateur_general'))
 or exists(select 1 from public.chantier_members where user_id=n.user_id and chantier_id=n.chantier_id and role='administrateur'))));
$$;
create or replace function journal_cr_private.email_text(p_snapshots jsonb) returns text language plpgsql stable set search_path='' as $$
declare report jsonb; s jsonb; t jsonb; txt text:='CR ENCADREMENT — diffusion restreinte'; label text;
begin
 for report in select * from jsonb_array_elements(p_snapshots) loop
  txt:=txt||E'\n\n'||(report->>'chantier')||' · nuit du '||(report->>'night')||' · v'||(report->>'revision');
  for s in select * from jsonb_array_elements(report->'sections') order by case value->>'key' when 'catenaire' then 1 when 'itc' then 2 when 'arf' then 3 when 'technique' then 4 when 'securite' then 5 else 6 end loop
   label:=case s->>'key' when 'catenaire' then 'Consignation caténaire · S11' when 'itc' then 'ITC · S9' when 'arf' then 'ARF' when 'technique' then 'Production / technique' when 'securite' then 'Sécurité' else 'Synthèse' end;
   txt:=txt||E'\n'||label||' : ';
   if s->>'status'='non_concerne' then txt:=txt||'Non concerné';
   elsif s#>>'{value,mode}'='perimeters' then
    for t in select * from jsonb_array_elements(coalesce(s->'items','[]')) where coalesce((value->>'active')::boolean,true) loop
     txt:=txt||E'\n • '||(t->>'label')||' : ';
     if t->>'status'='non_concerne' then txt:=txt||'Non concerné';
     else txt:=txt||coalesce(to_char((t->>'actual_start')::timestamptz at time zone 'Europe/Paris','DD/MM HH24:MI'),'?')||' → '||coalesce(to_char((t->>'actual_end')::timestamptz at time zone 'Europe/Paris','DD/MM HH24:MI'),'?'); end if;
     if t->>'comment'<>'' then txt:=txt||' — '||(t->>'comment'); end if;
     if (t->>'actual_start')::timestamptz>(t->>'planned_start')::timestamptz then txt:=txt||' · accord +'||ceil(extract(epoch from ((t->>'actual_start')::timestamptz-(t->>'planned_start')::timestamptz))/60)::text||' min'; end if;
     if (t->>'actual_end')::timestamptz>(t->>'planned_end')::timestamptz then txt:=txt||' · restitution +'||ceil(extract(epoch from ((t->>'actual_end')::timestamptz-(t->>'planned_end')::timestamptz))/60)::text||' min'; end if;
    end loop;
   elsif s->>'key' in ('catenaire','itc','arf') then
    txt:=txt||coalesce(to_char((s#>>'{value,start}')::timestamptz at time zone 'Europe/Paris','DD/MM HH24:MI'),'?')||' → '||coalesce(to_char((s#>>'{value,end}')::timestamptz at time zone 'Europe/Paris','DD/MM HH24:MI'),'?');
    if coalesce(s#>>'{value,precision}','')<>'' then txt:=txt||' — '||(s#>>'{value,precision}'); end if;
   else txt:=txt||coalesce(s#>>'{value,digest}',''); end if;
  end loop;
 end loop;
 return txt||E'\n\nHoraires affichés en heure de Paris. Copie de la version validée dans le Journal de chantier.';
end;
$$;
revoke all on all tables in schema journal_cr_private from public,anon,authenticated,service_role;
revoke all on all functions in schema journal_cr_private from public,anon,authenticated,service_role;
revoke all on function public.journal_cr_api(text,jsonb) from public,anon,service_role;
grant execute on function public.journal_cr_api(text,jsonb) to authenticated;
COMMIT;
