BEGIN;
-- One durable sequence for all Journal daily reports, on every device.
-- No historical document or PDF is renumbered by this migration.
create table if not exists journal_report_private.number_counter (
 singleton boolean primary key default true check(singleton),
 next_serial bigint not null check(next_serial between 1 and 999999999999)
);
create table if not exists journal_report_private.numbers (
 report_id uuid primary key, serial bigint not null unique,
 report_uid text not null unique, report_no text not null unique,
 created_at timestamptz not null default now()
);
-- These ledgers deliberately have no cascading foreign key: deleting a site
-- or a report never releases an allocated number.
create table if not exists journal_report_private.legacy_numbers (
 report_id uuid primary key, serial bigint, report_uid text, report_no text
);
alter table journal_report_private.number_counter enable row level security;
alter table journal_report_private.numbers enable row level security;
alter table journal_report_private.legacy_numbers enable row level security;

create or replace function journal_report_private.filename_serial(v text)
returns bigint language sql immutable set search_path='' as $$
 select (regexp_match(v,'_N([0-9]{1,12})[.]pdf$','i'))[1]::bigint;
$$;
create or replace function journal_report_private.pdf_suffix(v jsonb)
returns text language sql immutable set search_path='' as $$
 select '_REF-'||left(trim(both '-' from regexp_replace(coalesce(v->>'reportUid',''), '[^a-zA-Z0-9_-]+','-','g')),51)
  ||'_N'||case when length(v->>'reportSerial')<6 then lpad(v->>'reportSerial',6,'0') else v->>'reportSerial' end||'.pdf';
$$;

-- Include the older PDF-only archive, not just collaborative reports.
insert into journal_report_private.number_counter(singleton,next_serial)
select true,greatest(1,coalesce(max(n),0)+1) from (
 select case when document->>'reportSerial' ~ '^[0-9]{1,12}$' then (document->>'reportSerial')::bigint end n from journal_report_private.reports
 union all select (regexp_match(document->'meta'->>'reportNo','^AINM-RJ-([0-9]{1,12})-'))[1]::bigint from journal_report_private.reports
 union all select journal_report_private.filename_serial(file_name) from public.journal_report_uploads
 union all select journal_report_private.filename_serial(file_name) from public.chantier_documents
) existing on conflict(singleton) do update set next_serial=greatest(journal_report_private.number_counter.next_serial,excluded.next_serial);

-- Frozen / already archived reports keep their historical references. An old
-- unpublished draft gets its definitive number on its next server save.
insert into journal_report_private.legacy_numbers(report_id,serial,report_uid,report_no)
select r.id,case when r.document->>'reportSerial' ~ '^[0-9]{1,12}$' then (r.document->>'reportSerial')::bigint end,
 r.document->>'reportUid',r.document->'meta'->>'reportNo'
from journal_report_private.reports r
where not exists(select 1 from journal_report_private.numbers n where n.report_id=r.id)
 and (r.state='validated' or exists(select 1 from public.journal_report_uploads u where u.chantier_id=r.chantier_id
  and right(u.file_name,length(journal_report_private.pdf_suffix(r.document)))=journal_report_private.pdf_suffix(r.document)))
on conflict(report_id) do nothing;

create or replace function journal_report_private.assign_number()
returns trigger language plpgsql security definer set search_path='' as $$
declare n journal_report_private.numbers; oldn journal_report_private.legacy_numbers; serial bigint; previous_no text;
begin
 select * into oldn from journal_report_private.legacy_numbers where report_id=new.id;
 if found then
  if tg_op='INSERT' then raise exception 'Identifiant de rapport déjà utilisé. Créez un nouveau rapport.';end if;
  if oldn.serial is not null then new.document=jsonb_set(new.document,'{reportSerial}',to_jsonb(oldn.serial));end if;
  if oldn.report_uid is not null then new.document=jsonb_set(new.document,'{reportUid}',to_jsonb(oldn.report_uid));end if;
  if oldn.report_no is not null then new.document=jsonb_set(new.document,'{meta,reportNo}',to_jsonb(oldn.report_no));end if;
  return new;
 end if;
 select * into n from journal_report_private.numbers where report_id=new.id;
 if found and tg_op='INSERT' then raise exception 'Identifiant de rapport déjà utilisé. Créez un nouveau rapport.';end if;
 if not found then
  -- Row locking and the unique constraint cover simultaneous users, retries,
  -- transferred reports, and later site deletion. Rollbacks consume nothing.
  update journal_report_private.number_counter set next_serial=next_serial+1 where singleton returning next_serial-1 into serial;
  if serial is null then raise exception 'Numérotation partagée indisponible';end if;
  insert into journal_report_private.numbers(report_id,serial,report_uid,report_no)
  values(new.id,serial,new.id::text,'AINM-RJ-'||case when serial<1000000 then lpad(serial::text,6,'0') else serial::text end||'-'||upper(left(new.id::text,8))) returning * into n;
 end if;
 previous_no:=new.document->'meta'->>'reportNo';
 if coalesce(previous_no,'')<>'' and previous_no<>n.report_no and new.document#>>'{meta,previousReportNo}' is null then
  new.document=jsonb_set(new.document,'{meta,previousReportNo}',to_jsonb(previous_no));
 end if;
 new.document=jsonb_set(jsonb_set(jsonb_set(new.document,'{reportSerial}',to_jsonb(n.serial)),'{reportUid}',to_jsonb(n.report_uid)),'{meta,reportNo}',to_jsonb(n.report_no));
 return new;
end;
$$;
drop trigger if exists journal_report_assign_number on journal_report_private.reports;
create trigger journal_report_assign_number before insert or update of document on journal_report_private.reports for each row execute function journal_report_private.assign_number();

do $$begin
 if to_regprocedure('journal_report_private.detail_v15103(uuid)') is null then
  alter function journal_report_private.detail(uuid) rename to detail_v15103;
 end if;
end$$;
create or replace function journal_report_private.detail(p_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select journal_report_private.detail_v15103(p_id)||jsonb_build_object('numbering',
  case when exists(select 1 from journal_report_private.numbers where report_id=p_id) then 'confirmed'
   when exists(select 1 from journal_report_private.legacy_numbers where report_id=p_id) then 'legacy'
   else 'pending' end);
$$;

-- The existing archive/storage permissions still apply. Old clients may resume
-- an already queued upload; they cannot publish a newly generated local n° 1.
do $$begin
 if to_regprocedure('journal_report_private.reserve_pdf_v15103(uuid,text,text,bigint)') is null then
  alter function public.reserve_journal_report(uuid,text,text,bigint) set schema journal_report_private;
  alter function journal_report_private.reserve_journal_report(uuid,text,text,bigint) rename to reserve_pdf_v15103;
 end if;
end$$;
create or replace function public.reserve_journal_report(p_chantier_id uuid,p_sha256 text,p_file_name text,p_bytes bigint)
returns public.journal_report_uploads language plpgsql security definer set search_path='' as $$
begin
 if not public.journal_can_archive_report(p_chantier_id) then raise exception 'Accès contributeur au chantier requis.';end if;
 if not exists(select 1 from public.journal_report_uploads where chantier_id=p_chantier_id and user_id=auth.uid() and sha256=p_sha256) then
  raise exception 'Mettez à jour le Rapport journalier et enregistrez-le sur le serveur avant de générer le PDF. Le numéro doit être attribué automatiquement.';
 end if;
 return journal_report_private.reserve_pdf_v15103(p_chantier_id,p_sha256,p_file_name,p_bytes);
end;
$$;
alter table public.journal_report_uploads add column if not exists report_id uuid;
alter table public.journal_report_uploads add column if not exists imported boolean not null default false;
create or replace function public.journal_reserve_numbered_pdf(p_chantier_id uuid,p_sha256 text,p_file_name text,p_bytes bigint,p_report_id uuid default null,p_imported boolean default false)
returns public.journal_report_uploads language plpgsql security definer set search_path='' as $$
declare d jsonb;r public.journal_report_uploads;n bigint;
begin
 if not public.journal_can_archive_report(p_chantier_id) then raise exception 'Accès contributeur au chantier requis.';end if;
 if not coalesce(p_imported,false) then
  if p_report_id is null or not journal_report_private.allowed(auth.uid(),p_report_id,false) then raise exception 'Rapport inaccessible';end if;
  d:=journal_report_private.detail(p_report_id);
  if d->>'chantier_id'<>p_chantier_id::text or d->>'numbering' not in ('confirmed','legacy') then raise exception 'Enregistrez ce rapport pour obtenir son numéro définitif';end if;
  if right(p_file_name,length(journal_report_private.pdf_suffix(d->'document'))) is distinct from journal_report_private.pdf_suffix(d->'document') then
   raise exception 'Le numéro du PDF ne correspond pas au rapport enregistré. Régénérez le PDF.';
  end if;
 end if;
 r:=journal_report_private.reserve_pdf_v15103(p_chantier_id,p_sha256,p_file_name,p_bytes);
 if r.report_id is not null and r.report_id is distinct from p_report_id then raise exception 'Ce PDF est déjà rattaché à un autre rapport';end if;
 update public.journal_report_uploads set report_id=p_report_id,imported=coalesce(p_imported,false) where id=r.id returning * into r;
 -- Importing a historical PDF preserves it and advances the watermark only.
 if p_imported then
  n:=journal_report_private.filename_serial(p_file_name);
  if n is not null then update journal_report_private.number_counter set next_serial=greatest(next_serial,n+1) where singleton;end if;
 end if;
 return r;
end;
$$;
revoke all on all tables in schema journal_report_private from public,anon,authenticated;
revoke all on all functions in schema journal_report_private from public,anon,authenticated;
revoke all on function public.reserve_journal_report(uuid,text,text,bigint) from public,anon;
revoke all on function public.journal_reserve_numbered_pdf(uuid,text,text,bigint,uuid,boolean) from public,anon;
grant execute on function public.reserve_journal_report(uuid,text,text,bigint) to authenticated;
grant execute on function public.journal_reserve_numbered_pdf(uuid,text,text,bigint,uuid,boolean) to authenticated;
COMMIT;
