import importlib.util, unittest, tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('installer',ROOT/'scripts/prepare-v156-update.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Tests(unittest.TestCase):
 def test_existing_files_and_repeat(self):
  old,new=b'ancienne version',b'nouvelle version'
  m.validate_change('app.js',old,new,m.digest(old))
  m.validate_change('app.js',new,new,m.digest(old))
  with self.assertRaises(ValueError):m.validate_change('app.js',b'modification personnelle',new,m.digest(old))
 def test_missing_archive_and_new_files(self):
  m.validate_change('new.js',None,b'code',None)
  with self.assertRaises(ValueError):m.validate_change('app.js',b'code',None,m.digest(b'code'))
 def test_interrupted_v156_release_only_accepts_known_bytes(self):
  previous,new=b'paquet V15.6 interrompu',b'paquet corrige'
  m.validate_change('migration.sql',previous,new,None,[m.digest(previous)])
  m.validate_change('migration.sql',None,new,None,[m.digest(previous)])
  m.validate_change('migration.sql',new,new,None,[m.digest(previous)])
  with self.assertRaises(ValueError):m.validate_change('migration.sql',previous+b' modification personnelle',new,None,[m.digest(previous)])
 def test_symlinks(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);(root/'outside').write_text('garder');(root/'link').symlink_to(root/'outside')
   with self.assertRaises(ValueError):m.target(root,'link')
   self.assertEqual((root/'outside').read_text(),'garder')
 def test_phases(self):
  self.assertFalse(set(m.BACKEND)&set(m.FRONTEND))
  self.assertIn('cr-off.js',m.FRONTEND)
  self.assertIn('supabase/migrations/20260909000400_v15_6_writing_references_delete.sql',m.BACKEND)
  self.assertNotIn('config.js',m.BACKEND+m.FRONTEND)
  self.assertFalse(any('donnees-privees' in f for f in m.BACKEND+m.FRONTEND))
if __name__=='__main__':unittest.main()
