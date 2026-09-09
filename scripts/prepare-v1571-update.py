#!/usr/bin/env python3
"""Bounded V15.7.1 messaging hotfix; no database or secret changes."""
import hashlib,json,subprocess,sys
from pathlib import Path
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[1]
FILES=['app-v13.js','index.html','journal-composer.js','journal-v156.css','service-worker-v13.js',
       'tests/messages-v1571-browser.cjs','scripts/prepare-v1571-update.py',
       'scripts/update-v1571-termux.sh','scripts/v1571-base-sha256.json','VERSION_V15.7.1.md','VERIFICATIONS_V15.7.1.txt']
MESSAGE='Journal Chantier V15.7.1 - communication retablie pour les contributeurs'

def target(repo,name):
    p=repo/name
    if any(x.is_symlink() for x in (p,*p.parents)):raise ValueError('Lien symbolique refuse : '+name)
    if p.exists() and not p.is_file():raise ValueError('Fichier attendu : '+name)
    return p

def content(repo,name):
    p=target(repo,name);return p.read_bytes() if p.exists() else None

def digest(data):return hashlib.sha256(data).hexdigest() if data is not None else None

def prepare(repo):
    manifest=json.loads((ROOT/'scripts/v1571-base-sha256.json').read_text());changes={}
    for name in FILES:
        proposed=content(ROOT,name);current=content(repo,name)
        if proposed is None:raise ValueError('Archive incomplete : '+name)
        if current!=proposed and digest(current)!=manifest['files'][name]:
            raise ValueError(name+' differe de la V15.7 verifiee. Vos modifications sont conservees ; ce correctif doit etre adapte a votre version.')
        changes[name]=proposed
    for name,expected in manifest['dependencies'].items():
        if digest(content(repo,name))!=expected:raise ValueError('Prerequis modifie : '+name)
    config=content(repo,'config.js')
    if not config or b'eqfwdcttvnnrakyaacjm.supabase.co' not in config:raise ValueError('Configuration du projet Journal de chantier attendu requise.')
    return changes

def git(repo,*args):return subprocess.check_output(['git','-C',str(repo),*args],text=True).strip()

def main():
    mode,repo_text=sys.argv[1:3];repo=Path(repo_text).resolve()
    if mode=='list':print('\n'.join(FILES));return
    changes=prepare(repo)
    if mode=='check':print('V15.7 reconnue. Correctif de communication uniquement ; aucune migration Supabase.')
    elif mode=='changed':print('yes' if any(content(repo,k)!=v for k,v in changes.items()) else 'no')
    elif mode=='pending':
        if git(repo,'rev-list','--left-right','--count','HEAD...origin/main').split()!=['1','0'] or git(repo,'log','-1','--format=%B')!=MESSAGE:
            raise ValueError('Des commits locaux non publies existent ; ils sont conserves.')
        names=set(git(repo,'diff','--name-only','origin/main','HEAD').splitlines())
        if not names or not names.issubset(FILES) or any(content(repo,k)!=v for k,v in changes.items()):
            raise ValueError('Le commit local ne correspond pas exactement a cette livraison.')
        print('Reprise du correctif V15.7.1 verifie.')
    elif mode=='apply':
        for name,data in changes.items():
            p=target(repo,name);p.parent.mkdir(parents=True,exist_ok=True)
            if content(repo,name)!=data:p.write_bytes(data)
        print('Correctif V15.7.1 prepare.')
    else:raise ValueError('Operation inconnue.')

if __name__=='__main__':
    try:main()
    except Exception as e:print('ERREUR : '+str(e),file=sys.stderr);sys.exit(1)
