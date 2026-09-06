-- Execute AFTER fixture + migration, only in the disposable database.
\set ON_ERROR_STOP on
create function public.test_require(ok boolean,label text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'FAIL: %',label;end if;raise notice 'PASS: %',label;end$$;
create function public.test_denied(statement text,label text) returns void language plpgsql as $$
begin
 begin execute statement;
 exception when insufficient_privilege or raise_exception then raise notice 'PASS: %',label;return;
 end;
 raise exception 'FAIL: expected denial: %',label;
end$$;
grant execute on function public.test_require(boolean,text),public.test_denied(text,text) to authenticated,service_role;
select public.test_require((select count(*)=0 from storage.buckets where public),'journal buckets private');
select public.test_require((select count(*)=2 from action_items),'migration preserves historical actions');
select public.test_require((select count(*)=2 from action_items where assignee_user_id is null),'legacy text does not grant identity permissions');
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',false);
select public.test_require((select count(*)=9 from public.list_journal_user_directory()),'approved member reads all registered names including Auth-only registration');
select public.test_require((select full_name='Jean Essai' and not can_assign from public.list_journal_user_directory('aaaaaaaa-0000-4000-8000-000000000001') where id='00000000-0000-4000-8000-000000000009'),'Auth-only name is visible without email or assignment rights');
select public.test_require(not public.journal_v142_can_write('bbbbbbbb-0000-4000-8000-000000000001'),'member cannot write another site');
select public.test_denied($q$insert into journal_administrators(user_id,role) values('00000000-0000-4000-8000-000000000002','proprietaire')$q$,'direct platform role escalation denied');
select public.test_denied($q$update chantier_members set role='administrateur' where user_id='00000000-0000-4000-8000-000000000002'$q$,'direct site role escalation denied');
select public.test_require((select count(*)=1 from profiles),'direct profile read reveals own identity only');

update public.action_items set assignee_user_id='00000000-0000-4000-8000-000000000003' where id='11111111-0000-4000-8000-000000000001';
select public.test_require((select assignee_user_id is not null from action_items where id='11111111-0000-4000-8000-000000000001'),'creator assigns a registered pilot');
update public.action_items set due_mode='date',due_date=current_date where id='11111111-0000-4000-8000-000000000001';
select public.test_require((select due_date=current_date from action_items where id='11111111-0000-4000-8000-000000000001'),'today deadline accepted');
update public.action_items set due_mode='immediate',due_date=null where id='11111111-0000-4000-8000-000000000001';
select public.test_require((select due_mode='immediate' and due_date is null from action_items where id='11111111-0000-4000-8000-000000000001'),'immediate deadline accepted');
select public.test_denied($q$update action_items set assignee_user_id='00000000-0000-4000-8000-000000000007' where id='11111111-0000-4000-8000-000000000001'$q$,'unapproved pilot denied');
select public.test_denied($q$update action_items set created_by='00000000-0000-4000-8000-000000000004' where id='11111111-0000-4000-8000-000000000001'$q$,'creator identity immutable');
insert into chantier_messages(chantier_id,body,author_id,author_name,action_id) values('aaaaaaaa-0000-4000-8000-000000000001','','00000000-0000-4000-8000-000000000002','Personne 2','11111111-0000-4000-8000-000000000001');
select public.test_require((select count(*)=1 from chantier_messages where body=''),'photo-only empty body accepted');
select public.test_denied($q$insert into chantier_messages(chantier_id,body,author_id) values('bbbbbbbb-0000-4000-8000-000000000001','Message interdit','00000000-0000-4000-8000-000000000002')$q$,'cross-site message insert denied without action link');
select public.test_denied($q$insert into chantier_messages(chantier_id,body,author_id,action_id) values('bbbbbbbb-0000-4000-8000-000000000001','Lien interdit','00000000-0000-4000-8000-000000000002','11111111-0000-4000-8000-000000000001')$q$,'cross-site action link denied');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',false);
with changed as(update action_items set title='Pilote modifie' where id='11111111-0000-4000-8000-000000000001' returning id) select public.test_require(count(*)=1,'assigned pilot edits') from changed;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000004',false);
with changed as(update action_items set title='Interdit' where id='11111111-0000-4000-8000-000000000001' returning id) select public.test_require(count(*)=0,'unrelated contributor cannot edit') from changed;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000005',false);
with changed as(update action_items set title='Interdit' where id='11111111-0000-4000-8000-000000000002' returning id) select public.test_require(count(*)=0,'reader cannot edit own historical action') from changed;
select public.test_denied($q$insert into action_items(chantier_id,title,created_by) values('aaaaaaaa-0000-4000-8000-000000000001','Interdit','00000000-0000-4000-8000-000000000005')$q$,'reader cannot create action');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000006',false);
with changed as(update action_items set title='Admin modifie' where id='11111111-0000-4000-8000-000000000001' returning id) select public.test_require(count(*)=1,'site administrator edits') from changed;
select public.test_denied($q$select journal_v142_revoke_user_access('00000000-0000-4000-8000-000000000004')$q$,'site administrator cannot globally revoke');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000007',false);
select public.test_denied('select * from list_journal_user_directory()','pending user cannot read directory');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',false);
select public.test_require((select value->>'full_name'='Jean Essai' from jsonb_array_elements(journal_v142_administration_dashboard()) where value->>'id'='00000000-0000-4000-8000-000000000009'),'dashboard does not mislabel an Auth-only registration as deleting');
select public.test_require((select value->>'request_status'='en_attente' from jsonb_array_elements(journal_v142_administration_dashboard()) where value->>'id'='00000000-0000-4000-8000-000000000007'),'dashboard reads pending status through requester_id');
select journal_v142_set_user_access('00000000-0000-4000-8000-000000000006','','[{"chantier_id":"aaaaaaaa-0000-4000-8000-000000000001","role":"administrateur"},{"chantier_id":"bbbbbbbb-0000-4000-8000-000000000001","role":"administrateur"}]');
select public.test_require((select count(*)=2 from chantier_members where user_id='00000000-0000-4000-8000-000000000006'),'administrator on two sites');
select public.test_require((select status='acceptee' from journal_access_requests where requester_id='00000000-0000-4000-8000-000000000006'),'grant updates request status through requester_id');
select public.test_denied($q$select journal_v142_revoke_user_access('00000000-0000-4000-8000-000000000001')$q$,'owner protected from revocation');
select journal_v142_revoke_user_access('00000000-0000-4000-8000-000000000008');
select public.test_require((select status='refusee' from journal_access_requests where requester_id='00000000-0000-4000-8000-000000000008'),'revocation updates request status through requester_id');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000008',false);
select public.test_require(not journal_v142_is_active(),'revoked old JWT inactive');
select public.test_require((select count(*)=0 from chantiers),'revoked JWT reads no sites despite old permissive policy');
select public.test_require((select count(*)=0 from chantier_messages),'revoked JWT reads no messages');
select public.test_require((select count(*)=0 from storage.objects),'revoked JWT cannot sign new storage URLs');
select public.test_denied($q$insert into profiles(id,full_name) values('00000000-0000-4000-8000-000000000008','Recréé') on conflict(id) do update set full_name=excluded.full_name$q$,'revoked account cannot revive itself');
reset role;
select set_config('request.jwt.claim.sub','',false);

-- A historical SECURITY DEFINER RPC bypasses RLS. The action trigger must still
-- deny an unrelated writer after the creator's deleted identity became NULL.
insert into action_items(id,chantier_id,title,created_by)
values('11111111-0000-4000-8000-000000000003','aaaaaaaa-0000-4000-8000-000000000001','Contribution orpheline conservée',null);
create function public.test_legacy_update_orphan_action() returns void
language sql security definer set search_path='' as $$
  update public.action_items set title='Modification interdite'
  where id='11111111-0000-4000-8000-000000000003';
$$;
grant execute on function public.test_legacy_update_orphan_action() to authenticated;
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000004',false);
select public.test_denied('select public.test_legacy_update_orphan_action()','NULL creator and pilot cannot bypass action trigger via a legacy RPC');
reset role;
select set_config('request.jwt.claim.sub','',false);
drop function public.test_legacy_update_orphan_action();

-- A dangerous dependency added AFTER deployment must stop both revocation and
-- deletion before any existing account, right or business contribution changes.
create table public.test_business_history(
  chantier_id uuid,user_id uuid,body text,
  foreign key(chantier_id,user_id) references chantier_members(chantier_id,user_id) on delete cascade);
insert into public.test_business_history values('aaaaaaaa-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000004','Contribution à préserver');
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',false);
select public.test_denied($q$select journal_v142_revoke_user_access('00000000-0000-4000-8000-000000000004')$q$,'revocation refuses a new indirect destructive cascade');
reset role;
select set_config('request.jwt.claim.sub','',false);
set role service_role;
select public.test_denied($q$select journal_v142_prepare_user_deletion('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000004')$q$,'deletion refuses a new indirect destructive cascade');
reset role;
select public.test_require(
  exists(select 1 from public.test_business_history where body='Contribution à préserver')
  and exists(select 1 from public.chantier_members where user_id='00000000-0000-4000-8000-000000000004')
  and exists(select 1 from public.profiles where id='00000000-0000-4000-8000-000000000004')
  and not exists(select 1 from public.journal_user_access_blocks where user_id='00000000-0000-4000-8000-000000000004'),
  'refused cleanup preserves history, account, memberships and original access state');
drop table public.test_business_history;
set role service_role;
select public.test_denied($q$select journal_v142_prepare_user_deletion('00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000003')$q$,'server refuses non-owner deletion actor');
select journal_v142_prepare_user_deletion('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000003');
reset role;
select public.test_require(not exists(select 1 from journal_access_requests where requester_id='00000000-0000-4000-8000-000000000003'),'deletion removes requests through requester_id');
-- Simulates Auth hard-delete database side only; Edge Auth integration separately tested.
delete from auth.users where id='00000000-0000-4000-8000-000000000003';
select public.test_require((select count(*)=2 from chantiers),'deletion preserves all sites');
select public.test_require((select created_by is null from chantiers where id='aaaaaaaa-0000-4000-8000-000000000001'),'site creator FK detached');
select public.test_require((select assignee_user_id is null and assignee='Personne 3' from action_items where id='11111111-0000-4000-8000-000000000001'),'pilot account removed with historical label retained');
select public.test_require((select count(*)=1 from chantier_messages where body='Historique conservé' and author_id is null and author_name='Personne 3'),'message and attribution preserved');
-- Some historical installations have no author FK on documents: retaining the
-- original author UUID is valid there. The record and recorded name must survive.
select public.test_require((select count(*)=1 from chantier_documents where created_by_name='Personne 3'),'documents retained');
select public.test_require((select count(*)=1 from storage.objects where owner_id='00000000-0000-4000-8000-000000000001'),'stored photo retained and reassigned');
set role service_role;
select journal_v142_finish_user_deletion('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000003');
reset role;
select public.test_require(not exists(select 1 from profiles where id='00000000-0000-4000-8000-000000000003'),'profile fully removed');
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',false);
select public.test_require(not journal_v142_is_active(),'deleted user old JWT remains denied');
select public.test_denied($q$select journal_v142_prepare_user_deletion('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000004')$q$,'authenticated cannot invoke internal deletion RPC');
reset role;
select set_config('request.jwt.claim.sub','',false);
