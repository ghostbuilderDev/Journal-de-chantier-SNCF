-- Production PostgreSQL gate: grants, independent preparation, write-only QR.
DO $$ BEGIN
 IF has_schema_privilege('anon','journal_briefing_private','USAGE') OR has_schema_privilege('authenticated','journal_briefing_private','USAGE') THEN RAISE EXCEPTION 'Signatures privées exposées'; END IF;
 IF has_function_privilege('anon','public.journal_briefing_manage(text,jsonb)','EXECUTE') OR NOT has_function_privilege('authenticated','public.journal_briefing_manage(text,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'Gestion des séances exposée'; END IF;
 IF NOT has_function_privilege('anon','public.journal_briefing_sign(text,text,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'Formulaire QR inaccessible'; END IF;
 IF has_function_privilege('authenticated','journal_cr_private.api_v157(text,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'Ancienne API exposée'; END IF;
 IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='journal_briefing_private.signatures'::regclass) THEN RAISE EXCEPTION 'RLS absente'; END IF;
END $$;
BEGIN;
set local request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';
set local role authenticated;
DO $$ DECLARE src jsonb;dst jsonb;r jsonb;s jsonb; token text:=repeat('e',64); BEGIN
 src:=public.journal_cr_api('create',jsonb_build_object('chantier_id','aaaaaaaa-0000-4000-8000-000000000001','night',current_date-1));
 r:=public.journal_cr_api('detail',src);
 select value into s from jsonb_array_elements(r->'sections') where value->>'key'='itc';
 perform public.journal_cr_api('field_configure',src||jsonb_build_object('key','itc','version',s->'version','data',jsonb_build_object('rows',jsonb_build_array(jsonb_build_object('label','ZEP 785','track','V1M','planned_start',(current_date-1)::text||'T21:55:00Z','planned_end',current_date::text||'T03:00:00Z')))));
 dst:=public.journal_cr_api('copy_previous',jsonb_build_object('chantier_id','aaaaaaaa-0000-4000-8000-000000000001','night',current_date,'source_id',src->>'id','request_id',gen_random_uuid()));
 IF dst->>'id'=src->>'id' THEN RAISE EXCEPTION 'CR précédent écrasé'; END IF;
 r:=public.journal_cr_api('detail',dst);
 select value into s from jsonb_array_elements(r->'sections') where value->>'key'='itc';
 IF s#>>'{items,0,actual_start}' IS NOT NULL OR s#>>'{items,0,actual_end}' IS NOT NULL OR s#>>'{items,0,track}'<>'V1M' THEN RAISE EXCEPTION 'Reprise incorrecte'; END IF;
 perform public.journal_briefing_manage('open',jsonb_build_object('id','88888888-0000-4000-8000-000000000001','chantier_id','aaaaaaaa-0000-4000-8000-000000000001','date',current_date,'title','Séance de contrôle','token',token));
END $$;
reset role;
set local request.jwt.claim.sub='';
set local role anon;
DO $$ DECLARE r jsonb; BEGIN
 r:=public.journal_briefing_sign(repeat('e',64),'context');
 IF r ? 'signatures' OR r ? 'created_by' OR NOT (r->>'open')::boolean THEN RAISE EXCEPTION 'Contexte QR invalide'; END IF;
 BEGIN
  perform public.journal_briefing_manage('poll','{"id":"88888888-0000-4000-8000-000000000001"}');
  RAISE EXCEPTION 'Lecture anonyme acceptée';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
ROLLBACK;
