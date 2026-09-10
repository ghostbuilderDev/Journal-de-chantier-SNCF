BEGIN;
-- Correct the two legacy archive functions without replaying their definition.
-- Revoking PUBLIC alone does not remove a grant held directly by anon through
-- Supabase default privileges. Keep the authenticated archive workflow intact.
revoke all on function public.finalize_journal_report(uuid) from public, anon;
grant execute on function public.finalize_journal_report(uuid) to authenticated;
revoke all on function public.journal_can_archive_report(uuid) from public, anon;
grant execute on function public.journal_can_archive_report(uuid) to authenticated;

-- No report, PDF, notification, signature or number is modified or deleted.
DO $$BEGIN
 if has_function_privilege('anon','public.finalize_journal_report(uuid)','EXECUTE')
    or has_function_privilege('anon','public.journal_can_archive_report(uuid)','EXECUTE')
    or not has_function_privilege('authenticated','public.finalize_journal_report(uuid)','EXECUTE')
    or not has_function_privilege('authenticated','public.journal_can_archive_report(uuid)','EXECUTE') then
   raise exception 'Droits des archives RJ non corrigés';
 end if;
END$$;
COMMIT;
