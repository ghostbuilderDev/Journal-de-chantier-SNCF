import importlib.util, os, subprocess, unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('deploy',ROOT/'scripts/deploy-briefing-release.py')
deploy=importlib.util.module_from_spec(spec);spec.loader.exec_module(deploy)
PROJECT='eqfwdcttvnnrakyaacjm'
DSN='postgresql://postgres:TEST%40password@db.'+PROJECT+'.supabase.co:5432/postgres'
class InstallTests(unittest.TestCase):
 def run_deploy(self,ready='t',applied='f',rights='t'):
  queries=[]
  def psql(*args,**kwargs):
   sql=kwargs['input'];queries.append(sql)
   if 'to_regprocedure' in sql:result='ready\n'+ready+'\n'
   elif 'select exists' in sql:result='applied\n'+applied+'\n'
   elif 'has_function_privilege' in sql:result='ready\n'+rights+'\n'
   else:result=''
   return subprocess.CompletedProcess(args,0,result,'')
  self.queries=queries
  with patch.dict(os.environ,{'SUPABASE_PROJECT_ID':PROJECT,'SUPABASE_DB_URL':DSN}),patch.object(deploy.transport.subprocess,'run',side_effect=psql):deploy.main()
  return queries
 def test_csv_true_installs(self):
  q=self.run_deploy();self.assertEqual(sum('BEGIN;' in s for s in q),1);self.assertIn("NOTIFY pgrst, 'reload schema';",q)
 def test_already_installed_does_not_reapply(self):
  self.assertFalse(any('BEGIN;' in s for s in self.run_deploy(applied='t')))
 def test_missing_prerequisite_stops_before_mutation(self):
  with self.assertRaisesRegex(RuntimeError,'Journal V14.2'):self.run_deploy(ready='f')
  self.assertEqual(len(self.queries),1)
 def test_wrong_rights_fails(self):
  with self.assertRaisesRegex(RuntimeError,'Droits'):self.run_deploy(rights='f')
  self.assertFalse(any('NOTIFY' in s for s in self.queries))
 def test_malformed_check_fails(self):
  for value in ('yes','',1,None):
   with self.assertRaises(RuntimeError):deploy.is_ready([{'ready':value}])
 def test_redacts_secrets(self):
  with patch.dict(os.environ,{'SUPABASE_DB_URL':DSN}):
   result=deploy.safe_error(RuntimeError(DSN+' TEST@password TEST%40password'))
  self.assertNotIn('TEST',result);self.assertNotIn('postgresql://',result)
if __name__=='__main__':unittest.main()
