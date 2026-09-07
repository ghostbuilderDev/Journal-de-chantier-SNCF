begin;
-- Additif : aucune modification du fil ni des droits documentaires généraux.
create table if not exists public.journal_report_uploads (
  id uuid primary key default gen_random_uuid(),
  chantier_id uuid not null references public.chantiers(id) on delete cascade,
  user_id uuid not null,
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  file_name text not null,
  bytes bigint not null check (bytes between 5 and 52428800),
  storage_path text not null unique,
  created_at timestamptz not null default now(),
  unique (chantier_id, user_id, sha256)
);
alter table public.journal_report_uploads enable row level security;
revoke all on public.journal_report_uploads from anon, authenticated;
grant select on public.journal_report_uploads to authenticated;
drop policy if exists journal_report_uploads_read on public.journal_report_uploads;
create policy journal_report_uploads_read on public.journal_report_uploads
for select to authenticated using (user_id = auth.uid() and public.journal_can_access_chantier(chantier_id));

create or replace function public.journal_can_archive_report(p_chantier_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.journal_v142_can_write(p_chantier_id);
$$;

create or replace function public.reserve_journal_report(p_chantier_id uuid, p_sha256 text, p_file_name text, p_bytes bigint)
returns public.journal_report_uploads language plpgsql security definer set search_path = public, pg_temp as $$
declare v public.journal_report_uploads; v_id uuid := gen_random_uuid();
begin
  if not public.journal_can_archive_report(p_chantier_id) then raise exception 'Accès contributeur au chantier requis.'; end if;
  if p_sha256 is null or p_sha256 !~ '^[a-f0-9]{64}$' or p_bytes is null or p_bytes not between 5 and 52428800
    or p_file_name is null or length(p_file_name) not between 5 and 180 or lower(right(p_file_name,4)) <> '.pdf'
    then raise exception 'PDF invalide (maximum 50 Mo).'; end if;
  insert into public.journal_report_uploads(id, chantier_id, user_id, sha256, file_name, bytes, storage_path)
  values(v_id,p_chantier_id,auth.uid(),p_sha256,p_file_name,p_bytes,'documents/'||p_chantier_id||'/'||v_id||'/rapport.pdf')
  on conflict (chantier_id,user_id,sha256) do nothing;
  select * into v from public.journal_report_uploads
    where chantier_id=p_chantier_id and user_id=auth.uid() and sha256=p_sha256;
  return v;
end;
$$;

drop policy if exists journal_report_storage_insert on storage.objects;
create policy journal_report_storage_insert on storage.objects for insert to authenticated
with check (bucket_id='chantier-documents' and exists (
  select 1 from public.journal_report_uploads r where r.storage_path=name and r.user_id=auth.uid()
  and public.journal_can_archive_report(r.chantier_id)
));

create or replace function public.finalize_journal_report(p_upload_id uuid)
returns public.chantier_documents language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.journal_report_uploads; f uuid; d public.chantier_documents; author_name text;
begin
  select * into r from public.journal_report_uploads where id=p_upload_id for update;
  if not found then raise exception 'Transmission introuvable.'; end if;
  if r.user_id <> auth.uid() or auth.uid() is null or not public.journal_can_archive_report(r.chantier_id)
    then raise exception 'Transmission non autorisée.'; end if;
  select * into d from public.chantier_documents where id=r.id;
  if found then return d; end if;
  if not exists(select 1 from storage.objects where bucket_id='chantier-documents' and name=r.storage_path
    and (metadata->>'size')::bigint=r.bytes and metadata->>'mimetype'='application/pdf')
    then raise exception 'PDF absent ou incomplet dans le stockage.'; end if;
  -- Sérialise la création du dossier, même pour des utilisateurs différents.
  perform 1 from public.chantiers where id=r.chantier_id for update;
  select id into f from public.chantier_document_folders where chantier_id=r.chantier_id
    and is_root and name='Rapports journaliers' order by created_at limit 1;
  select coalesce(nullif(btrim(full_name),''),email,'Contributeur') into author_name from public.profiles where id=auth.uid();
  if f is null then
    insert into public.chantier_document_folders(chantier_id,root_code,name,is_root,created_by,created_by_name)
    values(r.chantier_id,'personnalise','Rapports journaliers',true,auth.uid(),author_name) returning id into f;
  end if;
  insert into public.chantier_documents(id,chantier_id,folder_id,storage_path,file_name,mime_type,bytes,description,created_by,created_by_name)
  values(r.id,r.chantier_id,f,r.storage_path,r.file_name,'application/pdf',r.bytes,'Rapport journalier AINM',auth.uid(),coalesce(author_name,'Contributeur'))
  returning * into d;
  return d;
end;
$$;
revoke all on function public.journal_can_archive_report(uuid) from public;
revoke all on function public.reserve_journal_report(uuid,text,text,bigint) from public;
revoke all on function public.finalize_journal_report(uuid) from public;
grant execute on function public.journal_can_archive_report(uuid) to authenticated;
grant execute on function public.reserve_journal_report(uuid,text,text,bigint) to authenticated;
grant execute on function public.finalize_journal_report(uuid) to authenticated;
commit;
