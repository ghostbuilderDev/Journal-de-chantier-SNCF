const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const {setup153}=require('./cr-v153-backend.cjs');
const root=path.resolve(__dirname,'../..'),migration='supabase/migrations/20260909000200_v15_4_production_email.sql';
async function setup154(db){await setup153(db);await db.exec(fs.readFileSync(path.join(root,migration),'utf8'));}
async function run(){const db=new PGlite();try{
 await setup154(db);await db.exec(fs.readFileSync(path.join(root,migration),'utf8'));
 const u=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),site='aaaaaaaa-0000-4000-8000-000000000001',other='bbbbbbbb-0000-4000-8000-000000000001';
 const login=async n=>db.exec(`reset role;set request.jwt.claim.sub='${u(n)}';set role authenticated;`);
 const api=async(a,p={})=>(await db.query('select journal_cr_api($1,$2) r',[a,p])).rows[0].r;
 const prod=async(a,p)=>(await db.query('select journal_production_api($1,$2) r',[a,p])).rows[0].r;
 const night=new Date().toISOString().slice(0,10),id='cccccccc-0000-4000-8000-000000000011';
 const plan={id,chantier_id:site,night,items:[{title:'Pose de deux supports',progress:null,additional:false},{title:'Réglage',progress:null,additional:false}]};
 await login(2);const first=await prod('save',plan);assert.equal(first.version,1);assert.equal((await prod('save',plan)).message_id,first.message_id);
 assert.equal((await prod('list',{chantier_id:site,night})).length,1);
 await assert.rejects(prod('list',{chantier_id:other,night}),/inaccessible/);
 await login(1);const r=await api('create',{chantier_id:site,night,test_audience:true});let detail=await api('detail',r),s=detail.sections.find(s=>s.key==='technique');
 assert.equal(s.value.production_sheets[0].items.length,2);assert.equal(s.status,'en_cours');assert.equal(detail.recipients.length,0);
 await assert.rejects(api('validate',r),/pourcentage/);
 const updated={...plan,version:1,items:[{...plan.items[0],progress:50},{...plan.items[1],progress:100}]};
 await login(2);const second=await prod('save',updated);assert.equal(second.message_id,first.message_id);assert.equal(second.version,2);
 await assert.rejects(prod('save',{...updated,items:[{...updated.items[0],progress:25}]}),/modifiée/);
 await assert.rejects(prod('save',{...updated,version:2,items:[{...updated.items[0],progress:101}]}),/100/);
 await login(1);s=(await api('detail',r)).sections.find(s=>s.key==='technique');assert.equal(s.status,'complete');
 const extra={id:'cccccccc-0000-4000-8000-000000000012',version:0,items:[{title:'Dégagement imprévu',additional:true,progress:100},{title:'Travail reporté',additional:false,progress:0}]};
 await assert.rejects(api('production_progress',{...r,version:s.version,body:'',sheets:[extra,{...updated,version:0,items:[{...updated.items[0],progress:25}]}]}),/modifiée/);
 assert.equal((await prod('list',{chantier_id:site,night})).length,1,'failed batch rolls back extra work too');
 await api('production_progress',{...r,version:s.version,body:'',sheets:[{...updated,version:2},extra]});
 s=(await api('detail',r)).sections.find(s=>s.key==='technique');assert.equal(s.status,'complete');assert.match(s.value.production_text,/50 % réalisé/);
 await api('audience',{...r,recipients:['test@example.fr'],collaborators:[]});
 for(const key of ['catenaire','itc']){s=(await api('detail',r)).sections.find(s=>s.key===key);await api('timing_sheet',{...r,key,version:s.version,configure:true,rows:[]});}
 s=(await api('detail',r)).sections.find(s=>s.key==='arf');await api('arf_save',{...r,key:'arf',version:s.version,non_concerne:true});
 s=(await api('detail',r)).sections.find(s=>s.key==='securite');await api('safety_clear',{...r,key:'securite',version:s.version});
 await api('validate',r);const before=(await api('detail',r)).snapshots;
 const preview=await api('preview',{ids:[r.id]});assert.match(preview.body,/Dégagement imprévu/);assert.match(preview.body,/0 % réalisé/);
 const delivery=await api('prepare_send',{ids:[r.id]});assert.equal(preview.body,delivery.body);assert.equal(preview.subject,delivery.subject);assert.deepEqual(preview.recipients,delivery.recipients);
 await login(2);await assert.rejects(prod('save',{...updated,version:2,items:[{title:'Modification tardive',progress:100,additional:false}]}),/rectificatif/);await assert.rejects(api('preview',{ids:[r.id]}),/accessibles/);
 await login(1);assert.deepEqual((await api('detail',r)).snapshots,before);
 await api('reopen',{...r,reason:'Précision du bilan'});await prod('save',{...updated,version:2,items:[{...updated.items[0],progress:75},updated.items[1]]});assert.deepEqual((await api('detail',r)).snapshots,before);
 await db.exec('reset role');assert.equal((await db.query('select count(*)::int n from public.chantier_messages where production_id=$1',[id])).rows[0].n,1,'updates never duplicate the feed message');
 await db.exec('set role anon');await assert.rejects(prod('list',{chantier_id:site,night}),/permission/);
 console.log('PASS V15.4: one production message, shared percentages, atomic concurrent edits, access denial, frozen snapshots, exact email preview, idempotent migration.');
 }finally{await db.close();}}
module.exports={setup154};if(require.main===module)run().catch(e=>{console.error(e.stack,e.where||'');process.exitCode=1});
