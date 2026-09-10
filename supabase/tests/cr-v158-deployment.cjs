const assert=require('node:assert/strict'),{execFileSync}=require('node:child_process'),fs=require('node:fs'),path=require('node:path');
const {setup157}=require('./cr-v157-backend.cjs');
const cwd=path.resolve(__dirname,'../..');
(async()=>{
 const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite'),db=new PGlite();
 try{
  // PGlite has no pg_cron worker: supply its SQL interface only in this fixture.
  await db.exec(`create schema cron; create table cron.job(jobid bigserial primary key,jobname text unique,schedule text,command text,active boolean default true);
   create function cron.schedule(text,text,text) returns bigint language sql as $$ insert into cron.job(jobname,schedule,command) values($1,$2,$3) on conflict(jobname) do update set command=excluded.command returning jobid $$;`);
  await setup157(db);await db.exec('create table if not exists public.journal_sql_migrations(migration_name text primary key,applied_at timestamptz default now());');
  const sql=execFileSync(process.env.PYTHON||'python3',['scripts/deploy-v158-release.py','--print-sql'],{cwd,encoding:'utf8'});
  await db.exec(sql);await db.exec(fs.readFileSync(path.join(__dirname,'cr-v158-postgres.sql'),'utf8'));
  assert.equal((await db.query('select count(*)::int n from public.journal_sql_migrations')).rows[0].n,1);
  // Check the actual installer's queries against the disposable database too.
  const capture=`import importlib.util,os,json,contextlib,io
spec=importlib.util.spec_from_file_location('release','scripts/deploy-v158-release.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
os.environ.update(SUPABASE_PROJECT_ID='eqfwdcttvnnrakyaacjm',SUPABASE_DB_URL='fixture',SUPABASE_ACCESS_TOKEN='fixture')
queries=[]
def query(sql,*args):
 queries.append(sql)
 return [{'ready':True}]
m.briefing.transport.postgres_environment=lambda *args:None
m.briefing.transport.postgres_query=query
with contextlib.redirect_stdout(io.StringIO()):m.main()
print(json.dumps(queries))
`;
  const checks=JSON.parse(execFileSync(process.env.PYTHON||'python3',['-c',capture],{cwd,encoding:'utf8'}));
  assert.ok(checks.length>=7);
  for(const query of checks){const result=await db.query(query);if(query.startsWith('select'))assert.equal(result.rows[0].ready,true,query);}
  console.log('V15.8 deployment OK: real SQL envelope, ledger and every installer readiness query.');
 }finally{await db.close();}
})().catch(e=>{console.error(e.message,e.where||'');process.exit(1)});
