"""No network: verify hidden credentials go only to gh's stdin."""
from pathlib import Path
import contextlib
import importlib.util
import io
import subprocess
import unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('configure', Path(__file__).resolve().parents[1]/'scripts/configure-supabase-db.py')
mod=importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)

class ConfigureTests(unittest.TestCase):
    def test_secret_sent_only_on_stdin(self):
        password='private:a@b/c space'
        output=io.StringIO()
        with patch.object(mod.sys.stdin,'isatty',return_value=True), patch('builtins.input',return_value='aws-0-eu-west-1.pooler.supabase.com'), patch.object(mod.getpass,'getpass',return_value=password), patch.object(mod.subprocess,'run',return_value=subprocess.CompletedProcess([],0,'','')) as run, contextlib.redirect_stdout(output):
            mod.main()
        args,kw=run.call_args
        self.assertEqual(args[0][:3],['gh','secret','set'])
        self.assertNotIn(password,repr(args)); self.assertNotIn(password,output.getvalue())
        self.assertIn('private%3Aa%40b%2Fc%20space',kw['input'])
        self.assertIn('SUPABASE_DB_URL',args[0])
    def test_wrong_host_refused_before_password(self):
        with patch.object(mod.sys.stdin,'isatty',return_value=True), patch('builtins.input',return_value='other.invalid'), patch.object(mod.getpass,'getpass') as secret, patch.object(mod.subprocess,'run',return_value=subprocess.CompletedProcess([],0,'','')) as run, contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaises(RuntimeError): mod.main()
        secret.assert_not_called(); self.assertEqual(run.call_count,1)
    def test_piped_input_cannot_expose_password(self):
        with patch.object(mod.sys.stdin,'isatty',return_value=False), patch.object(mod.getpass,'getpass') as secret, patch.object(mod.subprocess,'run') as run:
            with self.assertRaises(RuntimeError): mod.main()
        secret.assert_not_called(); run.assert_not_called()

if __name__=='__main__': unittest.main()
