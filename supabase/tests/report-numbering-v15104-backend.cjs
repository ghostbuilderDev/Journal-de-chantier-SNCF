const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {setup15101}=require('./collaboration-v15101-backend.cjs');
const migration=()=>fs.readFileSync(path.join(__dirname,'../migrations/20260910000500_v15_10_4_report_numbers.sql'),'utf8');
async function archiveFixture(db){await db.exec(fs.readFileSync(path.join(__dirname,'report-numbering-fixture.sql'),'utf8'));await db.exec(fs.readFileSync(path.join(__dirname,'../migrations/20260907000700_archive_rapports_journaliers.sql'),'utf8'));}
async function setup15104(db){await setup15101(db);await archiveFixture(db);await db.exec(migration());}
module.exports={setup15104,archiveFixture,migration};
if(require.main===module)(async()=>{
 const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite'),db=new PGlite();
 try{
  await setup15101(db);await archiveFixture(db);
  const uid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),site='aaaaaaaa-0000-4000-8000-000000000001';
  const login=n=>db.exec(`reset role;set request.jwt.claim.sub='${n?uid(n):''}';set role ${n?'authenticated':'anon'}`);
  const api=async(action,payload={})=>(await db.query('select journal_report_api($1,$2) r',[action,payload])).rows[0].r;
  const seed={schema:1,reportSerial:1,reportUid:'old-local-one',meta:{reportNo:'AINM-RJ-000001-LOCAL',date:'2026-09-09',operation:'SST Montereau'},tasks:[{id:'t1',label:'Contrôle V2M',progress:50}],photos:[{dataUrl:'photo-conservee'}],afterWorkSignature:{dataUrl:'signature-conservee'}};
  // Two earlier reports exist only as PDFs. Also retain one frozen report and
  // an unpublished draft that incorrectly says n° 1.
  for(let n=1;n<=2;n++)await db.query("insert into journal_report_uploads(chantier_id,user_id,sha256,file_name,bytes,storage_path) values($1,$2,$3,$4,100,$5)",[site,uid(2),String(n).repeat(64),`RJ_SST_2026-09-0${n}_REF-old-${n}_N00000${n}.pdf`,`legacy/${n}.pdf`]);
  await login(2);let draft=await api('create',{id:crypto.randomUUID(),chantier_id:site,request_id:crypto.randomUUID(),document:seed});
  let frozen=await api('create',{id:crypto.randomUUID(),chantier_id:site,request_id:crypto.randomUUID(),document:{...seed,reportSerial:2,reportUid:'old-two',meta:{...seed.meta,reportNo:'AINM-RJ-000002-LOCAL'}}});
  frozen=await api('validate',{id:frozen.id,version:frozen.version,request_id:crypto.randomUUID(),confirmed:true});
  await db.exec('reset role');await db.exec(migration());
  await login(2);const old=await api('detail',{id:frozen.id});assert.deepEqual(old.document,frozen.document);assert.equal(old.numbering,'legacy');
  assert.equal((await api('detail',{id:draft.id})).numbering,'pending');
  const save={id:draft.id,version:draft.version,request_id:crypto.randomUUID(),document:draft.document};draft=await api('save',save);
  assert.equal(draft.document.reportSerial,3);assert.equal(draft.numbering,'confirmed');assert.equal(draft.document.meta.date,'2026-09-09');assert.deepEqual(draft.document.photos,seed.photos);assert.deepEqual(draft.document.tasks,seed.tasks);assert.deepEqual(draft.document.afterWorkSignature,seed.afterWorkSignature);
  assert.equal((await api('save',save)).document.reportSerial,3,'Lost response retry retains the same number');
  draft=await api('save',{id:draft.id,version:draft.version,request_id:crypto.randomUUID(),document:{...draft.document,reportSerial:1,reportUid:'RESET',meta:{...draft.document.meta,reportNo:'AINM-RJ-000001-RESET'}}});assert.equal(draft.document.reportSerial,3);assert.equal(draft.document.reportUid,draft.id);
  draft=await api('transfer',{id:draft.id,version:draft.version,request_id:crypto.randomUUID(),users:[uid(3),uid(4)]});
  await login(3);draft=await api('save',{id:draft.id,version:draft.version,request_id:crypto.randomUUID(),document:{...draft.document,tasks:[{...draft.document.tasks[0],progress:100}]}});assert.equal(draft.document.reportSerial,3);
  const create={id:crypto.randomUUID(),chantier_id:site,request_id:crypto.randomUUID(),document:seed};let next=await api('create',create);assert.equal(next.document.reportSerial,4);assert.equal((await api('create',create)).document.reportSerial,4);
  // A downloaded/archived PDF must match the authoritative identity.
  const reserve=async(serial=4,options={})=>(await db.query('select to_jsonb(journal_reserve_numbered_pdf($1,$2,$3,$4,$5,$6)) r',[site,'a'.repeat(64),`RJ_SST_REF-${next.document.reportUid}_N${String(serial).padStart(6,'0')}.pdf`,100,options.id||next.id,!!options.imported])).rows[0].r;
  await assert.rejects(reserve(1),/numéro du PDF/);const upload=await reserve();assert.equal(upload.report_id,next.id);assert.equal((await reserve()).id,upload.id);
  await assert.rejects(db.query('select reserve_journal_report($1,$2,$3,$4)',[site,'b'.repeat(64),'RJ_SST_REF-local_N000001.pdf',100]),/Mettez à jour/);
  // A pending legacy upload can resume, including before its client updates.
  await login(2);await db.query('select reserve_journal_report($1,$2,$3,$4)',[site,'1'.repeat(64),'RJ_SST_2026-09-01_REF-old-1_N000001.pdf',100]);
  await login(5);await assert.rejects(api('create',{...create,id:crypto.randomUUID(),request_id:crypto.randomUUID()}),/Droits/);await assert.rejects(reserve(),/Accès/);
  await login(7);await assert.rejects(api('detail',{id:next.id}),/inaccessible/);await login(null);await assert.rejects(api('detail',{id:next.id}),/permission/);
  await db.exec('reset role');await db.query('delete from journal_report_private.reports where id=$1',[next.id]);await db.exec(migration());
  await login(3);next=await api('create',{...create,id:crypto.randomUUID(),request_id:crypto.randomUUID()});assert.equal(next.document.reportSerial,5,'Deletion and repeated migration never recycle a number');
  await assert.rejects(db.query('select * from journal_report_private.numbers'),/permission/);
  await assert.rejects(db.query('select journal_report_private.assign_number()'),/permission/);
  console.log('PASS V15.10.4 numbering: PDF-only history 1/2 -> draft 3 -> new report 4; retries, transfers, edits, deletion and update never recycle a number; old reports unchanged; PDF mismatch rejected; access preserved.');
 }finally{await db.close();}
})().catch(e=>{console.error(e.message,e.where||'',e.stack);process.exitCode=1});
