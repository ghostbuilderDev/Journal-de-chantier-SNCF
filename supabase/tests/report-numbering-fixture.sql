-- Disposable test database only: legacy PDF archive shape before the hotfix.
alter table public.chantier_documents add column if not exists file_name text;
alter table public.chantier_documents add column if not exists folder_id uuid;
alter table public.chantier_documents add column if not exists storage_path text;
alter table public.chantier_documents add column if not exists mime_type text;
alter table public.chantier_documents add column if not exists bytes bigint;
alter table public.chantier_documents add column if not exists description text;
alter table storage.objects add column if not exists metadata jsonb;
