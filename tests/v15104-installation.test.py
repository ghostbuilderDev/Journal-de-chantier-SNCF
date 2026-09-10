import importlib.util, unittest, tempfile, json, subprocess, os
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def module(name,path):
 spec=importlib.util.spec_from_file_location(name,ROOT/path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
m=module('installer','scripts/prepare-v15104-update.py')
class Tests(unittest.TestCase):
 def test_known_base_only_and_repeat(self):
  m.validate_change('app.js',b'before',b'after',m.digest(b'before'))
  m.validate_change('app.js',b'after',b'after',m.digest(b'before'))
  with self.assertRaises(ValueError):m.validate_change('app.js',b'personal change',b'after',m.digest(b'before'))
 def test_missing_payload_and_symlink(self):
  with self.assertRaises(ValueError):m.validate_change('app.js',b'keep',None,None)
  with tempfile.TemporaryDirectory() as d:
   p=Path(d);(p/'keep').write_text('keep');(p/'link').symlink_to(p/'keep')
   with self.assertRaises(ValueError):m.target(p,'link')
   self.assertEqual((p/'keep').read_text(),'keep')
 def test_backend_gate_and_scope(self):
  self.assertFalse(set(m.BACKEND)&set(m.FRONTEND));self.assertEqual(len(m.BACKEND+m.FRONTEND),len(set(m.BACKEND+m.FRONTEND)))
  self.assertEqual([p for p in m.BACKEND if p.startswith('supabase/migrations/')],['supabase/migrations/20260910000500_v15_10_4_report_numbers.sql'])
  self.assertNotIn('config.js',m.BACKEND+m.FRONTEND)
  self.assertNotIn('briefing/index.html',m.BACKEND+m.FRONTEND)
  shell=(ROOT/'scripts/update-v15104-termux.sh').read_text();self.assertLess(shell.index('wait-v15104-workflow.py'),shell.index('prepare frontend'))
  for message in m.MESSAGES.values():self.assertIn(message,shell)
 def test_deployment_uses_ledger_without_replaying_previous_versions(self):
  deploy=module('deploy_test','scripts/deploy-v15104-release.py');commands=[];applied=set()
  def query(sql,*args):
   nonlocal applied
   commands.append(sql)
   for name,transaction in [(deploy.NAME,deploy.migration_transaction()),(deploy.REPAIR_NAME,deploy.repair_transaction())]:
    if sql==transaction:applied.add(name);return []
   if "where migration_name='" in sql:return [{'ready':any(name in sql for name in applied)}]
   return [{'ready':True}]
  deploy.briefing.transport.postgres_query=query;deploy.briefing.transport.postgres_environment=lambda *args:None
  from unittest.mock import patch
  with patch.dict(os.environ,{'SUPABASE_PROJECT_ID':'eqfwdcttvnnrakyaacjm','SUPABASE_DB_URL':'fixture','SUPABASE_ACCESS_TOKEN':'fixture'}):deploy.main();deploy.main()
  self.assertEqual(commands.count(deploy.migration_transaction()),1)
  self.assertEqual(commands.count(deploy.repair_transaction()),1)
  self.assertFalse(any('20260910000400' in q or '20260910000300' in q for q in commands))
 def test_invalid_migration_stops_before_any_connection(self):
  deploy=module('invalid_deploy','scripts/deploy-v15104-release.py')
  deploy.migration_transaction=lambda:(_ for _ in ()).throw(RuntimeError('invalid SQL'))
  deploy.briefing.transport.postgres_query=lambda *args:self.fail('Unexpected connection')
  with self.assertRaisesRegex(RuntimeError,'invalid SQL'):deploy.main()
 def test_manifest_dependencies_are_exact(self):
  manifest=json.loads((ROOT/'scripts/v15104-base-sha256.json').read_text())
  self.assertEqual(set(manifest['files']),set(m.BACKEND+m.FRONTEND))
  self.assertEqual(manifest['base'],'ef7330ab77afaffdbdd3ca75158e550da297df1e')
if __name__=='__main__':unittest.main()
