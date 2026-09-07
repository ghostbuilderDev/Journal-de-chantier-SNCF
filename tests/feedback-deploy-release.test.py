#!/usr/bin/env python3
"""Deployment guards and atomic ledger behavior, entirely without network."""
import contextlib
import importlib.util
import io
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('feedback_deployer', SOURCE / 'scripts/deploy-feedback-release.py')
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


class FeedbackDeployTests(unittest.TestCase):
    def setUp(self):
        self.calls = []
        self.environment = {'SUPABASE_PROJECT_ID': deploy.PROJECT,
                            'SUPABASE_DB_URL': 'configured-private-dsn'}
        self.prerequisite = True
        self.already = False
        self.catalog = True
        self.error_on_apply = False

    def query(self, sql, project, dsn):
        self.assertEqual(project, deploy.PROJECT)
        self.assertEqual(dsn, 'configured-private-dsn')
        self.calls.append(sql)
        if sql.startswith('BEGIN;'):
            if self.error_on_apply:
                raise RuntimeError('Fixture SQL refusal')
            return []
        if sql.startswith('WITH expected'):
            return [{'applied': self.catalog}]
        if deploy.PREREQUISITE in sql:
            return [{'applied': self.prerequisite}]
        if deploy.MIGRATION in sql:
            return [{'applied': self.already}]
        raise AssertionError('Unexpected SQL')

    def run_deploy(self):
        with patch.dict(os.environ, self.environment, clear=True), \
             patch.object(deploy.transport, 'postgres_environment'), \
             patch.object(deploy.transport, 'postgres_query', side_effect=self.query), \
             contextlib.redirect_stdout(io.StringIO()) as output:
            deploy.main()
            return output.getvalue()

    def test_first_deploy_is_one_atomic_migration_then_catalog(self):
        self.run_deploy()
        transactions=[sql for sql in self.calls if sql.startswith('BEGIN;')]
        self.assertEqual(len(transactions), 1)
        self.assertIn('pg_advisory_xact_lock', transactions[0])
        self.assertIn("INSERT INTO public.journal_sql_migrations(migration_name) VALUES ('" + deploy.MIGRATION, transactions[0])
        self.assertTrue(transactions[0].rstrip().endswith('COMMIT;'))
        self.assertTrue(self.calls[-1].startswith('WITH expected'))

    def test_repeat_never_replays_applied_schema(self):
        self.already=True
        self.assertIn('deja appliquee', self.run_deploy())
        self.assertFalse(any(sql.startswith('BEGIN;') for sql in self.calls))
        self.assertTrue(self.calls[-1].startswith('WITH expected'))

    def test_works_without_push_token_or_mode_migration(self):
        self.run_deploy()
        self.assertNotIn('20260906000400', '\n'.join(self.calls))
        self.assertNotIn('pg_net', '\n'.join(self.calls))
        self.assertNotIn('SUPABASE_ACCESS_TOKEN', deploy.main.__code__.co_consts)

    def test_missing_prerequisite_never_applies(self):
        self.prerequisite=False
        with self.assertRaisesRegex(RuntimeError, 'V14.2'):
            self.run_deploy()
        self.assertEqual(len(self.calls),1)

    def test_unknown_project_stops_before_query(self):
        self.environment['SUPABASE_PROJECT_ID']='other-project'
        with self.assertRaises(RuntimeError):self.run_deploy()
        self.assertFalse(self.calls)

    def test_missing_dsn_stops_before_query(self):
        del self.environment['SUPABASE_DB_URL']
        with self.assertRaises(RuntimeError):self.run_deploy()
        self.assertFalse(self.calls)

    def test_sql_failure_never_reaches_catalog(self):
        self.error_on_apply=True
        with self.assertRaisesRegex(RuntimeError, 'Fixture SQL refusal'):
            self.run_deploy()
        self.assertFalse(any(sql.startswith('WITH expected') for sql in self.calls))

    def test_damaged_catalog_blocks_even_if_registered(self):
        for already in (False, True):
            with self.subTest(already=already):
                self.already=already;self.catalog=False
                with self.assertRaisesRegex(RuntimeError, 'catalogue'):
                    self.run_deploy()

    def test_invalid_ledger_is_refused(self):
        for result in ([],[{'applied':'true'}],[{'applied':None}],[{'applied':True},{'applied':True}]):
            with self.subTest(result=result):
                with self.assertRaisesRegex(RuntimeError, 'Registre'):
                    deploy.applied(lambda _:result, deploy.MIGRATION)

    def test_release_manifest_cannot_include_another_migration(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);(root/'supabase').mkdir()
            (root/'supabase/feedback-release-migrations.txt').write_text(deploy.MIGRATION+'\n'+deploy.PREREQUISITE+'\n')
            with patch.object(deploy, 'ROOT', root):
                with self.assertRaisesRegex(RuntimeError, 'uniquement'):
                    self.run_deploy()
        self.assertFalse(self.calls)

    def test_rpc_check_includes_context_and_auth_boundaries(self):
        self.run_deploy()
        sql=self.calls[-1]
        self.assertIn("public.journal_feedback_context()",sql)
        self.assertIn("NOT has_function_privilege('anon'",sql)
        self.assertIn("has_function_privilege('authenticated'",sql)
        self.assertIn("public=false",sql)
        self.assertEqual(len(deploy.RPC_SIGNATURES),11)


if __name__=='__main__':unittest.main()
