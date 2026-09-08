#!/usr/bin/env python3
"""V15 additive migration, using the existing verified TLS PostgreSQL transport."""
import importlib.util, os, subprocess, sys
from pathlib import Path
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('briefing_deploy',ROOT/'scripts/deploy-briefing-release.py')
briefing=importlib.util.module_from_spec(spec);spec.loader.exec_module(briefing)
NAME='20260908000100_v15_cr_encadrement.sql'

def main():
    project,dsn=os.environ.get('SUPABASE_PROJECT_ID',''),os.environ.get('SUPABASE_DB_URL','')
    if project!='eqfwdcttvnnrakyaacjm' or not dsn or not os.environ.get('SUPABASE_ACCESS_TOKEN'):
        raise RuntimeError('Les trois secrets GitHub Supabase de ce journal sont requis.')
    briefing.transport.postgres_environment(dsn,project)
    query=lambda sql:briefing.transport.postgres_query(sql,project,dsn)
    if not briefing.is_ready(query("select to_regprocedure('public.journal_v142_can_write(uuid)') is not null and to_regclass('public.journal_sql_migrations') is not null and to_regclass('journal_mode_private.config') is not null as ready")):
        raise RuntimeError('Socle du Journal et mode chantier V14.4 requis. Aucune ancienne migration rejouée.')
    applied=briefing.is_ready(query("select exists(select 1 from public.journal_sql_migrations where migration_name='"+NAME+"') as ready"))
    if not applied:
        query(briefing.transport.build_transaction((ROOT/'supabase/migrations'/NAME).read_text(),NAME))
    for signature in ['journal_cr_api(text,jsonb)']:
        if not briefing.is_ready(query("select has_function_privilege('authenticated','public."+signature+"','EXECUTE') and not has_function_privilege('anon','public."+signature+"','EXECUTE') as ready")):
            raise RuntimeError('Droits CR non validés.')
    for signature in ['journal_cr_delivery_finish(uuid,text,text)','journal_v15_push_jobs()','journal_v15_push_finish(uuid,uuid,integer,text)']:
        if not briefing.is_ready(query("select has_function_privilege('service_role','public."+signature+"','EXECUTE') and not has_function_privilege('authenticated','public."+signature+"','EXECUTE') and not has_function_privilege('anon','public."+signature+"','EXECUTE') as ready")):
            raise RuntimeError('Protection des fonctions internes non validée.')
    if not briefing.is_ready(query("select not has_schema_privilege('authenticated','journal_cr_private','USAGE') and not has_schema_privilege('anon','journal_cr_private','USAGE') as ready")):
        raise RuntimeError('Confidentialité du schéma CR non validée.')
    query("NOTIFY pgrst, 'reload schema';")
    print('Migration V15 installée, droits et confidentialité vérifiés.')

if __name__=='__main__':
    try:main()
    except Exception as error:
        print('Installation interrompue : '+briefing.safe_error(error),file=sys.stderr);sys.exit(1)
