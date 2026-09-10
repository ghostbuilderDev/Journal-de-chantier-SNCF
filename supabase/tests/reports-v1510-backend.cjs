const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {setup159}=require('./cr-v159-backend.cjs');
const migration=()=>fs.readFileSync(path.join(__dirname,'../migrations/20260910000300_v15_10_rapports_mentions.sql'),'utf8');
async function setup1510(db){await setup159(db);await db.exec(migration());}
module.exports={setup1510};
if(require.main===module)(async()=>{
 const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite'),db=new PGlite();
 try{
 await setup1510(db);
 const u=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),site='aaaaaaaa-0000-4000-8000-000000000001';
 const login=async n=>db.exec(`reset role;set request.jwt.claim.sub='${n?u(n):''}';set role ${n?'authenticated':'anon'};`);
 const api=async(a,p={})=>(await db.query('select journal_report_api($1,$2) r',[a,p])).rows[0].r;
 const inbox=async()=>(await db.query("select journal_cr_api('inbox') r")).rows[0].r;
 const document={schema:1,meta:{reportNo:'RJ-100',date:'2026-09-10',operation:'RCT'},tasks:[{id:'work1',label:'Pose 2 tendeurs',progress:50}],photos:[{dataUrl:'data:image/png;base64,cGhvdG8='}],afterWorkSignature:{dataUrl:'signature'},settings:{admin:{pinHash:'private'},mappings:{x:'test'}}};
 await login(2);const id=crypto.randomUUID(),create={id,chantier_id:site,request_id:crypto.randomUUID(),document};let r=await api('create',create);assert.equal(r.version,1);assert.equal(r.document.settings.admin,undefined);assert.equal(r.document.photos[0].dataUrl,document.photos[0].dataUrl);await api('create',create);
 let save={id,version:r.version,request_id:crypto.randomUUID(),document:{...document,meta:{...document.meta,executionNotes:'Première contribution'}}};r=await api('save',save);await api('save',save);assert.equal(r.history.length,2);
 await assert.rejects(api('transfer',{id,version:r.version,request_id:crypto.randomUUID(),users:[u(5)]}),/Destinataire/);
 const transfer={id,version:r.version,request_id:crypto.randomUUID(),users:[u(3),u(4)]};r=await api('transfer',transfer);assert.equal(r.can_edit,false);await api('transfer',transfer);assert.equal(r.history.length,3);
 await login(7);await assert.rejects(api('detail',{id}),/inaccessible/);assert.equal((await inbox()).filter(n=>n.daily_report_id===id).length,0);
 await login(3);assert.equal((await inbox()).filter(n=>n.daily_report_id===id).length,1);let other=await api('detail',{id});assert.equal(other.document.meta.executionNotes,'Première contribution');assert.equal(other.document.afterWorkSignature.dataUrl,'signature');assert.equal(other.can_edit,true);
 await login(4);let b=await api('detail',{id});r=await api('save',{id,version:b.version,request_id:crypto.randomUUID(),document:{...b.document,meta:{...b.document.meta,executionNotes:'Contribution 4'}}});
 await login(3);await assert.rejects(api('save',{id,version:other.version,request_id:crypto.randomUUID(),document:other.document}),/participant/);
 r=await api('detail',{id});r=await api('transfer',{id,version:r.version,request_id:crypto.randomUUID(),users:[u(2)]});
 await login(4);await assert.rejects(api('save',{id,version:r.version,request_id:crypto.randomUUID(),document:r.document}),/transféré/);
 await login(2);r=await api('detail',{id});const validate={id,version:r.version,request_id:crypto.randomUUID(),confirmed:true};r=await api('validate',validate);await api('validate',validate);assert.equal(r.state,'validated');assert.equal(r.validated_by,u(2));await assert.rejects(api('save',{...save,version:r.version,request_id:crypto.randomUUID()}),/validé/);
 // Mention delivered only as a targeted popup; ordinary inbox messages remain available.
 const m=crypto.randomUUID();await db.query("insert into chantier_messages(id,chantier_id,author_id,author_name,body,message_type,mentioned_users) values($1,$2,$3,'spoofed','@Personne.3 Consulte le rapport','Info',$4)",[m,site,u(2),[u(3)]]);
 await login(3);let n=(await inbox()).find(n=>n.message_id===m);assert.equal(n.is_mention,true);assert.notEqual(n.actor_name,'spoofed');
 await login(4);n=(await inbox()).find(n=>n.message_id===m);assert.equal(n.is_mention,false);
 await login(2);await db.query('update chantier_messages set body=$2,mentioned_users=$3 where id=$1',[m,'@Personne.3 @Personne.4 précision',[u(3),u(4)]]);
 await login(4);assert.equal((await inbox()).filter(n=>n.message_id===m).length,1);assert.equal((await inbox()).find(n=>n.message_id===m).is_mention,true);
 await login(7);await assert.rejects(api('directory',{chantier_id:site}),/inaccessible/);
 await login(2);await assert.rejects(db.query('select * from journal_report_private.reports'),/permission/);
 await login(null);await assert.rejects(api('detail',{id}),/permission/);
 await db.exec('reset role');await db.exec(migration());await login(2);assert.equal((await api('detail',{id})).state,'validated');
 console.log('PASS V15.10: complete state/photos/signatures retained, successive and multi-recipient transfers, version conflicts, idempotency, validation locking, private access and targeted mentions.');
 }finally{await db.close();}
})().catch(e=>{console.error(e.message,e.where||'',e.stack);process.exitCode=1;});
