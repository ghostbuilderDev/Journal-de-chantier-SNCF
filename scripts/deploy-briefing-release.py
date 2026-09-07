#!/usr/bin/env python3
"""Apply the briefing migration using the existing protected database transport."""
import importlib.util
import os
import re
import urllib.parse
from pathlib import Path
import sys
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('transport', ROOT / 'scripts/deploy-supabase-release.py')
transport = importlib.util.module_from_spec(spec)
spec.loader.exec_module(transport)
NAME = '20260907000600_briefing_archive.sql'
def is_ready(rows):
    # psql --csv fournit "t"/"f" ; le transport ne convertit que "applied".
    if len(rows) != 1 or 'ready' not in rows[0]:
        raise RuntimeError('Réponse de vérification Supabase invalide.')
    value = rows[0]['ready']
    if value is True or value in ('t', 'true'):
        return True
    if value is False or value in ('f', 'false'):
        return False
    raise RuntimeError('Valeur de vérification Supabase inattendue.')

def safe_error(error):
    # Aucun traceback, URL de connexion ou mot de passe dans les logs.
    detail = str(error) if isinstance(error, RuntimeError) else 'Erreur interne de l’installateur (' + type(error).__name__ + ').'
    dsn = os.environ.get('SUPABASE_DB_URL', '')
    secrets = [dsn, os.environ.get('SUPABASE_ACCESS_TOKEN', '')]
    try:
        password = urllib.parse.unquote(urllib.parse.urlsplit(dsn).password or '')
        secrets += [password, urllib.parse.quote(password), urllib.parse.quote(password, safe=''), urllib.parse.quote_plus(password)]
    except ValueError:
        pass
    for value in sorted(set(filter(None, secrets)), key=len, reverse=True):
        detail = detail.replace(value, '[secret masqué]')
    return re.sub(r'[\x00-\x08\x0b-\x1f\x7f]', '', detail)[:2400]

def main():
    project, dsn = os.environ.get('SUPABASE_PROJECT_ID',''), os.environ.get('SUPABASE_DB_URL','')
    if project != 'eqfwdcttvnnrakyaacjm' or not dsn:
        raise RuntimeError('Projet attendu et secret SUPABASE_DB_URL requis.')
    transport.postgres_environment(dsn, project)
    query = lambda sql: transport.postgres_query(sql, project, dsn)
    if not is_ready(query("select to_regprocedure('public.journal_v142_can_write(uuid)') is not null and to_regclass('public.chantier_document_folders') is not null as ready")):
        raise RuntimeError('Journal V14.2 et bibliothèque documentaire requis.')
    # SQL is idempotent and its registry update is in the same transaction.
    applied = query("select exists(select 1 from public.journal_sql_migrations where migration_name='" + NAME + "') as applied")[0]['applied']
    if not applied:
        query(transport.build_transaction((ROOT/'supabase/migrations'/NAME).read_text(), NAME))
    result = query("select has_function_privilege('authenticated','public.journal_archive_briefing(uuid,uuid,text,bigint)','EXECUTE') and not has_function_privilege('anon','public.journal_archive_briefing(uuid,uuid,text,bigint)','EXECUTE') as ready")
    if not is_ready(result): raise RuntimeError('Droits de la fonction non validés.')
    query("NOTIFY pgrst, 'reload schema';")
    print('Archivage briefing installé et droits vérifiés. Actualisation API demandée.')
if __name__ == '__main__':
    try: main()
    except Exception as exc:
        print('Installation interrompue : ' + safe_error(exc), file=sys.stderr)
        sys.exit(1)
