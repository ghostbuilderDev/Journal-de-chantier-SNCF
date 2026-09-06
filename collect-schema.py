#!/usr/bin/env python3
"""GitHub runner: catalog SELECT only, in a PostgreSQL read-only transaction."""
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import parse_qs, quote, quote_plus, unquote, urlsplit

PROJECT = 'eqfwdcttvnnrakyaacjm'


def connection_environment(dsn, project):
    if project != PROJECT:
        raise RuntimeError('Projet Supabase absent ou different du projet attendu.')
    try:
        uri = urlsplit(dsn)
        host, port = uri.hostname or '', uri.port or 5432
        user, password = unquote(uri.username or ''), unquote(uri.password or '')
        options = parse_qs(uri.query, strict_parsing=True)
    except (ValueError, UnicodeError):
        raise RuntimeError('Secret SUPABASE_DB_URL invalide.') from None
    direct = host == f'db.{PROJECT}.supabase.co' and user == 'postgres'
    pooler = re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*\.pooler\.supabase\.com', host) and user == f'postgres.{PROJECT}'
    if (uri.scheme not in ('postgres', 'postgresql') or not (direct or pooler)
            or port != 5432 or unquote(uri.path) != '/postgres' or uri.fragment or not password
            or any('\x00' in x for x in (host, user, password))):
        raise RuntimeError('La connexion doit cibler le projet attendu, port de session 5432.')
    allowed = {'sslmode': 'PGSSLMODE', 'sslrootcert': 'PGSSLROOTCERT',
               'sslcert': 'PGSSLCERT', 'sslkey': 'PGSSLKEY'}
    if any(k not in allowed or len(v) != 1 for k, v in options.items()):
        raise RuntimeError('Options de connexion non reconnues.')
    sslmode = options.get('sslmode', ['require'])[0]
    if sslmode not in ('require', 'verify-ca', 'verify-full'):
        raise RuntimeError('TLS est obligatoire pour ce diagnostic.')
    # No secret URL/password on the command line. Clear inherited libpq options.
    env = {k: v for k, v in os.environ.items()
           if not k.startswith('PG') and not k.startswith('SUPABASE_')}
    env.update(PGHOST=host, PGPORT='5432', PGUSER=user, PGPASSWORD=password,
               PGDATABASE='postgres', PGSSLMODE=sslmode, PGCONNECT_TIMEOUT='20',
               PGAPPNAME='journal-schema-readonly')
    for k, variable in allowed.items():
        if k in options:
            env[variable] = options[k][0]
    return env


def redact(text, dsn, password):
    variants = {dsn, password, quote(password), quote(password, safe=''), quote_plus(password)}
    for value in sorted(filter(None, variants), key=len, reverse=True):
        text = text.replace(value, '[secret masque]')
    return text


def collect(root):
    dsn = os.environ.get('SUPABASE_DB_URL', '')
    env = connection_environment(dsn, os.environ.get('SUPABASE_PROJECT_ID', ''))
    sql = (root / 'schema-readonly.sql').read_text(encoding='utf-8')
    try:
        result = subprocess.run(
            ['psql', '--no-psqlrc', '--no-password', '--quiet', '--no-align',
             '--tuples-only', '--set=ON_ERROR_STOP=1', '--file=-'],
            input=sql, env=env, capture_output=True, text=True, timeout=60)
    except subprocess.TimeoutExpired:
        raise RuntimeError('Delai de lecture PostgreSQL depasse ; aucune migration executee.') from None
    if result.returncode:
        detail = redact(result.stderr, dsn, env['PGPASSWORD'])
        detail = re.sub(r'[\x00-\x08\x0b-\x1f\x7f]', '', detail)[:1400]
        raise RuntimeError('Diagnostic interrompu : ' + detail)
    try:
        report = json.loads(result.stdout)
    except (ValueError, TypeError):
        raise RuntimeError('Reponse du diagnostic invalide ; aucun contenu brut affiche.') from None
    if (not isinstance(report, dict) or report.get('schema_version') != 1
            or report.get('transaction_read_only') != 'on'):
        raise RuntimeError('Le diagnostic ne confirme pas la lecture seule.')
    for key in ('tables', 'columns', 'constraints', 'indexes', 'triggers', 'functions'):
        if not isinstance(report.get(key), list):
            raise RuntimeError('Structure de rapport incomplete : ' + key)
    report['project_ref'] = PROJECT
    report['diagnostic_commit'] = os.environ.get('GITHUB_SHA', '')
    payload = json.dumps(report, ensure_ascii=False, indent=2) + '\n'
    if redact(payload, dsn, env['PGPASSWORD']) != payload:
        raise RuntimeError('Une valeur sensible a ete detectee ; aucun rapport publie.')
    target = root / 'diagnostic-output'
    target.mkdir(exist_ok=True)
    (target / 'Diagnostic-Supabase.json').write_text(payload, encoding='utf-8')
    print('Lecture du schema terminee. Aucune ligne metier lue et aucune migration executee.')


if __name__ == '__main__':
    try:
        collect(Path(__file__).resolve().parent)
    except Exception as exc:
        # Never expose a Python traceback containing connector data.
        print('ERREUR : ' + str(exc), file=sys.stderr)
        sys.exit(1)
