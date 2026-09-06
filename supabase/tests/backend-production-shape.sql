-- ONLY after backend-fixture.sql in the same EMPTY disposable test database.
-- Relevant column/constraint/index contracts copied from the read-only diagnostic
-- Diagnostic-Supabase-34056471078.json (2026-09-06). This is NOT a schema dump:
-- historical function bodies, trigger bodies and default expressions were not
-- exported. No historical triggers are fabricated. Data/default values below
-- are synthetic fixtures, and old policies deliberately remain permissive so
-- the new restrictive policy can be tested. Never apply this file to production.
\set ON_ERROR_STOP on

alter table public.chantier_messages alter column body drop not null;
alter table public.chantier_messages
  add column deleted_at timestamptz,
  add column reply_to uuid,
  add column message_type text not null default 'message',
  add column zone text not null default '',
  add column is_important boolean not null default false,
  add column created_at timestamptz not null default now(),
  add column edited_at timestamptz;
alter table public.chantier_messages alter column author_name set default '';

alter table public.action_items
  add column close_note text,add column closed_at timestamptz,
  add column closed_by uuid,add column proof_message_id uuid;
alter table public.chantiers
  add column planned_start date,add column planned_end date,
  add column cover_storage_path text;
alter table public.journal_access_requests
  add column granted_role text,add column granted_chantier_id uuid;
alter table public.chantier_message_reactions
  add column message_id uuid not null,
  add column emoji text not null,
  add column created_at timestamptz not null default now();
alter table public.chantier_read_states
  add column last_read_at timestamptz not null default now(),
  add column updated_at timestamptz not null default now();
alter table public.chantier_members add column created_at timestamptz not null default now();
alter table public.journal_administrators add column created_at timestamptz not null default now();

create table public.chantier_invitations(
  id uuid primary key default gen_random_uuid(),chantier_id uuid not null,
  email text not null,role text not null default 'membre',
  invited_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),accepted_at timestamptz);
create table public.chantier_attachments(
  id uuid primary key default gen_random_uuid(),chantier_id uuid not null,
  message_id uuid not null,storage_path text not null,file_name text not null,
  mime_type text not null default 'application/octet-stream',
  bytes bigint not null default 0,category text not null default 'message',
  created_at timestamptz not null default now());
create table public.chantier_daily_logs(
  id uuid primary key default gen_random_uuid(),chantier_id uuid not null,
  author_id uuid not null default auth.uid(),author_name text not null default '',
  work_summary text not null,message_id uuid,
  created_at timestamptz not null default now());
create table public.chantier_risks(
  id uuid primary key default gen_random_uuid(),chantier_id uuid not null,
  author_id uuid not null default auth.uid(),author_name text not null default '',
  severity text not null default 'faible',status text not null default 'ouvert',
  description text not null,message_id uuid,
  created_at timestamptz not null default now());
create table public.chantier_document_folders(
  id uuid primary key default gen_random_uuid(),chantier_id uuid not null,
  parent_id uuid,root_code text not null,name text not null,
  is_root boolean not null default false,created_by uuid,created_by_name text,
  created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table public.journal_portal_apps(
  id uuid primary key default gen_random_uuid(),name text not null,url text not null,
  description text,icon_key text not null default 'app',created_by uuid,
  created_at timestamptz not null default now(),updated_at timestamptz not null default now());

insert into public.chantier_document_folders
  (id,chantier_id,root_code,name,is_root,created_by,created_by_name)
values('55555555-0000-4000-8000-000000000001',
  'aaaaaaaa-0000-4000-8000-000000000001','plans','Plans conservés',true,
  '00000000-0000-4000-8000-000000000003','Personne 3');
alter table public.chantier_documents
  add column folder_id uuid,add column storage_path text,
  add column file_name text,add column mime_type text not null default 'application/pdf',
  add column bytes bigint not null default 0;
update public.chantier_documents set
  folder_id='55555555-0000-4000-8000-000000000001',
  storage_path='test-production-shape/document.pdf',file_name='Historique.pdf';
alter table public.chantier_documents
  alter column folder_id set not null,alter column storage_path set not null,
  alter column file_name set not null;

-- Remove simplified fixture CHECK/FKs, including its synthetic deadline CHECK.
-- Rebuild these contracts with the exact names/definitions in the diagnostic.
-- Documents/folders/portal created_by have NO identity FK in this diagnostic:
-- do not invent one; account deletion must preserve their historical UUID label.
do $$ declare r record; begin
  for r in select c.conname,n.nspname,t.relname from pg_constraint c
    join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace
    where n.nspname='public' and c.contype in ('c','f') loop
    execute format('alter table %I.%I drop constraint %I',r.nspname,r.relname,r.conname);
  end loop;
end $$;
alter table public.action_items add constraint action_items_chantier_id_fkey FOREIGN KEY (chantier_id) REFERENCES chantiers(id) ON DELETE CASCADE;
alter table public.action_items add constraint action_items_closed_by_fkey FOREIGN KEY (closed_by) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.action_items add constraint action_items_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE RESTRICT;
alter table public.action_items add constraint action_items_message_id_fkey FOREIGN KEY (message_id) REFERENCES chantier_messages(id) ON DELETE SET NULL;
alter table public.action_items add constraint action_items_priority_check CHECK (priority = ANY (ARRAY['basse'::text, 'normale'::text, 'haute'::text, 'critique'::text]));
alter table public.action_items add constraint action_items_proof_message_id_fkey FOREIGN KEY (proof_message_id) REFERENCES chantier_messages(id) ON DELETE SET NULL;
alter table public.action_items add constraint action_items_status_check CHECK (status = ANY (ARRAY['a_faire'::text, 'en_cours'::text, 'terminee'::text]));
alter table public.chantier_attachments add constraint chantier_attachments_bytes_check CHECK (bytes >= 0);
alter table public.chantier_attachments add constraint chantier_attachments_category_check CHECK (category = ANY (ARRAY['message'::text, 'document'::text, 'plan'::text]));
alter table public.chantier_attachments add constraint chantier_attachments_chantier_id_fkey FOREIGN KEY (chantier_id) REFERENCES chantiers(id) ON DELETE CASCADE;
alter table public.chantier_attachments add constraint chantier_attachments_message_id_fkey FOREIGN KEY (message_id) REFERENCES chantier_messages(id) ON DELETE CASCADE;
alter table public.chantier_daily_logs add constraint chantier_daily_logs_author_id_fkey FOREIGN KEY (author_id) REFERENCES auth.users(id) ON DELETE RESTRICT;
alter table public.chantier_daily_logs add constraint chantier_daily_logs_chantier_id_fkey FOREIGN KEY (chantier_id) REFERENCES chantiers(id) ON DELETE CASCADE;
alter table public.chantier_daily_logs add constraint chantier_daily_logs_message_id_fkey FOREIGN KEY (message_id) REFERENCES chantier_messages(id) ON DELETE SET NULL;
alter table public.chantier_document_folders add constraint chantier_document_folders_chantier_id_fkey FOREIGN KEY (chantier_id) REFERENCES chantiers(id) ON DELETE CASCADE;
alter table public.chantier_document_folders add constraint chantier_document_folders_check CHECK (is_root AND parent_id IS NULL OR NOT is_root AND parent_id IS NOT NULL);
alter table public.chantier_document_folders add constraint chantier_document_folders_name_check CHECK (char_length(btrim(name)) >= 1 AND char_length(btrim(name)) <= 120);
alter table public.chantier_document_folders add constraint chantier_document_folders_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES chantier_document_folders(id) ON DELETE RESTRICT;
alter table public.chantier_document_folders add constraint chantier_document_folders_root_code_check CHECK (root_code = ANY (ARRAY['securite'::text, 'plans'::text, 'qualite'::text, 'personnalise'::text]));
alter table public.chantier_documents add constraint chantier_documents_bytes_check CHECK (bytes >= 0 AND bytes <= 52428800);
alter table public.chantier_documents add constraint chantier_documents_chantier_id_fkey FOREIGN KEY (chantier_id) REFERENCES chantiers(id) ON DELETE CASCADE;
alter table public.chantier_documents add constraint chantier_documents_file_name_check CHECK (char_length(btrim(file_name)) >= 1 AND char_length(btrim(file_name)) <= 180);
alter table public.chantier_documents add constraint chantier_documents_folder_id_fkey FOREIGN KEY (folder_id) REFERENCES chantier_document_folders(id) ON DELETE RESTRICT;
alter table public.chantier_invitations add constraint chantier_invitations_chantier_id_fkey FOREIGN KEY (chantier_id) REFERENCES chantiers(id) ON DELETE CASCADE;
alter table public.chantier_invitations add constraint chantier_invitations_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES auth.users(id) ON DELETE RESTRICT;
alter table public.chantier_invitations add constraint chantier_invitations_role_check CHECK (role = ANY (ARRAY['administrateur'::text, 'membre'::text, 'lecture'::text]));
alter table public.chantier_members add constraint chantier_members_chantier_id_fkey FOREIGN KEY (chantier_id) REFERENCES chantiers(id) ON DELETE CASCADE;
alter table public.chantier_members add constraint chantier_members_role_check CHECK (role = ANY (ARRAY['administrateur'::text, 'membre'::text, 'lecture'::text]));
alter table public.chantier_members add constraint chantier_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.chantier_message_reactions add constraint chantier_message_reactions_chantier_id_fkey FOREIGN KEY (chantier_id) REFERENCES chantiers(id) ON DELETE CASCADE;
alter table public.chantier_message_reactions add constraint chantier_message_reactions_emoji_check CHECK (char_length(emoji) >= 1 AND char_length(emoji) <= 16);
alter table public.chantier_message_reactions add constraint chantier_message_reactions_message_id_fkey FOREIGN KEY (message_id) REFERENCES chantier_messages(id) ON DELETE CASCADE;
alter table public.chantier_message_reactions add constraint chantier_message_reactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.chantier_messages add constraint chantier_message_content CHECK (body IS NOT NULL OR deleted_at IS NOT NULL);
alter table public.chantier_messages add constraint chantier_messages_author_id_fkey FOREIGN KEY (author_id) REFERENCES auth.users(id) ON DELETE RESTRICT;
alter table public.chantier_messages add constraint chantier_messages_chantier_id_fkey FOREIGN KEY (chantier_id) REFERENCES chantiers(id) ON DELETE CASCADE;
alter table public.chantier_messages add constraint chantier_messages_reply_to_fkey FOREIGN KEY (reply_to) REFERENCES chantier_messages(id) ON DELETE SET NULL;
alter table public.chantier_read_states add constraint chantier_read_states_chantier_id_fkey FOREIGN KEY (chantier_id) REFERENCES chantiers(id) ON DELETE CASCADE;
alter table public.chantier_read_states add constraint chantier_read_states_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.chantier_risks add constraint chantier_risks_author_id_fkey FOREIGN KEY (author_id) REFERENCES auth.users(id) ON DELETE RESTRICT;
alter table public.chantier_risks add constraint chantier_risks_chantier_id_fkey FOREIGN KEY (chantier_id) REFERENCES chantiers(id) ON DELETE CASCADE;
alter table public.chantier_risks add constraint chantier_risks_message_id_fkey FOREIGN KEY (message_id) REFERENCES chantier_messages(id) ON DELETE SET NULL;
alter table public.chantier_risks add constraint chantier_risks_severity_check CHECK (severity = ANY (ARRAY['faible'::text, 'moderee'::text, 'elevee'::text, 'critique'::text]));
alter table public.chantier_risks add constraint chantier_risks_status_check CHECK (status = ANY (ARRAY['ouvert'::text, 'en_suivi'::text, 'traite'::text]));
alter table public.chantiers add constraint chantiers_cover_storage_path_check CHECK (cover_storage_path IS NULL OR cover_storage_path ~ (('^covers/'::text || id::text) || '/[0-9a-fA-F-]{36}[.](jpg|jpeg|png|webp)$'::text));
alter table public.chantiers add constraint chantiers_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE RESTRICT;
alter table public.chantiers add constraint chantiers_planned_dates_check CHECK (planned_end IS NULL OR planned_start IS NULL OR planned_end >= planned_start);
alter table public.journal_access_requests add constraint journal_access_requests_granted_chantier_id_fkey FOREIGN KEY (granted_chantier_id) REFERENCES chantiers(id) ON DELETE SET NULL;
alter table public.journal_access_requests add constraint journal_access_requests_granted_role_check CHECK (granted_role = ANY (ARRAY['administrateur_general'::text, 'administrateur'::text, 'membre'::text, 'lecture'::text]));
alter table public.journal_access_requests add constraint journal_access_requests_requester_id_fkey FOREIGN KEY (requester_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.journal_access_requests add constraint journal_access_requests_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.journal_access_requests add constraint journal_access_requests_status_check CHECK (status = ANY (ARRAY['en_attente'::text, 'acceptee'::text, 'refusee'::text]));
alter table public.journal_administrators add constraint journal_administrators_role_check CHECK (role = ANY (ARRAY['proprietaire'::text, 'administrateur_general'::text]));
alter table public.journal_administrators add constraint journal_administrators_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.journal_portal_apps add constraint journal_portal_apps_icon_key_check CHECK (icon_key = ANY (ARRAY['app'::text, 'briefing'::text, 'report'::text, 'tool'::text, 'folder'::text, 'safety'::text]));
alter table public.journal_portal_apps add constraint journal_portal_apps_name_check CHECK (char_length(btrim(name)) >= 1 AND char_length(btrim(name)) <= 100);
alter table public.journal_portal_apps add constraint journal_portal_apps_url_check CHECK (url ~* '^https://'::text);
alter table public.profiles add constraint profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- Non-primary unique indexes match the diagnostic, including expression/partial indexes.
CREATE UNIQUE INDEX chantier_attachments_storage_path_key ON chantier_attachments USING btree (storage_path);
CREATE UNIQUE INDEX chantier_document_folders_standard_root_unique ON chantier_document_folders USING btree (chantier_id, (
CASE
    WHEN root_code = ANY (ARRAY['securite'::text, 'plans'::text, 'qualite'::text]) THEN root_code
    ELSE NULL::text
END)) WHERE is_root;
CREATE UNIQUE INDEX chantier_documents_storage_path_key ON chantier_documents USING btree (storage_path);
CREATE UNIQUE INDEX chantier_invitations_chantier_id_email_key ON chantier_invitations USING btree (chantier_id, email);
CREATE UNIQUE INDEX chantier_message_reactions_message_id_user_id_emoji_key ON chantier_message_reactions USING btree (message_id, user_id, emoji);
CREATE UNIQUE INDEX journal_access_requests_requester_id_key ON journal_access_requests USING btree (requester_id);

-- Test-only snapshots persist across the separate psql -f CI sessions. They are
-- dropped by backend-production-assertions.sql and contain no production rows.
create table public.test_production_check_snapshot as
select c.oid,c.conrelid,c.conname,pg_get_constraintdef(c.oid) as definition,
       c.convalidated,c.condeferrable,c.condeferred
from pg_constraint c join pg_namespace n on n.oid=c.connamespace
where n.nspname='public' and c.contype='c';
create table public.test_production_unique_snapshot as
select c.oid,c.relname,pg_get_indexdef(c.oid) as definition,i.indisvalid,i.indisready
from pg_class c join pg_namespace n on n.oid=c.relnamespace
join pg_index i on i.indexrelid=c.oid
where n.nspname='public' and i.indisunique;

-- Existing attribution and dependent rows for the user 3 deleted by the generic suite.
insert into public.chantier_invitations(id,chantier_id,email,role,invited_by)
values('44444444-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000001',
       'invitation-test@test.invalid','membre','00000000-0000-4000-8000-000000000003');
insert into public.chantier_attachments(id,chantier_id,message_id,storage_path,file_name,mime_type,bytes)
values('66666666-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000001',
       '22222222-0000-4000-8000-000000000001','photo.jpg','Photo historique.jpg','image/jpeg',1200);
insert into public.chantier_daily_logs(id,chantier_id,author_id,author_name,work_summary,message_id)
values('77777777-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000001',
       '00000000-0000-4000-8000-000000000003','Personne 3','Travaux conservés',
       '22222222-0000-4000-8000-000000000001');
insert into public.chantier_risks(id,chantier_id,author_id,author_name,description,message_id)
values('88888888-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000001',
       '00000000-0000-4000-8000-000000000003','Personne 3','Risque conservé',
       '22222222-0000-4000-8000-000000000001');
insert into public.journal_portal_apps(id,name,url,created_by)
values('99999999-0000-4000-8000-000000000001','Application de test',
       'https://example.invalid/test','00000000-0000-4000-8000-000000000003');
insert into public.chantier_read_states(chantier_id,user_id)
values('aaaaaaaa-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000003');
insert into public.chantier_message_reactions(chantier_id,message_id,user_id,emoji)
values('aaaaaaaa-0000-4000-8000-000000000001','22222222-0000-4000-8000-000000000001',
       '00000000-0000-4000-8000-000000000003','👍');
update public.journal_access_requests set reviewed_by='00000000-0000-4000-8000-000000000003'
where requester_id='00000000-0000-4000-8000-000000000004';

-- Same deliberately permissive old policy as backend-fixture.sql: restrictive
-- guards introduced by V14.2 must still deny a revoked JWT on every added table.
do $$ declare r text; begin
  foreach r in array array['chantier_invitations','chantier_attachments',
    'chantier_daily_logs','chantier_risks','chantier_document_folders','journal_portal_apps'] loop
    execute format('alter table public.%I enable row level security',r);
    execute format('create policy old_permissive on public.%I for all to authenticated using(true) with check(true)',r);
    execute format('grant all on public.%I to authenticated',r);
  end loop;
end $$;
