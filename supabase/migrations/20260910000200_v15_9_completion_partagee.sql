BEGIN;
-- One shared draft per report. Production continues to use its existing source.
create table if not exists journal_cr_private.completions(
 report_id uuid primary key references journal_cr_private.reports(id) on delete cascade,
 state text not null default 'open' check(state in ('open','submitted')),
 version integer not null default 1,generation integer not null default 1,
 mode text not null default 'items' check(mode in ('items','text')),body text not null default '',safety_clear boolean not null default false,
 correction text not null default '',saved_at timestamptz,submitted_at timestamptz,submitted_by uuid,
 created_at timestamptz not null default now()
);
create table if not exists journal_cr_private.completion_agents(
 report_id uuid not null references journal_cr_private.completions(report_id) on delete cascade,user_id uuid not null,
 dismissed_token text not null default '',muted boolean not null default false,primary key(report_id,user_id)
);
create table if not exists journal_cr_private.completion_notes(
 id uuid primary key,report_id uuid not null references journal_cr_private.completions(report_id) on delete cascade,
 body text not null default '' check(length(body)<=2000),category text not null check(category in ('top','flop')),
 version integer not null default 1,deleted boolean not null default false,
 author_id uuid not null,author_name text not null,created_at timestamptz not null default now(),updated_name text not null
);
create index if not exists completion_notes_report on journal_cr_private.completion_notes(report_id,created_at,id);
create table if not exists journal_cr_private.completion_receipts(
 id uuid primary key,report_id uuid not null references journal_cr_private.completions(report_id) on delete cascade,
 actor_id uuid not null,action text not null,payload jsonb not null,created_at timestamptz not null default now()
);
alter table journal_cr_private.completions enable row level security;
alter table journal_cr_private.completion_agents enable row level security;
alter table journal_cr_private.completion_notes enable row level security;
alter table journal_cr_private.completion_receipts enable row level security;

create or replace function journal_cr_private.ensure_completion(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 insert into journal_cr_private.completions(report_id,mode,body,safety_clear)
 select p_id,coalesce(s.value->>'production_mode',case when jsonb_array_length(coalesce(s.value->'production_sheets','[]'))>0 then 'items' else 'text' end),coalesce(s.value->>'body',''),coalesce((select status='non_concerne' from journal_cr_private.sections where report_id=p_id and key='securite'),false)
 from journal_cr_private.sections s where s.report_id=p_id and s.key='technique' on conflict do nothing;
 insert into journal_cr_private.completion_notes(id,report_id,body,category,author_id,author_name,created_at,updated_name)
 select n.id,p_id,n.body,n.category,n.author_id,n.author_name,n.created_at,n.author_name from journal_cr_private.notes n
 where n.report_id=p_id and n.section_key='securite' and n.category in ('top','flop') on conflict do nothing;
end $$;

create or replace function journal_cr_private.completion_access(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select journal_cr_private.member(auth.uid(),r.chantier_id) and r.deleted_at is null
 and (journal_cr_private.manager(r.chantier_id) or exists(select 1 from journal_cr_private.completion_agents a where a.report_id=r.id and a.user_id=auth.uid()))
 from journal_cr_private.reports r where r.id=p_id),false);
$$;

create or replace function journal_cr_private.current_production(p journal_cr_private.production_sheets) returns boolean language sql stable security definer set search_path='' as $$
 select (p).created_at>coalesce((select z.reset_at from journal_cr_private.night_resets z where z.chantier_id=(p).chantier_id and z.night=(p).night),'-infinity'::timestamptz);
$$;

create or replace function journal_cr_private.completion_data(p_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select to_jsonb(b)||jsonb_build_object('id',r.id,'chantier_id',r.chantier_id,'chantier',c.name,'night',r.night,'report_state',r.state,
 'manager',journal_cr_private.manager(r.chantier_id),'submitted_name',(select full_name from public.profiles where id=b.submitted_by),
 'agents',(select coalesce(jsonb_agg(jsonb_build_object('id',a.user_id,'name',p.full_name) order by p.full_name),'[]') from journal_cr_private.completion_agents a join public.profiles p on p.id=a.user_id where a.report_id=r.id),
 'people',case when journal_cr_private.manager(r.chantier_id) then (select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.full_name) order by p.full_name),'[]') from public.profiles p where journal_cr_private.member(p.id,r.chantier_id)) else '[]'::jsonb end,
 'sheets',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'version',p.version,'items',p.items,'author_name',p.author_name,'updated_name',p.updated_name) order by p.created_at,p.id),'[]') from journal_cr_private.production_sheets p where p.chantier_id=r.chantier_id and p.night=r.night and journal_cr_private.current_production(p)),
 'notes',(select coalesce(jsonb_agg(to_jsonb(n) order by n.created_at,n.id),'[]') from journal_cr_private.completion_notes n where n.report_id=r.id and not n.deleted))
 from journal_cr_private.completions b join journal_cr_private.reports r on r.id=b.report_id join public.chantiers c on c.id=r.chantier_id where r.id=p_id;
$$;

create or replace function journal_cr_private.touch_completion_production() returns trigger language plpgsql security definer set search_path='' as $$
begin
 update journal_cr_private.completions b set version=b.version+1,saved_at=now() from journal_cr_private.reports r
 where r.id=b.report_id and r.chantier_id=new.chantier_id and r.night=new.night and journal_cr_private.current_production(new);
 return new;
end $$;
drop trigger if exists journal_completion_production on journal_cr_private.production_sheets;
create trigger journal_completion_production after insert or update of items on journal_cr_private.production_sheets for each row execute function journal_cr_private.touch_completion_production();

-- An assigned reader may fill this form, but gains no access to the full CR.
create or replace function journal_cr_private.can_fill_production(p_site uuid,p_night date) returns boolean language sql stable security definer set search_path='' as $$
 select journal_cr_private.member(auth.uid(),p_site) and (
 exists(select 1 from journal_cr_private.field_requests q join journal_cr_private.reports r on r.id=q.report_id where r.chantier_id=p_site and r.night=p_night and r.state='draft' and r.deleted_at is null and q.section_key='technique' and q.user_id=auth.uid() and q.state='open')
 or exists(select 1 from journal_cr_private.completion_agents a join journal_cr_private.completions b on b.report_id=a.report_id join journal_cr_private.reports r on r.id=b.report_id where a.user_id=auth.uid() and r.chantier_id=p_site and r.night=p_night and r.state='draft' and r.deleted_at is null and b.state='open'));
$$;

do $$ begin
 if to_regprocedure('journal_cr_private.api_v158(text,jsonb)') is null then
  alter function public.journal_cr_api(text,jsonb) set schema journal_cr_private;
  alter function journal_cr_private.journal_cr_api(text,jsonb) rename to api_v158;
 end if;
 if to_regprocedure('journal_cr_private.production_api_v158(text,jsonb)') is null then
  alter function public.journal_production_api(text,jsonb) set schema journal_cr_private;
  alter function journal_cr_private.journal_production_api(text,jsonb) rename to production_api_v158;
 end if;
 if to_regprocedure('journal_cr_private.tasks_v158(uuid)') is null then alter function journal_cr_private.tasks(uuid) rename to tasks_v158;end if;
 if to_regprocedure('journal_cr_private.notification_allowed_v158(journal_cr_private.notifications)') is null then alter function journal_cr_private.notification_allowed(journal_cr_private.notifications) rename to notification_allowed_v158;end if;
end $$;

create or replace function public.journal_production_api(p_action text,p_payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;rid uuid;sid uuid:=(p_payload->>'chantier_id')::uuid;d date:=(p_payload->>'night')::date;
begin
 if auth.uid() is null or not public.journal_v142_is_active() or not journal_cr_private.member(auth.uid(),sid) then raise exception 'Production inaccessible';end if;
 if p_action='save' then
  perform pg_advisory_xact_lock(hashtextextended(sid::text||d::text,0));
  if exists(select 1 from journal_cr_private.completions b join journal_cr_private.reports r on r.id=b.report_id where r.chantier_id=sid and r.night=d and b.state='submitted') and not journal_cr_private.manager(sid) then raise exception 'Complétude déjà transmise : demander une correction à l’encadrant';end if;
 end if;
 result:=journal_cr_private.production_api_v158(p_action,p_payload);
 if p_action='save' then
  select id into rid from journal_cr_private.reports where chantier_id=sid and night=d;
  perform journal_cr_private.ensure_completion(rid);
  update journal_cr_private.completions set mode='items' where report_id=rid and mode='text' and trim(body)='' and (select count(*) from journal_cr_private.production_sheets p where chantier_id=sid and night=d and journal_cr_private.current_production(p))=1;
  return result||jsonb_build_object('completion_id',rid,'completion_can_open',journal_cr_private.completion_access(rid));
 end if;
 return result;
end $$;

create or replace function journal_cr_private.publish_completion(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare b journal_cr_private.completions;data jsonb;
begin
 select * into b from journal_cr_private.completions where report_id=p_id;
 data:=journal_cr_private.completion_data(p_id);
 perform journal_cr_private.check_field(p_id,'technique',jsonb_build_object('mode',b.mode,'body',b.body,'sheets',data->'sheets'),true);
 if b.mode='items' and not exists(select 1 from jsonb_array_elements(data->'sheets') s cross join lateral jsonb_array_elements(s->'items') i) then raise exception 'Ajouter un travail ou choisir le descriptif libre';end if;
 if exists(select 1 from journal_cr_private.completion_notes where report_id=p_id and not deleted and length(trim(body))=0) then raise exception 'Compléter ou retirer l’observation de sécurité vide';end if;
 if not b.safety_clear and not exists(select 1 from journal_cr_private.completion_notes where report_id=p_id and not deleted) then raise exception 'Ajouter une observation de sécurité ou cocher Rien à signaler';end if;
 if exists(select 1 from journal_cr_private.completion_notes n join journal_cr_private.notes x on x.id=n.id where n.report_id=p_id and (x.report_id<>p_id or x.section_key<>'securite')) then raise exception 'Référence d’observation invalide';end if;
 delete from journal_cr_private.notes n using journal_cr_private.completion_notes x where x.id=n.id and x.report_id=p_id and x.deleted and n.report_id=p_id and n.section_key='securite';
 insert into journal_cr_private.notes(id,report_id,section_key,category,body,author_id,author_name,created_at)
 select id,p_id,'securite',category,trim(body),author_id,author_name,created_at from journal_cr_private.completion_notes where report_id=p_id and not deleted
 on conflict(id) do update set body=excluded.body,category=excluded.category;
 update journal_cr_private.sections set value=value||jsonb_build_object('body',b.body,'production_mode',b.mode),status='complete',version=version+1,updated_by=auth.uid(),updated_name=journal_cr_private.person(),updated_at=now() where report_id=p_id and key='technique';
 update journal_cr_private.sections set status=case when exists(select 1 from journal_cr_private.notes where report_id=p_id and section_key='securite') then 'complete' else 'non_concerne' end,value=value-'digest',version=version+1,updated_by=auth.uid(),updated_name=journal_cr_private.person(),updated_at=now() where report_id=p_id and key='securite';
 update journal_cr_private.reports set updated_at=now() where id=p_id;
end $$;

create or replace function journal_cr_private.completion_api(p_action text,p_payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare rid uuid:=(p_payload->>'id')::uuid;r journal_cr_private.reports;b journal_cr_private.completions;
 receipt journal_cr_private.completion_receipts;oid uuid;is_manager boolean;users uuid[];u uuid;x jsonb;cur jsonb;items jsonb;
 s journal_cr_private.production_sheets;n journal_cr_private.completion_notes;k text;idx int;q journal_cr_private.field_requests;
begin
 if auth.uid() is null or not public.journal_v142_is_active() or octet_length(p_payload::text)>200000 then raise exception 'Connexion active ou saisie valide requise';end if;
 select * into r from journal_cr_private.reports where id=rid;
 if not found or r.deleted_at is not null or not journal_cr_private.member(auth.uid(),r.chantier_id) then raise exception 'Complétude inaccessible';end if;
 is_manager:=journal_cr_private.manager(r.chantier_id);
 if not is_manager and not exists(select 1 from journal_cr_private.completion_agents where report_id=rid and user_id=auth.uid()) then raise exception 'Cette complétude est réservée aux agents désignés';end if;
 perform pg_advisory_xact_lock(hashtextextended(r.chantier_id::text||r.night::text,0));
 select * into r from journal_cr_private.reports where id=rid for update;
 if not found or r.deleted_at is not null then raise exception 'CR supprimé';end if;
 perform journal_cr_private.ensure_completion(rid);
 select * into b from journal_cr_private.completions where report_id=rid for update;
 if p_action='detail' then return journal_cr_private.completion_data(rid);end if;
 if p_action='ack' then
  if p_payload->>'token' is distinct from b.generation::text then raise exception 'Demande actualisée : rouvrir la complétude';end if;
  update journal_cr_private.completion_agents set dismissed_token=b.generation::text,muted=coalesce((p_payload->>'muted')::boolean,muted) where report_id=rid and user_id=auth.uid();return '{}';
 end if;
 if p_action not in ('assign','patch','submit') then raise exception 'Opération inconnue';end if;
 oid:=(p_payload->>'request_id')::uuid;if oid is null then raise exception 'Identifiant de sauvegarde requis';end if;
 select * into receipt from journal_cr_private.completion_receipts where id=oid;
 if found then
  if receipt.report_id<>rid or receipt.actor_id<>auth.uid() or receipt.action<>p_action or receipt.payload<>p_payload then raise exception 'Identifiant de sauvegarde déjà utilisé';end if;
  return journal_cr_private.completion_data(rid);
 end if;
 if r.state<>'draft' then raise exception 'Le CR est validé : demander un rectificatif à l’encadrant';end if;
 if p_action='assign' then
  if not is_manager then raise exception 'Désignation réservée à l’encadrant';end if;
  if b.version is distinct from (p_payload->>'version')::int then raise exception 'La complétude a évolué : actualiser avant de désigner les responsables';end if;
  if jsonb_typeof(p_payload->'users') is distinct from 'array' or jsonb_array_length(p_payload->'users')>40 then raise exception 'Sélectionner au plus 40 responsables';end if;
  select coalesce(array_agg(distinct v::uuid),'{}') into users from jsonb_array_elements_text(p_payload->'users') v;
  if exists(select 1 from unnest(users) id where not journal_cr_private.member(id,r.chantier_id)) then raise exception 'Un responsable n’a plus accès au chantier';end if;
  -- Convert a previous single-agent request without discarding a saved draft.
  select * into q from journal_cr_private.field_requests where report_id=rid and section_key='technique';
  if found and q.state='open' and q.saved_at is not null then
   perform journal_cr_private.apply_field(rid,'technique',q.draft);
   update journal_cr_private.completions set mode=coalesce(q.draft->>'mode','items'),body=coalesce(q.draft->>'body','') where report_id=rid;
  end if;
  delete from journal_cr_private.field_requests where report_id=rid and section_key='technique';
  delete from journal_cr_private.completion_agents where report_id=rid and not(user_id=any(users));
  insert into journal_cr_private.completion_agents(report_id,user_id) select rid,id from unnest(users) id on conflict do nothing;
  update journal_cr_private.completion_agents set dismissed_token='',muted=false where report_id=rid;
  update journal_cr_private.completions set state='open',generation=generation+1,version=version+1,correction=left(coalesce(p_payload->>'correction',''),1000),submitted_at=null,submitted_by=null where report_id=rid returning * into b;
  foreach u in array users loop perform journal_cr_private.notify(u,r.chantier_id,rid,'completion',null,'Complétude du CR off : production et sécurité','v159-completion:'||rid||':'||b.generation||':'||u);end loop;
  perform journal_cr_private.log(rid,'responsables_completude',null,jsonb_build_object('agents',users,'correction',b.correction));
 elsif p_action='patch' then
  if b.state='submitted' and not is_manager then raise exception 'Informations déjà transmises : demander une correction à l’encadrant';end if;
  if b.generation is distinct from (p_payload->>'generation')::int then raise exception 'La demande a été renvoyée : actualiser avant de poursuivre';end if;
  if jsonb_typeof(coalesce(p_payload->'progress','[]'))<>'array' or jsonb_array_length(coalesce(p_payload->'progress','[]'))>120 or jsonb_typeof(coalesce(p_payload->'notes','[]'))<>'array' or jsonb_array_length(coalesce(p_payload->'notes','[]'))>120 or jsonb_typeof(coalesce(p_payload->'new_work','[]'))<>'array' or jsonb_array_length(coalesce(p_payload->'new_work','[]'))>60 then raise exception 'Trop de modifications dans une seule sauvegarde';end if;
  for x in select * from jsonb_array_elements(coalesce(p_payload->'progress','[]')) loop
   select p.* into s from journal_cr_private.production_sheets p where p.id=(x->>'sheet_id')::uuid and p.chantier_id=r.chantier_id and p.night=r.night and journal_cr_private.current_production(p) for update;
   idx:=(x->>'index')::int;
   if not found or idx is null or idx<0 or idx>=jsonb_array_length(s.items) then raise exception 'Travail déplacé ou retiré : actualiser la production';end if;
   cur:=s.items->idx;
   if cur is distinct from x->'before' and cur is distinct from x->'next' then raise exception 'Un collègue a modifié ce travail : %',cur->>'title';end if;
   if cur is distinct from x->'next' then
    items:=jsonb_set(s.items,array[idx::text],x->'next');
    perform public.journal_production_api('save',jsonb_build_object('id',s.id,'chantier_id',s.chantier_id,'night',s.night,'version',s.version,'items',items));
   end if;
  end loop;
  for x in select * from jsonb_array_elements(coalesce(p_payload->'new_work','[]')) loop
   if exists(select 1 from journal_cr_private.production_sheets where id=(x->>'id')::uuid) then raise exception 'Travail ajouté déjà enregistré : actualiser';end if;
   perform public.journal_production_api('save',jsonb_build_object('id',x->'id','chantier_id',r.chantier_id,'night',r.night,'version',0,'items',x->'items'));
  end loop;
  for x in select * from jsonb_array_elements(coalesce(p_payload->'notes','[]')) loop
   select * into n from journal_cr_private.completion_notes where id=(x->>'id')::uuid;
   if found and (n.report_id<>rid or n.version is distinct from (x->>'version')::int) then raise exception 'Une observation a été modifiée par un collègue : actualiser';end if;
   if not found and coalesce((x->>'version')::int,0)<>0 then raise exception 'Observation retirée : actualiser';end if;
   if length(coalesce(x->>'body',''))>2000 or coalesce(x->>'category','') not in ('top','flop') then raise exception 'Observation invalide : Top ou Flop, 2 000 caractères maximum';end if;
   if exists(select 1 from journal_cr_private.notes where id=(x->>'id')::uuid and (report_id<>rid or section_key<>'securite')) then raise exception 'Référence d’observation invalide';end if;
   insert into journal_cr_private.completion_notes(id,report_id,body,category,deleted,author_id,author_name,updated_name)
   values((x->>'id')::uuid,rid,coalesce(x->>'body',''),x->>'category',coalesce((x->>'deleted')::boolean,false),auth.uid(),journal_cr_private.person(),journal_cr_private.person())
   on conflict(id) do update set body=excluded.body,category=excluded.category,deleted=excluded.deleted,version=completion_notes.version+1,updated_name=excluded.updated_name;
  end loop;
  for k in select jsonb_object_keys(coalesce(p_payload->'settings','{}')) loop
   if k not in ('mode','body','safety_clear') then raise exception 'Champ non modifiable';end if;
   x:=p_payload->'settings'->k;cur:=to_jsonb(b)->k;
   if cur is distinct from x->'before' and cur is distinct from x->'next' then raise exception 'Un collègue a modifié ce champ : %',k;end if;
   if k='mode' then b.mode:=x->>'next';elsif k='body' then b.body:=coalesce(x->>'next','');else b.safety_clear:=(x->>'next')::boolean;end if;
  end loop;
  if b.mode not in ('items','text') or length(b.body)>8000 then raise exception 'Descriptif invalide : 8 000 caractères maximum';end if;
  if exists(select 1 from journal_cr_private.completion_notes where report_id=rid and not deleted) then b.safety_clear:=false;end if;
  update journal_cr_private.completions set mode=b.mode,body=b.body,safety_clear=b.safety_clear,version=version+1,saved_at=now() where report_id=rid;
  if b.state='submitted' then perform journal_cr_private.publish_completion(rid);end if;
  perform journal_cr_private.log(rid,'completude_enregistree',null,jsonb_build_object('operation',oid));
 else
  if coalesce((p_payload->>'confirmed')::boolean,false) is not true then raise exception 'Confirmer la transmission à l’encadrant';end if;
  if b.state<>'open' then raise exception 'La complétude a déjà été transmise par un collègue';end if;
  if b.version is distinct from (p_payload->>'version')::int then raise exception 'Des informations ont été ajoutées par un collègue : actualiser et vérifier avant de transmettre';end if;
  perform journal_cr_private.publish_completion(rid);
  update journal_cr_private.completions set state='submitted',submitted_at=now(),submitted_by=auth.uid(),version=version+1 where report_id=rid;
  perform journal_cr_private.log(rid,'completude_transmise',null,jsonb_build_object('operation',oid));
 end if;
 insert into journal_cr_private.completion_receipts(id,report_id,actor_id,action,payload) values(oid,rid,auth.uid(),p_action,p_payload);
 return journal_cr_private.completion_data(rid);
end $$;

create or replace function journal_cr_private.tasks(p_user uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select journal_cr_private.tasks_v158(p_user)||coalesce((select jsonb_agg(jsonb_build_object('id',b.report_id,'report_id',b.report_id,'section_key','completion','user_id',p_user,'version',b.version,'saved_at',b.saved_at,'correction',b.correction,'muted',a.muted,'dismissed_token',a.dismissed_token,'token',b.generation::text,'reminder',false,'chantier_id',r.chantier_id,'night',r.night,'chantier',c.name,'expected_end',null) order by r.night desc,c.name)
 from journal_cr_private.completion_agents a join journal_cr_private.completions b on b.report_id=a.report_id join journal_cr_private.reports r on r.id=b.report_id join public.chantiers c on c.id=r.chantier_id
 where a.user_id=p_user and b.state='open' and r.state='draft' and r.deleted_at is null and journal_cr_private.member(p_user,r.chantier_id)),'[]');
$$;
create or replace function journal_cr_private.notification_allowed(n journal_cr_private.notifications) returns boolean language sql stable security definer set search_path='' as $$
 select case when n.kind='cr' and n.section_key='completion' then exists(select 1 from journal_cr_private.completion_agents a join journal_cr_private.completions b on b.report_id=a.report_id join journal_cr_private.reports r on r.id=b.report_id where a.user_id=n.user_id and a.report_id=n.report_id and b.state='open' and r.state='draft' and r.deleted_at is null and journal_cr_private.member(n.user_id,r.chantier_id)) else journal_cr_private.notification_allowed_v158(n) end;
$$;

create or replace function public.journal_cr_api(p_action text,p_payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;rid uuid;
begin
 if auth.uid() is null or not public.journal_v142_is_active() then raise exception 'Connexion active requise';end if;
 if p_action like 'completion\_%' escape '\' then return journal_cr_private.completion_api(substr(p_action,12),p_payload);end if;
 if p_action='task_ack' and exists(select 1 from journal_cr_private.completion_agents where report_id=(p_payload->>'task_id')::uuid and user_id=auth.uid()) then return journal_cr_private.completion_api('ack',p_payload||jsonb_build_object('id',p_payload->'task_id'));end if;
 if p_action='validate' and journal_cr_private.full_access((p_payload->>'id')::uuid) and exists(select 1 from journal_cr_private.completions where report_id=(p_payload->>'id')::uuid and state='open') then raise exception 'Ouvrir Complétude du CR off puis Transmettre au CR off avant la validation finale';end if;
 if p_action='field_configure' and p_payload->>'key'='technique' and coalesce((p_payload->>'dispatch')::boolean,false) and exists(select 1 from journal_cr_private.completions where report_id=(p_payload->>'id')::uuid) then raise exception 'Utiliser Complétude du CR off pour désigner plusieurs responsables';end if;
 result:=journal_cr_private.api_v158(p_action,p_payload);
 if p_action='detail' then
  rid:=(p_payload->>'id')::uuid;
  return result||jsonb_build_object('completion',(select jsonb_build_object('state',b.state,'saved_at',b.saved_at,'submitted_at',b.submitted_at,'agents',(select coalesce(jsonb_agg(p.full_name),'[]') from journal_cr_private.completion_agents a join public.profiles p on p.id=a.user_id where a.report_id=rid)) from journal_cr_private.completions b where b.report_id=rid));
 end if;
 return result;
end $$;

-- Existing production is immediately visible; assignments remain an explicit choice.
do $$ declare entry record;begin
 for entry in select distinct r.id from journal_cr_private.reports r join journal_cr_private.production_sheets p on p.chantier_id=r.chantier_id and p.night=r.night where r.state='draft' and r.deleted_at is null and journal_cr_private.current_production(p) loop perform journal_cr_private.ensure_completion(entry.id);end loop;
end $$;
revoke all on all tables in schema journal_cr_private from public,anon,authenticated,service_role;
revoke all on all functions in schema journal_cr_private from public,anon,authenticated,service_role;
revoke all on function public.journal_cr_api(text,jsonb),public.journal_production_api(text,jsonb) from public,anon,service_role;
grant execute on function public.journal_cr_api(text,jsonb),public.journal_production_api(text,jsonb) to authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
