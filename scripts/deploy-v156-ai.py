#!/usr/bin/env python3
"""Deploy an authenticated writing endpoint; never sends a message to Gemini."""
import os,re,subprocess,tempfile
from pathlib import Path
PROJECT='eqfwdcttvnnrakyaacjm'
def cli(*args):
 result=subprocess.run(['supabase',*args],capture_output=True,text=True)
 if result.returncode:raise RuntimeError('Installation du moteur de rédaction interrompue. Vérifier les accès Supabase du workflow, puis le relancer.')
def main():
 if not os.environ.get('SUPABASE_ACCESS_TOKEN'):raise RuntimeError('Accès Supabase requis.')
 key=os.environ.get('GEMINI_API_KEY','').strip()
 if key:
  if not re.fullmatch(r'[a-zA-Z0-9_-]{20,256}',key):raise RuntimeError('Format de clé Gemini invalide.')
  with tempfile.TemporaryDirectory() as folder:
   file=Path(folder)/'gemini.env';file.write_text('GEMINI_API_KEY='+key+'\nJOURNAL_GEMINI_MODEL=gemini-3.1-pro-preview\n');file.chmod(0o600)
   cli('secrets','set','--project-ref',PROJECT,'--env-file',str(file))
 cli('functions','deploy','journal-writing-ai','--project-ref',PROJECT,'--no-verify-jwt')
 print('Moteur de rédaction installé. Clé conservée côté serveur uniquement. Aucun appel Gemini de test facturé.')
if __name__=='__main__':
 try:main()
 except Exception as e:raise SystemExit(str(e))
