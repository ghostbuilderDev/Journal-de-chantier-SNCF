"""Frontend installer: preserve data/config, refuse unknown files, resume safely."""
import importlib.util
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('install', ROOT/'scripts/prepare-v15106-update.py')
INSTALL = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(INSTALL)
MANIFEST = json.loads((ROOT/'scripts/v15106-base-sha256.json').read_text())

class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.repo = Path(self.tmp.name)
        for name, expected in {**MANIFEST['files'], **MANIFEST['dependencies']}.items():
            if expected is None:
                continue
            value = subprocess.check_output(['git','show',MANIFEST['base']+':'+name], cwd=ROOT)
            target = self.repo/name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(value)
        (self.repo/'config.js').write_text('configuration personnalisée à conserver')
        (self.repo/'photo-privee.bin').write_bytes(b'PHOTO INCHANGEE')

    def run_install(self, mode, success=True):
        result = subprocess.run(['python3',str(ROOT/'scripts/prepare-v15106-update.py'),mode,str(self.repo)], capture_output=True, text=True)
        self.assertEqual(result.returncode == 0, success, result.stderr)
        return result

    def test_apply_and_repeat_preserve_configuration_and_data(self):
        self.run_install('check')
        self.run_install('apply')
        self.assertEqual(self.run_install('changed').stdout.strip(),'no')
        self.run_install('apply')
        self.assertEqual((self.repo/'config.js').read_text(),'configuration personnalisée à conserver')
        self.assertEqual((self.repo/'photo-privee.bin').read_bytes(),b'PHOTO INCHANGEE')
        for name in INSTALL.FILES:
            self.assertEqual((self.repo/name).read_bytes(),(ROOT/name).read_bytes())

    def test_unknown_file_refused_before_any_write(self):
        original = (self.repo/'index.html').read_bytes()
        (self.repo/'app-v13.js').write_text('custom code')
        self.run_install('apply',False)
        self.assertEqual((self.repo/'index.html').read_bytes(),original)
        self.assertEqual((self.repo/'app-v13.js').read_text(),'custom code')

    def test_changed_dependency_refused(self):
        (self.repo/'rapport/report-actions.js').write_text('newer version')
        self.run_install('apply',False)
        self.assertFalse((self.repo/'journal-albums.css').exists())

    def test_symlink_refused(self):
        (self.repo/'journal-albums.css').symlink_to(self.repo/'photo-privee.bin')
        self.run_install('apply',False)
        self.assertEqual((self.repo/'photo-privee.bin').read_bytes(),b'PHOTO INCHANGEE')

    def test_known_partial_copy_can_resume(self):
        (self.repo/'app-v13.js').write_bytes((ROOT/'app-v13.js').read_bytes())
        self.run_install('apply')
        self.assertEqual(self.run_install('changed').stdout.strip(),'no')

    def init_git(self):
        def git(*args):
            return subprocess.check_output(['git','-C',str(self.repo),*args],stderr=subprocess.DEVNULL,text=True)
        git('init','-b','main')
        git('config','user.name','Installation test')
        git('config','user.email','test@example.invalid')
        git('add','.')
        git('commit','-m','Base test')
        git('update-ref','refs/remotes/origin/main','HEAD')
        return git

    def test_resume_reviewed_unpushed_commit(self):
        git = self.init_git()
        self.run_install('apply')
        git('add','.')
        git('commit','-m',INSTALL.MESSAGE)
        self.run_install('pending')
        (self.repo/'unrelated.txt').write_text('modification étrangère')
        git('add','.')
        git('commit','--amend','--no-edit')
        self.run_install('pending',False)

    def test_only_recognized_worktree_copy_can_resume(self):
        git = self.init_git()
        (self.repo/'app-v13.js').write_bytes((ROOT/'app-v13.js').read_bytes())
        self.run_install('worktree')
        self.run_install('apply')
        git('add','app-v13.js')
        self.run_install('worktree')
        (self.repo/'unrelated.txt').write_text('à conserver')
        self.run_install('worktree',False)

if __name__ == '__main__':
    unittest.main()
