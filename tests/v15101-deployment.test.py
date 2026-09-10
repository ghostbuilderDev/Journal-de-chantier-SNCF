"""Exercise a cumulative install and resume without replaying registered SQL."""
import contextlib,importlib.util,io,os,re,subprocess,sys,tempfile,unittest
from pathlib import Path
from unittest import mock
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('release',ROOT/'scripts/deploy-v15101-release.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
ENV={'SUPABASE_PROJECT_ID':'eqfwdcttvnnrakyaacjm','SUPABASE_DB_URL':'postgresql://postgres:fixture-only@db.eqfwdcttvnnrakyaacjm.supabase.co:5432/postgres','SUPABASE_ACCESS_TOKEN':'fixture-only'}
class DeploymentTests(unittest.TestCase):
 def test_two_real_transactions_have_separate_ledgers(self):
  transactions=m.migration_transactions();self.assertEqual([name for name,_ in transactions],[m.previous.NAME,m.NAME])
  for name,sql in transactions:
   self.assertTrue(sql.startswith('BEGIN;\nSELECT pg_advisory_xact_lock'));self.assertTrue(sql.endswith('COMMIT;\n'));self.assertEqual(sql.count('INSERT INTO public.journal_sql_migrations(migration_name)'),1);self.assertIn("VALUES ('"+name+"')",sql)
 def test_invalid_new_file_stops_before_older_migration(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);p=root/'supabase/migrations'/m.NAME;p.parent.mkdir(parents=True);p.write_text('SQL without transaction;')
   with mock.patch.object(m,'ROOT',root),mock.patch.object(m.previous,'main') as prior:
    with self.assertRaisesRegex(RuntimeError,'SQL V15.10.1 invalide'):m.main()
    prior.assert_not_called()
 def test_print_without_credentials(self):
  result=subprocess.run([sys.executable,str(ROOT/'scripts/deploy-v15101-release.py'),'--print-sql'],capture_output=True,text=True,check=True,env={k:v for k,v in os.environ.items() if not k.startswith('SUPABASE_')})
  self.assertEqual(result.stdout,''.join(sql for _,sql in m.migration_transactions()));self.assertEqual(result.stderr,'')
 def exercise(self,initial=(),fail_second=False):
  applied=set(initial);writes=[];attempts=[]
  def query(sql,*_):
   if sql.startswith('BEGIN;'):
    name=next(name for name,transaction in m.migration_transactions() if sql==transaction);self.assertNotIn(name,applied);attempts.append(name)
    if fail_second and name==m.NAME and attempts.count(name)==1:raise RuntimeError('Connection interrupted; second transaction rolled back')
    applied.add(name);writes.append(name);return []
   if sql.startswith('select exists(select 1 from public.journal_sql_migrations'):
    name=re.search("migration_name='([^']+)'",sql)[1];return [{'ready':name in applied}]
   return [{'ready':True}]
  with mock.patch.dict(os.environ,ENV),mock.patch.object(m.previous.briefing.transport,'postgres_query',side_effect=query),contextlib.redirect_stdout(io.StringIO()):
   if fail_second:
    with self.assertRaisesRegex(RuntimeError,'interrupted'):m.main()
   m.main();m.main()
  self.assertEqual(writes,[n for n in (m.previous.NAME,m.NAME) if n not in initial])
 def test_direct_v159_upgrade(self):self.exercise()
 def test_already_installed_v1510(self):self.exercise((m.previous.NAME,))
 def test_resume_after_new_migration_failure(self):self.exercise(fail_second=True)
 def test_missing_prerequisite_never_writes(self):
  with mock.patch.dict(os.environ,ENV),mock.patch.object(m.previous.briefing.transport,'postgres_query',return_value=[{'ready':False}]) as query:
   with self.assertRaisesRegex(RuntimeError,'doivent être installés'):m.main()
   self.assertEqual(query.call_count,1);self.assertTrue(query.call_args.args[0].startswith('select '))
if __name__=='__main__':unittest.main()
