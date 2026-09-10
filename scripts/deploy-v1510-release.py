#!/usr/bin/env python3
"""Additive CR tables upgrade; verifies existing feedback and private access."""
import importlib.util,os,sys,subprocess,urllib.request,urllib.error
from pathlib import Path
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('briefing_deploy',ROOT/'scripts/deploy-briefing-release.py')
briefing=importlib.util.module_from_spec(spec);spec.loader.exec_module(briefing)
NAME='20260910000300_v15_10_rapports_mentions.sql'
def migration_transaction():
 try:
  return briefing.transport.build_transaction((ROOT/'supabase/migrations'/NAME).read_text(),NAME)
 except ValueError as error:
  raise RuntimeError('Fichier SQL V15.10 invalide : '+str(error)+' Télécharger le paquet corrigé ; aucune migration exécutée.') from None

def main():
 # Validate the exact production envelope before opening a database connection.
 transaction=migration_transaction()
 project,dsn=os.environ.get('SUPABASE_PROJECT_ID',''),os.environ.get('SUPABASE_DB_URL','')
 if project!='eqfwdcttvnnrakyaacjm' or not dsn or not os.environ.get('SUPABASE_ACCESS_TOKEN'):
  raise RuntimeError('Les trois secrets GitHub Supabase du journal sont requis.')
 briefing.transport.postgres_environment(dsn,project)
 query=lambda sql:briefing.transport.postgres_query(sql,project,dsn)
 if not briefing.is_ready(query("select to_regclass('journal_cr_private.completions') is not null and to_regprocedure('public.journal_briefing_manage(text,jsonb)') is not null and to_regclass('journal_briefing_private.signatures') is not null and to_regprocedure('journal_cr_private.api_v157(text,jsonb)') is not null and to_regprocedure('journal_cr_private.api_v155(text,jsonb)') is not null and to_regclass('journal_cr_private.references_v156') is not null and to_regclass('journal_cr_private.field_requests') is not null and to_regclass('journal_cr_private.production_sheets') is not null and to_regclass('journal_cr_private.week_plans') is not null and to_regprocedure('journal_cr_private.api_v151(text,jsonb)') is not null and to_regprocedure('public.journal_feedback_context()') is not null and to_regprocedure('cron.schedule(text,text,text)') is not null and to_regprocedure('public.journal_v142_can_write(uuid)') is not null and (select count(*)>=64 from journal_cr_private.references_v156) as ready")):
  raise RuntimeError('V15.9, le service des signalements et le planificateur doivent être installés. Aucune ancienne migration rejouée.')
 applied=briefing.is_ready(query("select exists(select 1 from public.journal_sql_migrations where migration_name='"+NAME+"') as ready"))
 if not applied:query(transaction)
 if not briefing.is_ready(query("select has_function_privilege('authenticated','public.journal_cr_api(text,jsonb)','EXECUTE') and not has_function_privilege('anon','public.journal_cr_api(text,jsonb)','EXECUTE') and not has_schema_privilege('authenticated','journal_cr_private','USAGE') and not has_schema_privilege('anon','journal_cr_private','USAGE') and not has_function_privilege('authenticated','journal_cr_private.api_v152(text,jsonb)','EXECUTE') and exists(select 1 from cron.job where jobname='journal-v152-reminders' and active) as ready")):
  raise RuntimeError('Confidentialité ou rappels existants non validés.')
 if not briefing.is_ready(query("select bool_and(has_function_privilege('authenticated',p.oid,'EXECUTE') and not has_function_privilege('anon',p.oid,'EXECUTE') and p.prosecdef) and count(*)=11 as ready from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('journal_feedback_context','journal_feedback_list','journal_feedback_get','journal_feedback_replies','journal_feedback_create_thread','journal_feedback_create_reply','journal_feedback_update_thread','journal_feedback_update_reply','journal_feedback_delete_thread','journal_feedback_delete_reply','journal_feedback_set_status')")):
  raise RuntimeError('Les droits du service des signalements doivent être rétablis avant la publication de cette interface.')
 query("NOTIFY pgrst, 'reload schema';")
 if not briefing.is_ready(query("select has_function_privilege('authenticated','public.journal_production_api(text,jsonb)','EXECUTE') and not has_function_privilege('anon','public.journal_production_api(text,jsonb)','EXECUTE') and not has_function_privilege('authenticated','journal_cr_private.api_v153(text,jsonb)','EXECUTE') as ready")):
  raise RuntimeError('Droits de production non validés.')
 if not briefing.is_ready(query("select to_regclass('journal_cr_private.field_requests') is not null and not has_table_privilege('authenticated','journal_cr_private.field_requests','SELECT') and not has_function_privilege('authenticated','journal_cr_private.api_v154(text,jsonb)','EXECUTE') and not has_function_privilege('authenticated','journal_cr_private.apply_field(uuid,text,jsonb)','EXECUTE') as ready")):
  raise RuntimeError('Protection des demandes de saisie non validée.')
 if not briefing.is_ready(query("select (select count(*)>=64 from journal_cr_private.references_v156) and not has_function_privilege('authenticated','journal_cr_private.api_v155(text,jsonb)','EXECUTE') and has_function_privilege('authenticated','public.journal_delete_site_v156(uuid)','EXECUTE') and not has_function_privilege('anon','public.journal_delete_site_v156(uuid)','EXECUTE') as ready")):
  raise RuntimeError('Catalogue ou droits V15.10 non validés.')
 if not briefing.is_ready(query("select has_function_privilege('authenticated','public.journal_briefing_manage(text,jsonb)','EXECUTE') and not has_function_privilege('anon','public.journal_briefing_manage(text,jsonb)','EXECUTE') and has_function_privilege('anon','public.journal_briefing_sign(text,text,jsonb)','EXECUTE') and not has_schema_privilege('anon','journal_briefing_private','USAGE') and not has_schema_privilege('authenticated','journal_briefing_private','USAGE') and not has_table_privilege('anon','journal_briefing_private.signatures','SELECT') and not has_function_privilege('authenticated','journal_cr_private.api_v157(text,jsonb)','EXECUTE') as ready")):
  raise RuntimeError('Droits des signatures QR ou de la reprise des CR non validés.')
 if not briefing.is_ready(query("select to_regclass('journal_cr_private.completions') is not null and not has_table_privilege('authenticated','journal_cr_private.completions','SELECT') and not has_table_privilege('anon','journal_cr_private.completion_notes','SELECT') and not has_function_privilege('authenticated','journal_cr_private.completion_api(text,jsonb)','EXECUTE') and not has_function_privilege('authenticated','journal_cr_private.api_v158(text,jsonb)','EXECUTE') and not has_function_privilege('authenticated','journal_cr_private.production_api_v158(text,jsonb)','EXECUTE') as ready")):
  raise RuntimeError('Confidentialité de la complétude partagée non validée.')
 if not briefing.is_ready(query("select has_function_privilege('authenticated','public.journal_report_api(text,jsonb)','EXECUTE') and not has_function_privilege('anon','public.journal_report_api(text,jsonb)','EXECUTE') and not has_schema_privilege('authenticated','journal_report_private','USAGE') and not has_schema_privilege('anon','journal_report_private','USAGE') and not has_table_privilege('authenticated','journal_report_private.reports','SELECT') and exists(select 1 from information_schema.columns where table_schema='public' and table_name='chantier_messages' and column_name='mentioned_users') as ready")):
  raise RuntimeError('Droits des rapports partagés ou mentions non validés.')
 print('V15.10 installée : transfert des rapports et alertes de mention. Les CR, les horaires et les demandes existantes sont conservés.')
if __name__=='__main__':
 try:
  if sys.argv[1:]==['--print-sql']:print(migration_transaction(),end='')
  elif sys.argv[1:]:raise RuntimeError('Option inconnue. Utiliser --print-sql pour vérifier la transaction sans connexion.')
  else:main()
 except Exception as error:print('Installation interrompue : '+briefing.safe_error(error),file=sys.stderr);sys.exit(1)
