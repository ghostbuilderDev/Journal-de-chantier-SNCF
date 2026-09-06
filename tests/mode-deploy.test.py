#!/usr/bin/env python3
"""Real local Git repositories, simulated GitHub; no production/network calls.
Run with --baseline-v142 /path/V14.2 --baseline-v143 /path/V14.3.
The deterministic frontend payload isolates installation behavior from rendering.
"""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
SOURCE = Path(__file__).resolve().parents[1]
sys.dont_write_bytecode = True
parser = argparse.ArgumentParser(add_help=False)
parser.add_argument('--baseline-v142', type=Path, required=True)
parser.add_argument('--baseline-v143', type=Path, required=True)
options, remaining = parser.parse_known_args()
V142, V143 = options.baseline_v142.resolve(), options.baseline_v143.resolve()
GIT = shutil.which('git')
spec=importlib.util.spec_from_file_location('prepare_mode_test', SOURCE/'scripts/prepare-mode-update.py')
prepare=importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)


class ModeInstallTests(unittest.TestCase):
    def setUp(self):
        temporary=tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.base=Path(temporary.name)
        self.repo=self.base/'repo'
        shutil.copytree(V142,self.repo,ignore=shutil.ignore_patterns('node_modules','.git','__pycache__'))
        self.payload=self.base/'release'
        for name in prepare.BACKEND+prepare.FRONTEND:
            source=SOURCE/name
            target=self.payload/name
            target.parent.mkdir(parents=True,exist_ok=True)
            target.write_bytes(source.read_bytes() if source.is_file() else b'// test fixture\n')
        for name in ('app-v13.js','index.html','service-worker-v13.js'):
            (self.payload/name).write_bytes((V142/name).read_bytes()+b'\n/* deterministic mode upgrade fixture */\n')
        self.original_config=(self.repo/'config.js').read_bytes()
        (self.repo/'unrelated.txt').write_text('PRESERVE\n')
        self.git('init','-b','main')
        self.git('config','user.name','Fixture')
        self.git('config','user.email','fixture@example.test')
        self.git('add','.')
        self.git('commit','-m','Validated V14.2')
        self.before=self.git('rev-parse','HEAD')
        self.remote=self.base/'remote.git'
        subprocess.run([GIT,'init','--bare',str(self.remote)],capture_output=True,check=True)
        self.git('remote','add','origin',str(self.remote))
        self.git('push','-u','origin','main')
        mocks=self.base/'bin'
        mocks.mkdir()
        (mocks/'git').write_text('#!'+sys.executable+'\n'+'''import json,os,subprocess,sys
from pathlib import Path
a=sys.argv[1:]
q=a[2:] if a[:1]==['-C'] else a
if q==['remote','get-url','origin']:
 print(os.environ['MODE_ORIGIN']);raise SystemExit(0)
if 'push' in a:
 message=subprocess.check_output(['''+repr(GIT)+''','log','-1','--format=%B'],text=True).strip()
 if os.environ.get('MODE_FAIL_PUSH')=='all' or (os.environ.get('MODE_FAIL_PUSH')=='frontend' and message.endswith('mode chantier et notifications')):
  raise SystemExit('simulated push failure')
os.execv('''+repr(GIT)+''',['''+repr(GIT)+''']+a)
''')
        (mocks/'gh').write_text('#!'+sys.executable+'\n'+'''import json,os,sys
from pathlib import Path
a=sys.argv[1:]
with Path(os.environ['MODE_GH_CALLS']).open('a') as f:f.write(json.dumps(a)+'\\n')
state=Path(os.environ['MODE_RUN_STATE'])
if a[:2]==['auth','status']:pass
elif a[:2]==['secret','list']:
 print('SUPABASE_ACCESS_TOKEN\\nSUPABASE_PROJECT_ID\\nSUPABASE_DB_URL' if os.environ.get('MODE_MISSING_SECRET')!='1' else 'SUPABASE_ACCESS_TOKEN')
elif a[:2]==['workflow','run']:
 state.write_text(str(int(state.read_text() if state.exists() else '1')+1))
elif a[:2]==['run','list']:print(state.read_text() if state.exists() else '1')
elif a[:2]==['run','view']:
 if '--log-failed' in a:print('DIAGNOSTIC AUTOMATIQUE : fixture migration refusal')
 else:print('completed '+('failure' if os.environ.get('MODE_BACKEND_FAIL')=='1' else 'success'))
else:raise SystemExit('unexpected gh '+repr(a))
''')
        for path in mocks.iterdir():path.chmod(0o755)
        self.env=os.environ|{'PATH':str(mocks)+os.pathsep+os.environ['PATH'],
            'JOURNAL_BACKUP_BASE':str(self.base),'MODE_ORIGIN':'https://github.com/ghostbuilderDev/Journal-de-chantier-SNCF.git',
            'MODE_GH_CALLS':str(self.base/'gh-calls'),'MODE_RUN_STATE':str(self.base/'run-state')}

    def git(self,*args):
        return subprocess.check_output([GIT,'-C',str(self.repo),*args],stderr=subprocess.DEVNULL,text=True).strip()

    def install(self,success=True,**env):
        result=subprocess.run(['bash',str(self.payload/'scripts/update-mode-termux.sh'),str(self.repo)],cwd=self.base,
            env=self.env|env,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=40)
        self.assertEqual(result.returncode,0 if success else 1,result.stdout)
        return result.stdout

    def preserved(self):
        self.assertEqual((self.repo/'config.js').read_bytes(),self.original_config)
        self.assertEqual((self.repo/'unrelated.txt').read_text(),'PRESERVE\n')
        self.assertEqual((self.repo/'styles-v13.css').read_bytes(),(V142/'styles-v13.css').read_bytes())
        self.assertEqual((self.repo/'supabase/migrations/20260906000300_v14_2_contraintes_reelles.sql').read_bytes(),(V142/'supabase/migrations/20260906000300_v14_2_contraintes_reelles.sql').read_bytes())

    def test_v142_upgrade_is_backend_first_and_idempotent(self):
        self.install()
        commits=self.git('rev-list','--reverse',self.before+'..HEAD').splitlines()
        self.assertEqual(len(commits),2)
        backend=set(self.git('diff','--name-only',self.before,commits[0]).splitlines())
        frontend=set(self.git('diff','--name-only',commits[0],commits[1]).splitlines())
        self.assertTrue(backend.issubset(prepare.BACKEND))
        self.assertTrue(frontend.issubset(prepare.FRONTEND))
        self.assertIn('app-v13.js',frontend)
        self.assertEqual(self.git('rev-parse','HEAD'),self.git('rev-parse','origin/main'))
        after=self.git('rev-parse','HEAD')
        self.install()
        self.assertEqual(self.git('rev-parse','HEAD'),after)
        self.preserved()
        self.assertTrue(list(self.base.glob('Journal-Chantier-mode-V14.4-sauvegarde-*/code-avant.tar')))

    def test_v143_optional_visual_baseline_is_accepted(self):
        for name in ('index.html','styles-v14.3.css','service-worker-v13.js'):
            shutil.copyfile(V143/name,self.repo/name)
        self.git('add','.');self.git('commit','-m','Validated design V14.3');self.git('push','origin','main')
        self.install()
        self.preserved()

    def test_backend_failure_keeps_previous_interface_and_prints_diagnostic(self):
        previous=(self.repo/'index.html').read_bytes()
        output=self.install(False,MODE_BACKEND_FAIL='1')
        self.assertEqual((self.repo/'index.html').read_bytes(),previous)
        self.assertFalse((self.repo/'mode-chantier.js').exists())
        self.assertIn('DIAGNOSTIC AUTOMATIQUE',output)
        self.install()
        self.assertEqual((self.repo/'index.html').read_bytes(),(self.payload/'index.html').read_bytes())
        self.preserved()

    def test_interrupted_backend_push_resumes_exact_commit(self):
        self.install(False,MODE_FAIL_PUSH='all')
        pending=self.git('rev-parse','HEAD')
        self.assertNotEqual(pending,self.git('rev-parse','origin/main'))
        self.assertIn('Reprise du commit backend',self.install())
        self.assertIn(pending,self.git('rev-list','HEAD').splitlines())
        self.preserved()

    def test_interrupted_frontend_push_resumes_exact_commit(self):
        self.install(False,MODE_FAIL_PUSH='frontend')
        pending=self.git('rev-parse','HEAD')
        self.assertIn('Reprise du commit frontend',self.install())
        self.assertEqual(self.git('rev-parse','origin/main'),pending)
        self.preserved()

    def test_committed_unknown_change_is_preserved(self):
        (self.repo/'app-v13.js').write_text('Custom business changes')
        self.git('add','.');self.git('commit','-m','User change');self.git('push','origin','main')
        self.assertIn('differe',self.install(False))
        self.assertEqual((self.repo/'app-v13.js').read_text(),'Custom business changes')

    def test_unrelated_local_commit_is_never_pushed(self):
        (self.repo/'unrelated.txt').write_text('Unpublished user work')
        self.git('add','.');self.git('commit','-m','User local commit')
        self.install(False)
        self.assertEqual(self.git('rev-parse','origin/main'),self.before)

    def test_missing_secret_stops_before_backend_commit(self):
        self.assertIn('Secret GitHub manquant',self.install(False,MODE_MISSING_SECRET='1'))
        self.assertEqual(self.git('rev-parse','HEAD'),self.before)

    def test_additional_supabase_config_is_preserved(self):
        with (self.repo/'supabase/config.toml').open('a') as handle:handle.write('\n[functions.unrelated]\nverify_jwt = true\n')
        self.git('add','.');self.git('commit','-m','Other function');self.git('push','origin','main')
        self.install()
        data=(self.repo/'supabase/config.toml').read_text()
        self.assertIn('[functions.unrelated]',data)
        self.assertEqual(data.count('[functions.journal-mode-push]'),1)

    def test_old_workflow_does_not_match_mode_payload(self):
        old=(SOURCE/'.github/workflows/deploy-supabase-migrations.yml').read_text()
        import fnmatch
        paths=released=[]
        inside=False
        for line in old.splitlines():
            if line.strip()=='paths:':inside=True;continue
            if inside and not line.startswith('      '):break
            if inside and line.strip().startswith('- '):paths.append(line.strip()[2:].strip('"\''))
        changed=[name for name in prepare.BACKEND if name!='supabase/config.toml' and (not (V142/name).exists() or (SOURCE/name).exists() and (SOURCE/name).read_bytes()!=(V142/name).read_bytes())]+['supabase/config.toml']
        self.assertFalse([(name,pattern) for name in changed for pattern in paths if fnmatch.fnmatchcase(name,pattern)])

if __name__=='__main__':unittest.main(argv=[sys.argv[0],*remaining])
