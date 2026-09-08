BEGIN;
-- V15 : CR confidentiels et boîte de notifications. Aucune écriture dans le fil par un CR.
-- Identités conservées comme références d'audit sans FK Auth : supprimer un compte
-- ne doit ni supprimer les CR ni bloquer l'outil existant de suppression des comptes.
create schema if not exists journal_cr_private;
revoke all on schema journal_cr_private from public,anon,authenticated,service_role;
create table if not exists journal_cr_private.reports (
 id uuid primary key default gen_random_uuid(), chantier_id uuid not null references public.chantiers(id) on delete cascade,
 night date not null, state text not null default 'draft' check(state in ('draft','validated','sent')),
 revision integer not null default 1, recipients jsonb not null default '[]', collaborators uuid[] not null default '{}',
 created_by uuid not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(chantier_id,night)
);
create table if not exists journal_cr_private.sections (
 report_id uuid references journal_cr_private.reports(id) on delete cascade,
 key text check(key in ('catenaire','itc','arf','technique','securite','synthese')),
 responsible uuid, due_at timestamptz, contributors uuid[] not null default '{}',
 status text not null default 'a_renseigner' check(status in ('a_renseigner','en_cours','complete','a_confirmer','non_concerne')),
 value jsonb not null default '{}', version integer not null default 1,
 updated_by uuid, updated_name text, updated_at timestamptz, primary key(report_id,key)
);
create table if not exists journal_cr_private.notes (
 id uuid primary key, report_id uuid not null, section_key text not null,
 category text not null check(category in ('production','top','flop','synthese','precision')),
 body text not null check(length(body) between 1 and 2000), author_id uuid not null, author_name text not null, created_at timestamptz not null default now(),
 foreign key(report_id,section_key) references journal_cr_private.sections(report_id,key) on delete cascade
);
create table if not exists journal_cr_private.audit (
 id bigint generated always as identity primary key, report_id uuid references journal_cr_private.reports(id) on delete cascade,
 actor_id uuid not null, actor_name text not null, action text not null, section_key text,
 detail jsonb not null default '{}', created_at timestamptz not null default now()
);
create table if not exists journal_cr_private.snapshots (
 report_id uuid references journal_cr_private.reports(id) on delete cascade, revision integer not null,
 data jsonb not null, validated_by uuid not null, validated_name text not null, validated_at timestamptz not null default now(),
 primary key(report_id,revision)
);
create table if not exists journal_cr_private.deliveries (
 id uuid primary key default gen_random_uuid(), request_key text not null unique, report_ids uuid[] not null,
 snapshots jsonb not null, recipients jsonb not null, subject text not null, body text not null, actor_id uuid not null,
 state text not null default 'pending' check(state in ('pending','sent','failed','uncertain')),
 provider_id text, error_code text, created_at timestamptz not null default now(), sent_at timestamptz
);
create table if not exists journal_cr_private.notifications (
 id uuid primary key default gen_random_uuid(), user_id uuid not null, chantier_id uuid not null references public.chantiers(id) on delete cascade,
 kind text not null check(kind in ('message','cr')), report_id uuid references journal_cr_private.reports(id) on delete cascade,
 section_key text, message_id uuid, title text not null, created_at timestamptz not null default now(), read_at timestamptz,
 dedup text not null unique
);
create index if not exists cr_notifications_user on journal_cr_private.notifications(user_id,created_at desc);
create index if not exists cr_notifications_created on journal_cr_private.notifications(created_at);
create table if not exists journal_cr_private.dispatch_gate(singleton boolean primary key default true check(singleton),requested_at timestamptz);
insert into journal_cr_private.dispatch_gate(singleton) values(true) on conflict do nothing;
create index if not exists cr_reports_night on journal_cr_private.reports(night desc);
create table if not exists journal_cr_private.devices (
 user_id uuid not null, device_id uuid not null, endpoint text not null unique,
 p256dh text not null, auth_key text not null, updated_at timestamptz not null default now(), primary key(user_id,device_id)
);
create table if not exists journal_cr_private.pushes (
 notification_id uuid references journal_cr_private.notifications(id) on delete cascade,
 device_id uuid not null, state text not null default 'pending', attempts int not null default 0,
 locked_at timestamptz, primary key(notification_id,device_id)
);
create or replace function journal_cr_private.member(p_user uuid,p_site uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.users where id=p_user)
 and not exists(select 1 from public.journal_user_access_blocks where user_id=p_user)
 and (exists(select 1 from public.journal_administrators where user_id=p_user and role in ('proprietaire','administrateur_general'))
 or exists(select 1 from public.chantier_members where user_id=p_user and chantier_id=p_site));
$$;
create or replace function journal_cr_private.manager(p_site uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.journal_can_manage_chantier_documents(p_site);
$$;
create or replace function journal_cr_private.full_access(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select journal_cr_private.member(auth.uid(),r.chantier_id) and
 (journal_cr_private.manager(r.chantier_id) or auth.uid()=any(r.collaborators)) from journal_cr_private.reports r where id=p_id),false);
$$;
create or replace function journal_cr_private.section_access(p_id uuid,p_key text) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select journal_cr_private.member(auth.uid(),r.chantier_id) and (journal_cr_private.full_access(r.id)
 or s.responsible=auth.uid() or auth.uid()=any(s.contributors)) from journal_cr_private.reports r join journal_cr_private.sections s on s.report_id=r.id where r.id=p_id and s.key=p_key),false);
$$;
create or replace function journal_cr_private.person() returns text language sql stable security definer set search_path='' as $$
 select coalesce((select nullif(full_name,'') from public.profiles where id=auth.uid()),'Utilisateur');
$$;
create or replace function journal_cr_private.log(p_id uuid,p_action text,p_key text,p_detail jsonb default '{}') returns void language sql security definer set search_path='' as $$
 insert into journal_cr_private.audit(report_id,actor_id,actor_name,action,section_key,detail) values(p_id,auth.uid(),journal_cr_private.person(),p_action,p_key,p_detail);
$$;
create or replace function journal_cr_private.kick() returns void language plpgsql security definer set search_path='' as $$
 declare c jsonb;
 begin
  if to_regclass('journal_mode_private.config') is null or to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then return; end if;
  execute 'select to_jsonb(c) from journal_mode_private.config c limit 1' into c;
  if coalesce((c->>'enabled')::boolean,false) and length(c->>'dispatch_secret')>=32 then
   update journal_cr_private.dispatch_gate set requested_at=now() where singleton and (requested_at is null or requested_at<now()-interval '5 seconds');
   if not found then return; end if;
   execute 'select net.http_post(url := $1, headers := $2, body := ''{}''::jsonb, timeout_milliseconds := 5000)'
   using replace(c->>'dispatch_url','/journal-mode-push','/journal-v15-push'),jsonb_build_object('Content-Type','application/json','x-journal-dispatch-secret',c->>'dispatch_secret');
  end if;
 exception when others then null; -- Le centre de notifications reste la source durable.
 end;
$$;
create or replace function journal_cr_private.notify(p_user uuid,p_site uuid,p_report uuid,p_key text,p_message uuid,p_title text,p_dedup text) returns void language plpgsql security definer set search_path='' as $$
 declare nid uuid;
 begin
  if p_user is null or p_user=auth.uid() or not journal_cr_private.member(p_user,p_site) then return; end if;
  insert into journal_cr_private.notifications(user_id,chantier_id,kind,report_id,section_key,message_id,title,dedup)
  values(p_user,p_site,case when p_report is null then 'message' else 'cr' end,p_report,p_key,p_message,p_title,p_dedup)
  on conflict(dedup) do nothing returning id into nid;
  if nid is not null then
   insert into journal_cr_private.pushes(notification_id,device_id) select nid,device_id from journal_cr_private.devices where user_id=p_user;
   perform journal_cr_private.kick();
  end if;
 end;
$$;
create or replace function journal_cr_private.message_notification() returns trigger language plpgsql security definer set search_path='' as $$
 declare u uuid;
 begin
  for u in select user_id from public.chantier_members where chantier_id=new.chantier_id union select user_id from public.journal_administrators where role in ('proprietaire','administrateur_general') loop
   if u is distinct from new.author_id then
    perform journal_cr_private.notify(u,new.chantier_id,null,null,new.id,'Nouveau message', 'message:'||new.id||':'||u);
   end if;
  end loop;
  return new;
 end;
$$;
drop trigger if exists journal_v15_message_notification on public.chantier_messages;
create trigger journal_v15_message_notification after insert on public.chantier_messages for each row execute function journal_cr_private.message_notification();
-- Lecture des dossiers et fichiers pour chaque membre autorisé, y compris contributeur.
-- Les politiques d'écriture et les contrôles des migrations précédentes sont conservés.
drop policy if exists journal_v15_documents_read on public.chantier_documents;
create policy journal_v15_documents_read on public.chantier_documents for select to authenticated using(public.journal_can_access_chantier(chantier_id));
drop policy if exists journal_v15_folders_read on public.chantier_document_folders;
create policy journal_v15_folders_read on public.chantier_document_folders for select to authenticated using(public.journal_can_access_chantier(chantier_id));
drop policy if exists journal_v15_document_files_read on storage.objects;
create policy journal_v15_document_files_read on storage.objects for select to authenticated using(
 bucket_id='chantier-documents' and exists(select 1 from public.chantier_documents d where d.storage_path=name and public.journal_can_access_chantier(d.chantier_id))
);
create or replace function journal_cr_private.snapshot(p_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',r.id,'chantier_id',r.chantier_id,'chantier',c.name,'night',r.night,'revision',r.revision,'recipients',r.recipients,
 'sections',(select jsonb_agg(to_jsonb(s) || jsonb_build_object('notes',coalesce((select jsonb_agg(to_jsonb(n) order by n.created_at,n.id) from journal_cr_private.notes n where n.report_id=r.id and n.section_key=s.key),'[]'::jsonb)) order by s.key) from journal_cr_private.sections s where s.report_id=r.id))
 from journal_cr_private.reports r join public.chantiers c on c.id=r.chantier_id where r.id=p_id;
$$;
create or replace function public.journal_cr_api(p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
 #variable_conflict use_column
 declare uid uuid:=auth.uid(); rid uuid; sid uuid; k text; r journal_cr_private.reports; s journal_cr_private.sections;
 v jsonb; result jsonb; old jsonb; members uuid[]; target uuid; ids uuid[]; d journal_cr_private.deliveries;
 t0 timestamptz; t1 timestamptz; note text; st text; ky text; n int; bodytext text; requestkey text;
 begin
  if uid is null or not public.journal_v142_is_active() then raise exception 'Connexion active requise'; end if;
  if octet_length(p_payload::text)>200000 then raise exception 'Demande trop volumineuse'; end if;
  if p_action='inbox' then
   return coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
    select n.* from journal_cr_private.notifications n where n.user_id=uid and journal_cr_private.member(uid,n.chantier_id)
    and (n.kind='message' and exists(select 1 from public.chantier_messages m where m.id=n.message_id and m.deleted_at is null)
     or n.kind='cr' and journal_cr_private.section_access(n.report_id,n.section_key))
    order by n.created_at desc limit 100) x),'[]'::jsonb);
  elsif p_action='read' then
   update journal_cr_private.notifications set read_at=now() where user_id=uid and id=(p_payload->>'id')::uuid; return '{}';
  elsif p_action='push_config' then
   if to_regclass('journal_mode_private.config') is not null then
    execute 'select jsonb_build_object(''enabled'',enabled,''vapid_public_key'',vapid_public_key) from journal_mode_private.config limit 1' into v;
   end if;
   return coalesce(v,'{"enabled":false}'::jsonb);
  elsif p_action='device_remove' then
   delete from journal_cr_private.devices where user_id=uid and device_id=(p_payload->>'device_id')::uuid; return '{}';
  elsif p_action='device' then
   v:=p_payload->'subscription';
   if coalesce(v->>'endpoint','') !~ '^https://([a-zA-Z0-9-]+\.)*(googleapis\.com|push\.apple\.com|push\.services\.mozilla\.com|notify\.windows\.com)/' or length(v->>'endpoint')>2048
    or coalesce(v#>>'{keys,p256dh}','') !~ '^[A-Za-z0-9_-]{87}=?$' or coalesce(v#>>'{keys,auth}','') !~ '^[A-Za-z0-9_-]{22}={0,2}$' then raise exception 'Abonnement push invalide'; end if;
   delete from journal_cr_private.devices where endpoint=v->>'endpoint' and (user_id<>uid or device_id<>(p_payload->>'device_id')::uuid);
   insert into journal_cr_private.devices(user_id,device_id,endpoint,p256dh,auth_key) values(uid,(p_payload->>'device_id')::uuid,v->>'endpoint',v#>>'{keys,p256dh}',v#>>'{keys,auth}')
   on conflict(user_id,device_id) do update set endpoint=excluded.endpoint,p256dh=excluded.p256dh,auth_key=excluded.auth_key,updated_at=now(); return '{}';
  elsif p_action='list' then
   return coalesce((select jsonb_agg(to_jsonb(x) order by x.night desc,x.chantier) from (
    select r.id,r.chantier_id,c.name as chantier,r.night,r.state,r.revision,journal_cr_private.manager(r.chantier_id) as manager,
     (select count(*) from journal_cr_private.sections s where s.report_id=r.id and journal_cr_private.section_access(r.id,s.key) and s.status in ('complete','non_concerne')) as completed,
     (select count(*) from journal_cr_private.sections s where s.report_id=r.id and journal_cr_private.section_access(r.id,s.key)) as total,
     (select count(*) from journal_cr_private.sections s where s.report_id=r.id and s.responsible=uid and s.status not in ('complete','non_concerne')) as mine
    from journal_cr_private.reports r join public.chantiers c on c.id=r.chantier_id
    where journal_cr_private.member(uid,r.chantier_id) and exists(select 1 from journal_cr_private.sections s where s.report_id=r.id and journal_cr_private.section_access(r.id,s.key))
    and (not coalesce((p_payload->>'mine')::boolean,false) or exists(select 1 from journal_cr_private.sections mine where mine.report_id=r.id and mine.responsible=uid and mine.status not in ('complete','non_concerne')))
    order by r.night desc,c.name limit 200 offset greatest(least(coalesce((p_payload->>'offset')::integer,0),100000),0)) x),'[]'::jsonb);
  elsif p_action='create' then
   sid:=(p_payload->>'chantier_id')::uuid;
   if not journal_cr_private.manager(sid) then raise exception 'Création réservée à l’encadrement du chantier'; end if;
   if (p_payload->>'night')::date not between current_date-366 and current_date+31 then raise exception 'Date de nuit invalide'; end if;
   insert into journal_cr_private.reports(chantier_id,night,created_by) values(sid,(p_payload->>'night')::date,uid)
    on conflict(chantier_id,night) do nothing returning id into rid;
   if rid is not null then
    insert into journal_cr_private.sections(report_id,key) select rid,unnest(array['catenaire','itc','arf','technique','securite','synthese']);
    if coalesce((p_payload->>'reuse')::boolean,false) then
     select * into r from journal_cr_private.reports where chantier_id=sid and id<>rid order by night desc limit 1;
     if found then
      update journal_cr_private.reports set recipients=r.recipients,collaborators=array(select u from unnest(r.collaborators) u where journal_cr_private.member(u,sid)) where id=rid;
      update journal_cr_private.sections x set responsible=case when journal_cr_private.member(y.responsible,sid) then y.responsible end,
       contributors=array(select u from unnest(y.contributors) u where journal_cr_private.member(u,sid))
       from journal_cr_private.sections y where x.report_id=rid and y.report_id=r.id and x.key=y.key;
      for s in select * from journal_cr_private.sections where report_id=rid and responsible is not null loop
       perform journal_cr_private.notify(s.responsible,sid,rid,s.key,null,'CR off : rubrique à renseigner','assign:'||rid||':'||s.key||':1');
      end loop;
     end if;
    end if;
    perform journal_cr_private.log(rid,'creation',null);
   else select id into rid from journal_cr_private.reports where chantier_id=sid and night=(p_payload->>'night')::date; end if;
   return jsonb_build_object('id',rid);
  elsif p_action='prepare_send' then
   select array_agg(x::uuid order by x::uuid) into ids from (select distinct jsonb_array_elements_text(p_payload->'ids') x) a;
   if coalesce(cardinality(ids),0) not between 1 and 20 then raise exception 'Choisir entre 1 et 20 CR'; end if;
   -- Sérialiser les envois et validations, dans un ordre fixe.
   perform 1 from journal_cr_private.reports where id=any(ids) order by id for update;
   if (select count(*) from journal_cr_private.reports where id=any(ids) and journal_cr_private.manager(chantier_id) and state in ('validated','sent'))<>cardinality(ids) then raise exception 'Chaque CR doit être validé et accessible à l’encadrant'; end if;
   select recipients into v from journal_cr_private.reports where id=ids[1];
   if jsonb_array_length(v)=0 then raise exception 'Liste des destinataires vide'; end if;
   if exists(select 1 from journal_cr_private.reports where id=any(ids) and recipients<>v) then raise exception 'Regroupement autorisé uniquement pour des destinataires identiques'; end if;
   select jsonb_agg(s.data order by r.night,c.name),string_agg(r.id||':'||r.revision,',' order by r.id) into result,requestkey
    from journal_cr_private.reports r join public.chantiers c on c.id=r.chantier_id join journal_cr_private.snapshots s on s.report_id=r.id and s.revision=r.revision where r.id=any(ids);
   if exists(select 1 from journal_cr_private.deliveries x where x.state='sent' and exists(select 1 from jsonb_array_elements(x.snapshots) z where z in (select q from jsonb_array_elements(result) q))) then raise exception 'Une version sélectionnée a déjà été envoyée. Créer un rectificatif pour un nouvel envoi'; end if;
   if exists(select 1 from journal_cr_private.deliveries x where x.request_key<>requestkey and exists(select 1 from jsonb_array_elements(x.snapshots) z where z in (select q from jsonb_array_elements(result) q))) then raise exception 'Une version est déjà réservée dans un autre envoi. Reprendre ce groupe ou créer un rectificatif après vérification'; end if;
   bodytext:=journal_cr_private.email_text(result);
   insert into journal_cr_private.deliveries(request_key,report_ids,snapshots,recipients,subject,body,actor_id)
    values(requestkey,ids,result,v,'CR encadrement · '||cardinality(ids)||' chantier(s)',bodytext,uid)
    on conflict(request_key) do update set request_key=excluded.request_key returning * into d;
   if d.actor_id<>uid then raise exception 'Un autre encadrant a préparé cet envoi'; end if;
   if d.created_at<now()-interval '23 hours' then raise exception 'Envoi trop ancien : vérifier sa réception avant de créer un rectificatif'; end if;
   return jsonb_build_object('id',d.id,'recipients',d.recipients,'subject',d.subject,'body',d.body,'state',d.state);
  end if;
  rid:=(p_payload->>'id')::uuid; k:=p_payload->>'key';
  select * into r from journal_cr_private.reports where id=rid for update;
  if not found or not journal_cr_private.member(uid,r.chantier_id) then raise exception 'CR inaccessible'; end if;
  if p_action='detail' then
   if not exists(select 1 from journal_cr_private.sections s where s.report_id=rid and journal_cr_private.section_access(rid,s.key)) then raise exception 'CR inaccessible'; end if;
   return jsonb_build_object('id',r.id,'chantier_id',r.chantier_id,'night',r.night,'state',r.state,'revision',r.revision,
    'manager',journal_cr_private.manager(r.chantier_id),'full_access',journal_cr_private.full_access(rid),
    'recipients',case when journal_cr_private.manager(r.chantier_id) then r.recipients else '[]'::jsonb end,
    'collaborators',case when journal_cr_private.manager(r.chantier_id) then to_jsonb(r.collaborators) else '[]'::jsonb end,
    'sections',(select jsonb_agg(to_jsonb(s)||jsonb_build_object('responsible_name',(select full_name from public.profiles where id=s.responsible),
      'notes',coalesce((select jsonb_agg(to_jsonb(n) order by n.created_at,n.id) from journal_cr_private.notes n where n.report_id=rid and n.section_key=s.key),'[]')) order by s.key)
      from journal_cr_private.sections s where s.report_id=rid and journal_cr_private.section_access(rid,s.key)),
    'people',case when journal_cr_private.manager(r.chantier_id) then (select coalesce(jsonb_agg(to_jsonb(p) order by p.full_name),'[]') from (select id,full_name from public.profiles where journal_cr_private.member(id,r.chantier_id)) p) else '[]'::jsonb end,
    'history',(select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc),'[]') from (select actor_name,action,section_key,created_at,detail from journal_cr_private.audit a where a.report_id=rid and (journal_cr_private.full_access(rid) or journal_cr_private.section_access(rid,a.section_key)) order by created_at desc limit 100) a),
    'deliveries',case when journal_cr_private.manager(r.chantier_id) then (select coalesce(jsonb_agg(jsonb_build_object('id',id,'state',state,'created_at',created_at,'sent_at',sent_at,'error',error_code) order by created_at desc),'[]') from journal_cr_private.deliveries where rid=any(report_ids)) else '[]'::jsonb end,
    'snapshots',case when journal_cr_private.full_access(rid) then (select coalesce(jsonb_agg(to_jsonb(s) order by revision desc),'[]') from journal_cr_private.snapshots s where report_id=rid) else '[]'::jsonb end);
  elsif p_action='reopen' then
   if not journal_cr_private.manager(r.chantier_id) or r.state='draft' then raise exception 'Réouverture réservée à l’encadrant'; end if;
   if length(trim(coalesce(p_payload->>'reason','')))<5 then raise exception 'Préciser le motif du rectificatif'; end if;
   update journal_cr_private.reports set state='draft',revision=revision+1,updated_at=now() where id=rid;
   perform journal_cr_private.log(rid,'rectificatif',null,jsonb_build_object('reason',left(p_payload->>'reason',500)));
   return '{}';
  end if;
  if r.state<>'draft' then raise exception 'CR figé : l’encadrant doit créer une nouvelle version'; end if;
  if p_action in ('assign','audience','validate') and not journal_cr_private.manager(r.chantier_id) then raise exception 'Action réservée à l’encadrant'; end if;
  if p_action='audience' then
   select coalesce(array_agg(distinct x::uuid),'{}') into members from jsonb_array_elements_text(coalesce(p_payload->'collaborators','[]')) x;
   if exists(select 1 from unnest(members) u where not journal_cr_private.member(u,r.chantier_id)) then raise exception 'Collaborateur sans accès au chantier'; end if;
   select coalesce(jsonb_agg(x order by x),'[]') into v from (select distinct lower(trim(x)) x from jsonb_array_elements_text(coalesce(p_payload->'recipients','[]')) x) a;
   if jsonb_array_length(v)>30 or exists(select 1 from jsonb_array_elements_text(v) x where length(x)>254 or x !~ '^[A-Za-z0-9.!#$%&*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$') then raise exception 'Destinataires invalides (30 maximum)'; end if;
   update journal_cr_private.reports set recipients=v,collaborators=members,updated_at=now() where id=rid;
   perform journal_cr_private.log(rid,'diffusion',null); return '{}';
  elsif p_action='validate' then
   if jsonb_array_length(r.recipients)=0 then raise exception 'Renseigner les destinataires avant validation'; end if;
   if exists(select 1 from journal_cr_private.sections where report_id=rid and status not in ('complete','non_concerne')) then raise exception 'Renseigner ou marquer non concernée chaque rubrique avant validation'; end if;
   v:=journal_cr_private.snapshot(rid);
   insert into journal_cr_private.snapshots(report_id,revision,data,validated_by,validated_name) values(rid,r.revision,v,uid,journal_cr_private.person());
   update journal_cr_private.reports set state='validated',updated_at=now() where id=rid;
   perform journal_cr_private.log(rid,'validation',null,jsonb_build_object('revision',r.revision)); return '{}';
  end if;
  if not journal_cr_private.section_access(rid,k) then raise exception 'Rubrique inaccessible'; end if;
  select * into s from journal_cr_private.sections where report_id=rid and key=k for update;
  if p_action='note' then
   note:=trim(coalesce(p_payload->>'body',''));
   if length(note) not between 1 and 2000 then raise exception 'Contribution requise (2 000 caractères maximum)'; end if;
   insert into journal_cr_private.notes(id,report_id,section_key,category,body,author_id,author_name)
    values((p_payload->>'note_id')::uuid,rid,k,p_payload->>'category',note,uid,journal_cr_private.person()) on conflict(id) do nothing;
   get diagnostics n=row_count;
   if n=0 and not exists(select 1 from journal_cr_private.notes where id=(p_payload->>'note_id')::uuid and report_id=rid and section_key=k and author_id=uid and body=note and category=p_payload->>'category') then raise exception 'Identifiant de contribution déjà utilisé. Actualiser avant de compléter'; end if;
   if n>0 then
    update journal_cr_private.sections set status='en_cours',value=value-'digest',version=version+1,updated_by=uid,updated_name=journal_cr_private.person(),updated_at=now() where report_id=rid and key=k;
    perform journal_cr_private.log(rid,'contribution',k,jsonb_build_object('note_id',p_payload->>'note_id'));
   end if;
  elsif p_action='remind' then
   if not journal_cr_private.manager(r.chantier_id) then raise exception 'Relance réservée à l’encadrant'; end if;
   if s.responsible is null then raise exception 'Aucun responsable affecté'; end if;
   perform journal_cr_private.notify(s.responsible,r.chantier_id,rid,k,null,'Rappel : CR off à compléter','remind:'||rid||':'||k||':'||floor(extract(epoch from now())/300));
   perform journal_cr_private.log(rid,'relance',k);
  elsif p_action in ('save','assign') then
   if s.version is distinct from (p_payload->>'version')::int then raise exception 'Rubrique modifiée par une autre personne : actualiser avant d’enregistrer'; end if;
   if p_action='assign' then
    target:=nullif(p_payload->>'responsible','')::uuid;
    select coalesce(array_agg(distinct x::uuid),'{}') into members from jsonb_array_elements_text(coalesce(p_payload->'contributors','[]')) x;
    if target is not null and not journal_cr_private.member(target,r.chantier_id) or exists(select 1 from unnest(members) u where not journal_cr_private.member(u,r.chantier_id)) then raise exception 'Personne sans accès au chantier'; end if;
    update journal_cr_private.sections set responsible=target,due_at=nullif(p_payload->>'due_at','')::timestamptz,contributors=members,version=version+1 where report_id=rid and key=k;
    perform journal_cr_private.notify(target,r.chantier_id,rid,k,null,'CR off : rubrique à renseigner','assign:'||rid||':'||k||':'||(s.version+1));
    perform journal_cr_private.log(rid,'attribution',k,jsonb_build_object('responsible',target,'contributors',members));
   else
    st:=p_payload->>'status'; v:=coalesce(p_payload->'value','{}');
    if jsonb_typeof(v)<>'object' or octet_length(v::text)>8000 then raise exception 'Contenu invalide'; end if;
    if k in ('catenaire','itc','arf') then
     t0:=nullif(v->>'start','')::timestamptz; t1:=nullif(v->>'end','')::timestamptz;
     if st='complete' and (t0 is null or t1 is null) then raise exception 'Début et fin requis'; end if;
     if t0 is not null and ((t0 at time zone 'Europe/Paris')::date not between r.night and r.night+1) or t1 is not null and ((t1 at time zone 'Europe/Paris')::date not between r.night and r.night+2) or t0 is not null and t1 is not null and (t1<t0 or t1-t0>interval '36 hours') then raise exception 'Horaires incohérents avec la nuit sélectionnée'; end if;
     v:=jsonb_build_object('start',t0,'end',t1,'precision',left(coalesce(v->>'precision',''),1000));
    else
     note:=trim(coalesce(v->>'digest',''));
     if note='' then select coalesce(string_agg('['||category||'] '||body,' / ' order by created_at,id),'') into note from journal_cr_private.notes where report_id=rid and section_key=k; end if;
     if st='complete' and note='' then raise exception 'Ajouter une contribution explicite avant de terminer'; end if;
     if length(note)>600 and st='complete' then raise exception 'Les contributions sont longues : rédiger un résumé de 600 caractères maximum pour le mail du matin'; end if;
     if length(coalesce(v->>'digest',''))>600 then raise exception 'Résumé limité à 600 caractères'; end if;
     v:=jsonb_build_object('digest',case when length(note)<=600 then note else '' end);
    end if;
    update journal_cr_private.sections set value=v,status=st,version=version+1,updated_by=uid,updated_name=journal_cr_private.person(),updated_at=now() where report_id=rid and key=k;
    perform journal_cr_private.log(rid,'saisie',k,jsonb_build_object('before',s.value,'after',v,'status',st));
   end if;
  else raise exception 'Opération inconnue'; end if;
  update journal_cr_private.reports set updated_at=now() where id=rid;
  return '{}';
 end;
$$;
-- Texte compact, construit exclusivement à partir des versions validées.
create or replace function journal_cr_private.email_text(p_snapshots jsonb) returns text language plpgsql immutable set search_path='' as $$
 declare report jsonb; s jsonb; n jsonb; txt text:='CR ENCADREMENT — diffusion restreinte'; label text;
 begin
  for report in select * from jsonb_array_elements(p_snapshots) loop
   txt:=txt||E'\n\n'||(report->>'chantier')||' · nuit du '||(report->>'night')||' · v'||(report->>'revision');
   for s in select * from jsonb_array_elements(report->'sections') order by case value->>'key' when 'catenaire' then 1 when 'itc' then 2 when 'arf' then 3 when 'technique' then 4 when 'securite' then 5 else 6 end loop
    label:=case s->>'key' when 'catenaire' then 'Consignation caténaire' when 'itc' then 'ITC' when 'arf' then 'ARF' when 'technique' then 'Production / technique' when 'securite' then 'Sécurité' else 'Synthèse' end;
    txt:=txt||E'\n'||label||' : ';
    if s->>'status'='non_concerne' then txt:=txt||'Non concerné';
    elsif s->>'key' in ('catenaire','itc','arf') then
     txt:=txt||coalesce(to_char((s#>>'{value,start}')::timestamptz at time zone 'Europe/Paris','DD/MM HH24:MI'),'?')||' → '||coalesce(to_char((s#>>'{value,end}')::timestamptz at time zone 'Europe/Paris','DD/MM HH24:MI'),'?');
     if coalesce(s#>>'{value,precision}','')<>'' then txt:=txt||' — '||(s#>>'{value,precision}'); end if;
    else
     txt:=txt||coalesce(s#>>'{value,digest}','');
    end if;
   end loop;
  end loop;
  return txt||E'\n\nHoraires affichés en heure de Paris. Copie de la version validée dans le Journal de chantier.';
 end;
$$;
create or replace function public.journal_cr_delivery_finish(p_id uuid,p_state text,p_provider_id text default null) returns void language plpgsql security definer set search_path='' as $$
 declare d journal_cr_private.deliveries; x jsonb;
 begin
  if p_state not in ('sent','failed','uncertain') then raise exception 'Statut invalide'; end if;
  select * into d from journal_cr_private.deliveries where id=p_id for update;
  if not found or d.state='sent' then return; end if;
  update journal_cr_private.deliveries set state=p_state,provider_id=left(p_provider_id,200),error_code=case when p_state<>'sent' then 'envoi_a_verifier' end,sent_at=case when p_state='sent' then now() end where id=p_id;
  if p_state='sent' then
   for x in select * from jsonb_array_elements(d.snapshots) loop
    update journal_cr_private.reports set state='sent' where id=(x->>'id')::uuid and revision=(x->>'revision')::int and state='validated';
   end loop;
  end if;
 end;
$$;
create or replace function journal_cr_private.notification_allowed(n journal_cr_private.notifications) returns boolean language sql stable security definer set search_path='' as $$
 select journal_cr_private.member(n.user_id,n.chantier_id) and (n.kind='message' and exists(select 1 from public.chantier_messages where id=n.message_id and deleted_at is null)
 or n.kind='cr' and exists(select 1 from journal_cr_private.reports r join journal_cr_private.sections s on s.report_id=r.id and s.key=n.section_key where r.id=n.report_id and
 (n.user_id=any(r.collaborators) or n.user_id=s.responsible or n.user_id=any(s.contributors)
 or exists(select 1 from public.journal_administrators where user_id=n.user_id and role in ('proprietaire','administrateur_general'))
 or exists(select 1 from public.chantier_members where user_id=n.user_id and chantier_id=n.chantier_id and role='administrateur'))));
$$;
create or replace function public.journal_v15_push_jobs() returns jsonb language plpgsql security definer set search_path='' as $$
 declare result jsonb;
 begin
  with selected as (
   select p.notification_id,p.device_id from journal_cr_private.pushes p join journal_cr_private.notifications n on n.id=p.notification_id
   join journal_cr_private.devices d on d.user_id=n.user_id and d.device_id=p.device_id
   where p.state='pending' and p.attempts<4 and (p.locked_at is null or p.locked_at<now()-interval '2 minutes')
    and n.created_at>now()-interval '24 hours' and n.read_at is null and journal_cr_private.notification_allowed(n)
   order by n.created_at limit 40 for update of p skip locked
  ), claimed as (
   update journal_cr_private.pushes p set locked_at=now(),attempts=attempts+1 from selected s where p.notification_id=s.notification_id and p.device_id=s.device_id returning p.*
  ) select coalesce(jsonb_agg(jsonb_build_object('id',n.id,'device_id',d.device_id,'user_id',n.user_id,'endpoint',d.endpoint,
    'keys',jsonb_build_object('p256dh',d.p256dh,'auth',d.auth_key),'expires_at',n.created_at+interval '24 hours','lease',p.attempts)),'[]') into result
    from claimed p join journal_cr_private.notifications n on n.id=p.notification_id join journal_cr_private.devices d on d.user_id=n.user_id and d.device_id=p.device_id;
  return result;
 end;
$$;
create or replace function public.journal_v15_push_finish(p_id uuid,p_device uuid,p_lease int,p_status text) returns void language plpgsql security definer set search_path='' as $$
 begin
  update journal_cr_private.pushes set state=case when p_status in ('sent','gone') then p_status else 'pending' end,locked_at=now()
   where notification_id=p_id and device_id=p_device and attempts=p_lease;
  if p_status='gone' then delete from journal_cr_private.devices where device_id=p_device and user_id=(select user_id from journal_cr_private.notifications where id=p_id); end if;
 end;
$$;
revoke all on function public.journal_v15_push_jobs() from public,anon,authenticated;
revoke all on function public.journal_v15_push_finish(uuid,uuid,int,text) from public,anon,authenticated;
grant execute on function public.journal_v15_push_jobs() to service_role;
grant execute on function public.journal_v15_push_finish(uuid,uuid,int,text) to service_role;
-- Bornage de la boîte et de la file : conservation des 90 derniers jours.
-- L'historique des CR et les versions envoyées sont conservés.
create or replace function journal_cr_private.maintenance() returns void language plpgsql security definer set search_path='' as $$
 begin
  delete from journal_cr_private.notifications where created_at<now()-interval '90 days';
  delete from journal_cr_private.pushes p using journal_cr_private.notifications n where n.id=p.notification_id and n.created_at<now()-interval '24 hours';
  delete from journal_cr_private.devices where updated_at<now()-interval '180 days';
  perform journal_cr_private.kick();
 end;
$$;
-- Facultatif dans les bases de test ; installé sur la production si pg_cron est disponible.
do $$ begin
 if to_regprocedure('cron.schedule(text,text,text)') is not null then
  perform cron.schedule('journal-v15-notifications','* * * * *','select journal_cr_private.kick()');
  perform cron.schedule('journal-v15-notifications-cleanup','35 0 * * *','select journal_cr_private.maintenance()');
 end if;
end $$;

-- Fermeture systématique des fonctions privées et accès RPC authentifié explicite.
revoke all on all tables in schema journal_cr_private from public,anon,authenticated,service_role;
revoke all on all functions in schema journal_cr_private from public,anon,authenticated,service_role;
revoke all on function public.journal_cr_api(text,jsonb) from public,anon;
grant execute on function public.journal_cr_api(text,jsonb) to authenticated;
revoke all on function public.journal_cr_delivery_finish(uuid,text,text) from public,anon,authenticated;
grant execute on function public.journal_cr_delivery_finish(uuid,text,text) to service_role;
COMMIT;
