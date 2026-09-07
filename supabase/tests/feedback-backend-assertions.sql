-- EMPTY disposable fixture only. No external network or production mutation.
\set ON_ERROR_STOP on
create function public.feedback_test_require(p_ok boolean,p_name text) returns text language plpgsql as $$
begin if p_ok is distinct from true then raise exception 'FEEDBACK TEST FAILED: %',p_name; end if;return p_name;end $$;
create function public.feedback_test_denied(p_sql text,p_name text) returns text language plpgsql as $$
begin
  begin execute p_sql; exception when others then return p_name;end;
  raise exception 'FEEDBACK TEST SHOULD DENY: %',p_name;
end $$;
select public.feedback_test_require(not has_schema_privilege('authenticated','journal_feedback_private','USAGE'),'private schema hidden');
select public.feedback_test_require(not has_schema_privilege('anon','journal_feedback_private','USAGE'),'anonymous private schema hidden');
select public.feedback_test_require(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='journal_feedback_private' and has_function_privilege('authenticated',p.oid,'EXECUTE')),'private helper execution revoked');
select public.feedback_test_require(not exists(select 1 from pg_constraint where conrelid in ('journal_feedback_private.threads'::regclass,'journal_feedback_private.replies'::regclass) and confrelid in ('auth.users'::regclass,'public.profiles'::regclass)),'no identity foreign keys');
select public.feedback_test_require(not exists(select 1 from pg_trigger where tgrelid in ('journal_feedback_private.threads'::regclass,'journal_feedback_private.replies'::regclass) and not tgisinternal),'feedback has no chantier event triggers');
select public.feedback_test_require((select not public and file_size_limit=5242880 and allowed_mime_types=array['image/jpeg','image/png','image/webp'] from storage.buckets where id='journal-feedback-images'),'private bucket and enforced upload limits');
select public.journal_v142_assert_account_cleanup_safe();

set role anon;
select set_config('request.jwt.claim.sub','',false);
select public.feedback_test_denied('select public.journal_feedback_context()','anonymous context denied');
select public.feedback_test_denied('select public.journal_feedback_list()','anonymous feed denied');
select public.feedback_test_require(not public.journal_feedback_image_access('any','read'),'anonymous image check denied');
reset role;
set role authenticated;
select public.feedback_test_denied('select public.journal_feedback_context()','authenticated role without identity denied');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000099',false);
select public.feedback_test_denied('select public.journal_feedback_context()','nonexistent account denied');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000007',false);
select public.feedback_test_require((public.journal_feedback_context()->>'user_id')='00000000-0000-4000-8000-000000000007','pending account without chantier can access global feedback');
select public.feedback_test_require((public.journal_feedback_context()->>'can_manage')::boolean=false,'pending account has no moderation rights');
select public.feedback_test_denied('select * from journal_feedback_private.threads','direct feedback tables hidden');
select public.feedback_test_denied('select journal_feedback_private.can_manage()','direct internal helper denied');
select public.feedback_test_denied($q$select public.journal_feedback_create_thread('10000000-0000-4000-8000-000000000001','','Description','bug')$q$,'empty title denied');
select public.feedback_test_denied($q$select public.journal_feedback_create_thread('10000000-0000-4000-8000-000000000001','Titre','  ','bug')$q$,'empty description denied');
select public.feedback_test_denied($q$select public.journal_feedback_create_thread('10000000-0000-4000-8000-000000000001',repeat('x',101),'Description','bug')$q$,'long title denied');
select public.feedback_test_denied($q$select public.journal_feedback_create_thread('10000000-0000-4000-8000-000000000001','Titre',repeat('x',4001),'bug')$q$,'long body denied');
select public.feedback_test_denied($q$select public.journal_feedback_create_thread('10000000-0000-4000-8000-000000000001','Titre','Description','invalid')$q$,'unknown category denied');
select public.feedback_test_denied($q$select public.journal_feedback_list(null,null,'all')$q$,'unknown status filter denied');
select public.feedback_test_denied($q$select public.journal_feedback_list(null,null,null,'all')$q$,'unknown category filter denied');
select public.feedback_test_denied($q$select public.journal_feedback_list(now(),null)$q$,'partial cursor denied');
select public.feedback_test_require(public.journal_feedback_list()->'items'='[]'::jsonb,'initial empty list');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000009',false);
select public.feedback_test_require(public.journal_feedback_context()->>'user_id'='00000000-0000-4000-8000-000000000009','new account without profile may access feedback');
select public.feedback_test_require(public.journal_feedback_create_thread('13000000-0000-4000-8000-000000000009','Inscription','Retour nouveau compte','improvement')->>'author_name'='Jean Essai','name derived from Auth metadata before profile exists');
select public.journal_feedback_delete_thread('13000000-0000-4000-8000-000000000009',(public.journal_feedback_get('13000000-0000-4000-8000-000000000009')->>'updated_at')::timestamptz);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000007',false);

select public.feedback_test_require(public.journal_feedback_create_thread('10000000-0000-4000-8000-000000000001',' Premier retour ',' Description utile ','bug')->>'author_name'='Personne 7','server-derived name on create');
select public.feedback_test_require(public.journal_feedback_get('10000000-0000-4000-8000-000000000001')->>'title'='Premier retour','trimmed title saved');
select public.feedback_test_require(public.journal_feedback_get('10000000-0000-4000-8000-000000000001')->>'status'='new','initial status controlled by server');
select public.feedback_test_require((public.journal_feedback_get('10000000-0000-4000-8000-000000000001')->>'can_edit')::boolean,'author can edit');
select set_config('test.feedback.timestamp',public.journal_feedback_get('10000000-0000-4000-8000-000000000001')->>'updated_at',false);
select public.feedback_test_require(public.journal_feedback_create_thread('10000000-0000-4000-8000-000000000001','Premier retour','Description utile','bug')->>'id'='10000000-0000-4000-8000-000000000001','strict identical thread retry succeeds');
select public.feedback_test_require(jsonb_array_length(public.journal_feedback_list()->'items')=1,'retry did not duplicate thread');
select public.feedback_test_denied($q$select public.journal_feedback_create_thread('10000000-0000-4000-8000-000000000001','Autre titre','Description utile','bug')$q$,'UUID reuse with changed content denied');
select public.feedback_test_denied($q$select public.journal_feedback_set_status('10000000-0000-4000-8000-000000000001','done',current_setting('test.feedback.timestamp')::timestamptz)$q$,'author cannot self-set status');
select public.feedback_test_require(public.journal_feedback_update_thread('10000000-0000-4000-8000-000000000001','Premier retour corrigé','Description utile','improvement',current_setting('test.feedback.timestamp')::timestamptz)->>'title'='Premier retour corrigé','author may edit own feedback');
select public.feedback_test_denied($q$select public.journal_feedback_update_thread('10000000-0000-4000-8000-000000000001','Version ancienne','Description utile','bug',current_setting('test.feedback.timestamp')::timestamptz)$q$,'stale thread edit denied');
select public.feedback_test_denied($q$select public.journal_feedback_delete_thread('10000000-0000-4000-8000-000000000001',current_setting('test.feedback.timestamp')::timestamptz)$q$,'stale delete denied');
select public.feedback_test_require(public.journal_feedback_get('10000000-0000-4000-8000-000000000001')->>'title'='Premier retour corrigé','stale edit preserved current data');
select public.feedback_test_denied($q$select public.journal_feedback_update_thread('10000000-0000-4000-8000-000000000001','Titre','Description utile','bug',null)$q$,'missing optimistic version denied');
select set_config('test.feedback.timestamp',public.journal_feedback_get('10000000-0000-4000-8000-000000000001')->>'updated_at',false);

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000006',false);
select public.feedback_test_require((public.journal_feedback_context()->>'can_manage')::boolean=false,'chantier admin cannot moderate global feedback');
select public.feedback_test_require((public.journal_feedback_get('10000000-0000-4000-8000-000000000001')->>'can_edit')::boolean=false,'another member cannot edit');
select public.feedback_test_denied($q$select public.journal_feedback_update_thread('10000000-0000-4000-8000-000000000001','Usurpé','Description','bug',current_setting('test.feedback.timestamp')::timestamptz)$q$,'another author edit denied');
select public.feedback_test_denied($q$select public.journal_feedback_delete_thread('10000000-0000-4000-8000-000000000001',current_setting('test.feedback.timestamp')::timestamptz)$q$,'chantier admin cannot delete global thread');
select public.feedback_test_denied($q$select public.journal_feedback_set_status('10000000-0000-4000-8000-000000000001','done',current_setting('test.feedback.timestamp')::timestamptz)$q$,'chantier admin cannot set status');
select public.feedback_test_denied($q$select public.journal_feedback_create_thread('10000000-0000-4000-8000-000000000001','Premier retour corrigé','Description utile','improvement')$q$,'another author cannot reuse existing UUID');
select public.feedback_test_require(public.journal_feedback_create_reply('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Même constat')->>'author_name'='Personne 6','collaborator can reply');
select public.feedback_test_require(public.journal_feedback_create_reply('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Même constat')->>'body'='Même constat','strict identical reply retry succeeds');
select public.feedback_test_require((public.journal_feedback_get('10000000-0000-4000-8000-000000000001')->>'reply_count')::int=1,'reply retry did not duplicate');
select public.feedback_test_denied($q$select public.journal_feedback_create_reply('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Autre réponse')$q$,'different reply retry denied');
select public.feedback_test_denied($q$select public.journal_feedback_create_reply('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000099','Réponse')$q$,'reply on missing thread denied');
select public.feedback_test_denied($q$select public.journal_feedback_create_reply('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001',' ' )$q$,'empty reply denied');
select public.feedback_test_denied($q$select public.journal_feedback_create_reply('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001',repeat('x',2001))$q$,'oversize reply denied');
select set_config('test.feedback.reply_timestamp',public.journal_feedback_replies('10000000-0000-4000-8000-000000000001')->'items'->0->>'updated_at',false);
select set_config('test.feedback.last_reply_update',public.journal_feedback_get('10000000-0000-4000-8000-000000000001')->>'reply_updated_at',false);
select public.feedback_test_require(public.journal_feedback_update_reply('20000000-0000-4000-8000-000000000001','Même constat confirmé',current_setting('test.feedback.reply_timestamp')::timestamptz)->>'body'='Même constat confirmé','reply author can edit');
select public.feedback_test_require((public.journal_feedback_get('10000000-0000-4000-8000-000000000001')->>'reply_updated_at')::timestamptz>current_setting('test.feedback.last_reply_update')::timestamptz and (public.journal_feedback_get('10000000-0000-4000-8000-000000000001')->>'reply_count')::int=1,'thread reply_updated_at detects edits without count changes');
select public.feedback_test_denied($q$select public.journal_feedback_update_reply('20000000-0000-4000-8000-000000000001','Ancien texte',current_setting('test.feedback.reply_timestamp')::timestamptz)$q$,'stale reply edit denied');
select public.feedback_test_denied($q$select public.journal_feedback_delete_reply('20000000-0000-4000-8000-000000000001',current_setting('test.feedback.reply_timestamp')::timestamptz)$q$,'stale reply deletion denied');
select set_config('test.feedback.reply_timestamp',public.journal_feedback_replies('10000000-0000-4000-8000-000000000001')->'items'->0->>'updated_at',false);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000007',false);
select public.feedback_test_denied($q$select public.journal_feedback_update_reply('20000000-0000-4000-8000-000000000001','Usurpé',current_setting('test.feedback.reply_timestamp')::timestamptz)$q$,'thread author cannot rewrite another reply');
select public.feedback_test_denied($q$select public.journal_feedback_delete_reply('20000000-0000-4000-8000-000000000001',current_setting('test.feedback.reply_timestamp')::timestamptz)$q$,'thread author cannot delete another reply');

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',false);
select public.feedback_test_require((public.journal_feedback_context()->>'can_manage')::boolean,'owner has moderation rights');
select public.feedback_test_denied($q$select public.journal_feedback_update_thread('10000000-0000-4000-8000-000000000001','Usurpé','Description','bug',current_setting('test.feedback.timestamp')::timestamptz)$q$,'global admin cannot rewrite another author');
select public.feedback_test_denied($q$select public.journal_feedback_set_status('10000000-0000-4000-8000-000000000001','unknown',current_setting('test.feedback.timestamp')::timestamptz)$q$,'invalid new status denied');
select public.feedback_test_require(public.journal_feedback_set_status('10000000-0000-4000-8000-000000000001','planned',current_setting('test.feedback.timestamp')::timestamptz)->>'status'='planned','owner can plan feedback');
select public.feedback_test_denied($q$select public.journal_feedback_set_status('10000000-0000-4000-8000-000000000001','done',current_setting('test.feedback.timestamp')::timestamptz)$q$,'stale moderation denied');
select public.feedback_test_require((public.journal_feedback_get('10000000-0000-4000-8000-000000000001')->>'can_edit')::boolean=false,'admin UI does not expose editing another author');
select public.feedback_test_require((public.journal_feedback_delete_reply('20000000-0000-4000-8000-000000000001',current_setting('test.feedback.reply_timestamp')::timestamptz)->>'deleted')::boolean,'global admin may moderate reply');
select public.feedback_test_require((public.journal_feedback_get('10000000-0000-4000-8000-000000000001')->>'reply_count')::int=0,'deleted reply count updates');
reset role;
insert into public.journal_administrators values('00000000-0000-4000-8000-000000000008','administrateur_general');
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000008',false);
select public.feedback_test_require((public.journal_feedback_context()->>'can_manage')::boolean,'general administrator can moderate');
select public.feedback_test_require(public.journal_feedback_set_status('10000000-0000-4000-8000-000000000001','in_progress',(public.journal_feedback_get('10000000-0000-4000-8000-000000000001')->>'updated_at')::timestamptz)->>'status'='in_progress','general administrator can start work');

-- A revoked JWT must lose both RPC access and Storage authorization immediately.
reset role;
insert into public.journal_user_access_blocks(user_id,reason) values('00000000-0000-4000-8000-000000000008','revoked');
set role authenticated;
select public.feedback_test_denied('select public.journal_feedback_context()','revoked global admin context denied');
select public.feedback_test_denied('select public.journal_feedback_list()','revoked feed read denied');
select public.feedback_test_denied($q$select public.journal_feedback_get('10000000-0000-4000-8000-000000000001')$q$,'revoked detail denied');
select public.feedback_test_denied($q$select public.journal_feedback_replies('10000000-0000-4000-8000-000000000001')$q$,'revoked replies denied');
select public.feedback_test_denied($q$select public.journal_feedback_create_thread('10000000-0000-4000-8000-000000000008','Titre','Description','bug')$q$,'revoked create denied');
select public.feedback_test_denied($q$select public.journal_feedback_create_reply('20000000-0000-4000-8000-000000000008','10000000-0000-4000-8000-000000000001','Réponse')$q$,'revoked reply creation denied');
select public.feedback_test_denied($q$select public.journal_feedback_set_status('10000000-0000-4000-8000-000000000001','done',now())$q$,'revoked moderator denied');
select public.feedback_test_require(not public.journal_feedback_image_access('00000000-0000-4000-8000-000000000008/10000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000001.jpg','insert'),'revoked screenshot upload denied');
reset role;
delete from public.journal_user_access_blocks where user_id='00000000-0000-4000-8000-000000000008';

-- Same timestamps must paginate deterministically with UUID tie-breaker.
insert into journal_feedback_private.threads(id,author_id,title,body,category,status,created_at)
 select ('11000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'00000000-0000-4000-8000-000000000007','Pagination '||i,'Texte','bug','new','2100-01-01T00:00:00Z' from generate_series(1,55) i;
insert into journal_feedback_private.replies(id,thread_id,author_id,body,created_at)
 select ('21000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000007','Réponse '||i,'2100-01-01T00:00:00Z' from generate_series(1,35) i;
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000007',false);
select public.feedback_test_require(jsonb_array_length(public.journal_feedback_list(null,null,null,null,1000)->'items')=50,'server caps thread page at 50');
select public.feedback_test_require(jsonb_array_length(public.journal_feedback_list()->'items')=30,'default page has 30 threads');
select public.feedback_test_require(public.journal_feedback_list()->'items'->0->>'id'='11000000-0000-4000-8000-000000000055','stable UUID descending order');
select public.feedback_test_require(public.journal_feedback_list('2100-01-01T00:00:00Z','11000000-0000-4000-8000-000000000026')->'items'->0->>'id'='11000000-0000-4000-8000-000000000025','cursor continues without timestamp duplicates');
select public.feedback_test_require(public.journal_feedback_list('2100-01-01T00:00:00Z','11000000-0000-4000-8000-000000000026')->'next_cursor'='null'::jsonb,'last page cursor absent');
select public.feedback_test_require(jsonb_array_length(public.journal_feedback_list(null,null,'in_progress','improvement')->'items')=1,'combined filters match only intended thread');
select public.feedback_test_require(jsonb_array_length(public.journal_feedback_replies('10000000-0000-4000-8000-000000000001')->'items')=30,'reply page capped at default 30');
select public.feedback_test_require(public.journal_feedback_replies('10000000-0000-4000-8000-000000000001')->'next_cursor'->>'id'='21000000-0000-4000-8000-000000000006','reply keyset boundary correct');
select public.feedback_test_require(jsonb_array_length(public.journal_feedback_replies('10000000-0000-4000-8000-000000000001','2100-01-01T00:00:00Z','21000000-0000-4000-8000-000000000006')->'items')=5,'all earlier replies reachable');
select public.feedback_test_denied($q$select public.journal_feedback_replies('10000000-0000-4000-8000-000000000001',null,'21000000-0000-4000-8000-000000000001')$q$,'partial replies cursor denied');

-- Storage policy checks run against deliberately permissive historical policies.
select public.feedback_test_denied($q$insert into storage.objects(bucket_id,name,metadata) values('journal-feedback-images','00000000-0000-4000-8000-000000000006/12000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000001.jpg','{"size":100,"mimetype":"image/jpeg"}')$q$,'cannot upload under another user prefix');
select public.feedback_test_denied($q$insert into storage.objects(bucket_id,name,metadata) values('journal-feedback-images','00000000-0000-4000-8000-000000000007/12000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000001.svg','{"size":100,"mimetype":"image/svg+xml"}')$q$,'SVG path denied');
insert into storage.objects(bucket_id,name,metadata) values('journal-feedback-images','00000000-0000-4000-8000-000000000007/12000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000001.jpg','{"size":100,"mimetype":"image/jpeg"}');
select public.feedback_test_require((select count(*)=1 from storage.objects where bucket_id='journal-feedback-images'),'author may read pending image for cleanup');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000006',false);
select public.feedback_test_require((select count(*)=0 from storage.objects where bucket_id='journal-feedback-images'),'other user cannot read unpublished screenshot despite old permissive policy');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000007',false);
select public.feedback_test_denied($q$select public.journal_feedback_create_thread('12000000-0000-4000-8000-000000000002','Photo','Texte','bug','00000000-0000-4000-8000-000000000007/12000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000001.jpg')$q$,'capture bound to exact thread ID');
select public.feedback_test_denied($q$select public.journal_feedback_create_thread('12000000-0000-4000-8000-000000000002','Photo','Texte','bug','00000000-0000-4000-8000-000000000007/12000000-0000-4000-8000-000000000002/30000000-0000-4000-8000-000000000001.jpg')$q$,'nonexistent image denied');
select public.feedback_test_require(public.journal_feedback_create_thread('12000000-0000-4000-8000-000000000001','Photo','Texte','bug','00000000-0000-4000-8000-000000000007/12000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000001.jpg')->>'image_path' is not null,'uploaded image can be published');
select public.feedback_test_require(not public.journal_feedback_image_access('00000000-0000-4000-8000-000000000007/12000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000001.jpg','delete'),'published image cannot be removed directly');
with changed as(update storage.objects set metadata='{}'::jsonb where bucket_id='journal-feedback-images' returning id) select public.feedback_test_require(count(*)=0,'published image cannot be overwritten') from changed;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000006',false);
select public.feedback_test_require((select count(*)=1 from storage.objects where bucket_id='journal-feedback-images'),'active collaborator can read published screenshot');
select public.feedback_test_denied($q$insert into storage.objects(bucket_id,name,metadata) values('journal-feedback-images','00000000-0000-4000-8000-000000000006/12000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000002.jpg','{"size":100,"mimetype":"image/jpeg"}')$q$,'cannot append screenshot to existing thread');
reset role;
-- Model legacy anonymous blanket storage policy to verify restrictive isolation.
create policy feedback_test_old_anon_storage on storage.objects for select to anon using(true);
grant select on storage.objects to anon;
set role anon;
select set_config('request.jwt.claim.sub','',false);
select public.feedback_test_require((select count(*)=0 from storage.objects where bucket_id='journal-feedback-images'),'anonymous blanket old policy still cannot expose feedback images');
reset role;
insert into public.journal_user_access_blocks(user_id,reason) values('00000000-0000-4000-8000-000000000006','revoked');
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000006',false);
select public.feedback_test_require((select count(*)=0 from storage.objects where bucket_id='journal-feedback-images'),'revoked JWT cannot read published images');
reset role;
delete from public.journal_user_access_blocks where user_id='00000000-0000-4000-8000-000000000006';
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000007',false);
select public.feedback_test_require((public.journal_feedback_delete_thread('12000000-0000-4000-8000-000000000001',(public.journal_feedback_get('12000000-0000-4000-8000-000000000001')->>'updated_at')::timestamptz)->>'deleted')::boolean,'author can delete own pictured thread');
with removed as(delete from storage.objects where bucket_id='journal-feedback-images' returning id) select public.feedback_test_require(count(*)=1,'author can clean up removed thread screenshot') from removed;
-- Invalid metadata prevents a client bypass of file type/size UI checks.
insert into storage.objects(bucket_id,name,metadata) values('journal-feedback-images','00000000-0000-4000-8000-000000000007/12000000-0000-4000-8000-000000000002/30000000-0000-4000-8000-000000000001.jpg','{"size":5242881,"mimetype":"image/jpeg"}');
select public.feedback_test_denied($q$select public.journal_feedback_create_thread('12000000-0000-4000-8000-000000000002','Photo','Texte','bug','00000000-0000-4000-8000-000000000007/12000000-0000-4000-8000-000000000002/30000000-0000-4000-8000-000000000001.jpg')$q$,'oversize uploaded object cannot be published');
reset role;
update storage.objects set metadata='{"size":10,"mimetype":"text/html"}' where bucket_id='journal-feedback-images';
set role authenticated;
select public.feedback_test_denied($q$select public.journal_feedback_create_thread('12000000-0000-4000-8000-000000000002','Photo','Texte','bug','00000000-0000-4000-8000-000000000007/12000000-0000-4000-8000-000000000002/30000000-0000-4000-8000-000000000001.jpg')$q$,'non-image metadata denied');
reset role;
update storage.objects set metadata='{"size":"NaN","mimetype":"image/jpeg"}' where bucket_id='journal-feedback-images';
set role authenticated;
select public.feedback_test_denied($q$select public.journal_feedback_create_thread('12000000-0000-4000-8000-000000000002','Photo','Texte','bug','00000000-0000-4000-8000-000000000007/12000000-0000-4000-8000-000000000002/30000000-0000-4000-8000-000000000001.jpg')$q$,'invalid size metadata denied');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',false);
with removed as(delete from storage.objects where bucket_id='journal-feedback-images' returning id) select public.feedback_test_require(count(*)=1,'global moderator can clean orphan screenshot from another author') from removed;
reset role;
select public.feedback_test_require((select count(*)=1 from storage.objects where bucket_id='chantier-files' and name='photo.jpg'),'historical files untouched');

-- Account deletion preserves history without new identity cascades.
select set_config('request.jwt.claim.sub','',false);
delete from public.profiles where id='00000000-0000-4000-8000-000000000007';
delete from auth.users where id='00000000-0000-4000-8000-000000000007';
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000007',false);
select public.feedback_test_denied('select public.journal_feedback_context()','deleted account old JWT denied');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',false);
select public.feedback_test_require(public.journal_feedback_get('10000000-0000-4000-8000-000000000001')->>'author_name'='Compte supprimé','deleted author falls back safely');
select public.feedback_test_require(public.journal_feedback_replies('10000000-0000-4000-8000-000000000001')->'items'->0->>'author_name'='Compte supprimé','deleted reply author falls back safely');
select public.feedback_test_require((public.journal_feedback_delete_thread('10000000-0000-4000-8000-000000000001',(public.journal_feedback_get('10000000-0000-4000-8000-000000000001')->>'updated_at')::timestamptz)->>'deleted')::boolean,'admin can delete abusive thread');
reset role;
select public.feedback_test_require(not exists(select 1 from journal_feedback_private.replies where thread_id='10000000-0000-4000-8000-000000000001'),'deleted thread cascades only its feedback replies');
select public.feedback_test_require((select count(*)=1 from public.chantier_messages),'no feedback messages in chantier feed');
select public.feedback_test_require((select count(*)=2 from public.action_items),'no feedback actions inserted');
do $$ declare v_events bigint;v_queue bigint;begin
  if to_regclass('journal_mode_private.events') is not null then
    execute 'select count(*) from journal_mode_private.events' into v_events;
    execute 'select count(*) from journal_mode_private.queue' into v_queue;
    if v_events<>0 or v_queue<>0 then raise exception 'Feedback unexpectedly produced chantier notifications.';end if;
  end if;
end $$;
select public.feedback_test_require(true,'feedback generated no Mode Chantier events or push queue');
select public.journal_v142_assert_account_cleanup_safe();
