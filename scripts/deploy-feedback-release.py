#!/usr/bin/env python3
"""Apply only V14.5 over V14.2, without depending on Mode Chantier setup."""
import importlib.util
import os
from pathlib import Path
import sys
sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('journal_transport', ROOT / 'scripts/deploy-supabase-release.py')
transport = importlib.util.module_from_spec(spec)
spec.loader.exec_module(transport)
PROJECT = 'eqfwdcttvnnrakyaacjm'
MIGRATION = '20260907000500_v14_5_retours_application.sql'
PREREQUISITE = '20260906000300_v14_2_contraintes_reelles.sql'
RPC_SIGNATURES = (
    'journal_feedback_context()',
    'journal_feedback_get(uuid)',
    'journal_feedback_list(timestamp with time zone,uuid,text,text,integer)',
    'journal_feedback_replies(uuid,timestamp with time zone,uuid,integer)',
    'journal_feedback_create_thread(uuid,text,text,text,text)',
    'journal_feedback_update_thread(uuid,text,text,text,timestamp with time zone)',
    'journal_feedback_set_status(uuid,text,timestamp with time zone)',
    'journal_feedback_delete_thread(uuid,timestamp with time zone)',
    'journal_feedback_create_reply(uuid,uuid,text)',
    'journal_feedback_update_reply(uuid,text,timestamp with time zone)',
    'journal_feedback_delete_reply(uuid,timestamp with time zone)',
)


def applied(query, name):
    rows = query("SELECT EXISTS(SELECT 1 FROM public.journal_sql_migrations WHERE migration_name = '" + name + "') AS applied;")
    if len(rows) != 1 or type(rows[0].get('applied')) is not bool:
        raise RuntimeError('Registre des migrations invalide ; interface conservee.')
    return rows[0]['applied']


def verify_catalog(query):
    signatures = ','.join("('public." + value + "')" for value in RPC_SIGNATURES)
    rows = query("WITH expected(signature) AS (VALUES " + signatures + ") "
        "SELECT ((SELECT count(*) = 11 AND bool_and(p.prosecdef AND p.prorettype = 'jsonb'::regtype "
        "AND has_function_privilege('authenticated',p.oid,'EXECUTE') "
        "AND NOT has_function_privilege('anon',p.oid,'EXECUTE')) "
        "FROM expected e JOIN pg_proc p ON p.oid = to_regprocedure(e.signature)) "
        "AND to_regclass('journal_feedback_private.threads') IS NOT NULL "
        "AND to_regclass('journal_feedback_private.replies') IS NOT NULL "
        "AND EXISTS(SELECT 1 FROM storage.buckets WHERE id='journal-feedback-images' AND public=false)) AS applied;")
    if len(rows) != 1 or rows[0].get('applied') is not True:
        raise RuntimeError('Le catalogue des RPC ou les droits du fil des ameliorations ne correspondent pas a V14.5. Interface conservee.')
    print('Catalogue des 11 RPC, acces connecte et stockage prive V14.5 verifies.')


def main():
    project = os.environ.get('SUPABASE_PROJECT_ID', '')
    dsn = os.environ.get('SUPABASE_DB_URL', '')
    if project != PROJECT or not dsn:
        raise RuntimeError('Projet attendu et secret GitHub SUPABASE_DB_URL requis pour le fil des ameliorations.')
    transport.postgres_environment(dsn, project)
    names = [line.strip() for line in (ROOT / 'supabase/feedback-release-migrations.txt').read_text().splitlines()
             if line.strip() and not line.lstrip().startswith('#')]
    if names != [MIGRATION]:
        raise RuntimeError('Cette livraison doit appliquer uniquement la migration V14.5.')
    query = lambda sql: transport.postgres_query(sql, project, dsn)
    if not applied(query, PREREQUISITE):
        raise RuntimeError('La migration V14.2 validee doit etre deja appliquee. Aucune ancienne migration relancee.')
    if applied(query, MIGRATION):
        print('V14.5 deja appliquee ; verification avant reprise de la publication.')
    else:
        print('Application transactionnelle du fil des ameliorations V14.5...', flush=True)
        query(transport.build_transaction((ROOT / 'supabase/migrations' / MIGRATION).read_text(), MIGRATION))
        print('Migration V14.5 et registre valides dans la meme transaction.')
    verify_catalog(query)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(f'ERREUR : {error}', file=sys.stderr)
        sys.exit(1)
