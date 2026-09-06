from pathlib import Path
import contextlib
import argparse
import ast
import hashlib
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile

SOURCE=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser(description='Tests de livraison ; GitHub et Supabase sont simules.', add_help=False)
parser.add_argument('--original-zip', type=Path, help='Archive Supabase-Transfer-Journal-Chantier.zip V14.1')
parser.add_argument('--full-original-zip', type=Path, help='Archive Journal-de-chantier-SNCF-main.zip V14.1')
parser.add_argument('--previous-release-zip', type=Path, help='Archive V14.2 exacte publiee avant le transport PostgreSQL')
options, unittest_args=parser.parse_known_args()
ORIGINAL=options.original_zip
FULL_ORIGINAL=options.full_original_zip
PREVIOUS_RELEASE=options.previous_release_zip
for provided in (ORIGINAL,FULL_ORIGINAL,PREVIOUS_RELEASE):
    if provided is not None and not provided.is_file():
        parser.error(f'Archive introuvable : {provided}')

def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path)
    mod=importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
    return mod
prep=load('prep',SOURCE/'scripts/prepare-update.py')
deploy=load('deploy',SOURCE/'scripts/deploy-supabase-release.py')


def copy_previous_backend(repo):
    """Reproduce a published backend-only commit from the real previous ZIP."""
    prefix='Journal-Chantier-V14.2/'
    with zipfile.ZipFile(PREVIOUS_RELEASE) as archive:
        tree=ast.parse(archive.read(prefix+'scripts/prepare-update.py').decode())
        assignment=next(node for node in tree.body if isinstance(node,ast.Assign)
                        and any(isinstance(target,ast.Name) and target.id=='BACKEND' for target in node.targets))
        for relative in ast.literal_eval(assignment.value):
            target=repo/relative
            target.parent.mkdir(parents=True,exist_ok=True)
            target.write_bytes(archive.read(prefix+relative))
    # The user's published backend includes the previously qualified case fix.
    script=repo/'scripts/update-termux.sh'
    fixed=script.read_text().replace('case "$origin" in','case "${origin,,}" in').replace('$REPOSITORY','${REPOSITORY,,}')
    script.write_text(fixed)


class ReleaseTests(unittest.TestCase):
    def test_actual_sql_atomic_ledger(self):
        name='20260906000300_v14_2_contraintes_reelles.sql'
        body=deploy.build_transaction((SOURCE/'supabase/migrations'/name).read_text(),name)
        self.assertEqual(body.count('INSERT INTO public.journal_sql_migrations(migration_name)'),1)
        self.assertLess(body.index('INSERT INTO public.journal_sql_migrations'),body.rindex('COMMIT;'))
        self.assertIn('pg_advisory_xact_lock',body)
    def test_transaction_refuses_sql_outside_and_paths(self):
        for sql in ('select 1;\nbegin;\nselect 1;\ncommit;', 'begin;\nselect 1;\ncommit;\nselect 2;', 'select 1;'):
            with self.assertRaises(ValueError): deploy.build_transaction(sql,'20260906000100_test.sql')
        with self.assertRaises(ValueError): deploy.build_transaction('begin;\nselect 1;\ncommit;','../old.sql')
    def test_config_merge_preserves_other_sections(self):
        with tempfile.TemporaryDirectory() as d:
            target=Path(d)/'config.toml'; old='project_id="existing"\n[functions.existing]\nverify_jwt=true\n'; target.write_text(old)
            result=prep.merged_config((SOURCE/'supabase/config.toml').read_bytes(),target).decode()
            self.assertTrue(result.startswith(old.rstrip()))
            self.assertIn('[functions.journal-delete-user]',result)
            target.write_text(result)
            self.assertEqual(prep.merged_config((SOURCE/'supabase/config.toml').read_bytes(),target).decode(),result)
    @unittest.skipUnless(ORIGINAL, "Fournir --original-zip pour verifier le transfert V14.1")
    def test_refuses_newer_file(self):
        with tempfile.TemporaryDirectory() as d:
            with zipfile.ZipFile(ORIGINAL) as z: z.extractall(d)
            repo=Path(d)/'Supabase-Transfer-Journal-Chantier'; (repo/'app-v13.js').write_text('NEWER WORK')
            with self.assertRaisesRegex(ValueError,'differe'): prep.prepare(repo)
            self.assertEqual((repo/'app-v13.js').read_text(),'NEWER WORK')
    def test_refuses_symlink(self):
        with tempfile.TemporaryDirectory() as d:
            repo=Path(d); (repo/'file').symlink_to('/tmp/other')
            with self.assertRaises(ValueError): prep.safe_target(repo,'file')

    @unittest.skipUnless(FULL_ORIGINAL, "Fournir --full-original-zip pour verifier le depot complet V14.1")
    def test_accepts_full_audited_repository(self):
        with tempfile.TemporaryDirectory() as d:
            with zipfile.ZipFile(FULL_ORIGINAL) as z: z.extractall(d)
            repo=Path(d)/'Journal-de-chantier-SNCF-main'
            changes=prep.prepare(repo)
            for relative in ('index.html', 'styles-v13.css', 'service-worker-v13.js'):
                self.assertIn(relative,changes)
                self.assertNotEqual((repo/relative).read_bytes(), changes[relative])

    def run_installer(self, success, full_repository=False, origin=None, autodiscover=False, refused=False,
                      previous_backend=False, resume_after_failure=False):
        if not (FULL_ORIGINAL if full_repository else ORIGINAL):
            self.skipTest("Fournir --full-original-zip" if full_repository else "Fournir --original-zip")
        if previous_backend and not PREVIOUS_RELEASE:
            self.skipTest('Fournir --previous-release-zip')
        with tempfile.TemporaryDirectory() as d:
            base=Path(d); payload=base/'payload'; shutil.copytree(SOURCE,payload)
            with zipfile.ZipFile(FULL_ORIGINAL if full_repository else ORIGINAL) as z: z.extractall(base)
            repo=base/('Journal-de-chantier-SNCF-main' if full_repository else 'Supabase-Transfer-Journal-Chantier'); remote=base/'remote.git'; mocks=base/'bin'; mocks.mkdir()
            if previous_backend:
                copy_previous_backend(repo)
            (repo/'unrelated.txt').write_text('KEEP ME')
            (repo/'.github/workflows/unrelated.yml').write_text('name: preserve\n')
            cfg=repo/'config.js'; cfg.write_text(cfg.read_text()+'\n// local configuration marker\n')
            config_before=cfg.read_bytes(); app_before=(repo/'app-v13.js').read_bytes()
            real_git=shutil.which('git')
            def git(*args): return subprocess.run([real_git,*args],cwd=repo,check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True).stdout
            git('init','-b','main'); git('config','user.name','Fixture'); git('config','user.email','fixture@example.test')
            git('add','.'); git('commit','-m','Original fixture')
            before_sha=git('rev-parse','HEAD').strip()
            subprocess.run([real_git,'init','--bare',str(remote)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            git('remote','add','origin',str(remote)); git('push','-u','origin','main')
            (mocks/'git').write_text('#!'+sys.executable+'\nimport json,os,sys\nfrom pathlib import Path\na=sys.argv[1:]\nwith Path(os.environ["JOURNAL_FIXTURE_GIT_CALLS"]).open("a") as log: log.write(json.dumps(a)+"\\n")\nquery=a[2:] if a[:1]==["-C"] else a\nif query==["remote","get-url","origin"]: print(os.environ["JOURNAL_FIXTURE_ORIGIN"])\nelse: os.execv('+repr(real_git)+',['+repr(real_git)+']+a)\n')
            state=base/'gh-state'; state.write_text('123')
            (mocks/'gh').write_text('#!'+sys.executable+'\nimport sys,os\nfrom pathlib import Path\na=sys.argv[1:]; s=Path(os.environ["JOURNAL_FIXTURE_STATE"])\nPath(os.environ["JOURNAL_FIXTURE_GH_CALLS"]).touch()\nif a[:2]==["auth","status"]: pass\nelif a[:2]==["secret","list"]: print("SUPABASE_ACCESS_TOKEN\\nSUPABASE_PROJECT_ID\\nSUPABASE_DB_URL")\nelif a[:2]==["run","list"]: print(s.read_text())\nelif a[:2]==["run","view"]: print("completed "+os.environ["JOURNAL_FIXTURE_CONCLUSION"])\nelif a[:2]==["workflow","run"]: s.write_text(str(int(s.read_text())+1))\nelse: raise SystemExit("unexpected gh "+repr(a))\n')
            for p in mocks.iterdir(): p.chmod(0o755)
            env=os.environ|{'PATH':str(mocks)+os.pathsep+os.environ['PATH'],'JOURNAL_BACKUP_BASE':str(base),'JOURNAL_FIXTURE_STATE':str(state),'JOURNAL_FIXTURE_CONCLUSION':'success' if success else 'failure','JOURNAL_FIXTURE_ORIGIN':origin or 'https://github.com/ghostbuilderdev/Journal-de-chantier-SNCF.git','JOURNAL_FIXTURE_GIT_CALLS':str(base/'git-calls'),'JOURNAL_FIXTURE_GH_CALLS':str(base/'gh-calls')}
            command=['bash',str(payload/'scripts/update-termux.sh')]+([] if autodiscover else [str(repo)])
            command_cwd=repo if autodiscover else base
            result=subprocess.run(command,cwd=command_cwd,env=env,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=30)
            self.assertEqual(result.returncode,0 if success and not refused else 1,result.stdout)
            self.assertEqual(cfg.read_bytes(),config_before)
            self.assertEqual((repo/'unrelated.txt').read_text(),'KEEP ME')
            self.assertEqual((repo/'.github/workflows/unrelated.yml').read_text(),'name: preserve\n')
            if refused:
                self.assertIn('Le depot origin ne correspond pas',result.stdout)
                self.assertEqual((repo/'app-v13.js').read_bytes(),app_before)
                self.assertEqual(git('rev-parse','HEAD').strip(),before_sha)
                self.assertEqual(git('status','--porcelain').strip(),'')
                self.assertFalse((base/'gh-calls').exists(),'Wrong remote must be rejected before GitHub calls')
                self.assertFalse(list(base.glob('Journal-Chantier-sauvegarde-*')))
                return
            if autodiscover:
                git_calls=[json.loads(line) for line in (base/'git-calls').read_text().splitlines()]
                self.assertIn(['-C',str(repo),'remote','get-url','origin'],git_calls)
            self.assertTrue((repo/'supabase/functions/journal-delete-user/index.ts').exists())
            if success:
                self.assertEqual((repo/'app-v13.js').read_bytes(),(payload/'app-v13.js').read_bytes())
                again=subprocess.run(command,cwd=command_cwd,env=env,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=30)
                self.assertEqual(again.returncode,0,again.stdout)
                self.assertEqual(state.read_text(),'124')
            else:
                self.assertEqual((repo/'app-v13.js').read_bytes(),app_before)
                self.assertIn("l'interface n'a pas ete publiee",result.stdout)
                if resume_after_failure:
                    env['JOURNAL_FIXTURE_CONCLUSION']='success'
                    resumed=subprocess.run(command,cwd=command_cwd,env=env,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=30)
                    self.assertEqual(resumed.returncode,0,resumed.stdout)
                    self.assertEqual((repo/'app-v13.js').read_bytes(),(payload/'app-v13.js').read_bytes())
                    self.assertEqual(state.read_text(),'124')
                    self.assertEqual(cfg.read_bytes(),config_before)
                    self.assertEqual((repo/'unrelated.txt').read_text(),'KEEP ME')
                    self.assertEqual((repo/'.github/workflows/unrelated.yml').read_text(),'name: preserve\n')
            self.assertEqual(git('status','--porcelain').strip(),'')
            self.assertEqual(git('rev-parse','HEAD').strip(),git('rev-parse','origin/main').strip())
    def test_installer_success_and_resume(self): self.run_installer(True)
    def test_installer_sql_failure_keeps_old_frontend(self): self.run_installer(False)
    def test_full_repository_success_and_resume(self): self.run_installer(True, full_repository=True)
    def test_mixed_case_origin_success_and_resume(self):
        self.run_installer(True, origin='https://github.com/ghostbuilderDev/Journal-de-chantier-SNCF.git')
    def test_mixed_case_origin_autodiscovery_and_resume(self):
        self.run_installer(True, origin='https://github.com/ghostbuilderDev/Journal-de-chantier-SNCF.git', autodiscover=True)
    def test_previous_backend_only_upgrade_and_resume(self):
        self.run_installer(True, full_repository=True, previous_backend=True,
                           origin='https://github.com/ghostbuilderDev/Journal-de-chantier-SNCF.git')
    def test_previous_backend_upgrade_failure_then_resume(self):
        self.run_installer(False, full_repository=True, previous_backend=True, resume_after_failure=True,
                           origin='https://github.com/ghostbuilderDev/Journal-de-chantier-SNCF.git')
    @unittest.skipUnless(FULL_ORIGINAL and PREVIOUS_RELEASE, 'Fournir --full-original-zip et --previous-release-zip')
    def test_previous_backend_refuses_unknown_changes(self):
        with tempfile.TemporaryDirectory() as d:
            with zipfile.ZipFile(FULL_ORIGINAL) as archive: archive.extractall(d)
            repo=Path(d)/'Journal-de-chantier-SNCF-main'
            copy_previous_backend(repo)
            prep.prepare(repo)
            script=repo/'scripts/deploy-supabase-release.py'
            changed=script.read_text()+'\n# Unrelated newer user work\n'
            script.write_text(changed)
            with self.assertRaisesRegex(ValueError,'differe'): prep.prepare(repo)
            self.assertEqual(script.read_text(),changed)
    def test_refuses_other_owner_repository_or_host(self):
        for origin in (
            'https://github.com/another-owner/Journal-de-chantier-SNCF.git',
            'https://github.com/ghostbuilderDev/another-repository.git',
            'https://github.com.example.test/ghostbuilderDev/Journal-de-chantier-SNCF.git',
        ):
            with self.subTest(origin=origin):
                self.run_installer(False, origin=origin, refused=True)

if __name__=='__main__': unittest.main(argv=[sys.argv[0], *unittest_args], verbosity=2)
