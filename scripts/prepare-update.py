#!/usr/bin/env python3
"""Validate and copy an explicit release file set; preserve unrelated files."""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
import re
import shutil
import sys
import tomllib

ROOT = Path(__file__).resolve().parent.parent
BACKEND = [
    '.github/workflows/deploy-supabase-migrations.yml',
    'supabase/migrations/20260906000100_v14_2_collaborateurs_actions.sql',
    'supabase/migrations/20260906000200_v14_2_schema_production.sql',
    'supabase/release-migrations.txt',
    'supabase/tests/backend-fixture.sql',
    'supabase/tests/backend-assertions.sql',
    'supabase/tests/edge-delete-user.test.cjs',
    'supabase/tests/run-backend-pglite.cjs',
    'supabase/functions/journal-delete-user/index.ts',
    'supabase/config.toml',
    'supabase/README.md',
    'supabase/V14_2_BACKEND_NOTES.md',
    'scripts/deploy-supabase-release.py',
    'scripts/prepare-update.py',
    'scripts/update-termux.sh',
    'scripts/release-base-sha256.json',
    'scripts/release-previous-sha256.json',
    'tests/deploy-transport.test.py',
    'scripts/configure-supabase-db.py',
    'tests/configure-db.test.py',
]
FRONTEND = [
    'app-v13.js', 'styles-v13.css', 'index.html', 'service-worker-v13.js',
    'MISE_A_JOUR_V14_2.md', 'LIRE_EN_PREMIER.md', 'README_TRANSFERT.md',
    'PROMPT_NOUVELLE_DISCUSSION.md', 'INVENTAIRE_SUPABASE.md',
    'tests/admin-ui.test.js', 'tests/feed-session.test.cjs', 'tests/actions.cjs',
    'tests/message-edit.test.cjs', 'tests/release.test.py',
]


def merged_config(source: bytes, target: Path) -> bytes:
    if not target.exists():
        return source
    current = target.read_text()
    values = tomllib.loads(current)
    released = tomllib.loads(source.decode())['functions']['journal-delete-user']
    found = values.get('functions', {}).get('journal-delete-user')
    if found is not None:
        if found != released:
            raise ValueError('La configuration de journal-delete-user existe avec des valeurs differentes.')
        return target.read_bytes()
    block = re.search(r'(?ms)^\[functions\.journal-delete-user\].*?(?=^\[|\Z)', source.decode())
    if not block:
        raise ValueError('Configuration de la fonction absente de la livraison.')
    result = current.rstrip() + '\n\n' + block[0].strip() + '\n'
    tomllib.loads(result)
    return result.encode()


def safe_target(repo: Path, relative: str) -> Path:
    target = repo / relative
    if any(item.is_symlink() for item in [target, *target.parents] if item != repo.parent):
        raise ValueError(f'Lien symbolique refuse pour {relative}.')
    if target.exists() and not target.is_file():
        raise ValueError(f'Fichier attendu mais autre objet trouve : {relative}.')
    return target


def known_hashes(manifest: dict, relative: str) -> set[str]:
    value = manifest.get(relative)
    if isinstance(value, str):
        return {value}
    if isinstance(value, list) and all(isinstance(item, str) for item in value):
        return set(value)
    return set()


def prepare(repo: Path):
    base = json.loads((ROOT / 'scripts/release-base-sha256.json').read_text())
    previous_path = ROOT / 'scripts/release-previous-sha256.json'
    previous = json.loads(previous_path.read_text()) if previous_path.is_file() else {}
    changes = {}
    for relative in BACKEND + FRONTEND:
        source = ROOT / relative
        if not source.is_file() or source.is_symlink():
            raise ValueError(f'Archive incomplete : {relative}.')
        target = safe_target(repo, relative)
        content = source.read_bytes()
        if relative == 'supabase/config.toml':
            content = merged_config(content, target)
        elif target.exists():
            digest = hashlib.sha256(target.read_bytes()).hexdigest()
            accepted = known_hashes(base, relative) | known_hashes(previous, relative)
            if target.read_bytes() != content and digest not in accepted:
                raise ValueError(f'{relative} differe des versions V14.1/V14.2 fournies. '
                                 'Mise a jour interrompue pour conserver vos autres modifications ; '
                                 'transmettez une nouvelle archive du depot pour les integrer.')
        changes[relative] = content
    config = repo / 'config.js'
    if not config.is_file() or 'eqfwdcttvnnrakyaacjm.supabase.co' not in config.read_text():
        raise ValueError('config.js absent ou projet Supabase different ; aucune configuration remplacee.')
    return changes


def main():
    mode, repo_text = sys.argv[1:3]
    repo = Path(repo_text).resolve()
    if mode == 'list-backend':
        print('\n'.join(BACKEND))
        return
    if mode == 'list-frontend':
        print('\n'.join(FRONTEND))
        return
    changes = prepare(repo)
    if mode == 'check':
        print('Fichiers verifies : config.js et fichiers hors livraison conserves.')
        return
    selected = BACKEND if mode == 'backend' else FRONTEND if mode == 'frontend' else None
    if selected is None:
        raise ValueError('Mode de preparation inconnu.')
    for relative in selected:
        target = safe_target(repo, relative)
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists() or target.read_bytes() != changes[relative]:
            target.write_bytes(changes[relative])
    print(f'Fichiers {mode} prepares.')


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print(f'ERREUR : {exc}', file=sys.stderr)
        sys.exit(1)
