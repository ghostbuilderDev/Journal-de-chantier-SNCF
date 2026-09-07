import importlib.util
from pathlib import Path
from unittest import TestCase,main,mock
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('report_deploy',ROOT/'scripts/deploy-report-release.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Deploy(TestCase):
    def run_case(self,applied='f'):
        queries=[]
        def query(sql,*args):
            queries.append(sql)
            if 'as ready' in sql.lower():
                return [{'ready':applied if 'select exists' in sql else 't'}]
            return []
        with mock.patch.dict(m.os.environ,{'SUPABASE_PROJECT_ID':'eqfwdcttvnnrakyaacjm','SUPABASE_DB_URL':'fake'}),mock.patch.object(m.briefing.transport,'postgres_environment'),mock.patch.object(m.briefing.transport,'postgres_query',side_effect=query):
            m.main()
        return queries
    def test_new_migration(self):
        queries=self.run_case();writes=[q for q in queries if q.startswith('BEGIN;')]
        self.assertEqual(len(writes),1)
        self.assertIn('20260907000700_archive_rapports_journaliers.sql',writes[0])
        self.assertNotIn('20260907000500_',writes[0])
        self.assertTrue(any('NOTIFY' in q for q in queries))
    def test_already_applied(self):
        self.assertFalse(any(q.startswith('BEGIN;') for q in self.run_case('t')))
    def test_requires_prerequisites(self):
        with mock.patch.dict(m.os.environ,{'SUPABASE_PROJECT_ID':'eqfwdcttvnnrakyaacjm','SUPABASE_DB_URL':'fake'}),mock.patch.object(m.briefing.transport,'postgres_environment'),mock.patch.object(m.briefing.transport,'postgres_query',return_value=[{'ready':'f'}]):
            with self.assertRaisesRegex(RuntimeError,'Socle'):m.main()
if __name__=='__main__':main()
