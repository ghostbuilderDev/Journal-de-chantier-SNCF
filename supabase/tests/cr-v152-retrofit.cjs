const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const root=require('path').resolve(__dirname,'../..');const{setup}=require(root+'/supabase/tests/cr-v151-backend.cjs'),fs=require('fs'),assert=require('node:assert/strict');
(async()=>{const db=new PGlite();try{
 await setup(db);await db.exec(fs.readFileSync(root+'/supabase/migrations/20260908000200_v15_1_cr_perimetres.sql','utf8'));
 await db.exec("set request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';set role authenticated;");
 const api=async(a,p={})=>(await db.query('select journal_cr_api($1,$2) r',[a,p])).rows[0].r;
 const r=await api('create',{chantier_id:'aaaaaaaa-0000-4000-8000-000000000001',night:new Date().toISOString().slice(0,10)});
 await api('assign',{...r,key:'catenaire',version:1,responsible:'00000000-0000-4000-8000-000000000002'});
 await api('save',{...r,key:'securite',version:1,status:'complete',value:{digest:'Observation existante avant V15.2'}});
 await db.exec('reset role');const migration=fs.readFileSync(root+'/supabase/migrations/20260908000300_v15_2_cr_simple.sql','utf8');await db.exec(migration);await db.exec(migration);
 await db.exec("set request.jwt.claim.sub='00000000-0000-4000-8000-000000000002';set role authenticated;");
 const tasks=await api('tasks');assert.equal(tasks.length,1);assert.equal(tasks[0].report_id,r.id);
 const safety=(await api('detail',r)).sections.find(s=>s.key==='securite');assert.equal(safety.notes.length,1);assert.equal(safety.notes[0].body,'Observation existante avant V15.2');
 console.log('PASS retrofit: assignment already present in V15.1 appears without reassignment; existing safety digest survives twice-applied upgrade.');
 }finally{await db.close();}})().catch(e=>{console.error(e.message,e.where);process.exitCode=1;});
