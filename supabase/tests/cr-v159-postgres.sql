-- The production gate checks actual roles on a disposable PostgreSQL instance.
DO $$ BEGIN
 IF has_schema_privilege('anon','journal_cr_private','USAGE') OR has_schema_privilege('authenticated','journal_cr_private','USAGE') THEN RAISE EXCEPTION 'CR privé exposé';END IF;
 IF has_function_privilege('anon','public.journal_cr_api(text,jsonb)','EXECUTE') OR NOT has_function_privilege('authenticated','public.journal_cr_api(text,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'Droits API invalides';END IF;
 IF has_function_privilege('authenticated','journal_cr_private.completion_api(text,jsonb)','EXECUTE') OR has_function_privilege('authenticated','journal_cr_private.production_api_v158(text,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'Ancienne API exposée';END IF;
 IF NOT (SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN ('journal_cr_private.completions'::regclass,'journal_cr_private.completion_agents'::regclass,'journal_cr_private.completion_notes'::regclass,'journal_cr_private.completion_receipts'::regclass)) THEN RAISE EXCEPTION 'RLS absente';END IF;
 IF has_table_privilege('anon','journal_briefing_private.signatures','SELECT') THEN RAISE EXCEPTION 'Signatures exposées';END IF;
END $$;
BEGIN;
set local request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';
set local role authenticated;
DO $$ DECLARE r jsonb; b jsonb; BEGIN
 r:=public.journal_production_api('save',jsonb_build_object('id','99999999-0000-4000-8000-000000000001','chantier_id','aaaaaaaa-0000-4000-8000-000000000001','night',current_date,'version',0,'items',jsonb_build_array(jsonb_build_object('title','Réglage V2M','progress',null,'additional',false))));
 perform set_config('test.completion_id',r->>'completion_id',true);
 b:=public.journal_cr_api('completion_detail',jsonb_build_object('id',r->>'completion_id'));
 perform public.journal_cr_api('completion_assign',jsonb_build_object('id',r->>'completion_id','version',b->'version','request_id',gen_random_uuid(),'users',jsonb_build_array('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003')));
END $$;
reset role;
set local request.jwt.claim.sub='00000000-0000-4000-8000-000000000002';
set local role authenticated;
DO $$ DECLARE b jsonb; rid text:=current_setting('test.completion_id'); BEGIN
 b:=public.journal_cr_api('completion_detail',jsonb_build_object('id',rid));
 IF (b->>'manager')::boolean OR b ? 'sections' OR jsonb_array_length(b->'people')<>0 THEN RAISE EXCEPTION 'CR complet exposé à un agent';END IF;
 b:=public.journal_cr_api('completion_patch',jsonb_build_object('id',rid,'request_id',gen_random_uuid(),'generation',b->'generation','progress',jsonb_build_array(jsonb_build_object('sheet_id',b#>>'{sheets,0,id}','index',0,'before',b#>'{sheets,0,items,0}','next',jsonb_build_object('title','Réglage V2M','progress',100,'additional',false))),'settings',jsonb_build_object('safety_clear',jsonb_build_object('before',false,'next',true))));
 IF b->>'state'<>'open' THEN RAISE EXCEPTION 'Enregistrement finalise la demande';END IF;
 b:=public.journal_cr_api('completion_submit',jsonb_build_object('id',rid,'request_id',gen_random_uuid(),'version',b->'version','confirmed',true));
 IF b->>'state'<>'submitted' OR b->>'report_state'<>'draft' THEN RAISE EXCEPTION 'Transmission valide le CR';END IF;
END $$;
reset role;
set local request.jwt.claim.sub='00000000-0000-4000-8000-000000000003';
set local role authenticated;
DO $$ BEGIN
 IF exists(select 1 from jsonb_array_elements(public.journal_cr_api('tasks')) t where t->>'id'=current_setting('test.completion_id')) THEN RAISE EXCEPTION 'Demande terminée encore visible';END IF;
END $$;
ROLLBACK;
