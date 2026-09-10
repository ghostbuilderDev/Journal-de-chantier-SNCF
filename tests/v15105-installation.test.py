"""The cumulative update accepts both shipped bases, with backend checked first."""
import importlib.util
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('update15105', ROOT/'scripts/prepare-v15105-update.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class Tests(unittest.TestCase):
    def test_base_current_and_repeat_are_supported(self):
        m.validate_change('rapport/app.js', b'v103', b'v105', m.digest(b'v103'), [m.digest(b'v104')])
        m.validate_change('rapport/app.js', b'v104', b'v105', m.digest(b'v103'), [m.digest(b'v104')])
        m.validate_change('rapport/app.js', b'v105', b'v105', m.digest(b'v103'), [m.digest(b'v104')])
        with self.assertRaises(ValueError):
            m.validate_change('rapport/app.js', b'custom', b'v105', m.digest(b'v103'), [m.digest(b'v104')])

    def test_scope_and_backend_gate(self):
        self.assertFalse(set(m.BACKEND) & set(m.FRONTEND))
        self.assertEqual(len(m.BACKEND + m.FRONTEND), len(set(m.BACKEND + m.FRONTEND)))
        self.assertNotIn('config.js', m.BACKEND + m.FRONTEND)
        self.assertNotIn('briefing/index.html', m.BACKEND + m.FRONTEND)
        self.assertEqual([p for p in m.BACKEND if p.startswith('supabase/migrations/')],
                         ['supabase/migrations/20260910000500_v15_10_4_report_numbers.sql'])
        shell = (ROOT/'scripts/update-v15105-termux.sh').read_text()
        self.assertLess(shell.index('wait-v15104-workflow.py'), shell.index('prepare frontend'))
        for message in m.MESSAGES.values():
            self.assertIn(message, shell)
        # This workflow runs for both a fresh cumulative install and an existing V15.10.4.
        workflow = (ROOT/'.github/workflows/deploy-v15104.yml').read_text()
        self.assertIn("'scripts/prepare-v15105-update.py'", workflow)
        self.assertIn('python3 tests/v15105-installation.test.py', workflow)

    def test_manifest_describes_both_shipped_versions(self):
        manifest = json.loads((ROOT/'scripts/v15105-base-sha256.json').read_text())
        self.assertEqual(set(manifest['files']), set(m.BACKEND + m.FRONTEND))
        self.assertFalse(set(manifest['dependencies']) & set(manifest['files']))
        self.assertEqual(manifest['base'], 'ef7330ab77afaffdbdd3ca75158e550da297df1e')
        self.assertIn('rapport/app.js', manifest['previous_files'])
        self.assertIn('rapport/collaboration.js', manifest['previous_files'])

    def test_missing_files_and_symlinks_never_replace_existing_code(self):
        with self.assertRaises(ValueError):
            m.validate_change('rapport/app.js', b'existing', None, None)
        with tempfile.TemporaryDirectory() as d:
            base = Path(d)
            (base/'original').write_text('keep')
            (base/'link').symlink_to(base/'original')
            with self.assertRaises(ValueError):
                m.target(base, 'link')
            self.assertEqual((base/'original').read_text(), 'keep')

if __name__ == '__main__':
    unittest.main()
