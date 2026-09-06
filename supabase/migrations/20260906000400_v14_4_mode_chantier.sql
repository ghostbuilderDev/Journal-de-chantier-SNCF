-- Journal Chantier V14.4 — sessions personnelles temporaires et notifications.
-- Aucun changement de table métier, FK d'identité, trigger DELETE ou droit V14.2.
begin;
do $$ begin
  if to_regprocedure('public.journal_v142_is_active()') is null
    or to_regprocedure('public.journal_v142_assert_account_cleanup_safe()') is null
    or not exists (select 1 from pg_attribute where attrelid='public.action_items'::regclass and attname='assignee_user_id' and not attisdropped) then
    raise exception 'Le mode chantier exige V14.2 validée.';
  end if;
  if to_regclass('public.chantier_attachments') is null or to_regclass('public.chantier_daily_logs') is null
    or to_regclass('public.chantier_risks') is null or to_regclass('public.chantier_documents') is null then
    raise exception 'Le mode chantier exige les tables photos, documents et pilotage historiques.';
  end if;
end $$;
create schema journal_mode_private;
revoke all on schema journal_mode_private from public,anon,authenticated,service_role;
create table journal_mode_private.config (
  singleton boolean primary key default true check(singleton),enabled boolean not null default false,
  vapid_public_key text,vapid_private_key text,dispatch_url text,dispatch_secret text
);
insert into journal_mode_private.config default values;
create table journal_mode_private.sessions (
  id uuid primary key default gen_random_uuid(),user_id uuid not null,device_id uuid not null,chantier_id uuid not null,
  started_at timestamptz not null default clock_timestamp(),ends_at timestamptz not null,
  status text not null default 'active' check(status in ('active','paused','stopped')),
  pause_until timestamptz,stopped_at timestamptz,recap_since timestamptz not null,
  endpoint text,keys jsonb,subscription_expires_at timestamptz,present_until timestamptz,
  check(ends_at>started_at and ends_at<=started_at+interval '24 hours'),
  check((endpoint is null and keys is null) or (endpoint is not null and keys is not null))
);
create unique index journal_mode_one_device on journal_mode_private.sessions(user_id,device_id) where status<>'stopped';
create unique index journal_mode_one_endpoint on journal_mode_private.sessions(endpoint) where status<>'stopped' and endpoint is not null;
create index journal_mode_sessions_site on journal_mode_private.sessions(chantier_id,ends_at) where status<>'stopped';
create index journal_mode_sessions_history on journal_mode_private.sessions(user_id,device_id,started_at desc);
-- Aucune donnée de message ou nom personnel dans la file d'événements.
create table journal_mode_private.events (
  id uuid primary key default gen_random_uuid(),chantier_id uuid not null,actor_id uuid,
  kind text not null check(kind in ('message','action','document','log','risk')),
  entity_id uuid not null,dedup_key text not null,message_id uuid,action_id uuid,
  happened_at timestamptz not null default clock_timestamp(),urgent boolean not null default false,
  priority_users uuid[] not null default '{}'
);
create index journal_mode_events_recent on journal_mode_private.events(chantier_id,happened_at);
create index journal_mode_events_dedup on journal_mode_private.events(dedup_key,happened_at desc);
create table journal_mode_private.deliveries (
  id uuid primary key default gen_random_uuid(),session_id uuid not null references journal_mode_private.sessions(id) on delete cascade,
  endpoint text not null,keys jsonb not null,event_ids uuid[] not null,
  status text not null default 'claimed' check(status in ('claimed','sending','sent','retry','dropped')),
  lease_until timestamptz not null,created_at timestamptz not null default clock_timestamp()
);
create table journal_mode_private.queue (
  session_id uuid not null references journal_mode_private.sessions(id) on delete cascade,
  event_id uuid not null references journal_mode_private.events(id) on delete cascade,
  ready_at timestamptz not null,expires_at timestamptz not null,
  status text not null default 'pending' check(status in ('pending','claimed','sent','dropped')),
  attempts integer not null default 0,delivery_id uuid references journal_mode_private.deliveries(id) on delete set null,
  priority boolean not null default false,primary key(session_id,event_id)
);
create index journal_mode_queue_ready on journal_mode_private.queue(ready_at,session_id) where status='pending';
create index journal_mode_queue_delivery on journal_mode_private.queue(delivery_id);

create function journal_mode_private.can_access(p_user uuid,p_chantier uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select p_user is not null
   and exists(select 1 from auth.users where id=p_user)
   and not exists(select 1 from public.journal_user_access_blocks where user_id=p_user)
   and exists(select 1 from public.chantiers where id=p_chantier)
   and (exists(select 1 from public.journal_administrators where user_id=p_user and role in ('proprietaire','administrateur_general'))
     or exists(select 1 from public.chantier_members where user_id=p_user and chantier_id=p_chantier));
$$;
create function journal_mode_private.require_user()
returns uuid language plpgsql stable security definer set search_path='' as $$
begin
 if not public.journal_v142_is_active() then raise exception 'Compte non autorisé.' using errcode='42501'; end if;
 return auth.uid();
end $$;
create function journal_mode_private.configure(p_public_key text,p_dispatch_url text,p_dispatch_secret text,p_enabled boolean,p_private_key text default null)
returns void language plpgsql security definer set search_path='' as $$
begin
 if p_public_key is null or p_dispatch_url is null or p_public_key !~ '^[A-Za-z0-9_-]{87}$' or p_dispatch_secret is null or length(p_dispatch_secret)<32
   or p_dispatch_url !~ '^https://[a-z0-9]+[.]supabase[.]co/functions/v1/journal-mode-push$' then
   raise exception 'Configuration push invalide.';
 end if;
 update journal_mode_private.config set vapid_public_key=p_public_key,vapid_private_key=coalesce(p_private_key,vapid_private_key),
  dispatch_url=p_dispatch_url,dispatch_secret=p_dispatch_secret,enabled=coalesce(p_enabled,false);
end $$;
create function journal_mode_private.kick()
returns void language plpgsql security definer set search_path='' as $$
declare c journal_mode_private.config%rowtype;
begin
 select * into c from journal_mode_private.config where singleton;
 if not c.enabled or c.dispatch_url is null or c.dispatch_secret is null then return; end if;
 -- Le minuteur n'appelle aucune fonction Edge en dehors d'une file utile.
 update journal_mode_private.sessions set status='stopped',stopped_at=least(ends_at,clock_timestamp()),endpoint=null,keys=null,present_until=null
  where (status<>'stopped' or endpoint is not null) and
   (ends_at<=clock_timestamp() or not journal_mode_private.can_access(user_id,chantier_id));
 update journal_mode_private.queue q set status='dropped' from journal_mode_private.sessions s where q.session_id=s.id
  and q.status in ('pending','claimed') and (q.expires_at<=clock_timestamp() or s.status='stopped'
   or(s.status='paused' and s.pause_until>clock_timestamp()) or s.endpoint is null or s.present_until>clock_timestamp());
 if not exists(select 1 from journal_mode_private.queue where status='pending' and ready_at<=clock_timestamp())
  and not exists(select 1 from journal_mode_private.deliveries where status in ('claimed','sending') and lease_until<=clock_timestamp()) then return; end if;
 -- Résolution dynamique : pg_net est installé par le configurateur après migration.
 if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is not null then
   execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 125000)'
    using c.dispatch_url,'{"dispatch":true}'::jsonb,jsonb_build_object('Content-Type','application/json','x-journal-dispatch-secret',c.dispatch_secret);
 end if;
end $$;
create function public.journal_mode_config()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c journal_mode_private.config%rowtype;
begin
 perform journal_mode_private.require_user();
 select * into c from journal_mode_private.config where singleton;
 return jsonb_build_object('enabled',c.enabled,'vapid_public_key',c.vapid_public_key,'server_now',clock_timestamp(),'version','14.4');
end $$;
create function public.journal_mode_state(p_device_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=journal_mode_private.require_user();s journal_mode_private.sessions%rowtype;v_now timestamptz:=clock_timestamp();recap jsonb;
begin
 if p_device_id is null then raise exception 'Appareil obligatoire.'; end if;
 select * into s from journal_mode_private.sessions where user_id=u and device_id=p_device_id order by started_at desc limit 1 for update;
 if s.id is null then return jsonb_build_object('server_now',v_now,'session',null,'recap',jsonb_build_object('since',v_now,'messages',0,'actions',0,'documents',0,'events',0)); end if;
 if not journal_mode_private.can_access(u,s.chantier_id) then
  update journal_mode_private.sessions set status='stopped',stopped_at=v_now,endpoint=null,keys=null,present_until=null where id=s.id;
  return jsonb_build_object('server_now',v_now,'session',null,'recap',null);
 end if;
 if s.ends_at<=v_now and s.status<>'stopped' then
  update journal_mode_private.sessions set status='stopped',stopped_at=ends_at,present_until=null where id=s.id returning * into s;
 elsif s.status='paused' and s.pause_until<=v_now then
  update journal_mode_private.sessions set status='active',pause_until=null where id=s.id returning * into s;
 end if;
 select jsonb_build_object('since',s.recap_since,'messages',count(*) filter(where kind='message'),
  'actions',count(*) filter(where kind='action'),'documents',count(*) filter(where kind='document'),'events',count(*) filter(where kind in ('risk','log')))
 into recap from journal_mode_private.events where chantier_id=s.chantier_id and happened_at>=s.recap_since
  and happened_at<s.started_at and actor_id is distinct from u;
 return jsonb_build_object('server_now',v_now,'session',jsonb_build_object('id',s.id,'user_id',s.user_id,'device_id',s.device_id,
  'chantier_id',s.chantier_id,'started_at',s.started_at,'ends_at',s.ends_at,'status',s.status,'pause_until',s.pause_until,
  'push_enabled',s.endpoint is not null and (s.subscription_expires_at is null or s.subscription_expires_at>v_now)
     and (select enabled from journal_mode_private.config where singleton)),'recap',recap);
end $$;
create function public.journal_mode_start(p_device_id uuid,p_chantier_id uuid,p_ends_at timestamptz,p_subscription jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=journal_mode_private.require_user();v_now timestamptz:=clock_timestamp();v_since timestamptz;v_endpoint text;v_keys jsonb;v_exp timestamptz;
begin
 if p_device_id is null or p_chantier_id is null or not journal_mode_private.can_access(u,p_chantier_id) then
  raise exception 'Chantier non autorisé.' using errcode='42501'; end if;
 if p_ends_at is null or p_ends_at<=v_now or p_ends_at>v_now+interval '24 hours' then raise exception 'Choisis une fin dans les prochaines 24 heures.'; end if;
 if p_subscription is not null then
  v_endpoint:=p_subscription->>'endpoint';v_keys:=p_subscription->'keys';
  -- Défense SSRF: seuls les hôtes des services Web Push connus, HTTPS/443 sans userinfo.
  if jsonb_typeof(p_subscription)<>'object' or length(p_subscription::text)>8192 or v_endpoint is null or length(v_endpoint)>4096
   or v_endpoint !~ '^https://(fcm[.]googleapis[.]com|updates[.]push[.]services[.]mozilla[.]com|[a-z0-9-]+[.]notify[.]windows[.]com|web[.]push[.]apple[.]com)/[^[:space:]#]*$'
   or coalesce(v_keys->>'p256dh','') !~ '^[A-Za-z0-9_-]{87}={0,1}$'
   or coalesce(v_keys->>'auth','') !~ '^[A-Za-z0-9_-]{22}={0,2}$' then raise exception 'Abonnement de notification invalide.'; end if;
  if p_subscription->>'expirationTime' is not null then
   v_exp:=to_timestamp((p_subscription->>'expirationTime')::double precision/1000);
   if not isfinite(v_exp) or v_exp<=v_now then raise exception 'Abonnement expiré.'; end if;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_endpoint,144));
 end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text||p_device_id::text,144));
 select coalesce(stopped_at,least(ends_at,v_now)) into v_since from journal_mode_private.sessions
  where user_id=u and device_id=p_device_id and chantier_id=p_chantier_id order by started_at desc limit 1;
 update journal_mode_private.sessions set status='stopped',stopped_at=least(ends_at,v_now),present_until=null
  where user_id=u and device_id=p_device_id and status<>'stopped';
 -- Un endpoint réattribué ne peut notifier l'ancien compte sur un téléphone partagé.
 if v_endpoint is not null then
  update journal_mode_private.sessions set endpoint=null,keys=null,present_until=null where endpoint=v_endpoint;
 end if;
 insert into journal_mode_private.sessions(user_id,device_id,chantier_id,started_at,ends_at,recap_since,endpoint,keys,subscription_expires_at)
 values(u,p_device_id,p_chantier_id,v_now,p_ends_at,greatest(coalesce(v_since,v_now),v_now-interval '30 days'),v_endpoint,v_keys,v_exp);
 return public.journal_mode_state(p_device_id);
end $$;
create function public.journal_mode_control(p_device_id uuid,p_operation text,p_until timestamptz default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=journal_mode_private.require_user();s journal_mode_private.sessions%rowtype;v_now timestamptz:=clock_timestamp();
begin
 select * into s from journal_mode_private.sessions where user_id=u and device_id=p_device_id and status<>'stopped' for update;
 if s.id is null then return public.journal_mode_state(p_device_id); end if;
 if p_operation='stop' then
  update journal_mode_private.sessions set status='stopped',stopped_at=least(ends_at,v_now),present_until=null where id=s.id;
 elsif not journal_mode_private.can_access(u,s.chantier_id) or s.ends_at<=v_now then
  update journal_mode_private.sessions set status='stopped',stopped_at=least(ends_at,v_now),present_until=null where id=s.id;
 elsif p_operation='pause' then
  if p_until is null then p_until:=least(v_now+interval '30 minutes',s.ends_at); end if;
  if p_until<=v_now or p_until>s.ends_at then raise exception 'Fin de pause invalide.'; end if;
  update journal_mode_private.sessions set status='paused',pause_until=p_until,present_until=null where id=s.id;
 elsif p_operation='resume' then
  update journal_mode_private.sessions set status='active',pause_until=null where id=s.id;
 elsif p_operation='extend' then
  if p_until is null or p_until<=s.ends_at or p_until>s.started_at+interval '24 hours' then raise exception 'La durée totale du poste est limitée à 24 heures.'; end if;
  update journal_mode_private.sessions set ends_at=p_until where id=s.id;
 else raise exception 'Opération inconnue.';
 end if;
 -- Aucun rattrapage en rafale des événements antérieurs à la pause/arrêt.
 if p_operation in ('pause','stop') then update journal_mode_private.queue set status='dropped' where session_id=s.id and status in ('pending','claimed'); end if;
 return public.journal_mode_state(p_device_id);
end $$;
create function public.journal_mode_presence(p_device_id uuid,p_visible boolean,p_chantier_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=journal_mode_private.require_user();
begin
 update journal_mode_private.sessions set present_until=case when p_visible is true and chantier_id=p_chantier_id
  and journal_mode_private.can_access(u,chantier_id) then clock_timestamp()+interval '60 seconds' else null end
 where user_id=u and device_id=p_device_id and status<>'stopped' and ends_at>clock_timestamp();
end $$;
create function public.journal_mode_forget_device(p_device_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 -- Autoriser la purge personnelle même après révocation ; aucune lecture permise.
 if auth.uid() is null then raise exception 'Connexion requise.' using errcode='42501'; end if;
 update journal_mode_private.sessions set status='stopped',stopped_at=least(ends_at,clock_timestamp()),endpoint=null,keys=null,present_until=null
 where user_id=auth.uid() and device_id=p_device_id;
 update journal_mode_private.queue q set status='dropped' from journal_mode_private.sessions s
 where q.session_id=s.id and s.user_id=auth.uid() and s.device_id=p_device_id and q.status in ('pending','claimed');
end $$;

-- One event per publication: message/photos and linked action announcements share it.
create function journal_mode_private.record_event(p_site uuid,p_actor uuid,p_kind text,p_entity uuid,p_key text,p_message uuid,p_action uuid,p_urgent boolean,p_priority_users uuid[] default '{}')
returns uuid language plpgsql security definer set search_path='' as $$
declare e journal_mode_private.events%rowtype;s journal_mode_private.sessions%rowtype;v_now timestamptz:=clock_timestamp();v_priority boolean;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_key,144));
 select * into e from journal_mode_private.events where dedup_key=p_key and happened_at>v_now-interval '20 seconds' order by happened_at desc limit 1 for update;
 if e.id is null then
  insert into journal_mode_private.events(chantier_id,actor_id,kind,entity_id,dedup_key,message_id,action_id,urgent,priority_users)
  values(p_site,p_actor,p_kind,p_entity,p_key,p_message,p_action,coalesce(p_urgent,false),coalesce(p_priority_users,'{}')) returning * into e;
 else
  update journal_mode_private.events set message_id=coalesce(p_message,message_id),action_id=coalesce(p_action,action_id),
   urgent=urgent or coalesce(p_urgent,false),priority_users=array(select distinct unnest(priority_users||coalesce(p_priority_users,'{}')))
   where id=e.id returning * into e;
 end if;
 if not (select enabled from journal_mode_private.config where singleton) then return e.id; end if;
 -- Endpoint/permissions checked here AND immediately before transport.
 for s in select * from journal_mode_private.sessions where chantier_id=p_site and started_at<=e.happened_at and ends_at>v_now
   and (status='active' or(status='paused' and pause_until<=v_now)) and endpoint is not null
   and (subscription_expires_at is null or subscription_expires_at>v_now)
   and user_id is distinct from p_actor and journal_mode_private.can_access(user_id,p_site) loop
  v_priority:=e.urgent or coalesce(s.user_id=any(e.priority_users),false);
  insert into journal_mode_private.queue(session_id,event_id,ready_at,expires_at,priority,status)
   values(s.id,e.id,case when v_priority then v_now else e.happened_at+interval '20 seconds' end,
    least(s.ends_at,e.happened_at+interval '2 minutes'),v_priority,case when s.present_until>v_now then 'dropped' else 'pending' end)
   on conflict(session_id,event_id) do update set priority=journal_mode_private.queue.priority or excluded.priority,
    ready_at=least(journal_mode_private.queue.ready_at,excluded.ready_at);
 end loop;
 if e.urgent or cardinality(e.priority_users)>0 then
  -- A broken optional push transport must not abort a user's publication.
  begin perform journal_mode_private.kick(); exception when others then raise log 'Journal mode push kick deferred to cron'; end;
 end if;
 return e.id;
end $$;
create function journal_mode_private.capture_event()
returns trigger language plpgsql security definer set search_path='' as $$
declare j jsonb:=to_jsonb(new);o jsonb;site uuid;actor uuid;entity uuid;msg uuid;act uuid;k text;dedup text;urgent boolean:=false;users uuid[]:='{}';body text;m jsonb;ignored text[];
begin
 site:=nullif(j->>'chantier_id','')::uuid;entity:=nullif(j->>'id','')::uuid;
 if site is null or entity is null then return new; end if;
 actor:=coalesce(auth.uid(),nullif(j->>'author_id','')::uuid,nullif(j->>'created_by','')::uuid,nullif(j->>'uploaded_by','')::uuid);
 if tg_op='UPDATE' then
  o:=to_jsonb(old);
  -- FK SET NULL, timestamps and publication backlinks are metadata, not alerts.
  ignored:=array['created_by','author_id','uploaded_by','updated_by','closed_by','author_name','created_by_name','updated_at','edited_at','message_id'];
  if (j-ignored) is not distinct from (o-ignored) then return new; end if;
 end if;
 if tg_table_name='chantier_attachments' then
  msg:=nullif(j->>'message_id','')::uuid;
  select to_jsonb(t) into m from public.chantier_messages t where id=msg and chantier_id=site;
  if m is null or m->>'deleted_at' is not null then return new; end if;
  -- L'ajout/réessai d'une photo complète sa publication, sans deuxième alerte.
  if exists(select 1 from journal_mode_private.events where message_id=msg) then return new; end if;
  actor:=coalesce(auth.uid(),nullif(m->>'author_id','')::uuid);act:=nullif(m->>'action_id','')::uuid;
  k:='message';entity:=msg;body:=m->>'body';urgent:=coalesce((m->>'is_important')::boolean,false);
 elsif tg_table_name='chantier_messages' then
  msg:=entity;act:=nullif(j->>'action_id','')::uuid;k:='message';body:=j->>'body';
  urgent:=coalesce((j->>'is_important')::boolean,false);
  if j->>'deleted_at' is not null then
   update journal_mode_private.queue q set status='dropped' from journal_mode_private.events e
    where q.event_id=e.id and e.message_id=msg and q.status in ('pending','claimed');
   return new;
  end if;
 elsif tg_table_name='action_items' then
  k:='action';act:=entity;msg:=nullif(j->>'message_id','')::uuid;
  urgent:=(j->>'priority')='critique';
  if j->>'assignee_user_id' is not null then users:=array[(j->>'assignee_user_id')::uuid]; end if;
 elsif tg_table_name='chantier_documents' then k:='document';
 elsif tg_table_name='chantier_daily_logs' then k:='log';msg:=nullif(j->>'message_id','')::uuid;
 elsif tg_table_name='chantier_risks' then k:='risk';msg:=nullif(j->>'message_id','')::uuid;urgent:=(j->>'severity') in ('elevee','critique');
 else return new;
 end if;
 if body is not null and position('@' in body)>0 then
  -- Le sélecteur historique écrit @Nom Prénom, avec espaces conservées.
  -- Comparaisons littérales et limites de mots : pas d'expression regex issue du profil.
  select coalesce(array_agg(p.id),'{}') into users from public.profiles p
   cross join lateral(select '@'||lower(btrim(p.full_name)) as needle)n
   cross join lateral(select strpos(lower(body),n.needle) as pos)x
   where nullif(btrim(p.full_name),'') is not null and journal_mode_private.can_access(p.id,site)
    and (lower(body) ~ '(^|[[:space:]])@équipe($|[^[:alnum:]_.-])' or
     (x.pos>0 and (x.pos=1 or substring(body from x.pos-1 for 1) !~ '[[:alnum:]_.-]')
      and (x.pos+length(n.needle)>length(body) or substring(body from x.pos+length(n.needle) for 1) !~ '[[:alnum:]_.-]')));
 end if;
 if act is not null then
  dedup:='action:'||act;k:='action';entity:=act;
  select array(select distinct x from unnest(users||array[a.assignee_user_id])x where x is not null) into users from public.action_items a where a.id=act;
 else dedup:=k||':'||entity; end if;
 perform journal_mode_private.record_event(site,actor,k,entity,dedup,msg,act,urgent,users);
 return new;
end $$;
do $$ declare t text;begin
 foreach t in array array['chantier_messages','chantier_attachments','action_items','chantier_documents','chantier_daily_logs','chantier_risks'] loop
  execute format('create trigger journal_mode_capture after insert or update on public.%I for each row execute function journal_mode_private.capture_event()',t);
 end loop;
end $$;

create function journal_mode_private.delivery_json(p_delivery uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('delivery_id',d.id,'session_id',s.id,'user_id',s.user_id,'device_id',s.device_id,'chantier_id',s.chantier_id,
  'chantier_name',left(c.name,100),'ends_at',s.ends_at,'endpoint',d.endpoint,'keys',d.keys,'event_count',cardinality(d.event_ids),
  'priority',(select coalesce(bool_or(priority),false) from journal_mode_private.queue where delivery_id=d.id),
  'message_id',e.message_id,'action_id',e.action_id,'event_kind',e.kind,'event_id',e.id)
 from journal_mode_private.deliveries d join journal_mode_private.sessions s on s.id=d.session_id
 join public.chantiers c on c.id=s.chantier_id
 cross join lateral(select * from journal_mode_private.events where id=any(d.event_ids) order by (urgent or coalesce(s.user_id=any(priority_users),false)) desc,happened_at desc limit 1)e
 where d.id=p_delivery;
$$;
create function public.journal_mode_dispatch_claim(p_limit integer default 50)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_now timestamptz:=clock_timestamp();s journal_mode_private.sessions%rowtype;ids uuid[];delivery uuid;result jsonb:='[]';
begin
 if p_limit is null or p_limit<1 or p_limit>100 then raise exception 'Limite de dispatch invalide.'; end if;
 -- Expiration and orphan cleanup even while push is disabled.
 update journal_mode_private.sessions set status='stopped',stopped_at=least(ends_at,v_now),endpoint=null,keys=null,present_until=null
  where (status<>'stopped' or endpoint is not null) and
   (ends_at<=v_now or not journal_mode_private.can_access(user_id,chantier_id));
 update journal_mode_private.sessions set status='active',pause_until=null where status='paused' and pause_until<=v_now and ends_at>v_now;
 -- A sender that disappeared AFTER confirm has ambiguous transport: don't repeat.
 update journal_mode_private.queue q set status='dropped' from journal_mode_private.deliveries d
  where q.delivery_id=d.id and d.status='sending' and d.lease_until<=v_now and q.status='claimed';
 update journal_mode_private.deliveries set status='dropped' where status='sending' and lease_until<=v_now;
 -- A sender that disappeared BEFORE confirm may safely be reclaimed.
 update journal_mode_private.queue q set status=case when q.attempts<3 then 'pending' else 'dropped' end,delivery_id=null
  from journal_mode_private.deliveries d where q.delivery_id=d.id and d.status='claimed' and d.lease_until<=v_now and q.status='claimed';
 update journal_mode_private.deliveries set status='retry' where status='claimed' and lease_until<=v_now;
 update journal_mode_private.queue q set status='dropped' from journal_mode_private.sessions checked_session where q.session_id=checked_session.id
  and q.status in ('pending','claimed') and (q.expires_at<=v_now or checked_session.status<>'active' or checked_session.ends_at<=v_now or checked_session.endpoint is null
    or checked_session.present_until>v_now or(checked_session.subscription_expires_at is not null and checked_session.subscription_expires_at<=v_now));
 delete from journal_mode_private.sessions where not exists(select 1 from auth.users where id=user_id);
 delete from journal_mode_private.sessions where status='stopped' and started_at<v_now-interval '30 days';
 delete from journal_mode_private.events where happened_at<v_now-interval '30 days';
 delete from journal_mode_private.deliveries where created_at<v_now-interval '1 day';
 if not(select enabled from journal_mode_private.config where singleton) then return result; end if;
 for s in select ss.* from journal_mode_private.sessions ss where ss.status='active' and ss.ends_at>v_now and ss.endpoint is not null
  and journal_mode_private.can_access(ss.user_id,ss.chantier_id)
  and not exists(select 1 from journal_mode_private.deliveries d where d.session_id=ss.id and d.status in ('claimed','sending') and d.lease_until>v_now)
  and exists(select 1 from journal_mode_private.queue q where q.session_id=ss.id and q.status='pending' and q.ready_at<=v_now)
  order by (select min(q.ready_at) from journal_mode_private.queue q where q.session_id=ss.id and q.status='pending'),ss.id
  limit p_limit for update of ss skip locked loop
  -- Claim all already waiting events in this site's short grouping window.
  select array_agg(event_id) into ids from(select q.event_id from journal_mode_private.queue q
   where q.session_id=s.id and q.status='pending' and q.expires_at>v_now order by q.ready_at limit 100 for update skip locked) pending;
  if ids is null then continue; end if;
  insert into journal_mode_private.deliveries(session_id,endpoint,keys,event_ids,lease_until)
   values(s.id,s.endpoint,s.keys,ids,least(s.ends_at,v_now+interval '120 seconds')) returning id into delivery;
  update journal_mode_private.queue set status='claimed',attempts=attempts+1,delivery_id=delivery where session_id=s.id and event_id=any(ids);
  result:=result||jsonb_build_array(journal_mode_private.delivery_json(delivery));
 end loop;
 return result;
end $$;
create function public.journal_mode_dispatch_confirm(p_delivery_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d journal_mode_private.deliveries%rowtype;s journal_mode_private.sessions%rowtype;v_now timestamptz:=clock_timestamp();
begin
 select * into d from journal_mode_private.deliveries where id=p_delivery_id for update;
 if d.id is null or d.status<>'claimed' or d.lease_until<=v_now then return null; end if;
 select * into s from journal_mode_private.sessions where id=d.session_id;
 if s.id is null or not(select enabled from journal_mode_private.config where singleton)
  or s.status<>'active' or s.ends_at<=v_now or s.endpoint is distinct from d.endpoint or s.keys is distinct from d.keys
  or s.present_until>v_now or (s.subscription_expires_at is not null and s.subscription_expires_at<=v_now)
  or not journal_mode_private.can_access(s.user_id,s.chantier_id)
  or not exists(select 1 from journal_mode_private.queue where delivery_id=d.id and status='claimed' and expires_at>v_now) then
   update journal_mode_private.deliveries set status='dropped' where id=d.id;
   update journal_mode_private.queue set status='dropped' where delivery_id=d.id and status='claimed';return null;
 end if;
 -- Expired/deleted events cannot remain in a group with another still-valid one.
 update journal_mode_private.deliveries set event_ids=array(select event_id from journal_mode_private.queue where delivery_id=d.id and status='claimed' and expires_at>v_now),status='sending' where id=d.id;
 return journal_mode_private.delivery_json(d.id);
end $$;
create function public.journal_mode_dispatch_finish(p_delivery_id uuid,p_result text)
returns void language plpgsql security definer set search_path='' as $$
declare d journal_mode_private.deliveries%rowtype;v_now timestamptz:=clock_timestamp();
begin
 if p_result is null or p_result not in ('sent','retry','gone','dropped') then raise exception 'Résultat inconnu.'; end if;
 select * into d from journal_mode_private.deliveries where id=p_delivery_id for update;
 if d.id is null or d.status not in ('claimed','sending') then return; end if;
 if p_result='gone' then
  update journal_mode_private.sessions set endpoint=null,keys=null where id=d.session_id and endpoint=d.endpoint and keys=d.keys;
 end if;
 update journal_mode_private.queue set status=case when p_result='sent' then 'sent'
  when p_result='retry' and attempts<3 and expires_at>v_now+interval '20 seconds' then 'pending' else 'dropped' end,
  ready_at=case when p_result='retry' then v_now+interval '20 seconds' else ready_at end
  where delivery_id=d.id and status='claimed';
 update journal_mode_private.deliveries set status=case when p_result='gone' then 'dropped' else p_result end where id=d.id;
end $$;

-- Private schema is absent from the Data API. RLS remains enabled as a second guard.
do $$ declare r record;begin
 for r in select tablename from pg_tables where schemaname='journal_mode_private' loop
  execute format('alter table journal_mode_private.%I enable row level security',r.tablename);
  execute format('revoke all on journal_mode_private.%I from public,anon,authenticated,service_role',r.tablename);
 end loop;
 for r in select p.oid::regprocedure sig,n.nspname,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='journal_mode_private' or(n.nspname='public' and p.proname like 'journal_mode_%') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',r.sig);
  if r.nspname='public' then
   execute format('grant execute on function %s to %I',r.sig,case when r.proname like 'journal_mode_dispatch_%' then 'service_role' else 'authenticated' end);
  end if;
 end loop;
end $$;
select public.journal_v142_assert_account_cleanup_safe();
notify pgrst,'reload schema';
commit;
