"""Offline transport tests. Never connects to Supabase or launches psql."""
import contextlib
import importlib.util
import io
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import urllib.error

spec = importlib.util.spec_from_file_location('deploy_release', Path(__file__).resolve().parents[1] / 'scripts/deploy-supabase-release.py')
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)
REF = 'eqfwdcttvnnrakyaacjm'
PASSWORD = 'private:pass@word/with spaces'
DSN = f'postgresql://postgres.{REF}:private%3Apass%40word%2Fwith%20spaces@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require'

class TransportTests(unittest.TestCase):
    def test_pooler_credentials_are_environment_only(self):
        with patch.dict(os.environ, {'SUPABASE_DB_URL': DSN, 'PGOPTIONS':'unsafe', 'PGSERVICE':'unsafe'}, clear=True):
            with patch.object(deploy.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, 'applied\nf\n', '')) as run:
                self.assertEqual(deploy.query('SELECT false AS applied;', REF, ''), [{'applied':False}])
        args, kwargs = run.call_args
        self.assertNotIn(PASSWORD, repr(args)); self.assertNotIn(DSN, repr(args))
        self.assertEqual(kwargs['env']['PGPASSWORD'], PASSWORD)
        self.assertEqual(kwargs['env']['PGHOST'], 'aws-1-eu-west-1.pooler.supabase.com')
        self.assertNotIn('PGOPTIONS', kwargs['env']); self.assertNotIn('PGSERVICE', kwargs['env'])
        self.assertNotIn('SUPABASE_DB_URL', kwargs['env'])
        self.assertIn('--no-psqlrc', args[0]); self.assertIn('--no-password', args[0])
        self.assertEqual(kwargs['input'], 'SELECT false AS applied;')

    def test_direct_connection_enforces_tls_by_default(self):
        env = deploy.postgres_environment(f'postgres://postgres:secret@db.{REF}.supabase.co:5432/postgres', REF)
        self.assertEqual(env['PGSSLMODE'], 'require')

    def test_foreign_or_unsafe_urls_rejected_before_network(self):
        invalid = [DSN.replace(REF, 'a' * 20), DSN.replace('5432', '6543'),
                   DSN.replace('sslmode=require','sslmode=disable'), DSN.replace('sslmode=require','sslmode=prefer'),
                   DSN.replace('aws-1-eu-west-1.pooler.supabase.com','attacker.invalid'),
                   DSN + '&options=-c%20role%3Dpostgres', DSN.replace('/postgres?', '/another?')]
        with patch.object(deploy.subprocess, 'run') as run:
            for dsn in invalid:
                with self.subTest(dsn=dsn.replace('private', 'REDACTED')):
                    with self.assertRaises(RuntimeError): deploy.postgres_query('SELECT 1;', REF, dsn)
            run.assert_not_called()

    def test_psql_failure_never_echoes_credentials_or_output(self):
        with patch.object(deploy.subprocess, 'run', return_value=subprocess.CompletedProcess([], 2, PASSWORD, DSN)):
            with self.assertRaises(RuntimeError) as failure:
                deploy.postgres_query('SELECT 1;', REF, DSN)
        self.assertNotIn(PASSWORD, str(failure.exception)); self.assertNotIn(DSN, str(failure.exception))

    def test_schema_diagnostic_survives_secret_redaction(self):
        token = 'test-access-token-do-not-display'
        encoded = deploy.urllib.parse.quote(PASSWORD, safe='')
        error = f'ERROR: P0001: V14.2 interrompue : colonne profiles.company absente.\n{DSN}\n{PASSWORD}\n{encoded}\n{token}'
        with patch.dict(os.environ, {'SUPABASE_ACCESS_TOKEN':token}), patch.object(deploy.subprocess, 'run', return_value=subprocess.CompletedProcess([], 2, 'PRIVATE_APPLICATION_ROW', error)):
            with self.assertRaises(RuntimeError) as failure:
                deploy.postgres_query('SELECT 1;', REF, DSN)
        message = str(failure.exception)
        self.assertIn('P0001: V14.2 interrompue : colonne profiles.company absente.', message)
        for secret in (DSN, PASSWORD, encoded, token, 'PRIVATE_APPLICATION_ROW'):
            self.assertNotIn(secret, message)

    def test_redaction_precedes_diagnostic_truncation(self):
        token = 'sensitive-token-prefix-' + 'z' * 300
        with patch.dict(os.environ, {'SUPABASE_ACCESS_TOKEN':token}), patch.object(deploy.subprocess, 'run', return_value=subprocess.CompletedProcess([], 2, '', 'x'*1900 + token)):
            with self.assertRaises(RuntimeError) as failure:
                deploy.postgres_query('SELECT 1;', REF, DSN)
        self.assertNotIn('sensitive-token-prefix', str(failure.exception))
        self.assertIn('[secret masque]', str(failure.exception))

    def test_ledger_boolean_is_strict(self):
        with patch.object(deploy.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, 'applied\nmaybe\n', '')):
            with self.assertRaises(RuntimeError): deploy.postgres_query('SELECT 1;', REF, DSN)

    def test_check_connection_is_one_read_only_query(self):
        with patch.dict(os.environ, {'SUPABASE_PROJECT_ID':REF, 'SUPABASE_DB_URL':DSN}, clear=True), patch.object(sys, 'argv', ['deploy', '--check-connection']):
            with patch.object(deploy.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, 'connected\n1\n', '')) as run, contextlib.redirect_stdout(io.StringIO()):
                deploy.main()
        self.assertEqual(run.call_count, 1)
        self.assertEqual(run.call_args.kwargs['input'], 'SELECT 1 AS connected;')

    def test_whitelist_and_atomic_ledger_remain_used(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); (root/'supabase/migrations').mkdir(parents=True)
            name = '20260906000100_v14_2_test.sql'
            (root/'supabase/release-migrations.txt').write_text(name+'\n')
            (root/'supabase/migrations'/name).write_text('begin;\nSELECT 1;\ncommit;\n')
            results = [subprocess.CompletedProcess([],0,'',''), subprocess.CompletedProcess([],0,'applied\nf\n',''), subprocess.CompletedProcess([],0,'','')]
            with patch.object(deploy,'ROOT',root), patch.dict(os.environ, {'SUPABASE_PROJECT_ID':REF,'SUPABASE_DB_URL':DSN},clear=True), patch.object(sys,'argv',['deploy']), patch.object(deploy.subprocess,'run',side_effect=results) as run, contextlib.redirect_stdout(io.StringIO()):
                deploy.main()
            sql = run.call_args_list[-1].kwargs['input']
            self.assertTrue(sql.startswith('BEGIN;'))
            self.assertIn('pg_advisory_xact_lock',sql)
            self.assertIn('INSERT INTO public.journal_sql_migrations',sql)
            self.assertTrue(sql.endswith('COMMIT;\n'))

    def test_cloudflare_denial_no_retry_or_automatic_alternate(self):
        denied = urllib.error.HTTPError('https://api.supabase.com/',403,'Forbidden',{},io.BytesIO(b'error code: 1010'))
        with patch.dict(os.environ, {}, clear=True), patch.object(deploy.urllib.request,'urlopen',side_effect=denied) as request, patch.object(deploy.subprocess,'run') as run:
            with self.assertRaisesRegex(RuntimeError, '403 / Cloudflare 1010'):
                deploy.query('SELECT 1;', REF, 'token')
            self.assertEqual(request.call_count,1); run.assert_not_called()

    def test_foreign_project_never_runs_connection_check(self):
        with patch.dict(os.environ, {'SUPABASE_PROJECT_ID':'a'*20,'SUPABASE_DB_URL':DSN},clear=True), patch.object(sys,'argv',['deploy','--check-connection']), patch.object(deploy.subprocess,'run') as run:
            with self.assertRaises(RuntimeError): deploy.main()
            run.assert_not_called()

if __name__ == '__main__': unittest.main()
