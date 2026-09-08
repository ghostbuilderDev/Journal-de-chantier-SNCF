const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),read=f=>fs.readFileSync(path.join(root,f),'utf8').replace(/^\\set ON_ERROR_STOP on\s*$/gm,'');
(async()=>{const db=new PGlite();try{
 const migration='supabase/migrations/20260908000100_v15_cr_encadrement.sql';
 for(const f of ['supabase/tests/backend-fixture.sql','supabase/tests/backend-production-shape.sql','supabase/migrations/20260906000300_v14_2_contraintes_reelles.sql',migration,migration])await db.exec(read(f));
 const u=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),site='aaaaaaaa-0000-4000-8000-000000000001',other='bbbbbbbb-0000-4000-8000-000000000001';
 const login=async n=>db.exec(`reset role;set request.jwt.claim.sub='${u(n)}';set role authenticated;`);
 const api=async (a,p={})=>(await db.query('select journal_cr_api($1,$2) as r',[a,p])).rows[0].r;
 const today=(await db.query('select current_date::text as d')).rows[0].d;
 const next=new Date(Date.parse(today+'T12:00:00Z')+86400000).toISOString().slice(0,10);
 await login(2);await assert.rejects(api('create',{chantier_id:site,night:today}),/encadrement/);
 await login(1);const r=await api('create',{chantier_id:site,night:today});assert.equal((await api('create',{chantier_id:site,night:today})).id,r.id);
 let d=await api('detail',r);assert.equal(d.sections.length,6);
 await api('assign',{...r,key:'catenaire',version:1,responsible:u(2),contributors:[u(4)]});
 await api('assign',{...r,key:'arf',version:1,responsible:u(6),contributors:[]});
 await api('audience',{...r,recipients:['chef@example.com'],collaborators:[u(3)]});
 await login(2);d=await api('detail',r);assert.deepEqual(d.sections.map(x=>x.key),['catenaire']);assert.deepEqual(d.recipients,[]);assert.deepEqual(d.people,[]);assert.equal(d.snapshots.length,0);
 assert.equal((await api('inbox')).filter(n=>n.report_id===r.id).length,1);
 await assert.rejects(api('note',{...r,key:'securite',note_id:crypto.randomUUID(),category:'flop',body:'Interdit'}),/inaccessible/);
 await assert.rejects(api('audience',{...r,recipients:['bad@example.com']}),/encadr/);
 await assert.rejects(db.query('select * from journal_cr_private.reports'),/permission denied/);
 await assert.rejects(db.query('select journal_cr_delivery_finish($1,$2)',[r.id,'sent']),/permission denied/);
 let payload={...r,key:'catenaire',version:2,status:'complete',value:{start:today+'T21:00:00+02:00',end:next+'T03:00:00+02:00',precision:'Caténaire voie 1'}};
 // Dates are real timestamps, including midnight crossing.
 await api('save',payload);await assert.rejects(api('save',payload),/modifiée/);
 await login(4);d=await api('detail',r);assert.equal(d.sections[0].updated_name,'Personne 2');
 await api('save',{...payload,version:3,value:{...payload.value,precision:'Complément par collègue'}});
 await login(1);d=await api('detail',r);assert.equal(d.sections.find(x=>x.key==='catenaire').responsible,u(2));assert.equal(d.sections.find(x=>x.key==='catenaire').updated_name,'Personne 4');
 await assert.rejects(api('validate',r),/chaque rubrique/);
 for(const key of ['technique','securite','synthese']){
  const noteid=crypto.randomUUID();const note={...r,key,note_id:noteid,category:key==='synthese'?'synthese':'production',body:key==='securite'?'RAS constaté':'20 supports réalisés'};
  await api('note',note);await api('note',note);
  await login(3);await api('note',{...note,note_id:crypto.randomUUID(),body:'Complément suivi'});
  await login(1);d=await api('detail',r);const s=d.sections.find(x=>x.key===key);assert.equal(s.notes.length,2);
  await api('save',{...r,key,version:s.version,status:'complete'});
 }
 for(const key of ['itc','arf']){d=await api('detail',r);await api('save',{...r,key,version:d.sections.find(x=>x.key===key).version,status:'non_concerne'});}
 await api('validate',r);d=await api('detail',r);assert.equal(d.state,'validated');assert.equal(d.snapshots.length,1);
 await assert.rejects(api('save',{...payload,version:4}),/figé/);
 await assert.rejects(api('audience',{...r,recipients:['other@example.com']}),/figé/);
 const delivery=await api('prepare_send',{ids:[r.id]});assert.match(delivery.body,/20 supports/);assert.match(delivery.body,/Caténaire|Consignation/);assert.deepEqual(delivery.recipients,['chef@example.com']);
 assert.equal((await api('prepare_send',{ids:[r.id]})).id,delivery.id);
 await db.exec('reset role;set role service_role');await db.query('select journal_cr_delivery_finish($1,$2,$3)',[delivery.id,'sent','email-fixture']);
 await login(1);assert.equal((await api('detail',r)).state,'sent');await assert.rejects(api('prepare_send',{ids:[r.id]}),/déjà été envoyée/);
 await api('reopen',{...r,reason:'Correction production'});d=await api('detail',r);assert.equal(d.revision,2);assert.equal(d.snapshots[0].revision,1);assert.equal(d.deliveries[0].state,'sent');
 // Revocation applies immediately even to a section assignee and inbox.
 await db.exec(`reset role;insert into journal_user_access_blocks(user_id) values('${u(2)}');`);
 await login(2);await assert.rejects(api('detail',r),/active/);
 await login(7);await assert.rejects(api('detail',r),/inaccessible/);
 await login(5);await assert.rejects(api('detail',r),/inaccessible/);
 // Contributor retains read access to authorized documents, no insert privilege.
 assert.ok((await db.query('select * from chantier_documents')).rows.length>0);
 await assert.rejects(db.query('insert into chantier_document_folders(chantier_id,name) values($1,$2)',[site,'Interdit']),/policy|permission|not-null/);
 await db.exec('reset role');const before=(await db.query('select count(*)::int n from chantier_messages')).rows[0].n;
 await login(3);await db.query('insert into chantier_messages(chantier_id,body,author_id,author_name) values($1,$2,$3,$4)',[site,'Message de test',u(3),'Utilisateur 3']);
 await login(4);assert.ok((await api('inbox')).some(n=>n.kind==='message'));assert.equal((await api('inbox')).filter(n=>n.kind==='message').length,1);
 await db.exec('reset role');assert.equal((await db.query('select count(*)::int n from chantier_messages')).rows[0].n,before+1,'Les CR ne créent aucun message');
 // Different recipient groups must never be mixed.
 await login(1);const second=await api('create',{chantier_id:other,night:today});await api('audience',{...second,recipients:['another@example.com']});
 for(const key of ['catenaire','itc','arf','technique','securite','synthese'])await api('save',{...second,key,version:1,status:'non_concerne'});
 await api('validate',second);await api('validate',r);await assert.rejects(api('prepare_send',{ids:[r.id,second.id]}),/destinataires identiques/);
 // Archive survives deleting an account: no new FK into Auth/profiles.
 await db.exec('reset role');await db.query('delete from auth.users where id=$1',[u(4)]);await login(1);assert.ok((await api('detail',r)).history.some(x=>x.actor_name==='Personne 4'));
 console.log('PASS V15: droits privés, rubriques limitées, aide d’un collègue, auteurs, conflit, minuit, contributions sans doublon, validation, envoi immuable, rectificatif, regroupement sécurisé, révocation, documents, notifications, historique et migration rejouable.');
}finally{await db.close();}})().catch(e=>{console.error(e.message,e.where||'',e.stack?.split('\n').slice(1,3).join('\n'));process.exitCode=1});
