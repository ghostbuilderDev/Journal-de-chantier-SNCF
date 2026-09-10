BEGIN;
-- V15.10.1: private notification wake-up signal and canonical QR participant names.
create table if not exists public.journal_notification_signals (
 user_id uuid primary key, revision bigint not null default 1
);
alter table public.journal_notification_signals enable row level security;
revoke all on public.journal_notification_signals from public,anon,authenticated;
grant select on public.journal_notification_signals to authenticated;
drop policy if exists journal_notification_own_signal on public.journal_notification_signals;
create policy journal_notification_own_signal on public.journal_notification_signals
 for select to authenticated using(user_id=(select auth.uid()) and public.journal_v142_is_active());
create or replace function journal_cr_private.signal_notification() returns trigger
 language plpgsql security definer set search_path='' as $$
begin
 if new.read_at is null and (new.is_mention or new.kind in ('daily_report','cr')) then
  insert into public.journal_notification_signals(user_id,revision) values(new.user_id,1)
  on conflict(user_id) do update set revision=journal_notification_signals.revision+1;
 end if;
 return new;
end $$;
revoke all on function journal_cr_private.signal_notification() from public,anon,authenticated,service_role;
drop trigger if exists journal_notification_signal on journal_cr_private.notifications;
create trigger journal_notification_signal after insert or update of is_mention,excerpt,title
 on journal_cr_private.notifications for each row execute function journal_cr_private.signal_notification();
do $$ begin
 if not exists(select 1 from pg_publication where pubname='supabase_realtime') then
  create publication supabase_realtime;
 end if;
 if not exists(select 1 from pg_publication where pubname='supabase_realtime' and puballtables)
  and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='journal_notification_signals') then
  alter publication supabase_realtime add table public.journal_notification_signals;
 end if;
end $$;

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
 -- Canonical case is enforced even for an older phone using the existing QR.
 p_payload:=p_payload||jsonb_build_object('nom',upper(trim(coalesce(p_payload->>'nom',''))),'entreprise',upper(trim(coalesce(p_payload->>'entreprise',''))));
 v_id:=(p_payload->>'id')::uuid;
 if v_id is null then raise exception 'Identifiant de signature requis';end if;
 select * into v from journal_briefing_private.signatures where signatures.id=v_id;
 if found then
  if v.session_id<>s.id or upper(v.nom)<>p_payload->>'nom' or v.prenom<>trim(coalesce(p_payload->>'prenom','')) or v.fonction<>trim(coalesce(p_payload->>'fonction','')) or upper(v.entreprise)<>p_payload->>'entreprise' or v.signature<>coalesce(p_payload->>'signature','') then raise exception 'Cette validation a déjà été utilisée';end if;
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
