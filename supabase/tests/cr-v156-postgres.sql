-- Run only against an empty CI fixture, after the real production envelope.
DO $$ BEGIN
 IF (select count(*) from journal_cr_private.references_v156)<>53 THEN RAISE EXCEPTION 'Références incomplètes';END IF;
 IF has_function_privilege('authenticated','journal_cr_private.api_v155(text,jsonb)','execute') THEN RAISE EXCEPTION 'Ancien accès direct';END IF;
 IF has_table_privilege('authenticated','journal_cr_private.night_resets','select') THEN RAISE EXCEPTION 'Table privée exposée';END IF;
 IF NOT has_function_privilege('authenticated','public.journal_writing_access(uuid,boolean)','execute') THEN RAISE EXCEPTION 'Moteur sans contrôle des accès';END IF;
END $$;
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';set role authenticated;
DO $$ DECLARE a uuid;b uuid;sid uuid:='aaaaaaaa-0000-4000-8000-000000000001';r jsonb; BEGIN
 r:=public.journal_cr_api('create',jsonb_build_object('chantier_id',sid,'night',current_date));a:=(r->>'id')::uuid;
 perform public.journal_cr_api('delete_reports',jsonb_build_object('ids',jsonb_build_array(a)));
 r:=public.journal_cr_api('create',jsonb_build_object('chantier_id',sid,'night',current_date));b:=(r->>'id')::uuid;
 IF a=b THEN RAISE EXCEPTION 'Ancien CR restauré';END IF;
 IF public.journal_cr_api('list','{"deleted":true}')<>'[]'::jsonb THEN RAISE EXCEPTION 'Restauration encore accessible';END IF;
END $$;
reset role;
