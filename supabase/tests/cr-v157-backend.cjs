const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {setup156}=require('./cr-v156-backend.cjs');
const migration=()=>fs.readFileSync(path.join(__dirname,'../migrations/20260909000500_v15_7_reference_catalogue.sql'),'utf8');
async function setup157(db){await setup156(db);await db.exec(migration());}
module.exports={setup157};
if(require.main===module)(async()=>{
 const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite'),db=new PGlite();
 try{
  await setup156(db);
  const uid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
  const login=async n=>db.exec(`reset role;select set_config('request.jwt.claim.sub','${uid(n)}',false);set role authenticated;`);
  const api=async(a,p={})=>(await db.query('select journal_cr_api($1,$2) r',[a,p])).rows[0].r;
  const site='aaaaaaaa-0000-4000-8000-000000000001',night='2026-09-09';
  await login(1);const {id}=await api('create',{chantier_id:site,night});
  let r=await api('detail',{id});const s=r.sections.find(x=>x.key==='catenaire');
  await api('field_configure',{id,key:'catenaire',version:s.version,responsible:uid(2),dispatch:true,data:{rows:[{label:'SEL 1 + 3 périmètre personnalisé',start:'2026-09-09T21:55:00Z',end:null}]}});
  await login(2);const tasks=await api('tasks');assert.equal(tasks.length,1);
  await db.exec('reset role');const before=(await db.query('select to_jsonb(t) value from journal_cr_private.timings t order by id')).rows;
  await db.exec(migration());await db.exec(migration());
  assert.deepEqual((await db.query('select to_jsonb(t) value from journal_cr_private.timings t order by id')).rows,before);
  const catalogue=JSON.parse(fs.readFileSync(path.join(__dirname,'../../data/cr-references-v157.json'))).entries;
  const stored=(await db.query('select * from journal_cr_private.references_v156 order by id')).rows;
  assert.deepEqual(stored,catalogue.sort((a,b)=>a.id.localeCompare(b.id)));
  await login(1);r=await api('detail',{id});assert.equal(r.choices.length,37);assert.equal(r.itc_choices.length,27);
  const samois=r.choices.find(c=>c.label==='SEL 1 SR Samois - St Mammes V1');assert.ok(samois);assert.equal(samois.sector,'SR Samois - St Mammes V1');
  assert.ok(r.choices.some(c=>c.label.includes('Dordives')));assert.ok(r.choices.some(c=>c.label.includes('Montereau')));
  assert.ok(samois.sources.some(s=>s.sheet==='WE 24-25'&&s.cell==='W5'));
  await login(2);assert.deepEqual(await api('tasks'),tasks);await assert.rejects(()=>api('detail',{id}),/réservé/);
  await assert.rejects(()=>db.query('select * from journal_cr_private.references_v156'),/permission denied/);
  await login(3);assert.deepEqual(await api('tasks'),[]);
  await db.exec('reset role;set role anon');await assert.rejects(()=>api('list'),/permission denied/);
  console.log('V15.7 catalogue: 64 exact source references, existing times and private requests preserved; idempotent migration OK.');
 }finally{await db.close();}
})().catch(e=>{console.error(e.message,e.where||'');process.exit(1);});
