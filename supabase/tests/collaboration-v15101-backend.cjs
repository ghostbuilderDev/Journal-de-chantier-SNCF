const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {setup1510}=require('./reports-v1510-backend.cjs');
const migration=()=>fs.readFileSync(path.join(__dirname,'../migrations/20260910000400_v15_10_1_signatures_notifications.sql'),'utf8');
async function setup15101(db){await setup1510(db);await db.exec(migration());}
module.exports={setup15101};
if(require.main===module)(async()=>{
 const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite'),db=new PGlite();
 try{
  // Create a receipt before the update to verify that a phone may safely retry it.
  await setup1510(db);
  const u=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),site='aaaaaaaa-0000-4000-8000-000000000001';
  const login=async n=>db.exec(`reset role;set request.jwt.claim.sub='${n?u(n):''}';set role ${n?'authenticated':'anon'};`);
  const report=async(a,p={})=>(await db.query('select journal_report_api($1,$2) r',[a,p])).rows[0].r;
  const manage=async(a,p={})=>(await db.query('select journal_briefing_manage($1,$2) r',[a,p])).rows[0].r;
  const sign=async(t,a,p={})=>(await db.query('select journal_briefing_sign($1,$2,$3) r',[t,a,p])).rows[0].r;
  const day=(await db.query('select current_date::text d')).rows[0].d,session={id:crypto.randomUUID(),chantier_id:site,date:day,title:'Séance de contrôle',token:'a'.repeat(64)};
  await login(2);await manage('open',session);
  const png=Buffer.alloc(150);Buffer.from('89504e470d0a1a0a','hex').copy(png);png.writeUInt32BE(800,16);png.writeUInt32BE(260,20);
  const old={id:crypto.randomUUID(),nom:'Dupré',prenom:'Émile',fonction:'RSO',entreprise:'Entreprise Martin',signature:'data:image/png;base64,'+png.toString('base64')};
  await login(null);await sign(session.token,'submit',old);
  await db.exec('reset role');await db.exec(migration());
  await login(null);assert.equal((await sign(session.token,'submit',old)).received,true);
  const entry={...old,id:crypto.randomUUID(),nom:'  dupont  ',entreprise:' Entreprise Énergie '};await sign(session.token,'submit',entry);await sign(session.token,'submit',entry);
  await login(2);let people=(await manage('poll',{id:session.id})).signatures;
  const current=people.find(p=>p.id===entry.id);assert.equal(current.nom,'DUPONT');assert.equal(current.entreprise,'ENTREPRISE ÉNERGIE');assert.equal(current.prenom,'Émile');assert.equal(current.signature,entry.signature);
  assert.equal(people.find(p=>p.id===old.id).nom,'Dupré','The migration must not rewrite previous signed records');
  const other={...session,id:crypto.randomUUID(),token:'b'.repeat(64)};await manage('open',other);
  await login(null);await assert.rejects(sign(other.token,'submit',entry),/déjà été utilisée/);await assert.rejects(sign(session.token,'submit',{...entry,nom:'Autre'}),/déjà été utilisée/);
  await login(2);await manage('close',{id:session.id});await login(null);await sign(session.token,'submit',old);await sign(session.token,'submit',entry);await assert.rejects(sign(session.token,'submit',{...entry,id:crypto.randomUUID()}),/fermé/);
  // Signals and reports obey the same registered-user permissions. A signal
  // carries only one's UUID and a revision, never any private document data.
  await login(2);let r=await report('create',{id:crypto.randomUUID(),chantier_id:site,request_id:crypto.randomUUID(),document:{schema:1,meta:{reportNo:'RJ-101',date:day,operation:'RCT'},tasks:[{label:'Tendeur',progress:50}],photos:[{dataUrl:'photo'}]}});
  r=await report('transfer',{id:r.id,version:r.version,request_id:crypto.randomUUID(),users:[u(3),u(4)]});
  await login(3);let signal=(await db.query('select * from journal_notification_signals')).rows;assert.equal(signal.length,1);assert.equal(signal[0].user_id,u(3));assert.deepEqual(Object.keys(signal[0]).sort(),['revision','user_id']);
  await assert.rejects(db.query('update journal_notification_signals set revision=99'),/permission/);
  await login(7);assert.equal((await db.query('select * from journal_notification_signals')).rows.length,0);
  await login(null);await assert.rejects(db.query('select * from journal_notification_signals'),/permission/);
  await login(2);const message=crypto.randomUUID();await db.query("insert into chantier_messages(id,chantier_id,author_id,author_name,body,message_type,mentioned_users) values($1,$2,$3,'Personne 2','Vérifiez la voie','Info',$4)",[message,site,u(2),[u(3)]]);
  await login(3);assert.ok(Number((await db.query('select revision from journal_notification_signals')).rows[0].revision)>Number(signal[0].revision));
  const before=JSON.stringify((await report('detail',{id:r.id})).document);r=await report('detail',{id:r.id});r=await report('transfer',{id:r.id,version:r.version,request_id:crypto.randomUUID(),users:[u(2)]});await login(2);r=await report('detail',{id:r.id});assert.equal(JSON.stringify(r.document),before);r=await report('validate',{id:r.id,version:r.version,confirmed:true,request_id:crypto.randomUUID()});assert.equal(r.state,'validated');assert.equal(r.validated_by,u(2));
  await db.exec('reset role');await db.exec(migration());assert.equal((await db.query("select count(*)::int n from pg_publication_tables where pubname='supabase_realtime' and tablename='journal_notification_signals'")).rows[0].n,1);
  assert.equal((await db.query('select count(*)::int n from journal_briefing_private.signatures')).rows[0].n,2);
  console.log('PASS V15.10.1 SQL: server uppercase, old receipt retries, correct/closed session, private signals, publication, transfers with complete data and validation; repeat update retains data.');
 }finally{await db.close();}
})().catch(e=>{console.error(e.stack,e.where||'');process.exitCode=1;});
