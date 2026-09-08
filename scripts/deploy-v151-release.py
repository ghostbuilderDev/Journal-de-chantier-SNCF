#!/usr/bin/env python3
"""Install only V15.1 and import confidential suggestions from a deployment secret."""
import importlib.util,json,os,sys
from pathlib import Path
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('briefing_deploy',ROOT/'scripts/deploy-briefing-release.py')
briefing=importlib.util.module_from_spec(spec);spec.loader.exec_module(briefing)
NAME='20260908000200_v15_1_cr_perimetres.sql'

def main():
    project,dsn=os.environ.get('SUPABASE_PROJECT_ID',''),os.environ.get('SUPABASE_DB_URL','')
    if project!='eqfwdcttvnnrakyaacjm' or not dsn or not os.environ.get('SUPABASE_ACCESS_TOKEN'):
        raise RuntimeError('Les trois secrets GitHub Supabase de ce journal sont requis.')
    raw=os.environ.get('JOURNAL_CR_V151_IMPORT','')
    try:
        data=json.loads(raw)
        if data.get('format')!='journal-cr-v15.1' or not data['catalog'] or not data['contacts']:raise ValueError()
    except (ValueError,KeyError,TypeError):raise RuntimeError('Import privé V15.1 absent ou invalide. Relancer la commande Termux fournie.') from None
    briefing.transport.postgres_environment(dsn,project)
    query=lambda sql:briefing.transport.postgres_query(sql,project,dsn)
    if not briefing.is_ready(query("select to_regprocedure('public.journal_cr_api(text,jsonb)') is not null and to_regclass('journal_cr_private.snapshots') is not null as ready")):
        raise RuntimeError('V15 installée requise ; aucune ancienne migration rejouée.')
    applied=briefing.is_ready(query("select exists(select 1 from public.journal_sql_migrations where migration_name='"+NAME+"') as ready"))
    if not applied:query(briefing.transport.build_transaction((ROOT/'supabase/migrations'/NAME).read_text(),NAME))
    # Literal JSON is escaped as a PostgreSQL string, never interpolated into shell code.
    literal=json.dumps(data,ensure_ascii=True,separators=(',',':')).replace("'","''")
    try:query("select journal_cr_private.import_v151('"+literal+"'::jsonb);")
    except Exception:raise RuntimeError('Import privé interrompu. Les destinataires déjà choisis dans les CR sont conservés.') from None
    if not briefing.is_ready(query("select has_function_privilege('authenticated','public.journal_cr_api(text,jsonb)','EXECUTE') and not has_function_privilege('anon','public.journal_cr_api(text,jsonb)','EXECUTE') and not has_schema_privilege('authenticated','journal_cr_private','USAGE') and not has_schema_privilege('anon','journal_cr_private','USAGE') as ready")):
        raise RuntimeError('Droits de confidentialité non validés.')
    query("NOTIFY pgrst, 'reload schema';")
    print('V15.1 installée : périmètres, confidentialité et import privé vérifiés. Aucun destinataire ajouté automatiquement aux CR.')

if __name__=='__main__':
    try:main()
    except Exception as error:print('Installation interrompue : '+briefing.safe_error(error),file=sys.stderr);sys.exit(1)
