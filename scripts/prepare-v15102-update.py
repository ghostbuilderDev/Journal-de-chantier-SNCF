#!/usr/bin/env python3
"""Bounded V15.9/V15.10/V15.10.1 -> V15.10.2 installation, repeatable backend-first phases."""
import hashlib,json,subprocess,sys
from pathlib import Path
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[1]
BACKEND=['supabase/migrations/20260910000300_v15_10_rapports_mentions.sql', 'supabase/tests/reports-v1510-backend.cjs', 'supabase/tests/reports-v1510-postgres.sql', 'supabase/tests/reports-v1510-deployment.cjs', 'scripts/deploy-v1510-release.py', 'tests/v1510-deployment.test.py', 'supabase/migrations/20260910000400_v15_10_1_signatures_notifications.sql', 'supabase/tests/collaboration-v15101-backend.cjs', 'supabase/tests/collaboration-v15101-postgres.sql', 'supabase/tests/collaboration-v15101-deployment.cjs', 'scripts/deploy-v15101-release.py', 'scripts/prepare-v15101-update.py', 'scripts/update-v15101-termux.sh', 'scripts/wait-v15101-workflow.py', 'scripts/v15101-base-sha256.json', 'tests/v15101-deployment.test.py', 'tests/v15101-installation.test.py', '.github/workflows/deploy-v15102.yml', 'scripts/prepare-v15102-update.py', 'scripts/update-v15102-termux.sh', 'scripts/wait-v15102-workflow.py', 'scripts/v15102-base-sha256.json', 'tests/v15102-installation.test.py']
FRONTEND=['app-v13.js', 'index.html', 'service-worker-v13.js', 'cr-off.js', 'journal-collaboration.js', 'journal-v1510.css', 'tests/collaboration-v1510-browser.cjs', 'rapport/app.js', 'rapport/assets/ainm-infrapole-paris-sud-est.jpg', 'rapport/collaboration.css', 'rapport/collaboration.js', 'rapport/data/billing-evidence.js', 'rapport/data/price-catalog.js', 'rapport/data/terrain-catalog.js', 'rapport/icons/icon.svg', 'rapport/icons/rapport-journalier-ainm-pwa.png', 'rapport/icons/rapport-journalier-ainm.png', 'rapport/index.html', 'rapport/journal-archive.js', 'rapport/journal-config.js', 'rapport/manifest.webmanifest', 'rapport/service-worker.js', 'rapport/styles.css', 'rapport/vendor/pdf-lib.min.js', 'rapport/vendor/supabase.js', 'briefing/index.html', 'briefing/service-worker.js', 'briefing/signer.html', 'briefing/signer.js', 'briefing/signature-pad.js', 'briefing/signer-v15101.css', 'tests/collaboration-v15101-browser.cjs', 'tests/signature-v15101-browser.cjs', 'tests/pwa-v15101-browser.cjs', 'VERSION_V15.10.1.md', 'VERIFICATIONS_V15.10.1.txt', 'briefing/briefing-attendance.js', 'briefing/presence-matching.js', 'briefing/presence-review.js', 'briefing/presence-review.css', 'tests/signature-v15102-browser.cjs', 'tests/presence-matching-v15102.cjs', 'tests/pwa-v15102-browser.cjs', 'VERSION_V15.10.2.md', 'VERIFICATIONS_V15.10.2.txt']
MESSAGES={'backend':'Journal Chantier V15.10.2 - serveur cumulatif verifie','frontend':'Journal Chantier V15.10.2 - rapprochement des signatures QR'}

def target(repo,name):
    p=repo/name
    if any(x.is_symlink() for x in (p,*p.parents)):raise ValueError('Lien symbolique refusé : '+name)
    if p.exists() and not p.is_file():raise ValueError('Fichier attendu : '+name)
    return p

def content(repo,name):
    p=target(repo,name);return p.read_bytes() if p.exists() else None

def digest(data):return hashlib.sha256(data).hexdigest() if data is not None else None

def validate_change(name,current,proposed,expected,previous=()):
    if proposed is None:raise ValueError('Archive incomplète : '+name)
    if current!=proposed and digest(current)!=expected and digest(current) not in previous:
        raise ValueError(name+' a changé depuis la version vérifiée. Vos modifications sont conservées ; il faut réadapter cette livraison.')

def prepare(repo):
    manifest=json.loads((ROOT/'scripts/v15102-base-sha256.json').read_text());changes={}
    for name in BACKEND+FRONTEND:
        proposed=content(ROOT,name);current=content(repo,name)
        validate_change(name,current,proposed,manifest['files'].get(name),manifest.get('previous_files',{}).get(name,()))
        changes[name]=proposed
    for name,expected in manifest['dependencies'].items():
        if digest(content(repo,name))!=expected:raise ValueError('Prérequis modifié : '+name+'. Aucune ancienne version ne sera réinstallée.')
    config=content(repo,'config.js')
    if not config or b'eqfwdcttvnnrakyaacjm.supabase.co' not in config:raise ValueError('Configuration du projet Supabase attendu requise.')
    return changes

def git(repo,*args):return subprocess.check_output(['git','-C',str(repo),*args],text=True).strip()

def pending(repo,changes):
    if git(repo,'rev-list','--left-right','--count','HEAD...origin/main').split()!=['1','0']:raise ValueError('Des commits locaux non publiés existent ; ils sont conservés.')
    message=git(repo,'log','-1','--format=%B');phase=next((k for k,v in MESSAGES.items() if message==v),None)
    selected=BACKEND if phase=='backend' else FRONTEND if phase=='frontend' else []
    names=set(git(repo,'diff','--name-only','origin/main','HEAD').splitlines())
    if not names or not names.issubset(selected) or any(content(repo,name)!=changes[name] for name in selected):raise ValueError('Le commit local ne correspond pas exactement à cette livraison.')
    print(phase)

def main():
    mode,repo_text=sys.argv[1:3];repo=Path(repo_text).resolve()
    if mode in ('list-backend','list-frontend'):print('\n'.join(BACKEND if mode=='list-backend' else FRONTEND));return
    changes=prepare(repo)
    if mode=='check':print('Version reconnue ; configuration et données existantes conservées.')
    elif mode=='pending':pending(repo,changes)
    elif mode=='changed':print('yes' if any(content(repo,k)!=v for k,v in changes.items()) else 'no')
    elif mode in ('backend','frontend'):
        for name in BACKEND if mode=='backend' else FRONTEND:
            p=target(repo,name);p.parent.mkdir(parents=True,exist_ok=True)
            if content(repo,name)!=changes[name]:p.write_bytes(changes[name])
        print('Fichiers '+mode+' préparés.')
    else:raise ValueError('Opération inconnue.')

if __name__=='__main__':
    try:main()
    except Exception as e:print('ERREUR : '+str(e),file=sys.stderr);sys.exit(1)
