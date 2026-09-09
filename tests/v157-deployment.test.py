"""Exercise the production installer, including its SQL envelope and retries."""
import contextlib
import importlib.util
import io
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest import mock
from urllib.error import HTTPError

ROOT = Path(__file__).resolve().parents[1]
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('release', ROOT / 'scripts/deploy-v157-release.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
ENV = {
    'SUPABASE_PROJECT_ID': 'eqfwdcttvnnrakyaacjm',
    'SUPABASE_DB_URL': 'postgresql://postgres:fixture-only@db.eqfwdcttvnnrakyaacjm.supabase.co:5432/postgres',
    'SUPABASE_ACCESS_TOKEN': 'fixture-only',
}


class DeploymentTests(unittest.TestCase):
    def test_real_migration_can_be_wrapped_and_registered(self):
        sql = m.migration_transaction()
        self.assertTrue(sql.startswith('BEGIN;\nSELECT pg_advisory_xact_lock'))
        self.assertTrue(sql.endswith('COMMIT;\n'))
        self.assertEqual(sql.count("INSERT INTO public.journal_sql_migrations(migration_name)"), 1)
        self.assertIn("VALUES ('" + m.NAME + "')", sql)

    def test_original_missing_envelope_is_reproduced(self):
        sql = (ROOT / 'supabase/migrations' / m.NAME).read_text()
        old_sql = sql.replace('BEGIN;\n', '', 1).rsplit('COMMIT;', 1)[0]
        with self.assertRaisesRegex(ValueError, 'BEGIN / COMMIT'):
            m.briefing.transport.build_transaction(old_sql, m.NAME)

    def test_invalid_package_fails_before_any_connection(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            file = root / 'supabase/migrations' / m.NAME
            file.parent.mkdir(parents=True)
            file.write_text('create table impossible_without_envelope(id int);')
            with mock.patch.object(m, 'ROOT', root), mock.patch.object(m.briefing.transport, 'postgres_environment') as connect:
                with self.assertRaisesRegex(RuntimeError, 'Fichier SQL V15.7 invalide.*aucune migration exécutée'):
                    m.main()
                connect.assert_not_called()

    def test_print_transaction_without_credentials(self):
        env = {k: v for k, v in os.environ.items() if not k.startswith('SUPABASE_')}
        result = subprocess.run([sys.executable, str(ROOT / 'scripts/deploy-v157-release.py'), '--print-sql'],
                                env=env, capture_output=True, text=True, check=True)
        self.assertEqual(result.stdout, m.migration_transaction())
        self.assertEqual(result.stderr, '')

    def check_resume(self, failed_function=False):
        state = {'applied': False, 'writes': 0}

        def query(sql, project, dsn):
            if sql.startswith('BEGIN;'):
                self.assertFalse(state['applied'], 'a registered migration must never replay')
                self.assertEqual(sql, m.migration_transaction())
                state.update(applied=True, writes=state['writes'] + 1)
                return []
            if "select exists(select 1 from public.journal_sql_migrations" in sql:
                return [{'ready': state['applied']}]
            return [{'ready': True}]

        with mock.patch.dict(os.environ, ENV), \
             mock.patch.object(m.briefing.transport, 'postgres_query', side_effect=query), \
             contextlib.redirect_stdout(io.StringIO()):
            m.main()
            m.main()
        self.assertEqual(state['writes'], 1)

    def test_install_then_repeat_does_not_replay_sql(self):
        self.check_resume()

    def test_missing_prerequisites_stop_before_mutations(self):
        with mock.patch.dict(os.environ, ENV), \
             mock.patch.object(m.briefing.transport, 'postgres_query', return_value=[{'ready': False}]) as query, \
             mock.patch.object(m.subprocess, 'run') as cli:
            with self.assertRaisesRegex(RuntimeError, 'doivent être installés'):
                m.main()
            self.assertEqual(query.call_count, 1)
            self.assertTrue(query.call_args.args[0].startswith('select '))
            cli.assert_not_called()


if __name__ == '__main__':
    unittest.main()
