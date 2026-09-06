-- ONLY an EMPTY, disposable PostgreSQL 16 database. NEVER a Supabase project.
\set ON_ERROR_STOP on
do $$ begin
  if to_regclass('public.profiles') is not null or exists(select 1 from pg_namespace where nspname in ('auth','storage')) then
    raise exception 'Fixture refusée : la base doit être vide et jetable.';
  end if;
end $$;
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create schema storage;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}'::jsonb);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema public,auth,storage to authenticated,anon,service_role;
grant execute on function auth.uid() to authenticated,anon,service_role;
create table public.profiles(id uuid primary key references auth.users(id) on delete cascade,full_name text,email text,company text);
create table public.chantiers(id uuid primary key,name text,created_by uuid not null references auth.users(id) on delete cascade);
create table public.journal_administrators(user_id uuid primary key references auth.users(id) on delete cascade,role text not null);
create table public.chantier_members(chantier_id uuid references chantiers(id) on delete cascade,user_id uuid references profiles(id) on delete cascade,role text not null,primary key(chantier_id,user_id));
create table public.journal_access_requests(id uuid primary key default gen_random_uuid(),user_id uuid references profiles(id) on delete cascade,status text not null default 'en_attente');
create table public.action_items(id uuid primary key default gen_random_uuid(),chantier_id uuid references chantiers(id) on delete cascade,
  title text not null,description text,assignee text,due_date date check(due_date>=current_date+1),priority text default 'normale',status text default 'a_faire',
  message_id uuid,created_by uuid not null references profiles(id) on delete cascade,created_at timestamptz default now(),updated_at timestamptz default now());
create table public.chantier_messages(id uuid primary key default gen_random_uuid(),chantier_id uuid references chantiers(id) on delete cascade,
  body text not null check(char_length(btrim(body))>0),author_id uuid not null references profiles(id) on delete cascade,author_name text);
create table public.chantier_documents(id uuid primary key default gen_random_uuid(),chantier_id uuid references chantiers(id) on delete cascade,created_by uuid not null references auth.users(id) on delete cascade,created_by_name text);
create table public.chantier_read_states(chantier_id uuid references chantiers(id),user_id uuid references profiles(id),primary key(chantier_id,user_id));
create table public.chantier_message_reactions(id uuid primary key default gen_random_uuid(),chantier_id uuid references chantiers(id),user_id uuid references profiles(id));
create table storage.buckets(id text primary key,name text,public boolean default true,owner uuid,owner_id text);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,owner uuid,owner_id text);
insert into storage.buckets(id,name) values('chantier-files','chantier-files'),('chantier-documents','chantier-documents'),('chantier-cover-images','chantier-cover-images');
create function public.journal_can_access_chantier(p_chantier_id uuid) returns boolean language sql as $$select true$$;
create function public.journal_can_manage_chantier_documents(p_chantier_id uuid) returns boolean language sql as $$select true$$;
create function public.journal_is_owner() returns boolean language sql as $$select true$$;
create function public.revoke_journal_user_access(p_user_id uuid) returns void language plpgsql as $$begin null; end$$;
-- Deliberately over-permissive old policies: V14.2 must close these paths.
do $$ declare r record; begin
 for r in select tablename from pg_tables where schemaname='public' loop
  execute format('alter table public.%I enable row level security',r.tablename);
  execute format('create policy old_permissive on public.%I for all to authenticated using (true) with check (true)',r.tablename);
  execute format('grant all on public.%I to authenticated',r.tablename);
 end loop;
end$$;
alter table storage.objects enable row level security;
create policy old_storage_permissive on storage.objects for all to authenticated using(true) with check(true);
grant all on storage.objects to authenticated;
insert into auth.users(id,email) select ('00000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'user'||i||'@test.invalid' from generate_series(1,8) i;
insert into public.profiles(id,email,full_name,company) select id,email,'Personne '||right(id::text,1),'Entreprise' from auth.users;
insert into public.journal_administrators(user_id,role) values('00000000-0000-4000-8000-000000000001','proprietaire');
insert into public.chantiers values('aaaaaaaa-0000-4000-8000-000000000001','A','00000000-0000-4000-8000-000000000003'),('bbbbbbbb-0000-4000-8000-000000000001','B','00000000-0000-4000-8000-000000000001');
insert into public.chantier_members(chantier_id,user_id,role) select 'aaaaaaaa-0000-4000-8000-000000000001',id,case right(id::text,1) when '5' then 'lecture' when '6' then 'administrateur' else 'membre' end from auth.users where right(id::text,1) in ('2','3','4','5','6','8');
insert into public.journal_access_requests(user_id,status) select id,case right(id::text,1) when '7' then 'en_attente' else 'acceptee' end from auth.users;
insert into public.action_items(id,chantier_id,title,assignee,created_by) values('11111111-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000001','Action existante','Personne 3','00000000-0000-4000-8000-000000000002'),('11111111-0000-4000-8000-000000000002','aaaaaaaa-0000-4000-8000-000000000001','Ancienne action du lecteur','Texte libre','00000000-0000-4000-8000-000000000005');
insert into public.chantier_messages(id,chantier_id,body,author_id,author_name) values('22222222-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000001','Historique conservé','00000000-0000-4000-8000-000000000003','Personne 3');
insert into public.chantier_documents(chantier_id,created_by,created_by_name) values('aaaaaaaa-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000003','Personne 3');
insert into storage.objects(bucket_id,name,owner,owner_id) values('chantier-files','photo.jpg','00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000003');
-- Auth registration exists before the historical profile trigger has completed.
insert into auth.users(id,email,raw_user_meta_data) values('00000000-0000-4000-8000-000000000009','user9@test.invalid','{"first_name":"Jean","last_name":"Essai"}');
