#!/usr/bin/env python3
"""Secrets/bootstrap/retry tests; never contacts PostgreSQL, GitHub or Supabase."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import unittest
from unittest import mock
import urllib.error
ROOT = Path(__file__).resolve().parents[1]
sys.dont_write_bytecode = True


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / filename)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result

config = module('mode_config_test', 'configure-mode-chantier.py')
deploy = module('mode_deploy_test', 'deploy-mode-release.py')


class ConfigurationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pair = config.generate_keys()  # Real P-256 generation, no network.

    def setUp(self):
        self.state = {'vapid_public_key': None, 'vapid_private_key': None, 'dispatch_secret': None}
        self.queries, self.transfers, self.paths = [], [], []

    def query(self, sql):
        self.queries.append(sql)
        if sql.startswith('SELECT NOT (has_any_column_privilege'):
            return [{'applied': True}]
        if sql.startswith('SELECT vapid_public_key'):
            return [self.state.copy()]
        if 'DO $setup$' in sql:
            match = re.search(r"configure\('([^']+)','([^']+)','([^']+)',false,'([^']+)'\)", sql)
            self.assertIsNotNone(match)
            if not self.state['vapid_public_key']:
                self.state.update(vapid_public_key=match[1], vapid_private_key=match[4], dispatch_secret=match[3])
        return []

    def transfer(self, args, **kwargs):
        self.assertEqual(args[:3], ['supabase', 'secrets', 'set'])
        path = Path(args[args.index('--env-file') + 1])
        self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
        data = path.read_text()
        self.assertNotIn(self.state['vapid_private_key'], ' '.join(args))
        self.assertNotIn(self.state['dispatch_secret'], ' '.join(args))
        self.paths.append(path)
        self.transfers.append(data)
        return subprocess.CompletedProcess(args, 0, 'not relayed', 'not relayed')

    def test_key_generation_is_p256_and_secret_configuration_is_valid(self):
        value = {'vapid_public_key':self.pair['public'], 'vapid_private_key':self.pair['private'], 'dispatch_secret':'A'*43}
        self.assertEqual(config.validate(value), value)
        self.assertNotEqual(config.generate_keys(), self.pair)

    def test_repeated_setup_preserves_keys_and_uses_only_secure_deleted_env_files(self):
        output = io.StringIO()
        with mock.patch.object(config, 'query', side_effect=self.query), mock.patch.object(config, 'generate_keys', return_value=self.pair) as generate, mock.patch.object(config.subprocess, 'run', side_effect=self.transfer), contextlib.redirect_stdout(output):
            config.provision()
            config.provision()
        self.assertEqual(generate.call_count, 1)
        self.assertEqual(self.transfers[0], self.transfers[1])
        self.assertTrue(all(not path.exists() for path in self.paths))
        self.assertNotIn(self.pair['private'], output.getvalue())
        self.assertNotIn(self.state['dispatch_secret'], output.getvalue())
        self.assertTrue(any('pg_advisory_xact_lock' in sql for sql in self.queries))

    def test_retry_after_secret_transfer_failure_reuses_durable_keys(self):
        def fail(args, **kwargs):
            result = self.transfer(args, **kwargs)
            return subprocess.CompletedProcess(args, 1, self.pair['private'], self.state['dispatch_secret'])
        with mock.patch.object(config, 'query', side_effect=self.query), mock.patch.object(config, 'generate_keys', return_value=self.pair) as generate:
            with mock.patch.object(config.subprocess, 'run', side_effect=fail):
                with self.assertRaises(RuntimeError) as error:
                    config.provision()
            self.assertNotIn(self.pair['private'], str(error.exception))
            self.assertNotIn(self.state['dispatch_secret'], str(error.exception))
            with mock.patch.object(config.subprocess, 'run', side_effect=self.transfer):
                config.provision()
            self.assertEqual(generate.call_count, 1)
        self.assertEqual(self.transfers[0], self.transfers[1])
        self.assertTrue(all(not path.exists() for path in self.paths))

    def test_partial_existing_configuration_is_never_rotated(self):
        self.state['vapid_public_key'] = self.pair['public']
        with mock.patch.object(config, 'query', side_effect=self.query), mock.patch.object(config, 'generate_keys') as generate:
            with self.assertRaisesRegex(RuntimeError, 'partielle'):
                config.provision()
        generate.assert_not_called()
        self.assertEqual(len(self.queries), 1)

    def test_private_database_failure_never_relays_sql_or_secrets(self):
        with mock.patch.dict(os.environ, {'SUPABASE_PROJECT_ID':config.PROJECT,'SUPABASE_DB_URL':'postgresql://secret'}, clear=False), mock.patch.object(config.transport, 'postgres_query', side_effect=RuntimeError('SQL password VAPID_PRIVATE leaked-dispatch')):
            with self.assertRaises(RuntimeError) as error: config.query('private SQL')
        self.assertNotIn('VAPID_PRIVATE', str(error.exception))
        self.assertNotIn('leaked-dispatch', str(error.exception))

    def test_failed_health_never_enables_dispatch(self):
        with mock.patch.object(config, 'health', side_effect=RuntimeError('not ready')), mock.patch.object(config, 'query') as query:
            with self.assertRaises(RuntimeError): config.activate()
        query.assert_not_called()

    def test_activation_requires_anonymous_refusal_and_healthy_edge(self):
        self.state.update(vapid_public_key=self.pair['public'], vapid_private_key=self.pair['private'], dispatch_secret='A'*43)
        refusal = urllib.error.HTTPError(config.URL, 401, 'Denied', {}, None)
        with mock.patch.object(config, 'health') as health, mock.patch.object(config.urllib.request, 'urlopen', side_effect=refusal), mock.patch.object(config, 'query', side_effect=self.query):
            config.activate()
        health.assert_called_once()
        self.assertIn("cron.schedule('journal-mode-dispatch-v14-4','30 seconds'", self.queries[-1])
        self.assertIn('SET enabled=true', self.queries[-1])
        self.assertNotIn(self.state['dispatch_secret'], self.queries[-1])

    def test_activation_refuses_public_dispatch(self):
        response = mock.MagicMock()
        response.__enter__.return_value.status = 200
        with mock.patch.object(config, 'health'), mock.patch.object(config.urllib.request, 'urlopen', return_value=response), mock.patch.object(config, 'query') as query:
            with self.assertRaisesRegex(RuntimeError, 'anonymes'): config.activate()
        query.assert_not_called()

    def test_transport_queue_revoke_preserves_write_and_checks_effective_column_rights(self):
        with mock.patch.object(config, 'query', side_effect=[[], [{'applied': True}]]) as query:
            config.ensure_queue_private()
        revoke, check = [call.args[0] for call in query.call_args_list]
        self.assertIn('REVOKE SELECT ON TABLE net.http_request_queue, net._http_response FROM PUBLIC, anon, authenticated', revoke)
        self.assertNotIn('REVOKE ALL', revoke)
        self.assertNotIn('http_post', revoke)
        self.assertIn('has_any_column_privilege', check)

    def test_readable_transport_queue_blocks_secret_transfer(self):
        self.state.update(vapid_public_key=self.pair['public'], vapid_private_key=self.pair['private'], dispatch_secret='A'*43)
        def readable(sql):
            if sql.startswith('SELECT NOT (has_any_column_privilege'): return [{'applied': False}]
            return self.query(sql)
        with mock.patch.object(config, 'query', side_effect=readable), mock.patch.object(config.subprocess, 'run') as transfer:
            with self.assertRaisesRegex(RuntimeError, 'reste lisible'): config.provision()
        transfer.assert_not_called()

    def test_migration_requires_v142_and_never_runs_an_old_migration(self):
        statements=[]
        def query(sql,*args):
            statements.append(sql)
            if sql.startswith('SELECT EXISTS'):
                return [{'applied': '20260906000300' in sql}]
            return []
        with mock.patch.dict(os.environ, {'SUPABASE_PROJECT_ID':deploy.PROJECT,'SUPABASE_DB_URL':'masked'}, clear=False), mock.patch.object(deploy.transport, 'postgres_environment'), mock.patch.object(deploy.transport, 'postgres_query', side_effect=query):
            deploy.main()
        self.assertEqual(len(statements), 3)
        self.assertIn("VALUES ('20260906000400_v14_4_mode_chantier.sql')", statements[-1])
        self.assertNotIn('contrainte multi-colonnes', statements[-1])

    def test_applied_v144_skips_migration_and_keeps_setup_resumable(self):
        with mock.patch.dict(os.environ, {'SUPABASE_PROJECT_ID':deploy.PROJECT,'SUPABASE_DB_URL':'masked'}, clear=False), mock.patch.object(deploy.transport, 'postgres_environment'), mock.patch.object(deploy.transport, 'postgres_query', return_value=[{'applied':True}]) as query:
            deploy.main()
        self.assertEqual(query.call_count, 2)

if __name__ == '__main__': unittest.main()
