const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {setup157}=require('./cr-v157-backend.cjs');
const migration=()=>fs.readFileSync(path.join(__dirname,'../migrations/20260910000100_v15_8_preparation_briefing.sql'),'utf8');
async function setup158(db){await setup157(db);await db.exec(migration());}
module.exports={setup158};
if(require.main===module)(async()=>{
 const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite'),db=new PGlite();
 try{
  await setup158(db);
  const u=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),site='aaaaaaaa-0000-4000-8000-000000000001',other='bbbbbbbb-0000-4000-8000-000000000001';
  const login=async n=>db.exec(`reset role;set request.jwt.claim.sub='${n?u(n):''}';set role ${n?'authenticated':'anon'};`);
  const api=async(a,p={})=>(await db.query('select journal_cr_api($1,$2) r',[a,p])).rows[0].r;
  const manage=async(a,p={})=>(await db.query('select journal_briefing_manage($1,$2) r',[a,p])).rows[0].r;
  const sign=async(t,a,p={})=>(await db.query('select journal_briefing_sign($1,$2,$3) r',[t,a,p])).rows[0].r;
  const d=(await db.query('select current_date::text d')).rows[0].d;
  const plus=(day,n)=>new Date(Date.parse(day+'T12:00Z')+n*86400000).toISOString().slice(0,10),yesterday=plus(d,-1);
  await login(1);const source=await api('create',{chantier_id:site,night:yesterday});let detail=await api('detail',source);
  for(const key of ['catenaire','itc'])await api('field_configure',{...source,key,version:detail.sections.find(s=>s.key===key).version,responsible:u(2),dispatch:true,data:{rows:[{label:key==='itc'?'ZEP 785':'SEL 1 + 3',track:key==='itc'?'V1M':'',planned_start:yesterday+'T21:55:00Z',planned_end:d+'T03:00:00Z'}]}});
  await login(2);for(const task of await api('tasks')){const t=await api('task_detail',{task_id:task.id});t.data.rows[0].start=yesterday+'T22:05:00Z';t.data.rows[0].end=d+'T03:05:00Z';await api('task_submit',{task_id:task.id,version:t.task.version,data:t.data,confirmed:true});}
  await login(1);detail=await api('detail',source);const before=JSON.stringify(detail);
  const request={chantier_id:site,night:d,source_id:source.id,request_id:crypto.randomUUID()},r=await api('copy_previous',request);
  assert.notEqual(r.id,source.id);assert.equal((await api('copy_previous',request)).id,r.id);await assert.rejects(api('copy_previous',{...request,request_id:crypto.randomUUID()}),/existe déjà/);
  const copied=await api('detail',r);for(const key of ['catenaire','itc']){const s=copied.sections.find(s=>s.key===key),t=s.items.find(t=>t.active);assert.equal(t.actual_start,null);assert.equal(t.actual_end,null);assert.equal(t.comment,'');assert.ok(t.planned_start.startsWith(d));assert.equal(s.responsible,u(2));assert.equal(s.status,'a_renseigner');assert.notEqual(t.id,detail.sections.find(s=>s.key===key).items[0].id);}
  assert.equal(copied.field_requests.length,0);assert.equal(copied.snapshots.length,0);assert.equal(JSON.stringify(await api('detail',source)),before);
  const arf=copied.sections.find(s=>s.key==='arf');await api('field_configure',{...r,key:'arf',version:arf.version,responsible:u(2),dispatch:true,data:{planned_start:'not a time',planned_end:'not a time'}});
  await login(2);const task=(await api('tasks')).find(t=>t.report_id===r.id&&t.section_key==='arf');let t=await api('task_detail',{task_id:task.id});await api('task_save',{task_id:task.id,version:t.task.version,data:{start:d+'T21:00:00Z',planned_start:'invalid'}});t=await api('task_detail',{task_id:task.id});assert.equal(t.data.planned_start,null);await api('task_submit',{task_id:task.id,version:t.task.version,confirmed:true,data:{start:d+'T21:00:00Z',end:plus(d,1)+'T03:00:00Z'}});
  await assert.rejects(api('copy_previous',{...request,night:plus(d,1),request_id:crypto.randomUUID()}),/administrateurs/);
  await login(6);assert.equal((await api('previous_options',{chantier_id:site,night:plus(d,1)})).length,2);await assert.rejects(api('previous_options',{chantier_id:other,night:d}),/administrateurs/);
  await login(5);await assert.rejects(manage('open',{id:crypto.randomUUID(),chantier_id:site,date:d,title:'Briefing',token:'a'.repeat(64)}),/contribution/);
  await login(2);const s={id:crypto.randomUUID(),chantier_id:site,date:d,title:'Briefing chantier test',token:'a'.repeat(64)};assert.equal((await manage('open',s)).state,'open');assert.equal((await manage('open',s)).id,s.id);
  const hidden={...s,id:crypto.randomUUID(),token:'b'.repeat(64)};await manage('open',hidden);
  await login(3);await assert.rejects(manage('poll',{id:s.id}),/inaccessible/);
  await login(null);await assert.rejects(manage('poll',{id:s.id}),/permission/);await assert.rejects(db.query('select * from journal_briefing_private.signatures'),/permission/);
  const context=await sign(s.token,'context');assert.equal(context.open,true);assert.ok(!('signatures' in context));assert.ok(!('created_by' in context));await assert.rejects(sign('c'.repeat(64),'context'),/inconnu/);
  // Synthetic valid-size PNG header; browser test below uses a real drawn PNG.
  const png=Buffer.alloc(150);Buffer.from('89504e470d0a1a0a','hex').copy(png);png.writeUInt32BE(800,16);png.writeUInt32BE(260,20);
  const entry={id:crypto.randomUUID(),nom:'Petit',prenom:'Agent',fonction:'RSO',entreprise:'Entreprise',signature:'data:image/png;base64,'+png.toString('base64')};
  assert.equal((await sign(s.token,'submit',entry)).received,true);assert.equal((await sign(s.token,'submit',entry)).id,entry.id);
  await assert.rejects(sign(hidden.token,'submit',entry),/déjà été utilisée/);
  await assert.rejects(sign(s.token,'submit',{...entry,id:crypto.randomUUID(),nom:'<img src=x>'}),/correctement/);
  await assert.rejects(sign(s.token,'submit',{...entry,id:crypto.randomUUID(),signature:'data:image/svg+xml;base64,PHN2Zz4='}),/PNG/);
  await login(2);assert.equal((await manage('poll',{id:s.id})).signatures.length,1);await manage('close',{id:s.id});
  await login(null);await assert.rejects(sign(s.token,'submit',{...entry,id:crypto.randomUUID()}),/fermé/);assert.equal((await sign(s.token,'submit',entry)).received,true,'A retry after closing receives its own acknowledgement');
  await db.exec('reset role');await db.exec(migration());await login(1);assert.equal((await manage('poll',{id:s.id})).signatures.length,1);assert.equal((await api('detail',r)).sections.find(s=>s.key==='arf').value.planned_start,null);
  console.log('PASS V15.8 SQL: explicit independent CR copy, dates shifted, real hours empty, no old requests, ARF actual only, contributor/manager/reader permissions, private QR session, anonymous write-only validation, retry, closure, idempotent migration.');
 }finally{await db.close();}
})().catch(e=>{console.error(e.message,e.where||'',e.stack);process.exitCode=1;});
