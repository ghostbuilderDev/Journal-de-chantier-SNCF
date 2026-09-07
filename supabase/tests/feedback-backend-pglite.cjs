// Disposable PostgreSQL in memory. Runs identical assertions with and without Mode Chantier.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8').replace(/^\\set ON_ERROR_STOP on\s*$/gm,'');
(async()=>{
 for(const mode of [false,true]){
  const db=new PGlite();
  try{
   const setup=['tests/backend-fixture.sql','tests/backend-production-shape.sql','migrations/20260906000300_v14_2_contraintes_reelles.sql'];
   if(mode) setup.push('migrations/20260906000400_v14_4_mode_chantier.sql');
   setup.push('tests/feedback-backend-fixture.sql','migrations/20260907000500_v14_5_retours_application.sql');
   for(const file of setup) await db.exec(read(file));
   const result=await db.exec(read('tests/feedback-backend-assertions.sql'));
   const count=result.filter(r=>r.fields?.some(f=>['feedback_test_require','feedback_test_denied'].includes(f.name))).length;
   assert.ok(count>=60,`Expected full feedback assertions, got ${count}`);
   console.log(`PASS ${count} feedback SQL assertions ${mode?'with V14.4 notifications':'without V14.4'}; permissions, optimistic edits, pagination, idempotency and private screenshots.`);
  }finally{await db.close()}
 }
 const compat=new PGlite();
 try{
  for(const file of ['tests/backend-fixture.sql','tests/backend-production-shape.sql','migrations/20260906000300_v14_2_contraintes_reelles.sql','tests/feedback-backend-fixture.sql','migrations/20260907000500_v14_5_retours_application.sql']) await compat.exec(read(file));
  const result=await compat.exec(read('tests/backend-assertions.sql'));
  assert.ok(result.filter(r=>r.fields?.some(f=>['test_require','test_denied'].includes(f.name))).length>=50);
  await compat.exec(read('tests/backend-production-assertions.sql'));
  console.log('PASS V14.2 regression assertions with V14.5, including real account deletion and historical schema preservation.');
 }finally{await compat.close()}
})().catch(e=>{console.error(e.message,e.where||'',e.position||'');process.exitCode=1});
