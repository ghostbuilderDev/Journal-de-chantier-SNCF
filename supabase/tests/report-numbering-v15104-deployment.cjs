const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const {setup15101}=require('./collaboration-v15101-backend.cjs'),{archiveFixture}=require('./report-numbering-v15104-backend.cjs');
const cwd=path.resolve(__dirname,'../..');
(async()=>{const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite'),db=new PGlite();try{
 await setup15101(db);await archiveFixture(db);await db.exec('create table if not exists public.journal_sql_migrations(migration_name text primary key,applied_at timestamptz default now())');
 const sql=execFileSync('python3',['scripts/deploy-v15104-release.py','--print-sql'],{cwd,encoding:'utf8'});await db.exec(sql);await db.exec(execFileSync('python3',['scripts/deploy-v15104-release.py','--print-repair-sql'],{cwd,encoding:'utf8'}));
 assert.equal((await db.query('select count(*)::int n from public.journal_sql_migrations')).rows[0].n,2);
 await db.exec(fs.readFileSync(path.join(__dirname,'report-numbering-v15104-postgres.sql'),'utf8'));
 const source=`import importlib.util,json,os,contextlib,io
spec=importlib.util.spec_from_file_location('release','scripts/deploy-v15104-release.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
os.environ.update(SUPABASE_PROJECT_ID='eqfwdcttvnnrakyaacjm',SUPABASE_DB_URL='fixture',SUPABASE_ACCESS_TOKEN='fixture')
queries=[]
def query(sql,*args):
 queries.append(sql)
 return [{'ready':True}]
m.briefing.transport.postgres_environment=lambda *args:None
m.briefing.transport.postgres_query=query
with contextlib.redirect_stdout(io.StringIO()):m.main()
print(json.dumps(queries))`;
 const queries=JSON.parse(execFileSync('python3',['-c',source],{cwd,encoding:'utf8'}));assert.ok(queries.length>=7);
 for(const q of queries){const r=await db.query(q);if(q.startsWith('select'))assert.equal(r.rows[0].ready,true,q);}
 console.log('PASS V15.10.4 deployment: exact registered transaction, repeat does not reset counter, actual PostgreSQL checks and installer readiness queries.');
}finally{await db.close();}})().catch(e=>{console.error(e.stack);process.exitCode=1;});
