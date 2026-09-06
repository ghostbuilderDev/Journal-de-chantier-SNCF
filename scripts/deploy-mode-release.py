#!/usr/bin/env python3
"""Apply V14.4 alone over an already validated V14.2 database."""
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
MIGRATION = '20260906000400_v14_4_mode_chantier.sql'


def main():
    project = os.environ.get('SUPABASE_PROJECT_ID', '')
    dsn = os.environ.get('SUPABASE_DB_URL', '')
    if project != PROJECT or not dsn:
        raise RuntimeError('Projet attendu et secret GitHub SUPABASE_DB_URL requis pour le mode chantier.')
    transport.postgres_environment(dsn, project)
    names = [line.strip() for line in (ROOT / 'supabase/mode-release-migrations.txt').read_text().splitlines()
             if line.strip() and not line.lstrip().startswith('#')]
    if names != [MIGRATION]:
        raise RuntimeError('Cette livraison doit appliquer uniquement la migration V14.4.')
    query = lambda sql: transport.postgres_query(sql, project, dsn)
    rows = query("SELECT EXISTS(SELECT 1 FROM public.journal_sql_migrations WHERE migration_name = '20260906000300_v14_2_contraintes_reelles.sql') AS applied;")
    if len(rows) != 1 or rows[0].get('applied') is not True:
        raise RuntimeError('La migration V14.2 validee doit etre deja appliquee. Aucune ancienne migration relancee.')
    rows = query("SELECT EXISTS(SELECT 1 FROM public.journal_sql_migrations WHERE migration_name = '" + MIGRATION + "') AS applied;")
    if len(rows) != 1 or type(rows[0].get('applied')) is not bool:
        raise RuntimeError('Registre des migrations invalide.')
    if rows[0]['applied']:
        print('V14.4 deja appliquee ; reprise de la configuration et du deploiement push.')
        return
    transaction = transport.build_transaction((ROOT / 'supabase/migrations' / MIGRATION).read_text(), MIGRATION)
    query(transaction)
    print('Migration V14.4 et registre valides dans la meme transaction.')

if __name__ == '__main__':
    try: main()
    except Exception as error:
        print(f'ERREUR : {error}', file=sys.stderr)
        sys.exit(1)
