#!/usr/bin/env python3
"""Cumulative V15.9/V15.10 -> V15.10.1, registered transactions before frontend."""
import importlib.util,os,sys
from pathlib import Path
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('previous_release',ROOT/'scripts/deploy-v1510-release.py')
previous=importlib.util.module_from_spec(spec);spec.loader.exec_module(previous)
NAME='20260910000400_v15_10_1_signatures_notifications.sql'

def migration_transactions():
 try:
  return [(previous.NAME,previous.migration_transaction()),(NAME,previous.briefing.transport.build_transaction((ROOT/'supabase/migrations'/NAME).read_text(),NAME))]
 except ValueError as error:
  raise RuntimeError('Fichier SQL V15.10.1 invalide : '+str(error)+' Aucune migration exécutée.') from None

def main():
 # Validate BOTH files before the earlier migration can be applied.
 transactions=migration_transactions()
 previous.main()
 project,dsn=os.environ['SUPABASE_PROJECT_ID'],os.environ['SUPABASE_DB_URL']
 query=lambda sql:previous.briefing.transport.postgres_query(sql,project,dsn)
 ready=previous.briefing.is_ready
 if not ready(query("select exists(select 1 from public.journal_sql_migrations where migration_name='"+NAME+"') as ready")):
  query(transactions[1][1])
 if not ready(query("select has_table_privilege('authenticated','public.journal_notification_signals','SELECT') and not has_table_privilege('anon','public.journal_notification_signals','SELECT') and not has_table_privilege('authenticated','public.journal_notification_signals','INSERT,UPDATE,DELETE') and (select relrowsecurity from pg_class where oid='public.journal_notification_signals'::regclass) and exists(select 1 from pg_policies where schemaname='public' and tablename='journal_notification_signals' and policyname='journal_notification_own_signal') and exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='journal_notification_signals') and exists(select 1 from pg_trigger where tgname='journal_notification_signal' and tgrelid='journal_cr_private.notifications'::regclass and tgenabled='O') as ready")):
  raise RuntimeError('La diffusion des alertes personnelles et ses droits ne sont pas validés.')
 if not ready(query("select has_function_privilege('anon','public.journal_briefing_sign(text,text,jsonb)','EXECUTE') and not has_table_privilege('anon','journal_briefing_private.signatures','SELECT') and not has_function_privilege('authenticated','journal_cr_private.signal_notification()','EXECUTE') and position('upper(v.nom)' in pg_get_functiondef('public.journal_briefing_sign(text,text,jsonb)'::regprocedure))>0 as ready")):
  raise RuntimeError('La compatibilité des signatures QR et de leurs confirmations doit être vérifiée.')
 query("NOTIFY pgrst, 'reload schema';")
 print('V15.10.1 installée : alertes personnelles en temps réel et signature QR mobile. Les données et les liens QR existants sont conservés.')

if __name__=='__main__':
 try:
  if sys.argv[1:]==['--print-sql']:print(''.join(sql for _,sql in migration_transactions()),end='')
  elif sys.argv[1:]:raise RuntimeError('Option inconnue. Utiliser --print-sql pour vérifier sans connexion.')
  else:main()
 except Exception as error:print('Installation interrompue : '+previous.briefing.safe_error(error),file=sys.stderr);sys.exit(1)
