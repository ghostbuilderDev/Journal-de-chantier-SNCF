// Disposable database only. Reproduce direct grants inherited from Supabase defaults.
const assert=require('node:assert/strict'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {setup15101}=require('./collaboration-v15101-backend.cjs');
const {archiveFixture}=require('./report-numbering-v15104-backend.cjs');
const cwd=path.resolve(__dirname,'../..');
const printed=option=>execFileSync('python3',['scripts/deploy-v15104-release.py',option],{cwd,encoding:'utf8'});
(async()=>{const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite'),db=new PGlite();try{
 await setup15101(db);
 await db.exec('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;');
 await archiveFixture(db);
 await db.exec("create function public.unrelated_fixture() returns boolean language sql as 'select true'; create table public.journal_sql_migrations(migration_name text primary key,applied_at timestamptz default now());");
 await db.exec(printed('--print-sql'));
 const checks=JSON.parse(execFileSync('python3',['-c',"import importlib.util,json;s=importlib.util.spec_from_file_location('m','scripts/deploy-v15104-release.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m);print(json.dumps(m.CHECKS))"],{cwd,encoding:'utf8'}));
 const flags=[];for(const q of checks)flags.push((await db.query(q)).rows[0].ready);
 assert.deepEqual(flags,[true,true,true,false,true,false],'The legacy archive privileges reproduce the failed installation');
 const uid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),site='aaaaaaaa-0000-4000-8000-000000000001';
 const login=n=>db.exec(`reset role;set request.jwt.claim.sub='${n?uid(n):''}';set role ${n?'authenticated':'anon'}`);
 const api=async(action,payload={})=>(await db.query('select journal_report_api($1,$2) r',[action,payload])).rows[0].r;
 await login(2);
 const doc={schema:1,meta:{date:'2026-09-10',operation:'SST Montereau'},tasks:[{label:'Contrôle V2M',progress:50}],photos:[{dataUrl:'fixture-photo'}],afterWorkSignature:{dataUrl:'fixture-signature'}};
 const report=await api('create',{id:crypto.randomUUID(),request_id:crypto.randomUUID(),chantier_id:site,document:doc});
 await db.exec('reset role');
 const snapshot=async()=>(await db.query(`select jsonb_build_object(
  'reports',(select jsonb_agg(to_jsonb(r) order by r.id) from journal_report_private.reports r),
  'numbers',(select jsonb_agg(to_jsonb(n) order by n.serial) from journal_report_private.numbers n),
  'counter',(select jsonb_agg(to_jsonb(c)) from journal_report_private.number_counter c),
  'uploads',(select jsonb_agg(to_jsonb(u) order by u.id) from journal_report_uploads u),
  'messages',(select jsonb_agg(to_jsonb(m) order by m.id) from chantier_messages m),
  'documents',(select jsonb_agg(to_jsonb(d) order by d.id) from chantier_documents d),
  'signatures',(select jsonb_agg(to_jsonb(s) order by s.id) from journal_briefing_private.signatures s)
 ) snapshot`)).rows[0].snapshot;
 const before=await snapshot();
 const definition=(await db.query("select pg_get_functiondef('public.finalize_journal_report(uuid)'::regprocedure) definition")).rows[0].definition;
 await db.exec(printed('--print-repair-sql'));
 assert.deepEqual(await snapshot(),before,'A retry after the recorded numbering migration must preserve every report and counter');
 assert.equal((await db.query("select pg_get_functiondef('public.finalize_journal_report(uuid)'::regprocedure) definition")).rows[0].definition,definition);
 for(const q of checks)assert.equal((await db.query(q)).rows[0].ready,true,q);
 assert.equal((await db.query("select has_function_privilege('anon','public.unrelated_fixture()','EXECUTE') allowed")).rows[0].allowed,true,'No blanket change to other features');
 // Raw ACL repair is idempotent; registered deploys apply it only once.
 const fs=require('node:fs');await db.exec(fs.readFileSync(path.join(cwd,'supabase/migrations/20260910000600_v15_10_5_report_archive_acl.sql'),'utf8'));
 assert.deepEqual(await snapshot(),before);
 assert.equal((await db.query('select count(*)::int n from journal_sql_migrations')).rows[0].n,2);
 await login(2);
 const detail=await api('detail',{id:report.id});assert.deepEqual(detail.document,report.document);
 const serial=String(detail.document.reportSerial).padStart(6,'0');
 const upload=(await db.query('select to_jsonb(journal_reserve_numbered_pdf($1,$2,$3,100,$4,false)) r',[site,'a'.repeat(64),`RJ_fixture_REF-${report.id}_N${serial}.pdf`,report.id])).rows[0].r;
 await db.query("insert into storage.objects(bucket_id,name,owner,owner_id,metadata) values('chantier-documents',$1,$2::uuid,$2::uuid::text,'{\"size\":100,\"mimetype\":\"application/pdf\"}'::jsonb)",[upload.storage_path,uid(2)]);
 const archived=(await db.query('select to_jsonb(finalize_journal_report($1)) r',[upload.id])).rows[0].r;
 assert.equal(archived.id,upload.id);assert.match(archived.file_name,new RegExp('_N'+serial+'[.]pdf$'));
 assert.equal((await db.query('select to_jsonb(finalize_journal_report($1)) r',[upload.id])).rows[0].r.id,archived.id);
 await login(5);await assert.rejects(db.query('select finalize_journal_report($1)',[upload.id]),/non autorisée/);
 await login(null);await assert.rejects(db.query('select finalize_journal_report($1)',[upload.id]),/permission/);
 assert.equal((await db.query("select has_function_privilege('anon','public.journal_briefing_sign(text,text,jsonb)','EXECUTE') allowed")).rows[0].allowed,true);
 console.log('PASS V15.10.5 recovery: inherited direct grants reproduced, ACL repaired after committed numbering migration, no data/number changes, archive and retry work, reader/anonymous denied, QR intact.');
}finally{await db.close();}})().catch(e=>{console.error(e.stack);process.exitCode=1;});
