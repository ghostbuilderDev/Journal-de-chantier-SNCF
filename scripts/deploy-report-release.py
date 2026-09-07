#!/usr/bin/env python3
"""Migration additive AINM avec le transport et les secrets du journal actuel."""
import importlib.util
import os
from pathlib import Path
import sys
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('briefing_deploy',ROOT/'scripts/deploy-briefing-release.py')
briefing=importlib.util.module_from_spec(spec)
spec.loader.exec_module(briefing)
NAME='20260907000700_archive_rapports_journaliers.sql'
def main():
    project,dsn=os.environ.get('SUPABASE_PROJECT_ID',''),os.environ.get('SUPABASE_DB_URL','')
    if project!='eqfwdcttvnnrakyaacjm' or not dsn:
        raise RuntimeError('Projet attendu et secret SUPABASE_DB_URL requis.')
    briefing.transport.postgres_environment(dsn,project)
    query=lambda sql:briefing.transport.postgres_query(sql,project,dsn)
    if not briefing.is_ready(query("select to_regprocedure('public.journal_v142_can_write(uuid)') is not null and to_regclass('public.chantier_documents') is not null and to_regclass('public.journal_sql_migrations') is not null as ready")):
        raise RuntimeError('Socle actuel du journal et bibliothèque documentaire requis.')
    applied=briefing.is_ready(query("select exists(select 1 from public.journal_sql_migrations where migration_name='"+NAME+"') as ready"))
    if not applied:
        query(briefing.transport.build_transaction((ROOT/'supabase/migrations'/NAME).read_text(),NAME))
    signatures=['journal_can_archive_report(uuid)','reserve_journal_report(uuid,text,text,bigint)','finalize_journal_report(uuid)']
    for signature in signatures:
        sql="select has_function_privilege('authenticated','public."+signature+"','EXECUTE') and not has_function_privilege('anon','public."+signature+"','EXECUTE') as ready"
        if not briefing.is_ready(query(sql)):raise RuntimeError('Droits d’archivage AINM non validés.')
    query("NOTIFY pgrst, 'reload schema';")
    print('Archives des rapports installées, droits vérifiés et actualisation API demandée.')
if __name__=='__main__':
    try:main()
    except Exception as exc:
        print('Installation interrompue : '+briefing.safe_error(exc),file=sys.stderr)
        sys.exit(1)
