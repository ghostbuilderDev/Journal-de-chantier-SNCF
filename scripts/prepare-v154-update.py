#!/usr/bin/env python3
"""Bounded V15.3 -> V15.4 installation, repeatable backend-first phases."""
import hashlib,json,subprocess,sys
from pathlib import Path
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[1]
BACKEND=['.github/workflows/deploy-v154.yml', '.github/workflows/configure-email-v154.yml', 'supabase/migrations/20260909000200_v15_4_production_email.sql', 'supabase/functions/_shared/cr-email.mjs', 'supabase/functions/journal-cr-send-v154/index.ts', 'supabase/functions/journal-cr-send-v154/handler.mjs', 'supabase/tests/cr-v154-backend.cjs', 'supabase/tests/cr-v154-postgres.sql', 'supabase/tests/cr-v154-retrofit.cjs', 'supabase/tests/cr-v154-email.test.cjs', 'scripts/deploy-v154-release.py', 'scripts/configure-v154-email.py', 'scripts/configure-v154-email-termux.sh', 'scripts/prepare-v154-update.py', 'scripts/wait-v154-workflow.py', 'scripts/update-v154-termux.sh', 'scripts/v154-base-sha256.json', 'tests/v154-installation.test.py', 'tests/v154-deployment.test.py', 'supabase/tests/cr-v154-deployment.cjs']
FRONTEND=['app-v13.js', 'cr-off.js', 'feedback.js', 'briefing-integration.js', 'briefing/index.html', 'index.html', 'service-worker-v13.js', 'journal-dialogs.js', 'journal-feed.js', 'journal-production.js', 'journal-export.js', 'journal-v154.css', 'tests/cr-v154-browser.cjs', 'VERSION_V15.4.md', 'VERIFICATIONS_V15.4.txt']
MESSAGES={'backend': 'Journal Chantier V15.4 - production partagee et email', 'frontend': 'Journal Chantier V15.4 - actions uniques CR et impression'}

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
    manifest=json.loads((ROOT/'scripts/v154-base-sha256.json').read_text());changes={}
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
