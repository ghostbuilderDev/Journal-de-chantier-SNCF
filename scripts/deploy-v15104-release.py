#!/usr/bin/env python3
"""V15.10.3 -> V15.10.4: one additive numbering migration, no replay of older releases."""
import importlib.util, os, sys
from pathlib import Path
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('briefing_deploy',ROOT/'scripts/deploy-briefing-release.py')
briefing=importlib.util.module_from_spec(spec);spec.loader.exec_module(briefing)
NAME='20260910000500_v15_10_4_report_numbers.sql'
REPAIR_NAME='20260910000600_v15_10_5_report_archive_acl.sql'
PREREQUISITE="select to_regprocedure('public.journal_report_api(text,jsonb)') is not null and to_regprocedure('journal_report_private.detail(uuid)') is not null and to_regprocedure('public.reserve_journal_report(uuid,text,text,bigint)') is not null and to_regclass('public.journal_report_uploads') is not null and to_regclass('public.journal_notification_signals') is not null as ready"
CHECKS=[
 "select has_function_privilege('authenticated','public.journal_report_api(text,jsonb)','EXECUTE') and not has_function_privilege('anon','public.journal_report_api(text,jsonb)','EXECUTE') and has_function_privilege('authenticated','public.journal_reserve_numbered_pdf(uuid,text,text,bigint,uuid,boolean)','EXECUTE') and not has_function_privilege('anon','public.journal_reserve_numbered_pdf(uuid,text,text,bigint,uuid,boolean)','EXECUTE') as ready",
 "select not has_schema_privilege('authenticated','journal_report_private','USAGE') and not has_schema_privilege('anon','journal_report_private','USAGE') and not has_table_privilege('authenticated','journal_report_private.numbers','SELECT,INSERT,UPDATE,DELETE') and not has_table_privilege('anon','journal_report_private.number_counter','SELECT,INSERT,UPDATE,DELETE') and not has_function_privilege('authenticated','journal_report_private.reserve_pdf_v15103(uuid,text,text,bigint)','EXECUTE') as ready",
 "select exists(select 1 from pg_trigger where tgname='journal_report_assign_number' and tgrelid='journal_report_private.reports'::regclass and tgenabled='O') and exists(select 1 from pg_constraint where conrelid='journal_report_private.numbers'::regclass and contype='u' and pg_get_constraintdef(oid)='UNIQUE (serial)') and (select count(*)=1 and min(next_serial)>coalesce((select max(serial) from journal_report_private.numbers),0) from journal_report_private.number_counter) as ready",
 "select has_function_privilege('authenticated','public.finalize_journal_report(uuid)','EXECUTE') and not has_function_privilege('anon','public.finalize_journal_report(uuid)','EXECUTE') as ready",
 "select has_function_privilege('anon','public.journal_briefing_sign(text,text,jsonb)','EXECUTE') and not has_table_privilege('anon','journal_briefing_private.signatures','SELECT') as ready",
 "select has_function_privilege('authenticated','public.journal_can_archive_report(uuid)','EXECUTE') and not has_function_privilege('anon','public.journal_can_archive_report(uuid)','EXECUTE') as ready"
]
CHECK_LABELS=[
 ('RJ_API','Accès aux rapports et à la réservation des PDF'),
 ('RJ_PRIVE','Protection des tables et fonctions de numérotation'),
 ('RJ_COMPTEUR','Compteur unique et attribution automatique'),
 ('RJ_ARCHIVE','Droits de finalisation des archives'),
 ('BRIEFING_QR','Signature QR et protection des signatures'),
 ('RJ_CONTRIBUTEUR','Contrôle des contributeurs autorisés à archiver')
]
def migration_transaction():
 try:return briefing.transport.build_transaction((ROOT/'supabase/migrations'/NAME).read_text(),NAME)
 except ValueError as error:raise RuntimeError('Fichier SQL V15.10.4 invalide : '+str(error)) from None

def repair_transaction():
 try:return briefing.transport.build_transaction((ROOT/'supabase/migrations'/REPAIR_NAME).read_text(),REPAIR_NAME)
 except ValueError as error:raise RuntimeError('Correctif SQL V15.10.5 invalide : '+str(error)) from None

def verify(query):
 failed=[]
 for (code,label),sql in zip(CHECK_LABELS,CHECKS,strict=True):
  try:ok=briefing.is_ready(query(sql))
  except Exception as error:raise RuntimeError('Contrôle '+code+' impossible : '+label+'. '+briefing.safe_error(error)) from None
  print('Contrôle '+code+' : '+('OK' if ok else 'ÉCHEC')+' — '+label,flush=True)
  if not ok:failed.append(code)
 if failed:raise RuntimeError('Contrôles échoués : '+', '.join(failed)+'. Interface conservée ; aucun contrôle ne sera ignoré.')

def main():
 # Validate both payloads before opening any database connection.
 transactions=[(NAME,migration_transaction()),(REPAIR_NAME,repair_transaction())]
 project,dsn=os.environ.get('SUPABASE_PROJECT_ID',''),os.environ.get('SUPABASE_DB_URL','')
 if project!='eqfwdcttvnnrakyaacjm' or not dsn or not os.environ.get('SUPABASE_ACCESS_TOKEN'):
  raise RuntimeError('Les secrets GitHub Supabase existants du journal sont requis.')
 briefing.transport.postgres_environment(dsn,project)
 query=lambda sql:briefing.transport.postgres_query(sql,project,dsn)
 if not briefing.is_ready(query(PREREQUISITE)):raise RuntimeError('La version actuelle et les archives des rapports doivent être installées. Aucune ancienne migration ne sera rejouée.')
 for name,transaction in transactions:
  if not briefing.is_ready(query("select exists(select 1 from public.journal_sql_migrations where migration_name='"+name+"') as ready")):
   query(transaction)
  else:print('Déjà appliqué : '+name,flush=True)
 verify(query)
 query("NOTIFY pgrst, 'reload schema';")
 print('V15.10.5 : numérotation et droits d’archivage vérifiés. Les anciens rapports sont conservés.')
if __name__=='__main__':
 try:
  if sys.argv[1:]==['--print-sql']:print(migration_transaction(),end='')
  elif sys.argv[1:]==['--print-repair-sql']:print(repair_transaction(),end='')
  elif sys.argv[1:]:raise RuntimeError('Option inconnue : --print-sql ou --print-repair-sql pour vérifier sans connexion.')
  else:main()
 except Exception as error:print('Installation interrompue : '+briefing.safe_error(error),file=sys.stderr);sys.exit(1)
