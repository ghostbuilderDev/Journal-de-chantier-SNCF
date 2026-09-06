#!/usr/bin/env python3
"""Secrets/bootstrap/retry tests; never contacts PostgreSQL, GitHub or Supabase."""
import contextlib
import base64
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile
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
        with mock.patch.object(config, 'query', side_effect=[[], [{'applied': True}]]) as query, mock.patch.object(config, 'assert_net_api_hidden') as probe:
            config.ensure_queue_private()
        probe.assert_not_called()
        revoke, check = [call.args[0] for call in query.call_args_list]
        self.assertIn('REVOKE SELECT ON TABLE net.http_request_queue, net._http_response FROM PUBLIC, anon, authenticated', revoke)
        self.assertNotIn('REVOKE ALL', revoke)
        self.assertNotIn('http_post', revoke)
        self.assertIn('has_any_column_privilege', check)

    def test_readable_transport_queue_with_unverified_roles_blocks_secret_transfer(self):
        self.state.update(vapid_public_key=self.pair['public'], vapid_private_key=self.pair['private'], dispatch_secret='A'*43)
        def readable(sql):
            if sql.startswith('SELECT NOT (has_any_column_privilege'): return [{'applied': False}]
            return self.query(sql)
        with mock.patch.object(config, 'query', side_effect=readable), mock.patch.object(config.subprocess, 'run') as transfer, mock.patch.object(config, 'assert_net_api_hidden') as probe:
            with self.assertRaises(RuntimeError): config.provision()
        transfer.assert_not_called()
        probe.assert_not_called()

    def test_readable_queue_with_nologin_and_hidden_api_allows_secret_transfer(self):
        self.state.update(vapid_public_key=self.pair['public'], vapid_private_key=self.pair['private'], dispatch_secret='A'*43)
        def readable(sql):
            if sql.startswith('SELECT NOT (has_any_column_privilege'): return [{'applied': False}]
            if 'pg_catalog.pg_roles' in sql: return [{'applied': True}]
            return self.query(sql)
        with mock.patch.object(config, 'query', side_effect=readable), mock.patch.object(config, 'assert_net_api_hidden') as probe, mock.patch.object(config.subprocess, 'run', side_effect=self.transfer):
            config.provision()
        probe.assert_called_once_with()
        self.assertEqual(len(self.transfers), 1)
        self.assertTrue(all(not path.exists() for path in self.paths))

    def test_exposed_or_ambiguous_api_blocks_transfer_and_activation(self):
        self.state.update(vapid_public_key=self.pair['public'], vapid_private_key=self.pair['private'], dispatch_secret='A'*43)
        def readable(sql):
            if sql.startswith('SELECT NOT (has_any_column_privilege'): return [{'applied': False}]
            if 'pg_catalog.pg_roles' in sql: return [{'applied': True}]
            return self.query(sql)
        refusal = urllib.error.HTTPError(config.URL, 401, 'Denied', {}, None)
        with mock.patch.object(config, 'query', side_effect=readable), mock.patch.object(config, 'assert_net_api_hidden', side_effect=RuntimeError('API not verified')), mock.patch.object(config.subprocess, 'run') as transfer, mock.patch.object(config, 'health'), mock.patch.object(config.urllib.request, 'urlopen', side_effect=refusal):
            with self.assertRaises(RuntimeError): config.provision()
            with self.assertRaises(RuntimeError): config.activate()
        transfer.assert_not_called()
        self.assertFalse(any('SET enabled=true' in sql or 'cron.schedule(' in sql for sql in self.queries))

    def test_fallback_is_rechecked_when_activating(self):
        self.state.update(vapid_public_key=self.pair['public'], vapid_private_key=self.pair['private'], dispatch_secret='A'*43)
        def readable(sql):
            if sql.startswith('SELECT NOT (has_any_column_privilege'): return [{'applied': False}]
            if 'pg_catalog.pg_roles' in sql: return [{'applied': True}]
            return self.query(sql)
        refusal = urllib.error.HTTPError(config.URL, 401, 'Denied', {}, None)
        with mock.patch.object(config, 'query', side_effect=readable), mock.patch.object(config, 'assert_net_api_hidden') as probe, mock.patch.object(config.subprocess, 'run', side_effect=self.transfer), mock.patch.object(config, 'health'), mock.patch.object(config.urllib.request, 'urlopen', side_effect=refusal):
            config.provision()
            config.activate()
        self.assertEqual(probe.call_count, 2)
        self.assertIn('SET enabled=true', self.queries[-1])

    def test_login_or_missing_role_blocks_before_any_api_probe(self):
        # An empty result covers a failed/incomplete role inspection; applied=False
        # covers a LOGIN role or the required count of two not being satisfied.
        for roles in ([], [{'applied': False}], [{'applied': None}]):
            with self.subTest(roles=roles), mock.patch.object(config, 'query', side_effect=[[], [{'applied': False}], roles]) as query, mock.patch.object(config, 'assert_net_api_hidden') as probe:
                with self.assertRaises(RuntimeError): config.ensure_queue_private()
                probe.assert_not_called()
                check = query.call_args_list[-1].args[0]
                self.assertIn('pg_catalog.pg_roles', check)
                self.assertRegex(check, r'count\(\*\)\s*=\s*2')
                self.assertIn('rolcanlogin', check)

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


class PublicAPIIsolationTests(unittest.TestCase):
    """Only synthetic keys and mocked responses; no client or server connection."""
    KEY = 'sb_publishable_' + 'SyntheticTestOnly_' * 2

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='mode-api-isolation-test-')
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.root_patch = mock.patch.object(config, 'ROOT', self.root)
        self.root_patch.start()
        self.addCleanup(self.root_patch.stop)
        self.write_config()

    def write_config(self, key=None, url=None, extra=''):
        value = {'SUPABASE_URL': url or f'https://{config.PROJECT}.supabase.co', 'SUPABASE_ANON_KEY': self.KEY if key is None else key}
        # Match the app's established config.js format: one literal per line.
        fields = ',\n'.join('  ' + name + ': ' + json.dumps(text) for name, text in value.items())
        (self.root / 'config.js').write_text('window.JOURNAL_CONFIG = {\n' + fields + '\n};\n' + extra)

    @staticmethod
    def jwt(claims):
        def encode(value):
            return base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip('=')
        return encode({'alg':'HS256','typ':'JWT'}) + '.' + encode(claims) + '.' + 'S' * 43

    @staticmethod
    def hidden_error(request):
        return urllib.error.HTTPError(request.full_url, 406, 'Not Acceptable', {'Content-Type':'application/json'}, io.BytesIO(b'{"code":"PGRST106","message":"The schema must be one of the following: public"}'))

    def test_literal_publishable_key_is_read_from_expected_project(self):
        self.assertEqual(config.public_api_key(), self.KEY)

    def test_legacy_anon_jwt_for_expected_project_is_supported(self):
        value = self.jwt({'role':'anon','ref':config.PROJECT,'iss':'supabase'})
        self.write_config(value)
        self.assertEqual(config.public_api_key(), value)

    def test_service_role_wrong_project_and_incomplete_jwt_are_rejected(self):
        for claims in ({'role':'service_role','ref':config.PROJECT}, {'role':'anon','ref':'anotherproject'}, {'role':'authenticated','ref':config.PROJECT}, {'role':'anon'}, {'ref':config.PROJECT}):
            with self.subTest(claims=claims):
                value = self.jwt(claims)
                self.write_config(value)
                with self.assertRaises(RuntimeError) as error: config.public_api_key()
                self.assertNotIn(value, str(error.exception))

    def test_secret_malformed_and_short_public_keys_are_rejected(self):
        for value in ('sb_secret_' + 'S'*40, 'sb_publishable_short', 'sb_publishable_' + '!'*40, 'not-a-jwt', 'e30.!!!!.signature'):
            with self.subTest(value=value):
                self.write_config(value)
                with self.assertRaises(RuntimeError) as error: config.public_api_key()
                self.assertNotIn(value, str(error.exception))

    def test_foreign_origin_lookalike_and_insecure_project_are_rejected(self):
        for url in ('https://otherproject.supabase.co', f'https://{config.PROJECT}.supabase.co.attacker.invalid', f'http://{config.PROJECT}.supabase.co', f'https://{config.PROJECT}.supabase.co/path'):
            with self.subTest(url=url):
                self.write_config(url=url)
                with self.assertRaises(RuntimeError): config.public_api_key()

    def test_config_is_never_evaluated_as_javascript(self):
        marker = self.root / 'should-not-exist'
        self.write_config(extra="require('node:fs').writeFileSync(" + json.dumps(str(marker)) + ", 'executed');")
        with mock.patch.object(config.subprocess, 'run', side_effect=AssertionError('No JavaScript execution')):
            self.assertEqual(config.public_api_key(), self.KEY)
        self.assertFalse(marker.exists())

    def test_nonliteral_key_expression_is_rejected_without_execution(self):
        (self.root / 'config.js').write_text('window.JOURNAL_CONFIG = {\n  SUPABASE_URL: "https://' + config.PROJECT + '.supabase.co",\n  SUPABASE_ANON_KEY: process.env.SECRET\n};')
        with mock.patch.object(config.subprocess, 'run', side_effect=AssertionError('No JavaScript execution')):
            with self.assertRaises(RuntimeError): config.public_api_key()

    def test_missing_configuration_is_a_sanitized_runtime_error(self):
        (self.root / 'config.js').unlink()
        with self.assertRaises(RuntimeError): config.public_api_key()

    def test_both_tables_require_positive_schema_exclusion_using_read_only_probes(self):
        def hidden(request, **kwargs):
            self.assertEqual(kwargs.get('timeout'), 15)
            self.assertEqual(request.get_method(), 'GET')
            self.assertIsNone(request.data)
            headers = {key.lower():value for key,value in request.header_items()}
            self.assertEqual(headers['accept-profile'], 'net')
            self.assertEqual(headers['apikey'], self.KEY)
            self.assertNotIn(self.KEY, request.full_url)
            raise self.hidden_error(request)
        opener = mock.Mock()
        opener.open.side_effect = hidden
        with mock.patch.object(config.urllib.request, 'build_opener', return_value=opener) as build:
            config.assert_net_api_hidden()
        self.assertTrue(any(isinstance(handler, config.NoRedirect) for handler in build.call_args.args))
        self.assertEqual({call.args[0].full_url for call in opener.open.call_args_list}, {
            f'https://{config.PROJECT}.supabase.co/rest/v1/http_request_queue?select=id&limit=0',
            f'https://{config.PROJECT}.supabase.co/rest/v1/_http_response?select=id&limit=0',
        })

    def test_auth_network_and_other_errors_never_count_as_isolation(self):
        cases = ((401, b'{"code":"PGRST106"}'), (403,b'{"code":"PGRST106"}'), (404,b'{"code":"PGRST106"}'),
                 (500,b'{"code":"PGRST106"}'), (406,b'{"code":"42501"}'), (406,b'not-json'), (406,b'[]'),
                 (302,b'{"code":"PGRST106"}'))
        for status, body in cases:
            with self.subTest(status=status, body=body):
                opener = mock.Mock()
                opener.open.side_effect = urllib.error.HTTPError('https://example.invalid', status, 'Must not echo ' + self.KEY, {}, io.BytesIO(body))
                with mock.patch.object(config.urllib.request, 'build_opener', return_value=opener):
                    with self.assertRaises(RuntimeError) as error: config.assert_net_api_hidden()
                    self.assertNotIn(self.KEY, str(error.exception))
        opener = mock.Mock()
        opener.open.side_effect = urllib.error.URLError('connection includes ' + self.KEY)
        with mock.patch.object(config.urllib.request, 'build_opener', return_value=opener):
            with self.assertRaises(RuntimeError) as error: config.assert_net_api_hidden()
        self.assertNotIn(self.KEY, str(error.exception))

    def test_successful_table_read_blocks_even_when_no_rows_were_returned(self):
        opener = mock.Mock()
        response = mock.MagicMock()
        response.__enter__.return_value.status = 200
        response.__enter__.return_value.read.return_value = b'[]'
        opener.open.return_value = response
        with mock.patch.object(config.urllib.request, 'build_opener', return_value=opener):
            with self.assertRaises(RuntimeError): config.assert_net_api_hidden()

    def test_isolation_of_only_one_table_is_insufficient(self):
        response = mock.MagicMock()
        response.__enter__.return_value.status = 200
        response.__enter__.return_value.read.return_value = b'[]'
        opener = mock.Mock()
        request = config.urllib.request.Request('https://example.invalid')
        opener.open.side_effect = [self.hidden_error(request), response]
        with mock.patch.object(config.urllib.request, 'build_opener', return_value=opener):
            with self.assertRaises(RuntimeError): config.assert_net_api_hidden()
        self.assertEqual(opener.open.call_count, 2)

    def test_redirect_handler_never_constructs_a_followup_request(self):
        original = config.urllib.request.Request(f'https://{config.PROJECT}.supabase.co/rest/v1/http_request_queue', headers={'apikey': self.KEY})
        handler = config.NoRedirect()
        try:
            redirected = handler.redirect_request(original, None, 302, 'Found', {}, 'https://attacker.invalid/')
        except urllib.error.HTTPError:
            redirected = None
        self.assertIsNone(redirected)

if __name__ == '__main__': unittest.main()
