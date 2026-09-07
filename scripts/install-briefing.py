#!/usr/bin/env python3
"""Copy only reviewed integration files into the user's existing Git checkout."""
from pathlib import Path
import hashlib, json, shutil, subprocess, sys
source=Path(__file__).resolve().parents[1]
if len(sys.argv)!=2: sys.exit('Usage : python scripts/install-briefing.py /chemin/Journal-de-chantier-SNCF')
target=Path(sys.argv[1]).resolve()
def git(*args): return subprocess.check_output(['git','-C',str(target),*args],text=True).strip()
if git('status','--porcelain'): sys.exit('Le dépôt contient des modifications. Conservez-les dans un commit avant installation.')
if git('branch','--show-current')!='main': sys.exit('Installation prévue sur la branche main.')
manifest=json.loads((source/'scripts/briefing-files.json').read_text())
def digest(p): return hashlib.sha256(p.read_bytes()).hexdigest() if p.exists() else None
for name, rule in manifest.items():
    if digest(target/name) not in (rule['before'],rule['after']):
        sys.exit('Version différente détectée : '+name+'. Aucune modification appliquée ; intégration à adapter à cette version.')
for name in manifest:
    path=target/name;path.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(source/name,path)
subprocess.run(['git','-C',str(target),'add','--',*manifest.keys()],check=True)
print('Intégration préparée. Vérifiez git diff --cached, puis :')
print('git commit -m "Intégrer les briefings au fil et aux archives du chantier"')
print('git push origin main')
print('Attendez le succès de Installer les archives briefing et du déploiement GitHub Pages.')
