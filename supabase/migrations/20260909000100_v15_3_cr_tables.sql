BEGIN;
-- V15.3: one atomic editor; keep every previous record and immutable report.
do $$ begin
 if to_regprocedure('journal_cr_private.api_v152(text,jsonb)') is null then
  alter function public.journal_cr_api(text,jsonb) set schema journal_cr_private;
  alter function journal_cr_private.journal_cr_api(text,jsonb) rename to api_v152;
 end if;
end $$;

create or replace function public.journal_cr_api(p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare uid uuid:=auth.uid();rid uuid;k text:=p_payload->>'key';r journal_cr_private.reports;
 s journal_cr_private.sections;t journal_cr_private.timings;plan journal_cr_private.week_plans;
 x jsonb;result jsonb;batch jsonb:='[]';cfg boolean;ps timestamptz;pe timestamptz;old jsonb;existed boolean;
begin
 if uid is null or not public.journal_v142_is_active() then raise exception 'Connexion active requise';end if;
 if octet_length(p_payload::text)>200000 then raise exception 'Demande trop volumineuse';end if;
 if p_action='timing_sheet' then
  rid:=(p_payload->>'id')::uuid;
  select * into r from journal_cr_private.reports where id=rid for update;
  if not found or k not in ('catenaire','itc') or k is null or not journal_cr_private.section_access(rid,k) then raise exception 'Rubrique inaccessible';end if;
  if r.state<>'draft' then raise exception 'CR figé : créer un rectificatif';end if;
  select * into s from journal_cr_private.sections where report_id=rid and key=k for update;
  if s.version is distinct from (p_payload->>'version')::int then raise exception 'Tableau modifié : actualiser avant d’enregistrer';end if;
  if jsonb_typeof(p_payload->'rows') is distinct from 'array' or jsonb_array_length(p_payload->'rows')>40 then raise exception 'Tableau invalide (40 lignes maximum)';end if;
  cfg:=coalesce((p_payload->>'configure')::boolean,false);
  if cfg then
   -- This call checks manager rights, all original row versions, labels, planned
   -- times, historical removals and assignments, under the same report lock.
   perform journal_cr_private.api_v152('timing_table',p_payload);
  end if;
  for x in select * from jsonb_array_elements(p_payload->'rows') loop
   if cfg and not coalesce((x->>'selected')::boolean,true) then continue;end if;
   if cfg and nullif(x->>'id','') is null then
    select * into t from journal_cr_private.timings where report_id=rid and section_key=k and active and label=trim(x->>'label');
   else
    select * into t from journal_cr_private.timings where id=(x->>'id')::uuid and report_id=rid and section_key=k and active;
   end if;
   if not found then raise exception 'Ligne inaccessible : actualiser le tableau';end if;
   if not cfg and t.version is distinct from (x->>'version')::int then raise exception 'Ligne modifiée : actualiser le tableau';end if;
   -- Do not mark unchanged hours as a new contribution by the supervisor.
   if t.actual_start is distinct from nullif(x->>'start','')::timestamptz
    or t.actual_end is distinct from nullif(x->>'end','')::timestamptz
    or coalesce(t.comment,'') is distinct from trim(coalesce(x->>'comment',''))
    or (t.status='non_concerne') is distinct from (coalesce(x->>'status','auto')='non_concerne') then
    batch:=batch||jsonb_build_array(x||jsonb_build_object('timing_id',t.id,'version',t.version));
   end if;
  end loop;
  select version into s.version from journal_cr_private.sections where report_id=rid and key=k;
  if jsonb_array_length(batch)>0 then
   perform journal_cr_private.api_v152('timing_batch',jsonb_build_object('id',rid,'key',k,'version',s.version,'rows',batch));
  end if;
  if coalesce((p_payload->>'remember_week')::boolean,false) and journal_cr_private.manager(r.chantier_id) then
   insert into journal_cr_private.week_plans(chantier_id,week_start,section_key,night,rows)
   values(r.chantier_id,date_trunc('week',r.night::timestamp)::date,k,r.night,
    (select coalesce(jsonb_agg(jsonb_build_object('label',label,'planned_start',planned_start,'planned_end',planned_end) order by label),'[]') from journal_cr_private.timings where report_id=rid and section_key=k and active))
   on conflict(chantier_id,week_start,section_key) do update set night=excluded.night,rows=excluded.rows,updated_at=now();
  end if;
  return '{}';
 elsif p_action='arf_save' then
  rid:=(p_payload->>'id')::uuid;
  select * into r from journal_cr_private.reports where id=rid for update;
  if not found or k is distinct from 'arf' or not journal_cr_private.section_access(rid,k) then raise exception 'Rubrique inaccessible';end if;
  select value into old from journal_cr_private.sections where report_id=rid and key=k;
  if (p_payload ? 'planned_start' or p_payload ? 'planned_end' or p_payload ? 'responsible') and not journal_cr_private.manager(r.chantier_id) then raise exception 'Prévu et attribution réservés à l’encadrant';end if;
  if p_payload ? 'planned_start' or p_payload ? 'planned_end' then
   ps:=case when p_payload ? 'planned_start' then nullif(p_payload->>'planned_start','')::timestamptz else (old->>'planned_start')::timestamptz end;
   pe:=case when p_payload ? 'planned_end' then nullif(p_payload->>'planned_end','')::timestamptz else (old->>'planned_end')::timestamptz end;
   perform journal_cr_private.check_timing(r.night,ps,pe);
  end if;
  result:=journal_cr_private.api_v152(p_action,p_payload);
  if p_payload ? 'planned_start' then
   update journal_cr_private.sections set value=value||jsonb_build_object('planned_start',ps) where report_id=rid and key=k;
   perform journal_cr_private.log(rid,'prevu_arf',k,jsonb_build_object('before',old,'after',jsonb_build_object('planned_start',ps,'planned_end',pe)));
  end if;
  if coalesce((p_payload->>'remember_week')::boolean,false) and journal_cr_private.manager(r.chantier_id) and p_payload ? 'planned_end' then
   update journal_cr_private.week_plans set rows=jsonb_build_array(jsonb_build_object('planned_start',(select value->'planned_start' from journal_cr_private.sections where report_id=rid and key=k),'planned_end',p_payload->'planned_end'))
   where chantier_id=r.chantier_id and week_start=date_trunc('week',r.night::timestamp)::date and section_key=k;
  end if;
  return result;
 elsif p_action='create' then
  perform pg_advisory_xact_lock(hashtextextended(coalesce(p_payload->>'chantier_id','')||coalesce(p_payload->>'night',''),0));
  select exists(select 1 from journal_cr_private.reports where chantier_id=(p_payload->>'chantier_id')::uuid and night=(p_payload->>'night')::date) into existed;
  result:=journal_cr_private.api_v152(p_action,p_payload);rid:=(result->>'id')::uuid;
  if not existed and coalesce((p_payload->>'reuse')::boolean,false) then
   select * into r from journal_cr_private.reports where id=rid;
   select * into plan from journal_cr_private.week_plans where chantier_id=r.chantier_id and week_start=date_trunc('week',r.night::timestamp)::date and section_key='arf';
   if found then
    update journal_cr_private.sections set value=value||jsonb_build_object('planned_start',journal_cr_private.shift_hour((plan.rows->0->>'planned_start')::timestamptz,r.night-plan.night)) where report_id=rid and key='arf';
   end if;
  end if;
  return result;
 elsif p_action='save' and k='arf' then
  -- An older phone must not erase the new planned start when saving actuals.
  rid:=(p_payload->>'id')::uuid;
  select value into old from journal_cr_private.sections where report_id=rid and key=k for update;
  result:=journal_cr_private.api_v152(p_action,p_payload);
  if old ? 'planned_start' then update journal_cr_private.sections set value=value||jsonb_build_object('planned_start',old->'planned_start') where report_id=rid and key=k;end if;
  return result;
 end if;
 return journal_cr_private.api_v152(p_action,p_payload);
end $$;
revoke all on function journal_cr_private.api_v152(text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.journal_cr_api(text,jsonb) from public,anon,service_role;
grant execute on function public.journal_cr_api(text,jsonb) to authenticated;
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
   elsif s->>'key'='arf' and s->'value' ? 'planned_start' then
    txt:=txt||E' • ARF\n   Prévu : '||journal_cr_private.email_clock(s#>>'{value,planned_start}')||' → '||journal_cr_private.email_clock(s#>>'{value,planned_end}');
    txt:=txt||E'\n   Réel : '||journal_cr_private.email_clock(s#>>'{value,start}')||' → '||journal_cr_private.email_clock(s#>>'{value,end}');
    if coalesce(s#>>'{value,precision}','')<>'' then txt:=txt||E'\n   Commentaire : '||(s#>>'{value,precision}');end if;
   else txt:=txt||'Début : '||journal_cr_private.email_clock(s#>>'{value,start}')||' · Fin : '||journal_cr_private.email_clock(s#>>'{value,end}');
    if coalesce(s#>>'{value,precision}','')<>'' then txt:=txt||E'\n'||(s#>>'{value,precision}');end if;
   end if;
  end loop;
 end loop;
 return txt||E'\n\nHoraires en heure de Paris. Version validée dans le Journal de chantier.';
end;
$$;
revoke all on function journal_cr_private.email_text(jsonb) from public,anon,authenticated,service_role;
-- Restore only the intended authenticated RPC grants; author/admin checks remain
-- in each existing function. The anon Storage-policy helper is left intact.
do $$ declare f record;begin
 for f in select p.oid::regprocedure signature,p.prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('journal_feedback_context','journal_feedback_list','journal_feedback_get','journal_feedback_replies','journal_feedback_create_thread','journal_feedback_create_reply','journal_feedback_update_thread','journal_feedback_update_reply','journal_feedback_delete_thread','journal_feedback_delete_reply','journal_feedback_set_status') loop
  if not f.prosecdef then raise exception 'Service des signalements incompatible';end if;
  execute format('revoke all on function %s from public,anon',f.signature);
  execute format('grant execute on function %s to authenticated',f.signature);
 end loop;
end $$;
NOTIFY pgrst, 'reload schema';
COMMIT;
