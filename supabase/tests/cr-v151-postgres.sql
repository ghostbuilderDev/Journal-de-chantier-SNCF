\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF has_schema_privilege('authenticated','journal_cr_private','USAGE') OR has_function_privilege('anon','public.journal_cr_api(text,jsonb)','EXECUTE')
 OR has_function_privilege('authenticated','journal_cr_private.api_v15(text,jsonb)','EXECUTE')
 THEN RAISE EXCEPTION 'Private API or data exposed'; END IF;
END $$;
SET LOCAL request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb; s jsonb; t jsonb; d jsonb; BEGIN
 r:=public.journal_cr_api('create',jsonb_build_object('chantier_id','aaaaaaaa-0000-4000-8000-000000000001','night',current_date));
 d:=public.journal_cr_api('detail',r);
 SELECT x INTO s FROM jsonb_array_elements(d->'sections') x WHERE x->>'key'='catenaire';
 IF s#>>'{value,mode}'<>'perimeters' THEN RAISE EXCEPTION 'Perimeter mode missing'; END IF;
 PERFORM public.journal_cr_api('timing_configure',r||jsonb_build_object('key','catenaire','version',s->'version','catalog_ids','[]'::jsonb,'keep_ids','[]'::jsonb,'manual_label','Secteur de test voie 1'));
 d:=public.journal_cr_api('detail',r);
 SELECT x INTO s FROM jsonb_array_elements(d->'sections') x WHERE x->>'key'='catenaire'; t:=s->'items'->0;
 PERFORM public.journal_cr_api('timing_save',r||jsonb_build_object('key','catenaire','timing_id',t->>'id','version',t->'version','start',current_date+time '21:00','end',current_date+1+time '02:00','status','auto'));
 d:=public.journal_cr_api('detail',r);
 SELECT x INTO s FROM jsonb_array_elements(d->'sections') x WHERE x->>'key'='catenaire';
 IF s->>'status'<>'complete' OR s#>>'{items,0,updated_name}'<>'Personne 1' THEN RAISE EXCEPTION 'Timing not completed or attributed'; END IF;
END $$;
ROLLBACK;
