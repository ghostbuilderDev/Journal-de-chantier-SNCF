const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),read=f=>fs.readFileSync(path.join(root,f),'utf8').replace(/^\\set ON_ERROR_STOP on\s*$/gm,'');
const fixture={format:'journal-cr-v15.1',catalog:[
 {id:'scope-a',chantier:'Chantier test',section_key:'catenaire',label:'Secteur A voie 1',sources:[{sheet:'S37',row:5,planned_text:'23h00-05h00'}]},
 {id:'scope-b',chantier:'Chantier test',section_key:'catenaire',label:'SEL 2 secteur B voie 2',sources:[]},
 {id:'zep-a',chantier:'Chantier test',section_key:'itc',label:'ZEP 123 + 456',sources:[]}],
 contacts:[{id:'test-contact',name:'Destinataire exemple',email:'example@example.com',evidence:'inferred'}]};
async function setup(db){for(const f of ['supabase/tests/backend-fixture.sql','supabase/tests/backend-production-shape.sql','supabase/migrations/20260906000300_v14_2_contraintes_reelles.sql','supabase/migrations/20260908000100_v15_cr_encadrement.sql'])await db.exec(read(f));}
async function run(){const db=new PGlite();try{
 await setup(db);
 const messagesBefore=(await db.query('select count(*)::int n from chantier_messages')).rows[0].n;
 const u=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),site='aaaaaaaa-0000-4000-8000-000000000001';
 const login=async n=>db.exec(`reset role;set request.jwt.claim.sub='${u(n)}';set role authenticated;`);
 const api=async(a,p={})=>(await db.query('select journal_cr_api($1,$2) r',[a,p])).rows[0].r;
 const today=(await db.query('select current_date::text d')).rows[0].d,day=n=>new Date(Date.parse(today+'T12:00Z')+n*86400000).toISOString().slice(0,10);
 // A V15 CR already has global times when the additive migration runs.
 await login(1);const old=await api('create',{chantier_id:site,night:day(-1)});
 await api('save',{...old,key:'catenaire',version:1,status:'complete',value:{start:day(-1)+'T21:00:00Z',end:today+'T02:00:00Z',precision:'Ancien global'}});
 await db.exec('reset role');
 for(let i=0;i<2;i++)await db.exec(read('supabase/migrations/20260908000200_v15_1_cr_perimetres.sql'));
 await db.query('select journal_cr_private.import_v151($1)',[fixture]);
 await login(1);assert.equal((await api('detail',old)).sections.find(s=>s.key==='catenaire').value.precision,'Ancien global');
 await assert.rejects(db.query('select journal_cr_private.import_v151($1)',[fixture]),/permission/);
 const r=await api('create',{chantier_id:site,night:today});
 const detail=()=>api('detail',r),section=async key=>(await detail()).sections.find(s=>s.key===key);
 const configure=async(key,ids,extra={})=>api('timing_configure',{...r,key,version:(await section(key)).version,catalog_ids:ids,keep_ids:[],...extra});
 assert.equal((await section('catenaire')).value.mode,'perimeters');assert.deepEqual((await detail()).recipients,[]);
 assert.equal((await api('catalog',{chantier_id:site})).contacts.length,1);
 await configure('catenaire',['scope-a','scope-b']);await configure('itc',['zep-a']);
 let s=await section('catenaire'),a=s.items.find(t=>t.catalog_id==='scope-a'),b=s.items.find(t=>t.catalog_id==='scope-b');
 assert.equal(a.actual_start,null);assert.equal(a.planned_start,null,'Planning never becomes actual or silently assigned planned times');
 await api('timing_assign',{...r,key:'catenaire',timing_id:a.id,version:a.version,responsible:u(2)});
 await api('assign',{...r,key:'catenaire',version:(await section('catenaire')).version,responsible:u(3),contributors:[u(4)]});
 await api('audience',{...r,recipients:['chef@example.com']});
 await login(2);assert.equal((await detail()).sections.length,1);assert.equal((await detail()).recipients.length,0);assert.equal((await api('list',{mine:true})).length,1);
 await assert.rejects(api('catalog',{chantier_id:site}),/encadrant/);
 await assert.rejects(configure('catenaire',[]),/encadrant/);
 await assert.rejects(api('save',{...r,key:'catenaire',version:1,status:'complete',value:{start:today+'T20:00Z',end:day(1)+'T02:00Z'}}),/séparément/);
 await assert.rejects(api('timing_assign',{...r,key:'catenaire',timing_id:a.id,version:2,responsible:u(4)}),/encadrant/);
 a=(await section('catenaire')).items.find(t=>t.id===a.id);
 const payload={...r,key:'catenaire',timing_id:a.id,version:a.version,start:today+'T21:00:00Z',end:day(1)+'T02:00:00Z',status:'auto',comment:'RAS'};
 await api('timing_save',payload);await assert.rejects(api('timing_save',payload),/modifié/);
 await login(4);b=(await section('catenaire')).items.find(t=>t.id===b.id);
 await api('timing_save',{...payload,timing_id:b.id,version:b.version,start:today+'T21:15:00Z'});
 s=await section('catenaire');assert.equal(s.status,'complete');assert.equal(s.items.find(t=>t.id===a.id).updated_name,'Personne 2');assert.equal(s.items.find(t=>t.id===b.id).updated_name,'Personne 4');
 await login(1);a=(await section('catenaire')).items.find(t=>t.id===a.id);
 await api('timing_plan',{...r,key:'catenaire',timing_id:a.id,version:a.version,start:today+'T20:50:00Z',end:day(1)+'T01:55:00Z'});
 await assert.rejects(configure('catenaire',['scope-b']),/motif/);
 await configure('catenaire',['scope-b'],{reason:'Périmètre finalement retiré'});
 a=(await section('catenaire')).items.find(t=>t.id===a.id);assert.equal(a.active,false);assert.ok(a.actual_start);
 await configure('catenaire',['scope-a','scope-b']);
 let itc=(await section('itc')).items[0];
 await api('timing_save',{...r,key:'itc',timing_id:itc.id,version:itc.version,start:today+'T21:00:00Z',end:day(1)+'T02:00:00Z'});
 for(const key of ['arf','technique','securite','synthese'])await api('save',{...r,key,version:(await section(key)).version,status:'non_concerne'});
 await api('validate',r);let d=await detail();assert.equal(d.snapshots.length,1);assert.equal(d.snapshots[0].data.sections.find(s=>s.key==='catenaire').items.length,2);
 await assert.rejects(api('timing_save',payload),/figé/);
 const mail=await api('prepare_send',{ids:[r.id]});assert.match(mail.body,/Secteur A voie 1/);assert.match(mail.body,/SEL 2 secteur B voie 2/);assert.match(mail.body,/ZEP 123 \+ 456/);assert.match(mail.body,/accord \+10 min/);assert.match(mail.body,/restitution \+5 min/);
 await api('reopen',{...r,reason:'Correction des horaires'});assert.equal((await detail()).snapshots[0].data.sections.find(s=>s.key==='catenaire').items.find(t=>t.id===a.id).comment,'RAS');
 const next=await api('create',{chantier_id:site,night:day(1),reuse:true});d=await api('detail',next);
 const copied=d.sections.find(s=>s.key==='catenaire');assert.equal(copied.items.length,2);assert.ok(copied.items.every(t=>!t.actual_start&&!t.actual_end&&!t.planned_start&&!t.planned_end&&!t.comment&&!t.due_at));assert.equal(copied.status,'a_renseigner');
 assert.ok(copied.items.some(t=>t.responsible===u(2)));
 // Old global data is retained on explicit conversion; it cannot silently vanish.
 const oldSection=(await api('detail',old)).sections.find(s=>s.key==='catenaire');await api('timing_configure',{...old,key:'catenaire',version:oldSection.version,catalog_ids:['scope-a'],keep_ids:[]});
 const converted=(await api('detail',old)).sections.find(s=>s.key==='catenaire');assert.ok(converted.items.some(t=>t.comment==='Ancien global'&&t.actual_start));assert.equal(converted.status,'a_confirmer');
 const legacyRow=converted.items.find(t=>!t.catalog_id);await api('timing_assign',{...old,key:'catenaire',timing_id:legacyRow.id,version:legacyRow.version,label:'Secteur ancien confirmé voie 1'});
 assert.equal((await api('detail',old)).sections.find(s=>s.key==='catenaire').items.find(t=>t.id===legacyRow.id).label,'Secteur ancien confirmé voie 1');
 await login(5);await assert.rejects(detail(),/inaccessible/);
 await login(1);await api('timing_assign',{...r,key:'catenaire',timing_id:a.id,version:(await section('catenaire')).items.find(t=>t.id===a.id).version,responsible:''});
 await login(2);await assert.rejects(detail(),/inaccessible/);
 await db.exec('reset role');assert.equal((await db.query('select count(*)::int n from chantier_messages')).rows[0].n,messagesBefore);
 console.log('PASS V15.1: additive migration, legacy retention, private catalog, independent times and authors, conflicts, assignments, collaboration, planned/actual split, explicit removals, frozen email snapshots, copy without hours, revocation and no newsfeed publication.');
 }finally{await db.close();}}
module.exports={setup,fixture};if(require.main===module)run().catch(e=>{console.error(e.message,e.where||'',e.stack);process.exitCode=1});
