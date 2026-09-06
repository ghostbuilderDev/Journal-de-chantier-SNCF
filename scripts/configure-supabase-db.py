#!/usr/bin/env python3
"""Store the user's PostgreSQL connection in GitHub through hidden local input."""
from pathlib import Path
import getpass
import importlib.util
import subprocess
import sys
from urllib.parse import quote

sys.dont_write_bytecode = True
PROJECT = 'eqfwdcttvnnrakyaacjm'
REPOSITORY = 'ghostbuilderDev/Journal-de-chantier-SNCF'
_spec = importlib.util.spec_from_file_location('journal_deploy', Path(__file__).with_name('deploy-supabase-release.py'))
deploy = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(deploy)


def connection_uri(host, password):
    user = 'postgres' if host == f'db.{PROJECT}.supabase.co' else f'postgres.{PROJECT}'
    uri = f'postgresql://{user}:{quote(password, safe="")}@{host}:5432/postgres?sslmode=require'
    deploy.postgres_environment(uri, PROJECT)
    return uri


def main():
    if not sys.stdin.isatty():
        raise RuntimeError('Ouvrir ce script directement dans Termux pour la saisie masquee.')
    auth = subprocess.run(['gh','auth','status','--hostname','github.com'], capture_output=True, text=True)
    if auth.returncode:
        raise RuntimeError('Connexion GitHub necessaire : lancer gh auth login avant ce script.')
    print('Supabase > Connect > Session pooler : relever le champ Host (port 5432).')
    host = input('Hote uniquement, sans URL ni mot de passe : ').strip().lower()
    connection_uri(host, 'validation-only')  # Validate destination before requesting a secret.
    password = getpass.getpass('Mot de passe PostgreSQL (saisie invisible) : ')
    if not password:
        raise RuntimeError('Mot de passe vide ; aucun secret enregistre.')
    uri = connection_uri(host, password)
    result = subprocess.run(['gh','secret','set','SUPABASE_DB_URL','--repo',REPOSITORY],
                            input=uri, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError('GitHub n’a pas enregistre le secret. Verifier les droits du compte sur le depot avant de reessayer.')
    print('SUPABASE_DB_URL enregistre dans GitHub. Aucune migration executee par ce configurateur.')


if __name__ == '__main__':
    try:
        main()
    except (KeyboardInterrupt, EOFError):
        print('\nConfiguration annulee.', file=sys.stderr)
        sys.exit(1)
    except Exception as error:
        print(f'ERREUR : {error}', file=sys.stderr)
        sys.exit(1)
