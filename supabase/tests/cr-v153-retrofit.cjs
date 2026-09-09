// A populated V15.2 report stays intact through V15.3, including frozen emails.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');const{setup152}=require('./cr-v152-backend.cjs');
const read=f=>fs.readFileSync(path.resolve(__dirname,'../..',f),'utf8');
(async()=>{const db=new PGlite();try{
 await setup152(db);const u='00000000-0000-4000-8000-000000000001',site='aaaaaaaa-0000-4000-8000-000000000001';
 const api=async(a,p={})=>(await db.query('select journal_cr_api($1,$2) r',[a,p])).rows[0].r;
 await db.exec(`set request.jwt.claim.sub='${u}';set role authenticated`);const night=(await db.query('select current_date::text d')).rows[0].d;
 const r=await api('create',{chantier_id:site,night});let d=await api('detail',r);
 await api('timing_table',{...r,key:'catenaire',version:d.sections.find(s=>s.key==='catenaire').version,responsible:u,rows:[{label:'SEL ancienne référence',selected:true,planned_start:night+'T20:00Z',planned_end:night+'T23:30Z'}]});
 d=await api('detail',r);let sec=d.sections.find(s=>s.key==='catenaire');let row=sec.items[0];await api('timing_batch',{...r,key:'catenaire',version:sec.version,rows:[{timing_id:row.id,version:row.version,start:night+'T20:01Z',end:night+'T23:28Z',comment:'Donnée historique.'}]});
 d=await api('detail',r);await api('timing_table',{...r,key:'itc',version:d.sections.find(s=>s.key==='itc').version,rows:[]});
 await api('arf_save',{...r,key:'arf',version:d.sections.find(s=>s.key==='arf').version,start:night+'T20:15Z',end:night+'T23:25Z'});
 await api('production_save',{...r,key:'technique',version:d.sections.find(s=>s.key==='technique').version,body:'Production conservée.'});await api('safety_clear',{...r,key:'securite',version:d.sections.find(s=>s.key==='securite').version});
 await api('audience',{...r,recipients:['recipient@example.test']});await api('validate',r);const before=await api('detail',r);await db.exec('reset role');
 const mail=(await db.query('select journal_cr_private.email_text($1) body',[[before.snapshots[0].data]])).rows[0].body;
 for(let i=0;i<2;i++)await db.exec(read('supabase/migrations/20260909000100_v15_3_cr_tables.sql'));
 await db.exec('set role authenticated');const after=await api('detail',r);assert.deepEqual(after.snapshots,before.snapshots);assert.deepEqual(after.sections,before.sections);assert.deepEqual(after.recipients,before.recipients);await db.exec('reset role');
 assert.equal((await db.query('select journal_cr_private.email_text($1) body',[[after.snapshots[0].data]])).rows[0].body,mail);
 const arf=after.snapshots[0].data;arf.sections.find(s=>s.key==='arf').value.planned_start=night+'T20:10Z';arf.sections.find(s=>s.key==='arf').value.planned_end=night+'T23:30Z';
 const updatedMail=(await db.query('select journal_cr_private.email_text($1) body',[[arf]])).rows[0].body;assert.match(updatedMail,/ARF\n • ARF\n   Prévu :/);assert.match(updatedMail,/Réel :/);
 const {emailMarkup}=await import('../functions/journal-cr-send-v152/markup.mjs');assert.match(emailMarkup(updatedMail),/<table/);assert.ok(emailMarkup(updatedMail).includes(new Intl.DateTimeFormat('fr-FR',{hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZone:'Europe/Paris'}).format(new Date(night+'T20:10Z'))));
 console.log('PASS V15.3 retrofit: actual hours, labels, authors, recipients and immutable snapshots retained; old validated email byte-identical; new ARF planned/actual formatted by the existing sender.');
 }finally{await db.close();}})().catch(e=>{console.error(e.message,e.where||'');process.exitCode=1});
