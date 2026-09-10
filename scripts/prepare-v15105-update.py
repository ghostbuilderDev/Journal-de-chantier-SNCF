#!/usr/bin/env python3
"""Cumulative V15.10.5 recovery, backend checked before the interface."""
import hashlib,json,subprocess,sys
from pathlib import Path
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[1]
BACKEND=['supabase/migrations/20260910000500_v15_10_4_report_numbers.sql', 'supabase/tests/report-numbering-fixture.sql', 'supabase/tests/report-numbering-v15104-backend.cjs', 'supabase/tests/report-numbering-v15104-deployment.cjs', 'supabase/tests/report-numbering-v15104-postgres.sql', 'scripts/deploy-v15104-release.py', '.github/workflows/deploy-v15104.yml', 'scripts/prepare-v15104-update.py', 'scripts/update-v15104-termux.sh', 'scripts/wait-v15104-workflow.py', 'scripts/v15104-base-sha256.json', 'tests/v15104-installation.test.py', 'scripts/prepare-v15105-update.py', 'scripts/update-v15105-termux.sh', 'scripts/v15105-base-sha256.json', 'tests/v15105-installation.test.py', 'supabase/migrations/20260910000600_v15_10_5_report_archive_acl.sql', 'supabase/tests/report-numbering-v15105-recovery.cjs']
FRONTEND=['rapport/app.js', 'rapport/collaboration.js', 'rapport/index.html', 'rapport/journal-archive.js', 'rapport/service-worker.js', 'tests/collaboration-v15101-browser.cjs', 'tests/report-numbering-v15104-browser.cjs', 'tests/pwa-v15104-browser.cjs', 'VERSION_V15.10.4.md', 'VERIFICATIONS_V15.10.4.txt', 'rapport/collaboration.css', 'rapport/report-actions.js', 'tests/report-actions-helpers.cjs', 'tests/report-actions-v15105.cjs', 'VERSION_V15.10.5.md', 'VERIFICATIONS_V15.10.5.txt']
MESSAGES={'backend':'Journal Chantier V15.10.5 - correction des droits d archivage','frontend':'Journal Chantier V15.10.5 - menu flottant des actions du rapport'}

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
        raise ValueError(name+' ne correspond pas à une V15.10.3, V15.10.4 ou V15.10.5 vérifiée. Les fichiers sont conservés ; ce correctif doit être adapté à votre version.')

def prepare(repo):
    manifest=json.loads((ROOT/'scripts/v15105-base-sha256.json').read_text());changes={}
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
