#!/usr/bin/env python3
"""Install only the reviewed V15.10.6 frontend on V15.10.5. No SQL writes."""
import hashlib
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FILES = [
    'app-v13.js', 'index.html', 'journal-composer.js', 'journal-albums.css',
    'service-worker-v13.js', 'tests/messages-v1571-browser.cjs',
    'tests/photo-albums-v15106.cjs', 'tests/v15106-installation.test.py',
    'scripts/prepare-v15106-update.py', 'scripts/update-v15106-termux.sh',
    'scripts/v15106-base-sha256.json', 'VERSION_V15.10.6.md',
    'VERIFICATIONS_V15.10.6.txt',
]
MESSAGE = 'Journal Chantier V15.10.6 - albums photos'

def content(root, name):
    target = root / name
    if any(p.is_symlink() for p in (target, *target.parents)):
        raise ValueError('Lien symbolique refusé : ' + name)
    if target.exists() and not target.is_file():
        raise ValueError('Fichier attendu : ' + name)
    return target.read_bytes() if target.exists() else None

def digest(value):
    return hashlib.sha256(value).hexdigest() if value is not None else None

def prepare(repo):
    manifest = json.loads((ROOT / 'scripts/v15106-base-sha256.json').read_text())
    changes = {}
    for name in FILES:
        proposed, current = content(ROOT, name), content(repo, name)
        if proposed is None:
            raise ValueError('Archive incomplète : ' + name)
        if current != proposed and digest(current) != manifest['files'][name]:
            raise ValueError('Version différente ou fichier modifié : ' + name + '. Aucun remplacement effectué.')
        changes[name] = proposed
    for name, expected in manifest['dependencies'].items():
        if digest(content(repo, name)) != expected:
            raise ValueError('Prérequis V15.10.5 différent : ' + name + '. Les fichiers sont conservés.')
    if not content(repo, 'config.js'):
        raise ValueError('Configuration existante config.js introuvable.')
    return changes

def git(repo, *args):
    return subprocess.check_output(['git', '-C', str(repo), *args], text=True).strip()

def main():
    mode, repo_text = sys.argv[1:3]
    repo = Path(repo_text).resolve()
    if mode == 'files':
        print('\n'.join(FILES)); return
    changes = prepare(repo)
    if mode == 'check':
        print('V15.10.5 reconnue. Mise à jour de l’interface uniquement.')
    elif mode == 'changed':
        print('yes' if any(content(repo, k) != v for k, v in changes.items()) else 'no')
    elif mode == 'worktree':
        names = set(git(repo, 'diff', '--name-only', 'HEAD').splitlines()) | set(git(repo, 'ls-files', '--others', '--exclude-standard').splitlines())
        if not names or not names.issubset(FILES) or any(content(repo, n) != changes[n] for n in names):
            raise ValueError('Modifications locales non reconnues : conservées.')
        print('Copie interrompue de cette livraison reconnue ; reprise possible.')
    elif mode == 'pending':
        if git(repo, 'rev-list', '--left-right', '--count', 'HEAD...origin/main').split() != ['1', '0']:
            raise ValueError('Commits locaux non reconnus : conservés.')
        names = set(git(repo, 'diff', '--name-only', 'origin/main', 'HEAD').splitlines())
        if git(repo, 'log', '-1', '--format=%B') != MESSAGE or not names or not names.issubset(FILES) or any(content(repo, n) != changes[n] for n in FILES):
            raise ValueError('Le commit en attente ne correspond pas à cette livraison.')
        print('Commit de cette livraison reconnu.')
    elif mode == 'apply':
        # All files and prerequisites were checked before the first write.
        for name, proposed in changes.items():
            target = repo / name
            target.parent.mkdir(parents=True, exist_ok=True)
            if content(repo, name) != proposed:
                target.write_bytes(proposed)
        print('Albums photos préparés. Configuration et données conservées.')
    else:
        raise ValueError('Opération inconnue.')

if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('ERREUR : ' + str(error), file=sys.stderr)
        sys.exit(1)
