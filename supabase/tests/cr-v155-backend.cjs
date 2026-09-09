const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {setup154}=require('./cr-v154-backend.cjs');
async function setup155(db){await setup154(db);await db.exec(fs.readFileSync(path.join(__dirname,'../migrations/20260909000300_v15_5_requests_pdf.sql'),'utf8'));}
module.exports={setup155};
if(require.main===module)(async()=>{
 const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite'),db=new PGlite();try{await setup155(db);
 const uid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),site='aaaaaaaa-0000-4000-8000-000000000001',night=new Date().toISOString().slice(0,10),at=(day,h)=>new Date(Date.parse(night+'T'+h+':00Z')+day*864e5).toISOString();
 const login=async n=>db.exec(`reset role;select set_config('request.jwt.claim.sub','${uid(n)}',false);set role authenticated;`);
 const api=async(a,p={})=>(await db.query('select journal_cr_api($1,$2) r',[a,p])).rows[0].r;
 const prod=async(a,p={})=>(await db.query('select journal_production_api($1,$2) r',[a,{chantier_id:site,night,...p}])).rows[0].r;
 await login(1);const {id}=await api('create',{chantier_id:site,night});let detail=await api('detail',{id});assert.equal(detail.sections.find(s=>s.key==='catenaire').items.length,0);
 const configure=async(key,data,user=2,dispatch=true)=>{const s=(await api('detail',{id})).sections.find(s=>s.key===key);return api('field_configure',{id,key,version:s.version,data,responsible:user?uid(user):null,dispatch});};
 await configure('catenaire',{rows:[{label:'SEL Essai terrain'}]});await configure('itc',{rows:[{label:'ZEP 785',track:'V2'}]},3);await configure('arf',{},4);
 for(const n of [2,3,4,5]){await login(n);assert.deepEqual((await api('context')).sites,[]);assert.deepEqual(await api('list'),[]);for(const a of ['detail','pdf_snapshot','validate','reopen'])await assert.rejects(()=>api(a,{id}),/réservé/);await assert.rejects(()=>api('delete_reports',{ids:[id]}),/réservée/);}
 await login(2);let tasks=await api('tasks');assert.equal(tasks.length,1);let task=await api('task_detail',{task_id:tasks[0].id});assert.equal(task.key,'catenaire');assert.ok(!task.sections&&!task.recipients&&!task.people);assert.equal(task.data.rows[0].label,'SEL Essai terrain');
 const originalVersion=task.task.version;task.data.rows[0].start=at(0,'22:00');task.data.rows[0].end=at(1,'03:00');
 task=await api('task_save',{task_id:task.task.id,version:originalVersion,data:task.data});assert.equal((await api('tasks')).length,1,'save must not complete');
 const sentData=task.data,taskId=task.task.id,sentVersion=task.task.version;
 await login(1);detail=await api('detail',{id});assert.equal(detail.sections.find(s=>s.key==='catenaire').items[0].actual_end,null,'draft is not official');await assert.rejects(()=>api('validate',{id}),/envoi définitif/);
 await login(3);await assert.rejects(()=>api('task_detail',{task_id:taskId}),/inaccessible/);
 await login(2);await assert.rejects(()=>api('task_submit',{task_id:taskId,version:sentVersion,data:sentData}),/Confirmer/);
 await api('task_submit',{task_id:taskId,version:sentVersion,data:sentData,confirmed:true});assert.equal((await api('tasks')).length,0);await api('task_submit',{task_id:taskId,version:sentVersion,data:sentData,confirmed:true});await assert.rejects(()=>api('task_save',{task_id:taskId,version:sentVersion+1,data:sentData}),/déjà transmise/);
 await login(1);detail=await api('detail',{id});assert.ok(detail.sections.find(s=>s.key==='catenaire').items[0].actual_end);await api('request_resend',{id,key:'catenaire',reason:'Vérifier la fin'});
 await login(2);task=await api('task_detail',{task_id:taskId});assert.equal(task.task.correction,'Vérifier la fin');assert.equal(Date.parse(task.data.rows[0].end),Date.parse(sentData.rows[0].end));await api('task_submit',{task_id:taskId,version:task.task.version,data:task.data,confirmed:true});
 await login(1);await api('delete_reports',{ids:[id]});assert.equal((await api('list')).length,0);assert.equal((await api('list',{deleted:true})).length,1);
 await login(3);assert.equal((await api('tasks')).length,0);await login(1);await api('restore_reports',{ids:[id]});assert.equal((await api('list')).length,1);
 await configure('itc',{rows:[]},null,false);await configure('arf',{non_concerne:true},null,false);await configure('technique',{mode:'text',body:'Pose des supports réalisée.'},null,false);
 const sec=(await api('detail',{id})).sections.find(s=>s.key==='securite');await api('safety_clear',{id,key:'securite',version:sec.version});await api('validate',{id});const snap=await api('pdf_snapshot',{id});assert.equal(snap.state,'validated');assert.equal(snap.sections.find(s=>s.key==='technique').value.body,'Pose des supports réalisée.');await assert.rejects(()=>api('prepare_send',{ids:[id]}),/partage manuel/);
 await api('delete_reports',{ids:[id]});await api('restore_reports',{ids:[id]});assert.equal((await api('pdf_snapshot',{id})).state,'validated');
 await login(6);assert.ok((await api('context')).sites.some(s=>s.id===site),'site admin can manage');await api('detail',{id});
 await login(2);const next=new Date(Date.parse(night+'T12:00Z')+864e5).toISOString().slice(0,10);await prod('save',{id:'10000000-0000-4000-8000-000000000001',night:next,version:0,items:[{title:'Travail prévu',progress:null,additional:false}]});await login(1);const found=(await api('list')).find(r=>r.night===next);assert.ok(found,'production-only nights appear');assert.equal((await api('detail',{id:found.id})).sections.find(s=>s.key==='technique').value.production_sheets[0].items[0].title,'Travail prévu');

 const section=(await api('detail',{id:found.id})).sections.find(s=>s.key==='technique');
 await api('field_configure',{id:found.id,key:'technique',version:section.version,responsible:uid(5),dispatch:true,data:{mode:'items',body:'',sheets:section.value.production_sheets}});
 await login(5);const productionTask=(await api('tasks')).find(t=>t.section_key==='technique');let productionDraft=await api('task_detail',{task_id:productionTask.id});productionDraft.data.sheets[0].items[0].progress=75;
 await api('task_submit',{task_id:productionTask.id,version:productionDraft.task.version,data:productionDraft.data,confirmed:true});assert.equal((await api('tasks')).length,0,'assigned reader can submit only their production request');
 await login(1);assert.equal((await api('detail',{id:found.id})).sections.find(s=>s.key==='technique').value.production_sheets[0].items[0].progress,75);
 await db.exec('reset role');const access=(await db.query("select has_function_privilege('authenticated','journal_cr_private.apply_field(uuid,text,jsonb)','execute') as direct,has_table_privilege('authenticated','journal_cr_private.field_requests','select') as tbl")).rows[0];assert.equal(access.direct,false);assert.equal(access.tbl,false);
 console.log('V15.5 SQL: admin scopes, private drafts, explicit submission, retry, correction, soft deletion, frozen PDF, production nights: OK');
 }finally{await db.close();}
})().catch(e=>{console.error(e.message,e.where||'',e.stack);process.exit(1)});
