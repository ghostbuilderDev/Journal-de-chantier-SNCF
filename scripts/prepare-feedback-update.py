#!/usr/bin/env python3
"""Add the feedback module to the installed UI, preserving V14.2/V14.3/V14.4."""
from __future__ import annotations
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
PATCHED = ['app-v13.js', 'index.html', 'service-worker-v13.js']
BACKEND = [
    '.github/workflows/deploy-feedback.yml',
    'supabase/migrations/20260907000500_v14_5_retours_application.sql',
    'supabase/feedback-release-migrations.txt',
    'supabase/tests/feedback-backend-fixture.sql',
    'supabase/tests/feedback-backend-assertions.sql',
    'supabase/tests/feedback-backend-pglite.cjs',
    'scripts/prepare-feedback-update.py', 'scripts/update-feedback-termux.sh',
    'scripts/deploy-feedback-release.py', 'scripts/wait-feedback-workflow.py',
    'scripts/feedback-base-sha256.json', 'scripts/feedback-ui-patch.py',
    'tests/feedback-deploy.test.py', 'tests/feedback-deploy-release.test.py',
    'tests/feedback-workflow.test.py',
]
FRONTEND = PATCHED + ['feedback.js', 'feedback.css', 'FEEDBACK_V14_5.md', 'tests/feedback-ui.test.cjs']
MESSAGES = {'backend': 'Journal Chantier V14.5 - serveur des retours application',
            'frontend': 'Journal Chantier V14.5 - fil des ameliorations application'}


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


def prepare(repo):
    manifest = json.loads((ROOT / 'scripts/feedback-base-sha256.json').read_text())
    spec = importlib.util.spec_from_file_location('feedback_ui_patch', ROOT / 'scripts/feedback-ui-patch.py')
    patch = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(patch)
    changes = {}
    for name in BACKEND + FRONTEND:
        value = content(ROOT, name)
        if value is None:
            raise ValueError(f'Archive incomplete : {name}.')
        current = content(repo, name)
        if name in PATCHED:
            if current is None or digest(current) not in manifest.get(name, []):
                raise ValueError(f'{name} differe des interfaces validees ; vos modifications sont conservees.')
            value = patch.patch_file(name, current)
        elif current != value and digest(current) not in manifest.get(name, [None]):
            raise ValueError(f'{name} differe de la livraison attendue ; vos modifications sont conservees.')
        changes[name] = value
    # Check only reused deployment dependencies. Other modules and configuration
    # are not copied, normalized or changed by this independent release.
    for name, accepted in manifest.items():
        if name not in changes and digest(content(repo, name)) not in accepted:
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
        print('Interface V14.2/V14.3/V14.4 reconnue ; seul le fil des ameliorations sera ajoute.')
    elif mode == 'pending':
        pending(repo, changes)
    elif mode == 'changed':
        print('yes' if any(content(repo, name) != value for name, value in changes.items()) else 'no')
    elif mode in ('backend', 'frontend'):
        for name in BACKEND if mode == 'backend' else FRONTEND:
            path = target(repo, name)
            path.parent.mkdir(parents=True, exist_ok=True)
            if content(repo, name) != changes[name]:
                path.write_bytes(changes[name])
        print(f'Fichiers {mode} prepares.')
    else:
        raise ValueError('Operation inconnue.')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(f'ERREUR : {error}', file=sys.stderr)
        sys.exit(1)
