-- Test-only extension of the disposable Storage fixture to the standard Supabase shape.
-- NEVER run in production. No sample production data or credentials.
-- These three columns/types are confirmed by Diagnostic-Supabase-34056471078.json.
alter table storage.buckets add column file_size_limit bigint;
alter table storage.buckets add column allowed_mime_types text[];
alter table storage.objects add column metadata jsonb;
