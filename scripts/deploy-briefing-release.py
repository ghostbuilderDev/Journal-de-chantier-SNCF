#!/usr/bin/env python3
"""Apply the briefing migration using the existing protected database transport."""
import importlib.util
import os
from pathlib import Path
import sys
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('transport', ROOT / 'scripts/deploy-supabase-release.py')
transport = importlib.util.module_from_spec(spec)
spec.loader.exec_module(transport)
NAME = '20260907000600_briefing_archive.sql'
def main():
    project, dsn = os.environ.get('SUPABASE_PROJECT_ID',''), os.environ.get('SUPABASE_DB_URL','')
    if project != 'eqfwdcttvnnrakyaacjm' or not dsn:
        raise RuntimeError('Projet attendu et secret SUPABASE_DB_URL requis.')
    transport.postgres_environment(dsn, project)
    query = lambda sql: transport.postgres_query(sql, project, dsn)
    if query("select to_regprocedure('public.journal_v142_can_write(uuid)') is not null and to_regclass('public.chantier_document_folders') is not null as ready")[0]['ready'] is not True:
        raise RuntimeError('Journal V14.2 et bibliothèque documentaire requis.')
    # SQL is idempotent and its registry update is in the same transaction.
    applied = query("select exists(select 1 from public.journal_sql_migrations where migration_name='" + NAME + "') as applied")[0]['applied']
    if not applied:
        query(transport.build_transaction((ROOT/'supabase/migrations'/NAME).read_text(), NAME))
    result = query("select has_function_privilege('authenticated','public.journal_archive_briefing(uuid,uuid,text,bigint)','EXECUTE') and not has_function_privilege('anon','public.journal_archive_briefing(uuid,uuid,text,bigint)','EXECUTE') as ready")
    if result[0]['ready'] is not True: raise RuntimeError('Droits de la fonction non validés.')
    print('Archivage briefing installé et droits vérifiés.')
if __name__ == '__main__':
    try: main()
    except Exception:
        print('Installation interrompue. Vérifiez les prérequis et les secrets GitHub ; aucun secret affiché.',file=sys.stderr)
        sys.exit(1)
