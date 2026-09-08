#!/usr/bin/env python3
"""Additive V15.2, with scheduler and authenticated email endpoint verification."""
import importlib.util,os,subprocess,sys,urllib.request,urllib.error
from pathlib import Path
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('briefing_deploy',ROOT/'scripts/deploy-briefing-release.py')
briefing=importlib.util.module_from_spec(spec);spec.loader.exec_module(briefing)
NAME='20260908000300_v15_2_cr_simple.sql'
def main():
 project,dsn=os.environ.get('SUPABASE_PROJECT_ID',''),os.environ.get('SUPABASE_DB_URL','')
 if project!='eqfwdcttvnnrakyaacjm' or not dsn or not os.environ.get('SUPABASE_ACCESS_TOKEN'):
  raise RuntimeError('Les trois secrets GitHub Supabase du journal sont requis.')
 briefing.transport.postgres_environment(dsn,project)
 query=lambda sql:briefing.transport.postgres_query(sql,project,dsn)
 if not briefing.is_ready(query("select to_regclass('journal_cr_private.timings') is not null and to_regprocedure('journal_cr_private.api_v15(text,jsonb)') is not null and to_regprocedure('cron.schedule(text,text,text)') is not null as ready")):
  raise RuntimeError('V15.1 et le planificateur des notifications sont requis. Aucune ancienne migration rejouée.')
 applied=briefing.is_ready(query("select exists(select 1 from public.journal_sql_migrations where migration_name='"+NAME+"') as ready"))
 if not applied:query(briefing.transport.build_transaction((ROOT/'supabase/migrations'/NAME).read_text(),NAME))
 if not briefing.is_ready(query("select has_function_privilege('authenticated','public.journal_cr_api(text,jsonb)','EXECUTE') and not has_function_privilege('anon','public.journal_cr_api(text,jsonb)','EXECUTE') and not has_schema_privilege('authenticated','journal_cr_private','USAGE') and not has_schema_privilege('anon','journal_cr_private','USAGE') and exists(select 1 from cron.job where jobname='journal-v152-reminders' and active) as ready")):
  raise RuntimeError('Confidentialité ou planificateur des rappels non validés.')
 result=subprocess.run(['supabase','functions','deploy','journal-cr-send-v152','--project-ref',project,'--no-verify-jwt'],capture_output=True,text=True,timeout=180)
 if result.returncode:raise RuntimeError('Déploiement email V15.2 interrompu. Les CR existants sont conservés ; relancer la même commande.')
 request=urllib.request.Request(f'https://{project}.supabase.co/functions/v1/journal-cr-send-v152',data=b'{}',headers={'Content-Type':'application/json'},method='POST')
 try:
  with urllib.request.urlopen(request,timeout=20) as response:code=response.status
 except urllib.error.HTTPError as error:code=error.code
 if code not in (401,403):raise RuntimeError('Protection de la fonction email non confirmée.')
 query("NOTIFY pgrst, 'reload schema';")
 print('V15.2 installée : demandes individuelles, rappels planifiés, droits privés et fonction email vérifiés. Configuration email existante conservée.')
if __name__=='__main__':
 try:main()
 except Exception as error:print('Installation interrompue : '+briefing.safe_error(error),file=sys.stderr);sys.exit(1)
