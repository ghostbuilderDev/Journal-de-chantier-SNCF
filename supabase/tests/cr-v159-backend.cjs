const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {setup158}=require('./cr-v158-backend.cjs');
const migration=()=>fs.readFileSync(path.join(__dirname,'../migrations/20260910000200_v15_9_completion_partagee.sql'),'utf8');
async function setup159(db){await setup158(db);await db.exec(migration());}
module.exports={setup159};
if(require.main===module)(async()=>{
 const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite'),db=new PGlite();
 try{
  await setup159(db);
  const u=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),site='aaaaaaaa-0000-4000-8000-000000000001';
  const login=async n=>db.exec(`reset role;set request.jwt.claim.sub='${n?u(n):''}';set role ${n?'authenticated':'anon'};`);
  const api=async(a,p={})=>(await db.query('select journal_cr_api($1,$2) r',[a,p])).rows[0].r;
  const prod=async(a,p={})=>(await db.query('select journal_production_api($1,$2) r',[a,p])).rows[0].r;
  const night=(await db.query('select current_date::text d')).rows[0].d;
  await login(2);const sheet=await prod('save',{id:crypto.randomUUID(),chantier_id:site,night,version:0,items:[{title:'Pose tendeur 80/07',progress:null,additional:false},{title:'Réglage V2M',progress:null,additional:false}]});
  const id=sheet.completion_id;assert.ok(id);assert.equal(sheet.completion_can_open,false);
  await assert.rejects(api('completion_detail',{id}),/désignés/);
  await login(1);let board=await api('completion_detail',{id});assert.equal(board.sheets[0].items.length,2);assert.equal(board.state,'open');
  board=await api('completion_assign',{id,request_id:crypto.randomUUID(),version:board.version,users:[u(2),u(3),u(5)]});
  const common=()=>({id,request_id:crypto.randomUUID(),generation:board.generation});
  await login(4);assert.equal((await api('tasks')).length,0);await assert.rejects(api('completion_detail',{id}),/désignés/);
  await login(2);let a=await api('completion_detail',{id});assert.equal(a.manager,false);assert.equal(a.people.length,0);assert.equal(a.sections,undefined);assert.equal((await api('tasks'))[0].section_key,'completion');await assert.rejects(api('detail',{id}),/interdit|inaccessible|réserv|autorisé/i);
  const change=(b,index,progress)=>({sheet_id:b.sheets[0].id,index,before:b.sheets[0].items[index],next:{...b.sheets[0].items[index],progress}});
  const patch={...common(),progress:[change(a,0,50)]};await api('completion_patch',patch);
  await login(3);await api('completion_patch',{...common(),progress:[change(a,1,75)]});
  await assert.rejects(api('completion_patch',{...common(),progress:[change(a,0,60)]}),/collègue/);
  let shared=await api('completion_detail',{id});assert.deepEqual(shared.sheets[0].items.map(x=>x.progress),[50,75]);
  await login(2);await api('completion_patch',patch);assert.deepEqual((await api('completion_detail',{id})).sheets[0].items.map(x=>x.progress),[50,75],'retry does not erase another agent');
  const noteid=crypto.randomUUID();shared=await api('completion_patch',{...common(),notes:[{id:noteid,version:0,category:'top',body:'Briefing clair, voie V2M identifiée'}]});
  await login(5);assert.equal((await api('tasks')).length,1);await api('task_ack',{task_id:id,token:String(board.generation)});assert.equal((await api('tasks'))[0].dismissed_token,String(board.generation));
  await api('completion_patch',{...common(),progress:[change(shared,0,100)]});
  await assert.rejects(api('completion_submit',{id,request_id:crypto.randomUUID(),version:shared.version,confirmed:true}),/collègue/);
  shared=await api('completion_detail',{id});await assert.rejects(api('completion_submit',{id,request_id:crypto.randomUUID(),version:shared.version}),/Confirmer/);
  const submission={id,request_id:crypto.randomUUID(),version:shared.version,confirmed:true};shared=await api('completion_submit',submission);assert.equal(shared.state,'submitted');assert.equal(shared.report_state,'draft');assert.equal((await api('tasks')).length,0);
  await api('completion_submit',submission);
  await login(2);assert.equal((await api('tasks')).length,0);await assert.rejects(api('completion_patch',{...common(),progress:[]}),/déjà transmises/);await assert.rejects(prod('save',{id:shared.sheets[0].id,chantier_id:site,night,version:shared.sheets[0].version,items:shared.sheets[0].items}),/déjà transmise/);
  await login(1);let full=await api('detail',{id});assert.equal(full.state,'draft');assert.equal(full.sections.find(x=>x.key==='technique').status,'complete');assert.equal(full.sections.find(x=>x.key==='securite').notes[0].body,'Briefing clair, voie V2M identifiée');
  shared=await api('completion_patch',{...common(),notes:[{...shared.notes[0],body:'Briefing clair : V2M identifiée et contrôlée'}]});
  full=await api('detail',{id});assert.ok(full.sections.find(x=>x.key==='securite').notes[0].body.includes('contrôlée'));
  board=await api('completion_assign',{id,request_id:crypto.randomUUID(),version:shared.version,users:[u(2),u(3)],correction:'Préciser le réglage'});
  await login(5);await assert.rejects(api('completion_detail',{id}),/désignés/);assert.equal((await api('tasks')).length,0);
  await login(2);assert.equal((await api('tasks'))[0].correction,'Préciser le réglage');await assert.rejects(api('completion_patch',{...patch,request_id:crypto.randomUUID()}),/renvoyée/);
  await login(1);await assert.rejects(api('validate',{id}),/Complétude/);
  await db.exec('reset role');await db.exec(migration());await login(2);assert.equal((await api('completion_detail',{id})).notes.length,1);
  await assert.rejects(db.query('select * from journal_cr_private.completion_notes'),/permission/);
  await login(null);await assert.rejects(api('completion_detail',{id}),/permission/);
  await login(1);await api('delete_reports',{ids:[id]});await assert.rejects(api('completion_detail',{id}),/inaccessible/);
  const fresh=await api('create',{chantier_id:site,night});assert.notEqual(fresh.id,id);
  const freshBoard=await api('completion_detail',fresh);assert.equal(freshBoard.sheets.length,0);assert.equal(freshBoard.notes.length,0);assert.equal(freshBoard.agents.length,0);
  await assert.rejects(api('completion_patch',{id:fresh.id,request_id:crypto.randomUUID(),generation:freshBoard.generation,progress:[change(shared,0,60)]}),/déplacé|retiré/);
  await db.exec('reset role');assert.equal((await db.query('select count(*)::int n from journal_cr_private.completion_receipts where report_id=$1',[id])).rows[0].n,0);

  console.log('PASS V15.9 SQL: production linked, shared assignments, distinct-row merge, same-row conflict, retry idempotency, reader scoped access, submit distinct from save, manager review/reopen, privacy, repeat migration.');
 }finally{await db.close();}
})().catch(e=>{console.error(e.message,e.where||'',e.stack);process.exitCode=1;});
