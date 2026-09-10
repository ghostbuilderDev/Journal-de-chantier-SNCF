"""The cumulative update accepts both shipped bases, with backend checked first."""
import importlib.util
import json
import subprocess
import tempfile
import unittest
import contextlib
import io
import os
from unittest.mock import patch
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('update15105', ROOT/'scripts/prepare-v15105-update.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

def deploy_module():
    spec = importlib.util.spec_from_file_location('deploy_recovery', ROOT/'scripts/deploy-v15104-release.py')
    deploy = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(deploy)
    return deploy

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
                         ['supabase/migrations/20260910000500_v15_10_4_report_numbers.sql', 'supabase/migrations/20260910000600_v15_10_5_report_archive_acl.sql'])
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

    def test_resume_committed_numbering_applies_only_missing_repair(self):
        deploy = deploy_module()
        applied = {deploy.NAME}
        sent = []
        base, repair = deploy.migration_transaction(), deploy.repair_transaction()
        def query(sql, *args):
            sent.append(sql)
            if sql == repair:
                applied.add(deploy.REPAIR_NAME)
                return []
            if sql == base:
                self.fail('The committed numbering migration must not be replayed')
            if "where migration_name='" in sql:
                return [{'ready': any(name in sql for name in applied)}]
            return [{'ready': True}]
        deploy.briefing.transport.postgres_query = query
        deploy.briefing.transport.postgres_environment = lambda *args: None
        with patch.dict(os.environ, {'SUPABASE_PROJECT_ID':'eqfwdcttvnnrakyaacjm','SUPABASE_DB_URL':'fixture','SUPABASE_ACCESS_TOKEN':'fixture'}), contextlib.redirect_stdout(io.StringIO()):
            deploy.main()
            deploy.main()
        self.assertEqual(sent.count(repair), 1)
        self.assertTrue(all(sql in sent for sql in deploy.CHECKS))

    def test_failed_checks_are_named_and_never_bypassed(self):
        deploy = deploy_module()
        query = lambda sql: [{'ready': sql not in (deploy.CHECKS[2], deploy.CHECKS[3])}]
        output = io.StringIO()
        with contextlib.redirect_stdout(output), self.assertRaisesRegex(RuntimeError, 'RJ_COMPTEUR, RJ_ARCHIVE'):
            deploy.verify(query)
        self.assertIn('Contrôle RJ_ARCHIVE : ÉCHEC', output.getvalue())
        self.assertIn('Contrôle BRIEFING_QR : OK', output.getvalue())

    def test_invalid_repair_stops_before_connection(self):
        deploy = deploy_module()
        deploy.repair_transaction = lambda: (_ for _ in ()).throw(RuntimeError('invalid repair'))
        deploy.briefing.transport.postgres_environment = lambda *args: self.fail('Unexpected connection')
        with self.assertRaisesRegex(RuntimeError, 'invalid repair'):
            deploy.main()

if __name__ == '__main__':
    unittest.main()
