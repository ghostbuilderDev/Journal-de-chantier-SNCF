// Isolated, in-memory PostgreSQL only. Native PostgreSQL17 runs the same SQL in CI.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {PGlite} = require(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root,p),'utf8').replace(/^\\set ON_ERROR_STOP on\s*$/gm,'');
const setup = ['tests/backend-fixture.sql','tests/backend-production-shape.sql','migrations/20260906000300_v14_2_contraintes_reelles.sql','migrations/20260906000400_v14_4_mode_chantier.sql'];
(async()=>{
 const db=new PGlite();
 try {
  for(const f of setup) await db.exec(read(f));
  const results=await db.exec(read('tests/mode-backend-assertions.sql'));
  const count=results.filter(r=>r.fields?.some(f=>['mode_test_require','mode_test_denied'].includes(f.name))).length;
  assert.ok(count>=60,`Mode assertions ran (${count})`);
  console.log(`PASS ${count} mode session, scope, privacy, grouping, delivery, retry and revoke assertions.`);
 } finally {await db.close()}
 const compat=new PGlite();
 try {
  for(const f of setup) await compat.exec(read(f));
  const results=await compat.exec(read('tests/backend-assertions.sql'));
  const count=results.filter(r=>r.fields?.some(f=>['test_require','test_denied'].includes(f.name))).length;
  assert.ok(count>=50);
  await compat.exec(read('tests/backend-production-assertions.sql'));
  console.log(`PASS ${count} V14.2 security/assertions and real-schema assertions with V14.4 installed.`);
 } finally {await compat.close()}
})().catch(e=>{console.error(e.message,e.where||'',e.position||'');process.exitCode=1});
