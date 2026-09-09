const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const {setup152}=require('./cr-v152-backend.cjs');
const root=path.resolve(__dirname,'../..'),migration='supabase/migrations/20260909000100_v15_3_cr_tables.sql';
const read=f=>fs.readFileSync(path.join(root,f),'utf8').replace(/^\\set ON_ERROR_STOP on\s*$/gm,'');
async function setup153(db){await setup152(db);await db.exec(read('supabase/tests/feedback-backend-fixture.sql'));await db.exec(read('supabase/migrations/20260907000500_v14_5_retours_application.sql'));await db.exec(read(migration));}
async function run(){const db=new PGlite();try{
 await setup153(db);await db.exec('revoke execute on function public.journal_feedback_create_thread(uuid,text,text,text,text) from authenticated');await db.exec(read(migration));
 const u=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),site='aaaaaaaa-0000-4000-8000-000000000001';
 const login=async n=>db.exec(`reset role;set request.jwt.claim.sub='${u(n)}';set role authenticated;`);
 const api=async(a,p={})=>(await db.query('select journal_cr_api($1,$2) r',[a,p])).rows[0].r;
 const monday=(await db.query("select date_trunc('week',current_date)::date::text d")).rows[0].d;
 const day=n=>new Date(Date.parse(monday+'T12:00Z')+n*864e5).toISOString().slice(0,10);
 await login(1);const r=await api('create',{chantier_id:site,night:monday});
 const section=async key=>(await api('detail',r)).sections.find(s=>s.key===key);
 const rows=[{label:'SEL 1 + 3 · voie 1',selected:true,planned_start:day(0)+'T21:00Z',planned_end:day(1)+'T03:00Z',start:day(0)+'T21:05Z'}, {label:'Secteur Montereau voie 2',selected:true,planned_start:day(0)+'T21:10Z',planned_end:day(1)+'T03:15Z'}];
 let s=await section('catenaire'),config={...r,key:'catenaire',configure:true,version:s.version,responsible:u(2),remember_week:true,rows};
 // Config, attribution, hours and notifications must all roll back together.
 await assert.rejects(api('timing_sheet',{...config,rows:[rows[0],{...rows[1],start:day(1)+'T02:00Z',end:day(0)+'T20:00Z'}]}),/incohérents/);
 assert.equal((await section('catenaire')).items.length,0);
 await login(2);assert.equal((await api('tasks')).length,0);await login(1);
 await api('timing_sheet',config);await assert.rejects(api('timing_sheet',config),/modifié/);
 s=await section('catenaire');assert.equal(s.items.length,2);assert.ok(s.items.find(t=>t.label.startsWith('SEL')).actual_start);
 await login(2);assert.equal((await api('tasks')).length,1);s=await section('catenaire');
 await assert.rejects(api('timing_sheet',{...r,key:'catenaire',configure:true,version:s.version,rows}),/encadrant/);
 const actuals=s.items.map(t=>({id:t.id,version:t.version,start:t.actual_start||day(0)+'T21:15Z',end:day(1)+'T03:10Z',comment:'Contrôle effectué',status:'auto'}));
 await api('timing_sheet',{...r,key:'catenaire',version:s.version,rows:actuals});assert.equal((await api('tasks')).length,0);
 await login(3);await assert.rejects(api('timing_sheet',{...r,key:'catenaire',version:s.version,rows:actuals}),/inaccessible/);
 await login(1);s=await section('catenaire');const unchanged=s.items.map(t=>({id:t.id,version:t.version,selected:true,label:t.label,planned_start:t.planned_start,planned_end:t.planned_end,start:t.actual_start,end:t.actual_end,status:'auto',comment:t.comment}));
 const before=s.items.map(t=>[t.id,t.updated_by,t.version]);
 await api('timing_sheet',{...r,key:'catenaire',version:s.version,configure:false,rows:unchanged,remember_week:true});
 assert.deepEqual((await section('catenaire')).items.map(t=>[t.id,t.updated_by,t.version]),before,'Reading/saving unchanged hours preserves the actual contributor');
 await assert.rejects(api('timing_sheet',{...r,key:'catenaire',version:s.version,configure:true,rows:unchanged.slice(0,1),responsible:u(2)}),/motif/);
 // ARF has one planned pair and one actual pair, with manager-only planned hours.
 let arf=await section('arf');await api('arf_save',{...r,key:'arf',version:arf.version,responsible:u(2),planned_start:day(0)+'T21:30Z',planned_end:day(1)+'T03:30Z',remember_week:true});
 await login(2);arf=await section('arf');await assert.rejects(api('arf_save',{...r,key:'arf',version:arf.version,planned_start:day(0)+'T19:00Z'}),/encadrant/);
 await api('arf_save',{...r,key:'arf',version:arf.version,start:day(0)+'T21:35Z',end:day(1)+'T03:25Z'});
 assert.equal(Date.parse((await section('arf')).value.planned_start),Date.parse(day(0)+'T21:30Z'));
 await login(1);const next=await api('create',{chantier_id:site,night:day(1),reuse:true});const nextArf=(await api('detail',next)).sections.find(s=>s.key==='arf');
 assert.equal(Date.parse(nextArf.value.planned_start),Date.parse(day(1)+'T21:30Z'));assert.equal(Date.parse(nextArf.value.planned_end),Date.parse(day(2)+'T03:30Z'));assert.ok(!nextArf.value.start&&!nextArf.value.end);
 // Feedback still works for an admitted contributor after the complete CR stack.
 await login(2);const tid='cccccccc-0000-4000-8000-000000000009';
 const created=(await db.query('select public.journal_feedback_create_thread($1,$2,$3,$4,$5) r',[tid,'Photo absente du PDF','Description du défaut constaté','bug',null])).rows[0].r;
 assert.equal(created.id,tid);assert.equal(created.category,'bug');
 await db.query('select public.journal_feedback_create_reply($1,$2,$3)',['dddddddd-0000-4000-8000-000000000009',tid,'Une précision.']);
 assert.equal((await db.query('select public.journal_feedback_get($1) r',[tid])).rows[0].r.reply_count,1);
 await assert.rejects(db.query('select * from journal_cr_private.timings'),/permission/);await assert.rejects(db.query("select journal_cr_private.api_v152('tasks','{}')"),/permission/);
 await db.exec('reset role;set role anon');await assert.rejects(api('tasks'),/permission/);
 console.log('PASS V15.3: atomic planned/actual tables, rollback, conflicts, private attribution, historical preservation, ARF planned pair and weekly reuse, active feedback publications/replies, anonymous denial, idempotent migration.');
 }finally{await db.close();}}
module.exports={setup153};if(require.main===module)run().catch(e=>{console.error(e.message,e.where||'');process.exitCode=1});
