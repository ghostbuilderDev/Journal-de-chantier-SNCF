#!/usr/bin/env python3
"""Prepare the reviewed V15.10.7 frontend without changing configuration or data."""
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FILES = [
    "app-v13.js", "index.html", "service-worker-v13.js",
    "MISE_A_JOUR_V15_10_7.md", "VERSION_V15.10.7.md", "VERIFICATIONS_V15.10.7.txt",
    "tests/v15107-photo-performance.test.py", "scripts/update-v15107-termux.sh",
    "scripts/v15107-base-sha256.json", "scripts/prepare-v15107-update.py",
]
MESSAGE = "Journal Chantier V15.10.7 - photos rapides"

def content(root, name):
    target = root / name
    if any(part.is_symlink() for part in (target, *target.parents)):
        raise ValueError("Lien symbolique refusé : " + name)
    if target.exists() and not target.is_file():
        raise ValueError("Fichier attendu : " + name)
    return target.read_bytes() if target.exists() else None

def digest(value):
    return hashlib.sha256(value).hexdigest() if value is not None else None

def prepare(repo):
    manifest = json.loads((ROOT / "scripts/v15107-base-sha256.json").read_text(encoding="utf-8"))
    changes = {}
    for name in FILES:
        proposed, current = content(ROOT, name), content(repo, name)
        if proposed is None:
            raise ValueError("Archive incomplète : " + name)
        expected = manifest["files"].get(name)
        if current != proposed and digest(current) != expected:
            raise ValueError("Version différente ou fichier modifié : " + name + ". Aucun remplacement effectué.")
        changes[name] = proposed
    for name, expected in manifest["dependencies"].items():
        if digest(content(repo, name)) != expected:
            raise ValueError("Prérequis V15.10.6 différent : " + name + ". Les fichiers sont conservés.")
    if not content(repo, "config.js"):
        raise ValueError("Configuration existante config.js introuvable.")
    return changes

def main():
    mode, repo_text = sys.argv[1:3]
    repo = Path(repo_text).resolve()
    changes = prepare(repo)
    if mode == "files":
        print("\n".join(FILES)); return
    if mode == "check":
        print("V15.10.6 reconnue. Mise à jour interface uniquement."); return
    if mode == "changed":
        print("yes" if any(content(repo, name) != value for name, value in changes.items()) else "no"); return
    if mode == "apply":
        for name, value in changes.items():
            target = repo / name
            target.parent.mkdir(parents=True, exist_ok=True)
            if content(repo, name) != value:
                target.write_bytes(value)
        print("Photos rapides préparées. Configuration et données conservées."); return
    raise ValueError("Opération inconnue.")

if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print("ERREUR : " + str(error), file=sys.stderr)
        sys.exit(1)
