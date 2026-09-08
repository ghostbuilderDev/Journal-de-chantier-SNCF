#!/usr/bin/env python3
"""Reuse the stable VAPID identity; email credentials remain server-only."""
import importlib.util,os,subprocess,sys,tempfile,urllib.request,urllib.error
from pathlib import Path
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('mode_config',ROOT/'scripts/configure-mode-chantier.py')
mode=importlib.util.module_from_spec(spec);spec.loader.exec_module(mode)

def run(command):
    try:r=subprocess.run(command,capture_output=True,text=True,timeout=180)
    except Exception:raise RuntimeError('Déploiement Supabase interrompu. Relancer la même commande.') from None
    if r.returncode:raise RuntimeError('Supabase a refusé le déploiement. Vérifier le jeton et les droits du projet ; aucun secret affiché.')

def main():
    if os.environ.get('SUPABASE_PROJECT_ID')!=mode.PROJECT or not os.environ.get('SUPABASE_ACCESS_TOKEN'):
        raise RuntimeError('Projet et jeton Supabase requis.')
    # Same routine as the installed mode: generates keys ONLY if none exist,
    # persists them before transfer and never rotates an existing identity.
    mode.provision()
    for function in ['journal-mode-push','journal-v15-push','journal-cr-send']:
        run(['supabase','functions','deploy',function,'--project-ref',mode.PROJECT,'--no-verify-jwt'])
    key,source=os.environ.get('RESEND_API_KEY',''),os.environ.get('JOURNAL_CR_FROM','')
    if bool(key)!=bool(source):raise RuntimeError('Fournir ensemble RESEND_API_KEY et JOURNAL_CR_FROM, ou conserver la configuration email existante.')
    if key:
        if '\n' in key or '\r' in key or '\n' in source or '\r' in source or '@' not in source:
            raise RuntimeError('Configuration email invalide.')
        with tempfile.TemporaryDirectory(prefix='journal-cr-secrets-') as directory:
            p=Path(directory)/'email.env';fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
            with os.fdopen(fd,'w') as f:f.write('RESEND_API_KEY='+key+'\nJOURNAL_CR_FROM='+source+'\n')
            run(['supabase','secrets','set','--env-file',str(p),'--project-ref',mode.PROJECT])
    # Anonymous dispatch must be refused by the deployed endpoints.
    for function in ['journal-v15-push','journal-cr-send']:
        req=urllib.request.Request(f'https://{mode.PROJECT}.supabase.co/functions/v1/{function}',data=b'{}',headers={'Content-Type':'application/json'},method='POST')
        try:
            with urllib.request.urlopen(req,timeout=20) as response:code=response.status
        except urllib.error.HTTPError as error:code=error.code
        if code not in (401,403):raise RuntimeError('Protection de la fonction '+function+' non confirmée.')
    mode.activate()
    mode.query("select cron.schedule('journal-v15-notifications','* * * * *','select journal_cr_private.kick()'); select cron.schedule('journal-v15-notifications-cleanup','35 0 * * *','select journal_cr_private.maintenance()');")
    print('Notifications V15 actives. Fonctions email et push installées.')
    if not key:print('Configuration email existante conservée. Si absente, ajouter RESEND_API_KEY et JOURNAL_CR_FROM avant le premier envoi.')

if __name__=='__main__':
    try:main()
    except Exception as error:
        # Neither raw CLI output nor provider/SQL exception bodies are printed.
        print('Configuration V15 interrompue : '+(str(error) if isinstance(error,RuntimeError) else type(error).__name__),file=sys.stderr);sys.exit(1)
