#!/usr/bin/env python3
"""One-time secrets transfer. No email is sent, no database migration is replayed."""
import os,re,subprocess,tempfile
from pathlib import Path

def configure():
    project=os.environ.get('SUPABASE_PROJECT_ID','')
    if project!='eqfwdcttvnnrakyaacjm' or not os.environ.get('SUPABASE_ACCESS_TOKEN'):
        raise RuntimeError('Secrets Supabase du journal requis.')
    values={k:os.environ.get(k,'') for k in ('RESEND_API_KEY','JOURNAL_CR_FROM','JOURNAL_CR_TEST_TO')}
    if not all(values.values()):raise RuntimeError('Renseigner la cle Resend, l’expediteur et l’adresse de test avec la commande Termux.')
    if any('\r' in x or '\n' in x for x in values.values()):raise RuntimeError('Configuration invalide.')
    if not values['RESEND_API_KEY'].startswith('re_') or '@' not in values['JOURNAL_CR_FROM'] or not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+',values['JOURNAL_CR_TEST_TO']):raise RuntimeError('Configuration du test invalide.')
    with tempfile.TemporaryDirectory(prefix='journal-email-') as directory:
        path=Path(directory)/'email.env'
        with os.fdopen(os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),'w') as out:
            for key,value in values.items():out.write(key+'='+value+'\n')
        result=subprocess.run(['supabase','secrets','set','--env-file',str(path),'--project-ref',project],capture_output=True,timeout=90)
        if result.returncode:raise RuntimeError('Transfert des reglages email interrompu. Relancer la meme commande.')
    result=subprocess.run(['supabase','functions','deploy','journal-cr-send-v154','--project-ref',project,'--no-verify-jwt'],capture_output=True,timeout=180)
    if result.returncode:raise RuntimeError('Deploiement email interrompu. Relancer la configuration.')
    print('Service configure en mode test, limite a une seule adresse. Envoyer le CR depuis l’application pour verifier la reception.')
if __name__=='__main__':
    try:configure()
    except Exception as e:
        print(str(e) if isinstance(e,RuntimeError) else 'Configuration interrompue. Verifier la connexion et relancer.');raise SystemExit(1)
