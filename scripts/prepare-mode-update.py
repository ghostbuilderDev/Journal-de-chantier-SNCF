#!/usr/bin/env python3
"""Exact V14.2/V14.3 upgrade, backend first, with safe interrupted-push resume."""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import tomllib
ROOT = Path(__file__).resolve().parents[1]
BACKEND = [
    '.github/workflows/deploy-supabase-migrations.yml', '.github/workflows/deploy-mode-chantier.yml',
    'supabase/migrations/20260906000400_v14_4_mode_chantier.sql', 'supabase/mode-release-migrations.txt',
    'supabase/config.toml', 'supabase/functions/journal-mode-push/index.ts', 'supabase/functions/journal-mode-push/handler.mjs',
    'supabase/tests/mode-backend-assertions.sql', 'supabase/tests/mode-backend-pglite.cjs',
    'supabase/tests/mode-push.test.cjs', 'supabase/tests/mode-push-crypto.test.cjs',
    'scripts/prepare-mode-update.py', 'scripts/update-mode-termux.sh', 'scripts/wait-mode-workflow.py', 'scripts/configure-mode-chantier.py',
    'scripts/deploy-mode-release.py', 'scripts/mode-base-sha256.json',
    'tests/mode-deploy.test.py', 'tests/mode-deploy-config.test.py', 'tests/mode-workflow.test.py',
]
FRONTEND = ['app-v13.js', 'index.html', 'service-worker-v13.js', 'styles-v14.3.css',
            'mode-chantier.js', 'mode-chantier.css', 'MODE_CHANTIER_V14_4.md', 'tests/mode-worker.test.cjs', 'tests/mode-frontend.test.cjs']
MESSAGES = {'backend': 'Journal Chantier V14.4 - serveur du mode chantier',
            'frontend': 'Journal Chantier V14.4 - mode chantier et notifications'}


def target(repo, name):
    path = repo / name
    if any(part.is_symlink() for part in (path, *path.parents)):
        raise ValueError(f'Lien symbolique refuse : {name}.')
    if path.exists() and not path.is_file():
        raise ValueError(f'Fichier attendu : {name}.')
    return path


def content(repo, name):
    path = target(repo, name)
    return path.read_bytes() if path.exists() else None


def digest(value):
    return hashlib.sha256(value).hexdigest() if value is not None else None


def merge_config(repo):
    name = 'supabase/config.toml'
    current = content(repo, name)
    if current is None: raise ValueError('Configuration Supabase V14.2 absente.')
    source = content(ROOT, name).decode()
    values = tomllib.loads(current.decode())
    if values.get('functions', {}).get('journal-delete-user') != {'verify_jwt': False}:
        raise ValueError('La configuration V14.2 de suppression des comptes a change.')
    found = values.get('functions', {}).get('journal-mode-push')
    desired = tomllib.loads(source)['functions']['journal-mode-push']
    if found is not None:
        if found != desired: raise ValueError('La configuration journal-mode-push existante differe ; fichiers conserves.')
        return current
    block = re.search(r'(?ms)^\[functions\.journal-mode-push\].*?(?=^\[|\Z)', source)
    result = current.decode().rstrip() + '\n\n' + block[0].strip() + '\n'
    tomllib.loads(result)
    return result.encode()


def prepare(repo):
    manifest = json.loads((ROOT / 'scripts/mode-base-sha256.json').read_text())
    changes = {}
    for name in BACKEND + FRONTEND:
        value = content(ROOT, name)
        if value is None: raise ValueError(f'Archive incomplete : {name}.')
        current = content(repo, name)
        if name == 'supabase/config.toml': value = merge_config(repo)
        elif current != value and digest(current) not in manifest.get(name, [None]):
            raise ValueError(f'{name} differe des V14.2/V14.3 validees ; vos modifications sont conservees.')
        changes[name] = value
    # Existing support files are reused by the workflow; all must match the
    # audited baseline even though they are not overwritten by this release.
    for name, accepted in manifest.items():
        if name not in changes and name not in ('styles-v14.3.css',):
            if digest(content(repo, name)) not in accepted:
                raise ValueError(f'Prerequis {name} different ou absent ; mise a jour interrompue.')
    config = content(repo, 'config.js')
    if config is None or b'eqfwdcttvnnrakyaacjm.supabase.co' not in config:
        raise ValueError('config.js absent ou projet inattendu ; configuration conservee.')
    return changes


def git(repo, *args):
    return subprocess.check_output(['git', '-C', str(repo), *args], text=True).strip()


def pending(repo, changes):
    if git(repo, 'rev-list', '--left-right', '--count', 'HEAD...origin/main').split() != ['1', '0']:
        raise ValueError('Commits locaux non publies ou divergence ; vos commits sont conserves.')
    message = git(repo, 'log', '-1', '--format=%B')
    phase = next((name for name, value in MESSAGES.items() if message == value), None)
    selected = BACKEND if phase == 'backend' else FRONTEND if phase == 'frontend' else []
    changed = set(git(repo, 'diff', '--name-only', 'origin/main', 'HEAD').splitlines())
    if not changed or not changed.issubset(selected) or any(content(repo, name) != changes[name] for name in selected):
        raise ValueError('Le commit local ne correspond pas exactement a une phase de cette livraison.')
    print(phase)


def main():
    mode, repo_text = sys.argv[1:3]
    repo = Path(repo_text).resolve()
    if mode.startswith('list-'):
        print('\n'.join(BACKEND if mode == 'list-backend' else FRONTEND))
        return
    changes = prepare(repo)
    if mode == 'check':
        print('V14.2/V14.3 verifiee ; configuration et autres fichiers conserves.')
    elif mode == 'pending': pending(repo, changes)
    elif mode == 'changed': print('yes' if any(content(repo, name) != value for name, value in changes.items()) else 'no')
    elif mode in ('backend', 'frontend'):
        for name in BACKEND if mode == 'backend' else FRONTEND:
            path = target(repo, name)
            path.parent.mkdir(parents=True, exist_ok=True)
            if content(repo, name) != changes[name]: path.write_bytes(changes[name])
        print(f'Fichiers {mode} prepares.')
    else: raise ValueError('Operation inconnue.')

if __name__ == '__main__':
    try: main()
    except Exception as error:
        print(f'ERREUR : {error}', file=sys.stderr)
        sys.exit(1)
