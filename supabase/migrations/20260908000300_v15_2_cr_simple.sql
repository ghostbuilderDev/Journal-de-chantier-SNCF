BEGIN;
-- Additive: retain old timings, catalog, contributions and immutable snapshots.
create table if not exists journal_cr_private.week_plans (
 chantier_id uuid references public.chantiers(id) on delete cascade,
 week_start date not null, section_key text not null check(section_key in ('catenaire','itc','arf')),
 night date not null, rows jsonb not null, updated_at timestamptz default now(),
 primary key(chantier_id,week_start,section_key)
);
create table if not exists journal_cr_private.request_prefs (
 id uuid primary key default gen_random_uuid(), report_id uuid not null references journal_cr_private.reports(id) on delete cascade,
 section_key text not null check(section_key in ('catenaire','itc','arf')),user_id uuid not null,
 generation integer not null default 1, dismissed_token text not null default '', muted boolean not null default false,
 reminder_for timestamptz, unique(report_id,section_key,user_id)
);
do $$ begin
 if to_regprocedure('journal_cr_private.api_v151(text,jsonb)') is null then
  alter function public.journal_cr_api(text,jsonb) set schema journal_cr_private;
  alter function journal_cr_private.journal_cr_api(text,jsonb) rename to api_v151;
 end if;
end $$;

-- Only participants already admitted to the private CR can add production/safety.
create or replace function journal_cr_private.section_access(p_id uuid,p_key text) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce((select journal_cr_private.member(auth.uid(),r.chantier_id) and
 (journal_cr_private.full_access(r.id) or s.responsible=auth.uid() or auth.uid()=any(s.contributors)
 or exists(select 1 from journal_cr_private.timings t where t.report_id=r.id and t.section_key=p_key and t.active and t.responsible=auth.uid())
 or p_key in ('technique','securite') and exists(select 1 from journal_cr_private.sections a where a.report_id=r.id and a.key in ('catenaire','itc','arf') and
 (a.responsible=auth.uid() or auth.uid()=any(a.contributors) or exists(select 1 from journal_cr_private.timings t where t.report_id=r.id and t.section_key=a.key and t.active and t.responsible=auth.uid()))))
 from journal_cr_private.reports r join journal_cr_private.sections s on s.report_id=r.id where r.id=p_id and s.key=p_key),false);
$$;

create or replace view journal_cr_private.request_candidates as
 select q.report_id,q.section_key,q.user_id,r.chantier_id,r.night,c.name chantier,min(q.expected_end) expected_end
 from (
 select s.report_id,s.key section_key,coalesce(t.responsible,s.responsible) user_id,
 case when t.actual_end is null then t.planned_end end expected_end
 from journal_cr_private.sections s join journal_cr_private.timings t on t.report_id=s.report_id and t.section_key=s.key
 where s.key in ('catenaire','itc') and t.active and t.status not in ('complete','non_concerne')
 union all
 select s.report_id,s.key,s.responsible,case when nullif(s.value->>'end','') is null then coalesce(nullif(s.value->>'planned_end','')::timestamptz,s.due_at) end
 from journal_cr_private.sections s where s.key in ('catenaire','itc','arf') and s.status not in ('complete','non_concerne')
 and (s.key='arf' or not exists(select 1 from journal_cr_private.timings t where t.report_id=s.report_id and t.section_key=s.key and t.active))
 ) q join journal_cr_private.reports r on r.id=q.report_id join public.chantiers c on c.id=r.chantier_id
 where r.state='draft' and q.user_id is not null and journal_cr_private.member(q.user_id,r.chantier_id)
 group by q.report_id,q.section_key,q.user_id,r.chantier_id,r.night,c.name;

create or replace function journal_cr_private.sync_requests(p_id uuid,p_key text default null,p_bump boolean default false) returns void
language plpgsql security definer set search_path='' as $$
begin
 insert into journal_cr_private.request_prefs(report_id,section_key,user_id)
 select report_id,section_key,user_id from journal_cr_private.request_candidates where report_id=p_id and (p_key is null or section_key=p_key)
 on conflict(report_id,section_key,user_id) do update set
 generation=journal_cr_private.request_prefs.generation+case when p_bump then 1 else 0 end,
 muted=case when p_bump then false else journal_cr_private.request_prefs.muted end,
 reminder_for=case when p_bump then null else journal_cr_private.request_prefs.reminder_for end;
end;
$$;
create or replace function journal_cr_private.remind_due() returns void
language plpgsql security definer set search_path='' as $$
declare q record;
begin
 for q in select p.id,p.user_id,p.report_id,p.section_key,c.chantier_id,c.expected_end from journal_cr_private.request_prefs p
 join journal_cr_private.request_candidates c using(report_id,section_key,user_id)
 where not p.muted and c.expected_end between now()-interval '12 hours' and now()+interval '1 hour'
 and p.reminder_for is distinct from c.expected_end for update of p skip locked loop
  update journal_cr_private.request_prefs set reminder_for=q.expected_end where id=q.id;
  perform journal_cr_private.notify(q.user_id,q.chantier_id,q.report_id,q.section_key,null,'CR off : pensez à renseigner la fin réelle',
   'v152-end:'||q.id||':'||q.expected_end::text);
 end loop;
end;
$$;
create or replace function journal_cr_private.tasks(p_user uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(q) order by q.night desc,q.chantier,q.section_key),'[]') from (
 select c.*,p.id,p.muted,p.generation::text||':'||coalesce(p.reminder_for::text,'initial') token,p.dismissed_token,
 p.reminder_for is not null reminder
 from journal_cr_private.request_candidates c join journal_cr_private.request_prefs p using(report_id,section_key,user_id)
 where c.user_id=p_user
 ) q;
$$;
-- A template contains local planned hours only; never actual hours or comments.
create or replace function journal_cr_private.shift_hour(p_hour timestamptz,p_days int) returns timestamptz
language plpgsql immutable set search_path='' as $$
declare local_hour timestamp; shifted timestamptz;
begin
 if p_hour is null then return null; end if;
 local_hour:=(p_hour at time zone 'Europe/Paris')+p_days*interval '1 day';shifted:=local_hour at time zone 'Europe/Paris';
 if (shifted at time zone 'Europe/Paris')<>local_hour or ((shifted+interval '1 hour') at time zone 'Europe/Paris')=local_hour
 or ((shifted-interval '1 hour') at time zone 'Europe/Paris')=local_hour then
 raise exception 'Changement d’heure : créer la nuit sans reprise et confirmer les horaires prévus'; end if;
 return shifted;
end;
$$;

create or replace function public.journal_cr_api(p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare uid uuid:=auth.uid();rid uuid;k text:=p_payload->>'key';r journal_cr_private.reports;s journal_cr_private.sections;
 t journal_cr_private.timings;x jsonb;result jsonb;old jsonb;kept uuid[]:='{}';target uuid;v0 timestamptz;v1 timestamptz;
 plan journal_cr_private.week_plans;responsible uuid;txt text;existing boolean;pref journal_cr_private.request_prefs;
begin
 if uid is null or not public.journal_v142_is_active() then raise exception 'Connexion active requise'; end if;
 if octet_length(p_payload::text)>200000 then raise exception 'Demande trop volumineuse'; end if;
 if p_action='tasks' then
  for rid in select distinct report_id from journal_cr_private.request_candidates where user_id=uid loop
   perform journal_cr_private.sync_requests(rid);end loop;
  return journal_cr_private.tasks(uid);
 elsif p_action='task_ack' then
  select * into pref from journal_cr_private.request_prefs where id=(p_payload->>'task_id')::uuid and user_id=uid for update;
  if not found or not exists(select 1 from journal_cr_private.request_candidates where report_id=pref.report_id and section_key=pref.section_key and user_id=uid) then raise exception 'Demande inaccessible'; end if;
  if p_payload->>'token' is distinct from pref.generation::text||':'||coalesce(pref.reminder_for::text,'initial') then raise exception 'Demande actualisée : rouvrir les demandes'; end if;
  update journal_cr_private.request_prefs set dismissed_token=p_payload->>'token',muted=coalesce((p_payload->>'muted')::boolean,muted) where id=pref.id;return '{}';
 elsif p_action='inbox' then
  return (select coalesce(jsonb_agg(to_jsonb(q) order by created_at desc),'[]') from (select n.* from journal_cr_private.notifications n
   where n.user_id=uid and journal_cr_private.notification_allowed(n) order by created_at desc limit 100) q);
 elsif p_action='list' then
  result:=journal_cr_private.api_v151(p_action,p_payload);
  return (select coalesce(jsonb_agg(x||jsonb_build_object('total',(select count(*) from journal_cr_private.sections s where s.report_id=(x->>'id')::uuid and s.key<>'synthese' and journal_cr_private.section_access(s.report_id,s.key)),
   'completed',(select count(*) from journal_cr_private.sections s where s.report_id=(x->>'id')::uuid and s.key<>'synthese' and s.status in ('complete','non_concerne') and journal_cr_private.section_access(s.report_id,s.key)))),'[]') from jsonb_array_elements(result) x);
 elsif p_action='catalog' then
  if not journal_cr_private.manager((p_payload->>'chantier_id')::uuid) then raise exception 'Liste réservée à l’encadrant'; end if;
  return jsonb_build_object('catalog','[]'::jsonb,'contacts',(select coalesce(jsonb_agg(to_jsonb(c) order by name),'[]') from journal_cr_private.contact_suggestions c));
 elsif p_action='timing_batch' then
  rid:=(p_payload->>'id')::uuid;select * into r from journal_cr_private.reports where id=rid for update;
  if not found or not journal_cr_private.section_access(rid,k) or k not in ('catenaire','itc') then raise exception 'Rubrique inaccessible';end if;
  if r.state<>'draft' then raise exception 'CR figé : créer un rectificatif';end if;
  select * into s from journal_cr_private.sections where report_id=rid and key=k for update;
  if s.version is distinct from (p_payload->>'version')::int then raise exception 'Tableau modifié : actualiser avant d’enregistrer';end if;
  if jsonb_typeof(p_payload->'rows') is distinct from 'array' or jsonb_array_length(p_payload->'rows')>100 then raise exception 'Tableau invalide';end if;
  for x in select * from jsonb_array_elements(p_payload->'rows') loop
   perform journal_cr_private.api_v151('timing_save',x||jsonb_build_object('id',rid,'key',k));
  end loop;
  return '{}';
 elsif p_action='create' then
  perform pg_advisory_xact_lock(hashtextextended(coalesce(p_payload->>'chantier_id','')||coalesce(p_payload->>'night',''),0));
  select exists(select 1 from journal_cr_private.reports where chantier_id=(p_payload->>'chantier_id')::uuid and night=(p_payload->>'night')::date) into existing;
  result:=journal_cr_private.api_v151(p_action,p_payload);rid:=(result->>'id')::uuid;
  if not existing then
   select * into r from journal_cr_private.reports where id=rid;
   update journal_cr_private.sections set responsible=null,due_at=null where report_id=rid and key in ('technique','securite','synthese');
   update journal_cr_private.sections set status='non_concerne' where report_id=rid and key='synthese';
   if coalesce((p_payload->>'reuse')::boolean,false) then
    for plan in select * from journal_cr_private.week_plans where chantier_id=r.chantier_id and week_start=date_trunc('week',r.night::timestamp)::date loop
     if plan.section_key='arf' then
      update journal_cr_private.sections set value=value||jsonb_build_object('planned_end',journal_cr_private.shift_hour((plan.rows->0->>'planned_end')::timestamptz,r.night-plan.night)) where report_id=rid and key='arf';
     else
      update journal_cr_private.timings set active=false where report_id=rid and section_key=plan.section_key;
      for x in select * from jsonb_array_elements(plan.rows) loop
       select id into target from journal_cr_private.timings where report_id=rid and section_key=plan.section_key and label=x->>'label' limit 1;
       v0:=journal_cr_private.shift_hour((x->>'planned_start')::timestamptz,r.night-plan.night);
       v1:=journal_cr_private.shift_hour((x->>'planned_end')::timestamptz,r.night-plan.night);
       if target is null then insert into journal_cr_private.timings(report_id,section_key,label,planned_start,planned_end) values(rid,plan.section_key,x->>'label',v0,v1);
       else update journal_cr_private.timings set active=true,planned_start=v0,planned_end=v1 where id=target;end if;
      end loop;
      perform journal_cr_private.refresh_timing_section(rid,plan.section_key);
      if jsonb_array_length(plan.rows)=0 then update journal_cr_private.sections set status='non_concerne' where report_id=rid and key=plan.section_key;end if;
     end if;
    end loop;
   end if;
   perform journal_cr_private.sync_requests(rid);
  end if;
  return result;
 elsif p_action='detail' then
  result:=journal_cr_private.api_v151(p_action,p_payload);rid:=(result->>'id')::uuid;
  return result||jsonb_build_object('sections',(select coalesce(jsonb_agg(x),'[]') from jsonb_array_elements(result->'sections') x where x->>'key'<>'synthese'),
   'legacy_synthesis',(select x->'value' from jsonb_array_elements(result->'sections') x where x->>'key'='synthese'),
   'choices',case when (result->>'manager')::boolean then (select coalesce(jsonb_agg(to_jsonb(q)),'[]') from
    (select distinct t.section_key,t.label from journal_cr_private.timings t join journal_cr_private.reports a on a.id=t.report_id
     where a.chantier_id=(result->>'chantier_id')::uuid order by t.section_key,t.label limit 200) q) else '[]'::jsonb end);
 elsif p_action in ('timing_table','production_save','safety_clear','arf_save') then
  rid:=(p_payload->>'id')::uuid;select * into r from journal_cr_private.reports where id=rid for update;
  if not found or not journal_cr_private.member(uid,r.chantier_id) or not journal_cr_private.section_access(rid,k) then raise exception 'Rubrique inaccessible';end if;
  if r.state<>'draft' then raise exception 'CR figé : créer un rectificatif';end if;
  select * into s from journal_cr_private.sections where report_id=rid and key=k for update;
  if s.version is distinct from (p_payload->>'version')::int then raise exception 'Rubrique modifiée par une autre personne : actualiser avant d’enregistrer';end if;
  if p_action='timing_table' then
   if k not in ('catenaire','itc') or not journal_cr_private.manager(r.chantier_id) then raise exception 'Configuration réservée à l’encadrant';end if;
   if jsonb_typeof(p_payload->'rows') is distinct from 'array' or jsonb_array_length(p_payload->'rows')>40 then raise exception 'Tableau invalide (40 lignes maximum)';end if;
   if exists(select 1 from jsonb_array_elements(p_payload->'rows') q group by q->>'id' having q->>'id' is not null and count(*)>1) then raise exception 'Ligne répétée';end if;
   if exists(select 1 from jsonb_array_elements(p_payload->'rows') q where coalesce((q->>'selected')::boolean,true)
    group by lower(trim(q->>'label')) having count(*)>1) then raise exception 'Chaque référence doit être unique dans ce tableau';end if;
   responsible:=nullif(p_payload->>'responsible','')::uuid;
   if responsible is not null and not journal_cr_private.member(responsible,r.chantier_id) then raise exception 'Personne sans accès au chantier';end if;
   old:=journal_cr_private.timing_json(rid,k);
   if coalesce(s.value->>'mode','')<>'perimeters' and (s.value->>'start' is not null or s.value->>'end' is not null) then
    insert into journal_cr_private.timings(report_id,section_key,label,actual_start,actual_end,comment,status,updated_by,updated_name,updated_at)
    values(rid,k,'Ancien périmètre global — à préciser',(s.value->>'start')::timestamptz,(s.value->>'end')::timestamptz,coalesce(s.value->>'precision',''),'a_confirmer',s.updated_by,s.updated_name,s.updated_at) returning id into target;
    kept:=array_append(kept,target);
   end if;
   for x in select * from jsonb_array_elements(p_payload->'rows') loop
    target:=nullif(x->>'id','')::uuid;
    if target is not null then
     select * into t from journal_cr_private.timings where id=target and report_id=rid and section_key=k for update;
     if not found or t.version is distinct from (x->>'version')::int then raise exception 'Ligne modifiée : actualiser le tableau';end if;
    end if;
    if not coalesce((x->>'selected')::boolean,true) then continue;end if;
    txt:=trim(coalesce(x->>'label',''));if length(txt) not between 1 and 500 then raise exception 'Préciser le secteur, le SEL ou la ZEP';end if;
    v0:=nullif(x->>'planned_start','')::timestamptz;v1:=nullif(x->>'planned_end','')::timestamptz;
    perform journal_cr_private.check_timing(r.night,v0,v1);
    if target is null then
     insert into journal_cr_private.timings(report_id,section_key,label,planned_start,planned_end) values(rid,k,txt,v0,v1) returning id into target;
    else
     if t.label<>txt and (t.actual_start is not null or t.actual_end is not null) and length(trim(coalesce(p_payload->>'reason','')))<5 then raise exception 'Indiquer le motif du changement de référence déjà renseignée';end if;
     update journal_cr_private.timings set label=txt,planned_start=v0,planned_end=v1,active=true,responsible=null,version=version+1 where id=target;
    end if;
    kept:=array_append(kept,target);
   end loop;
   if exists(select 1 from journal_cr_private.timings where report_id=rid and section_key=k and active and not(id=any(kept)) and (actual_start is not null or actual_end is not null)) and length(trim(coalesce(p_payload->>'reason','')))<5 then raise exception 'Indiquer le motif du retrait d’une ligne déjà renseignée';end if;
   update journal_cr_private.timings set active=false,version=version+1 where report_id=rid and section_key=k and active and not(id=any(kept));
   update journal_cr_private.sections set value=value||'{"mode":"perimeters"}',responsible=nullif(p_payload->>'responsible','')::uuid where report_id=rid and key=k;
   perform journal_cr_private.refresh_timing_section(rid,k);
   if cardinality(kept)=0 then update journal_cr_private.sections set status='non_concerne' where report_id=rid and key=k;end if;
   if coalesce((p_payload->>'remember_week')::boolean,false) then
    insert into journal_cr_private.week_plans(chantier_id,week_start,section_key,night,rows)
    values(r.chantier_id,date_trunc('week',r.night::timestamp)::date,k,r.night,
     (select coalesce(jsonb_agg(jsonb_build_object('label',label,'planned_start',planned_start,'planned_end',planned_end) order by label),'[]') from journal_cr_private.timings where report_id=rid and section_key=k and active))
    on conflict(chantier_id,week_start,section_key) do update set night=excluded.night,rows=excluded.rows,updated_at=now();
   end if;
   perform journal_cr_private.log(rid,'tableau',k,jsonb_build_object('before',old,'after',journal_cr_private.timing_json(rid,k),'reason',left(p_payload->>'reason',1000)));
   perform journal_cr_private.sync_requests(rid,k,true);
   perform journal_cr_private.notify(responsible,r.chantier_id,rid,k,null,'CR off : horaires à renseigner','v152-table:'||rid||':'||k||':'||s.version);
  elsif p_action='production_save' then
   if k<>'technique' then raise exception 'Rubrique invalide';end if;
   txt:=trim(coalesce(p_payload->>'body',''));if length(txt) not between 1 and 8000 then raise exception 'Production requise (8 000 caractères maximum)';end if;
   update journal_cr_private.sections set value=jsonb_build_object('body',txt),status='complete',version=version+1,updated_by=uid,updated_name=journal_cr_private.person(),updated_at=now() where report_id=rid and key=k;
   perform journal_cr_private.log(rid,'production',k,jsonb_build_object('before',s.value,'after',txt));
  elsif p_action='safety_clear' then
   if k<>'securite' then raise exception 'Rubrique invalide';end if;
   if exists(select 1 from journal_cr_private.notes where report_id=rid and section_key=k) then raise exception 'Des observations sont déjà présentes';end if;
   update journal_cr_private.sections set status='non_concerne',version=version+1,updated_by=uid,updated_name=journal_cr_private.person(),updated_at=now() where report_id=rid and key=k;
  else
   if k<>'arf' then raise exception 'Rubrique invalide';end if;
   v0:=nullif(p_payload->>'start','')::timestamptz;v1:=nullif(p_payload->>'end','')::timestamptz;perform journal_cr_private.check_timing(r.night,v0,v1);
   txt:=trim(coalesce(p_payload->>'comment',''));if length(txt)>1000 then raise exception 'Commentaire trop long';end if;
   update journal_cr_private.sections set value=value||jsonb_build_object('start',v0,'end',v1,'precision',txt),
    status=case when coalesce((p_payload->>'non_concerne')::boolean,false) and v0 is null and v1 is null then 'non_concerne' when v0 is not null and v1 is not null then 'complete' when v0 is not null or v1 is not null then 'en_cours' else 'a_renseigner' end,
    version=version+1,updated_by=uid,updated_name=journal_cr_private.person(),updated_at=now() where report_id=rid and key=k;
   if journal_cr_private.manager(r.chantier_id) and p_payload ? 'planned_end' then
    perform journal_cr_private.check_timing(r.night,null,nullif(p_payload->>'planned_end','')::timestamptz);
    responsible:=nullif(p_payload->>'responsible','')::uuid;
    if responsible is not null and not journal_cr_private.member(responsible,r.chantier_id) then raise exception 'Personne sans accès au chantier';end if;
    update journal_cr_private.sections set responsible=nullif(p_payload->>'responsible','')::uuid,value=value||jsonb_build_object('planned_end',nullif(p_payload->>'planned_end','')::timestamptz) where report_id=rid and key=k;
    if coalesce((p_payload->>'remember_week')::boolean,false) then
     insert into journal_cr_private.week_plans values(r.chantier_id,date_trunc('week',r.night::timestamp)::date,k,r.night,jsonb_build_array(jsonb_build_object('planned_end',p_payload->>'planned_end')),now())
     on conflict(chantier_id,week_start,section_key) do update set night=excluded.night,rows=excluded.rows,updated_at=now();end if;
    perform journal_cr_private.sync_requests(rid,k,s.responsible is distinct from responsible);
    if s.responsible is distinct from responsible then perform journal_cr_private.notify(responsible,r.chantier_id,rid,k,null,'CR off : ARF à renseigner','v152-arf:'||rid||':'||s.version);end if;
   end if;
   perform journal_cr_private.log(rid,'arf',k,jsonb_build_object('before',s.value,'after',(select value from journal_cr_private.sections where report_id=rid and key=k)));
  end if;
  update journal_cr_private.reports set updated_at=now() where id=rid;return '{}';
 else
  if p_action in ('assign','timing_assign','remind') and k not in ('catenaire','itc','arf') then raise exception 'Demandes limitées aux consignations, ITC et ARF';end if;
  rid:=nullif(p_payload->>'id','')::uuid;
  if p_action='validate' then
   if not exists(select 1 from journal_cr_private.reports where id=rid and state='draft' and journal_cr_private.manager(chantier_id)) then raise exception 'Validation réservée à l’encadrant';end if;
   update journal_cr_private.sections set status='non_concerne' where report_id=rid and key='synthese';
  end if;
  if p_action='note' and k='securite' and coalesce(p_payload->>'category','') not in ('top','flop') then raise exception 'Choisir Top ou Flop';end if;
  if p_action='save' and k='arf' then select value into old from journal_cr_private.sections where report_id=rid and key=k;end if;
  result:=journal_cr_private.api_v151(p_action,p_payload);
  if p_action='save' and k='arf' and old ? 'planned_end' then
   update journal_cr_private.sections set value=value||jsonb_build_object('planned_end',old->'planned_end') where report_id=rid and key=k;
  end if;
  if p_action='note' and k='securite' then update journal_cr_private.sections set status='complete' where report_id=rid and key=k;end if;
  if p_action in ('assign','timing_assign','timing_configure','remind','reopen','timing_save','save') and rid is not null then
   perform journal_cr_private.sync_requests(rid,case when p_action='reopen' then null else k end,p_action in ('assign','timing_assign','remind'));
  end if;
  return result;
 end if;
end;
$$;
-- A former safety digest without individual notes stays visible in the new editor.
insert into journal_cr_private.notes(id,report_id,section_key,category,body,author_id,author_name,created_at)
 select gen_random_uuid(),s.report_id,'securite','precision',s.value->>'digest',coalesce(s.updated_by,r.created_by),coalesce(s.updated_name,'Utilisateur'),coalesce(s.updated_at,r.created_at)
 from journal_cr_private.sections s join journal_cr_private.reports r on r.id=s.report_id
 where s.key='securite' and r.state='draft' and length(trim(coalesce(s.value->>'digest',''))) between 1 and 2000
 and not exists(select 1 from journal_cr_private.notes n where n.report_id=s.report_id and n.section_key='securite');
-- Preserve former authors and assignees as contributors, without new task obligations.
update journal_cr_private.sections s set contributors=case when responsible is not null and not(responsible=any(contributors)) then array_append(contributors,responsible) else contributors end,
 responsible=null,due_at=null where key in ('technique','securite','synthese') and exists(select 1 from journal_cr_private.reports r where r.id=s.report_id and r.state='draft');
insert into journal_cr_private.request_prefs(report_id,section_key,user_id) select report_id,section_key,user_id from journal_cr_private.request_candidates on conflict do nothing;
do $$ begin
 if to_regprocedure('cron.schedule(text,text,text)') is not null then
  perform cron.schedule('journal-v152-reminders','* * * * *','select journal_cr_private.remind_due(); select journal_cr_private.kick()');
 end if;
end $$;
-- Keep the exact legacy renderer for already validated versions.
do $$ begin
 if to_regprocedure('journal_cr_private.email_text_v151(jsonb)') is null then
  alter function journal_cr_private.email_text(jsonb) rename to email_text_v151;
  alter function journal_cr_private.snapshot(uuid) rename to snapshot_v151;
  alter function journal_cr_private.notification_allowed(journal_cr_private.notifications) rename to notification_allowed_v151;
 end if;
end $$;
create or replace function journal_cr_private.snapshot(p_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select v||jsonb_build_object('format','15.2','sections',(select jsonb_agg(x) from jsonb_array_elements(v->'sections') x where x->>'key'<>'synthese'))
 from (select journal_cr_private.snapshot_v151(p_id) v) q;
$$;
create or replace function journal_cr_private.notification_allowed(n journal_cr_private.notifications) returns boolean
language sql stable security definer set search_path='' as $$
 select journal_cr_private.notification_allowed_v151(n) and (n.kind<>'cr' or exists(
 select 1 from journal_cr_private.request_candidates c where c.report_id=n.report_id and c.section_key=n.section_key and c.user_id=n.user_id
 and (n.dedup not like 'v152-end:%' or exists(select 1 from journal_cr_private.request_prefs p where p.report_id=c.report_id and p.section_key=c.section_key and p.user_id=c.user_id and not p.muted and n.dedup='v152-end:'||p.id||':'||c.expected_end::text))));
$$;
create or replace function journal_cr_private.email_clock(p_value text) returns text language sql stable set search_path='' as $$
 select coalesce(to_char(nullif(p_value,'')::timestamptz at time zone 'Europe/Paris','DD/MM HH24:MI'),'—');
$$;
create or replace function journal_cr_private.email_text(p_snapshots jsonb) returns text language plpgsql stable set search_path='' as $$
declare r jsonb;s jsonb;t jsonb;n jsonb;txt text:='CR OFF — DIFFUSION RESTREINTE';label text;
begin
 for r in select * from jsonb_array_elements(p_snapshots) loop
  if coalesce(r->>'format','')<>'15.2' then txt:=txt||E'\n\n'||journal_cr_private.email_text_v151(jsonb_build_array(r));continue;end if;
  txt:=txt||E'\n\n'||(r->>'chantier')||' · nuit du '||(r->>'night')||' · v'||(r->>'revision');
  for s in select * from jsonb_array_elements(r->'sections') order by case value->>'key' when 'technique' then 1 when 'securite' then 2 when 'catenaire' then 3 when 'itc' then 4 else 5 end loop
   label:=case s->>'key' when 'technique' then 'PRODUCTION RÉALISÉE' when 'securite' then 'SÉCURITÉ' when 'catenaire' then 'CONSIGNATIONS CATÉNAIRES' when 'itc' then 'ITC — ZEP PRISES' else 'ARF' end;
   txt:=txt||E'\n\n'||label||E'\n';
   if s->>'status'='non_concerne' then txt:=txt||case when s->>'key'='securite' then 'Rien à signaler' else 'Non concerné' end;
   elsif s->>'key'='technique' then
    txt:=txt||coalesce(s#>>'{value,body}',s#>>'{value,digest}',(select string_agg(value->>'body',E'\n') from jsonb_array_elements(coalesce(s->'notes','[]'))),'');
   elsif s->>'key'='securite' then
    for n in select * from jsonb_array_elements(coalesce(s->'notes','[]')) loop txt:=txt||' • '||upper(n->>'category')||' — '||(n->>'body')||' ('||(n->>'author_name')||')'||E'\n';end loop;
    if jsonb_array_length(coalesce(s->'notes','[]'))=0 then txt:=txt||coalesce(s#>>'{value,digest}','');end if;
   elsif s#>>'{value,mode}'='perimeters' then
    for t in select * from jsonb_array_elements(coalesce(s->'items','[]')) where (value->>'active')::boolean loop
     txt:=txt||' • '||(t->>'label')||E'\n   Prévu : '||journal_cr_private.email_clock(t->>'planned_start')||' → '||journal_cr_private.email_clock(t->>'planned_end');
     txt:=txt||E'\n   Réel : '||case when t->>'status'='non_concerne' then 'Non pris' else journal_cr_private.email_clock(t->>'actual_start')||' → '||journal_cr_private.email_clock(t->>'actual_end') end;
     if coalesce(t->>'comment','')<>'' then txt:=txt||E'\n   Commentaire : '||(t->>'comment');end if;
     txt:=txt||E'\n';
    end loop;
   else txt:=txt||'Début : '||journal_cr_private.email_clock(s#>>'{value,start}')||' · Fin : '||journal_cr_private.email_clock(s#>>'{value,end}');
    if coalesce(s#>>'{value,precision}','')<>'' then txt:=txt||E'\n'||(s#>>'{value,precision}');end if;
   end if;
  end loop;
 end loop;
 return txt||E'\n\nHoraires en heure de Paris. Version validée dans le Journal de chantier.';
end;
$$;

revoke all on all tables in schema journal_cr_private from public,anon,authenticated,service_role;
revoke all on all functions in schema journal_cr_private from public,anon,authenticated,service_role;
revoke all on function public.journal_cr_api(text,jsonb) from public,anon,service_role;
grant execute on function public.journal_cr_api(text,jsonb) to authenticated;
COMMIT;
