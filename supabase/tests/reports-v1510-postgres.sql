BEGIN;
DO $$ BEGIN
 IF NOT has_function_privilege('authenticated','public.journal_report_api(text,jsonb)','EXECUTE') OR has_function_privilege('anon','public.journal_report_api(text,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'Droits de transfert invalides';END IF;
 IF has_schema_privilege('authenticated','journal_report_private','USAGE') OR has_schema_privilege('anon','journal_report_private','USAGE') THEN RAISE EXCEPTION 'Brouillons accessibles directement';END IF;
 IF has_table_privilege('authenticated','journal_report_private.reports','SELECT') THEN RAISE EXCEPTION 'Accès direct aux rapports';END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='journal_v15_message_notification') THEN RAISE EXCEPTION 'Notifications absentes';END IF;
END $$;
ROLLBACK;
