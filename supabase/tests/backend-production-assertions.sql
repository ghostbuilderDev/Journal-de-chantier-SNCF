-- Run AFTER backend-assertions.sql in the disposable production-shape fixture.
-- The generic suite has prepared/hard-deleted Auth user 3 and revoked user 8.
-- This validates observed metadata contracts, not unexported historical triggers.
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claim.sub','',false);

select public.test_require(
  (select count(*) >= 20 from public.test_production_check_snapshot)
  and not exists (
    select 1 from public.test_production_check_snapshot s
    left join pg_constraint c on c.oid=s.oid
    where c.oid is null or c.conrelid<>s.conrelid or c.conname<>s.conname
      or pg_get_constraintdef(c.oid)<>s.definition
      or c.convalidated<>s.convalidated or c.condeferrable<>s.condeferrable
      or c.condeferred<>s.condeferred),
  'all observed CHECK constraints retain OID, exact definition and validation metadata');
select public.test_require(
  exists(select 1 from public.test_production_check_snapshot s
    join pg_constraint c on c.oid=s.oid
    where c.conrelid='public.chantier_messages'::regclass
      and c.conname='chantier_message_content'
      and pg_get_constraintdef(c.oid,true)='CHECK (body IS NOT NULL OR deleted_at IS NOT NULL)'),
  'historical body-or-soft-delete CHECK remains in place');
select public.test_require(
  not exists(select 1 from public.test_production_unique_snapshot s
    left join pg_index i on i.indexrelid=s.oid
    left join pg_class c on c.oid=s.oid
    where i.indexrelid is null or c.relname<>s.relname
      or pg_get_indexdef(s.oid)<>s.definition
      or i.indisvalid<>s.indisvalid or i.indisready<>s.indisready),
  'all observed unique indexes retain OID, definition and validity');
select public.test_require(
  exists(select 1 from pg_constraint c where c.conrelid='public.chantier_invitations'::regclass
    and c.conname='chantier_invitations_invited_by_fkey'
    and c.confrelid='auth.users'::regclass and c.confdeltype='n'
    and cardinality(c.conkey)=1 and cardinality(c.confkey)=1
    and not c.condeferrable and not c.condeferred and c.convalidated)
  and not(select attnotnull from pg_attribute
    where attrelid='public.chantier_invitations'::regclass and attname='invited_by'),
  'observed NOT NULL/RESTRICT invitation attribution becomes nullable SET NULL');
select public.test_require(
  exists(select 1 from public.chantier_invitations
    where id='44444444-0000-4000-8000-000000000001' and invited_by is null
      and email='invitation-test@test.invalid' and role='membre'
      and chantier_id='aaaaaaaa-0000-4000-8000-000000000001'),
  'account deletion preserves invitation and detaches only its inviter');
select public.test_require(
  exists(select 1 from public.chantier_daily_logs
    where id='77777777-0000-4000-8000-000000000001' and author_id is null
      and author_name='Personne 3' and work_summary='Travaux conservés')
  and exists(select 1 from public.chantier_risks
    where id='88888888-0000-4000-8000-000000000001' and author_id is null
      and author_name='Personne 3' and description='Risque conservé'),
  'historical RESTRICT daily-log and risk foreign keys preserve labelled contributions');
select public.test_require(
  exists(select 1 from public.chantier_attachments
    where id='66666666-0000-4000-8000-000000000001' and storage_path='photo.jpg'
      and message_id='22222222-0000-4000-8000-000000000001'),
  'deleting a message author preserves its attachment record');
select public.test_require(
  exists(select 1 from public.chantier_documents
    where created_by='00000000-0000-4000-8000-000000000003'
      and created_by_name='Personne 3' and file_name='Historique.pdf')
  and exists(select 1 from public.chantier_document_folders
    where id='55555555-0000-4000-8000-000000000001'
      and created_by='00000000-0000-4000-8000-000000000003' and name='Plans conservés')
  and exists(select 1 from public.journal_portal_apps
    where id='99999999-0000-4000-8000-000000000001'
      and created_by='00000000-0000-4000-8000-000000000003' and name='Application de test'),
  'contributions with no observed identity FK preserve historical UUIDs and labels');
select public.test_require(
  not exists(select 1 from public.chantier_read_states where user_id='00000000-0000-4000-8000-000000000003')
  and not exists(select 1 from public.chantier_message_reactions where user_id='00000000-0000-4000-8000-000000000003')
  and exists(select 1 from public.journal_access_requests
    where requester_id='00000000-0000-4000-8000-000000000004' and reviewed_by is null),
  'observed account receipts cascade and access-request reviewer detaches');

set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000008',false);
select public.test_require((select count(*)=0 from public.chantier_invitations),
  'revoked JWT cannot read invitations despite the old permissive policy');
select public.test_denied($q$insert into public.chantier_invitations(chantier_id,email,invited_by)
  values('aaaaaaaa-0000-4000-8000-000000000001','revoked@test.invalid',
  '00000000-0000-4000-8000-000000000008')$q$,
  'revoked JWT cannot create invitations despite the old permissive policy');

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',false);
insert into public.chantier_messages(id,chantier_id,body,author_id,author_name)
values('eeeeeeee-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000001','',
       '00000000-0000-4000-8000-000000000002','Personne 2');
insert into public.chantier_attachments(id,chantier_id,message_id,storage_path,file_name,mime_type,bytes)
values('eeeeeeee-0000-4000-8000-000000000002','aaaaaaaa-0000-4000-8000-000000000001',
       'eeeeeeee-0000-4000-8000-000000000001','test-production-shape/photo-only.jpg',
       'Photo seule.jpg','image/jpeg',500);
select public.test_require(
  exists(select 1 from public.chantier_messages m join public.chantier_attachments a on a.message_id=m.id
    where m.id='eeeeeeee-0000-4000-8000-000000000001' and m.body='' and m.deleted_at is null
      and a.file_name='Photo seule.jpg'),
  'photo-only message and attachment accepted by the exact historical CHECK');
do $$ declare v_constraint text; v_denied boolean:=false; begin
  begin
    insert into public.chantier_messages(id,chantier_id,body,author_id,author_name)
    values('eeeeeeee-0000-4000-8000-000000000003','aaaaaaaa-0000-4000-8000-000000000001',null,
           '00000000-0000-4000-8000-000000000002','Personne 2');
  exception when check_violation then
    get stacked diagnostics v_constraint=constraint_name;
    v_denied:=(v_constraint='chantier_message_content');
  end;
  perform public.test_require(v_denied,
    'NULL body without soft deletion is still rejected by chantier_message_content');
end $$;
insert into public.chantier_messages(id,chantier_id,body,author_id,author_name,deleted_at)
values('eeeeeeee-0000-4000-8000-000000000004','aaaaaaaa-0000-4000-8000-000000000001',null,
       '00000000-0000-4000-8000-000000000002','Personne 2',now());
select public.test_require(
  exists(select 1 from public.chantier_messages
    where id='eeeeeeee-0000-4000-8000-000000000004' and body is null and deleted_at is not null),
  'historical soft-delete row with NULL body remains valid');
reset role;
select set_config('request.jwt.claim.sub','',false);
drop table public.test_production_check_snapshot,public.test_production_unique_snapshot;
