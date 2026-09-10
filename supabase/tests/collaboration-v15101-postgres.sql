BEGIN;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='journal_notification_signals') THEN RAISE EXCEPTION 'Publication Realtime absente';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='journal_notification_signals' AND policyname='journal_notification_own_signal') THEN RAISE EXCEPTION 'Politique personnelle absente';END IF;
 IF has_table_privilege('anon','public.journal_notification_signals','SELECT') OR has_table_privilege('authenticated','public.journal_notification_signals','INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'Droits trop larges sur les signaux';END IF;
 IF NOT has_function_privilege('anon','public.journal_briefing_sign(text,text,jsonb)','EXECUTE') OR has_table_privilege('anon','journal_briefing_private.signatures','SELECT') THEN RAISE EXCEPTION 'Droits QR incorrects';END IF;
 IF position('upper(v.nom)' in pg_get_functiondef('public.journal_briefing_sign(text,text,jsonb)'::regprocedure))=0 THEN RAISE EXCEPTION 'Normalisation QR absente';END IF;
END $$;
ROLLBACK;
