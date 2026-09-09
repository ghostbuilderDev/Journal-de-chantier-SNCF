const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {setup155}=require('./cr-v155-backend.cjs');
const migration=()=>fs.readFileSync(path.join(__dirname,'../migrations/20260909000400_v15_6_writing_references_delete.sql'),'utf8');
async function setup156(db){await setup155(db);await db.exec(migration());}
module.exports={setup156};
if(require.main===module)(async()=>{const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite'),db=new PGlite();try{
 await setup156(db);await db.exec(migration());
 const uid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),site='aaaaaaaa-0000-4000-8000-000000000001',night=new Date().toISOString().slice(0,10);
 const login=async n=>db.exec(`reset role;select set_config('request.jwt.claim.sub','${uid(n)}',false);set role authenticated;`);
 const api=async(a,p={})=>(await db.query('select journal_cr_api($1,$2) r',[a,p])).rows[0].r;
 const prod=async(a,p={})=>(await db.query('select journal_production_api($1,$2) r',[a,{chantier_id:site,night,...p}])).rows[0].r;
 await login(2);const pid='10000000-0000-4000-8000-000000000011';await prod('save',{id:pid,version:0,items:[{title:'Ancien travail',progress:50,additional:false}]});
 await login(1);const {id}=await api('create',{chantier_id:site,night});let r=await api('detail',{id});assert.equal(r.sections.find(s=>s.key==='technique').value.production_sheets.length,1);
 assert.equal(r.choices.length,31);assert.equal(r.itc_choices.length,22);const associated=r.choices.find(c=>c.label.startsWith('Sél 27+29'));assert.match(associated.sector,/Saint Mammès-Montereau/);assert.ok(associated.sources.every(c=>c.cell.startsWith('W')));assert.ok(!JSON.stringify(r.choices).includes('Coactivité'));
 const section=r.sections.find(s=>s.key==='catenaire');await api('field_configure',{id,key:'catenaire',version:section.version,data:{rows:[{label:'SEL 27+29 du Sr Saint Mammès-Montereau V1',start:new Date().toISOString()}]},responsible:uid(2),dispatch:true});
 await login(2);const task=(await api('tasks'))[0];assert.ok(task);await assert.rejects(()=>api('delete_reports',{ids:[id]}),/réservée/);await assert.rejects(()=>api('detail',{id}),/réservé/);
 await login(1);await api('delete_reports',{ids:[id]});await api('delete_reports',{ids:[id]});assert.deepEqual(await api('list'),[]);assert.deepEqual(await api('list',{deleted:true}),[]);await assert.rejects(()=>api('restore_reports',{ids:[id]}),/restauration/);
 await login(2);assert.deepEqual(await api('tasks'),[]);await assert.rejects(()=>api('task_save',{task_id:task.id,version:1,data:{rows:[]}}),/inaccessible/);
 // Editing an old journal production must not recreate the removed CR.
 await prod('save',{id:pid,version:1,items:[{title:'Ancien travail',progress:75,additional:false}]});
 await login(1);assert.deepEqual(await api('list'),[]);const fresh=await api('create',{chantier_id:site,night,reuse:true});assert.notEqual(fresh.id,id);r=await api('detail',fresh);assert.equal(r.revision,1);assert.equal(r.field_requests.length,0);assert.equal(r.sections.find(s=>s.key==='catenaire').items.length,0);assert.equal(r.sections.find(s=>s.key==='technique').value.production_sheets?.length||0,0);assert.ok(!JSON.stringify(r).includes('Ancien travail'));
 await login(2);await prod('save',{id:'10000000-0000-4000-8000-000000000012',version:0,items:[{title:'Nouveau travail',progress:100,additional:false}]});await login(1);r=await api('detail',fresh);assert.deepEqual(r.sections.find(s=>s.key==='technique').value.production_sheets.map(p=>p.items[0].title),['Nouveau travail']);
 // Legacy soft deletion can be replaced directly, without restoring prior replies.
 await db.exec('reset role');await db.query('update journal_cr_private.reports set deleted_at=now() where id=$1',[fresh.id]);await login(1);const replacement=await api('create',{chantier_id:site,night});assert.notEqual(replacement.id,fresh.id);assert.ok(!JSON.stringify(await api('detail',replacement)).includes('Nouveau travail'));
 await db.exec('reset role');for(const table of ['sections','field_requests','timings','audit','notifications','snapshots']){const count=(await db.query(`select count(*)::int n from journal_cr_private.${table} where report_id=$1`,[id])).rows[0].n;assert.equal(count,0,table+' cascades');}
 const perms=(await db.query("select has_function_privilege('authenticated','journal_cr_private.api_v155(text,jsonb)','execute') direct,has_table_privilege('authenticated','journal_cr_private.references_v156','select') tbl")).rows[0];assert.equal(perms.direct,false);assert.equal(perms.tbl,false);
 await login(7);assert.equal((await db.query('select journal_writing_access($1,false) ok',[site])).rows[0].ok,false);await login(2);assert.equal((await db.query('select journal_writing_access($1,true) ok',[site])).rows[0].ok,true);await assert.rejects(()=>db.query('select journal_delete_site_v156($1)',[site]),/propriétaire/);
 await login(1);await db.query('select journal_delete_site_v156($1)',[site]);assert.deepEqual(await api('list'),[]);
 console.log('V15.6 SQL OK: source-linked catalog, roles, permanent deletion, inaccessible former tasks, independent blank nights, production generation, site removal.');
 }finally{await db.close();}})().catch(e=>{console.error(e.message,e.where||'');process.exit(1)});
