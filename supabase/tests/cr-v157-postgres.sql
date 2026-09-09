-- Executed with the same transaction wrapper used by the production installer.
DO $$ BEGIN
 IF (SELECT count(*) FROM journal_cr_private.references_v156) <> 64 THEN RAISE EXCEPTION 'Catalogue incomplet'; END IF;
 IF NOT EXISTS(SELECT 1 FROM journal_cr_private.references_v156 WHERE label='SEL 1 SR Samois - St Mammes V1' AND sector='SR Samois - St Mammes V1') THEN RAISE EXCEPTION 'Relation SEL-secteur perdue'; END IF;
 IF NOT EXISTS(SELECT 1 FROM journal_cr_private.references_v156 WHERE label='ZEP Type G 704 (Précaire)') THEN RAISE EXCEPTION 'Mention technique perdue'; END IF;
 IF has_schema_privilege('authenticated','journal_cr_private','USAGE') OR has_schema_privilege('anon','journal_cr_private','USAGE') THEN RAISE EXCEPTION 'Schéma privé exposé'; END IF;
 IF NOT has_function_privilege('authenticated','public.journal_cr_api(text,jsonb)','EXECUTE') OR has_function_privilege('anon','public.journal_cr_api(text,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'Droits CR incorrects'; END IF;
END $$;
