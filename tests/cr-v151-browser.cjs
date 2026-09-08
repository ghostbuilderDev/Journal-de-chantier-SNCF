const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),http=require('node:http');
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {setup,fixture}=require('../supabase/tests/cr-v151-backend.cjs');
const root=path.resolve(__dirname,'..');
(async()=>{const db=new PGlite();let browser,server;
 try{
  await setup(db);await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20260908000200_v15_1_cr_perimetres.sql'),'utf8'));
  await db.query('select journal_cr_private.import_v151($1)',[fixture]);
  server=http.createServer((req,res)=>{const name=new URL(req.url,'http://localhost').pathname;
   if(name==='/harness'){res.end('<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles-v13.css"><link rel="stylesheet" href="/cr-off.css"></head><body><button id="notificationBtn">Alertes</button><button id="launch">CR off</button><script src="/cr-off.js"></script></body></html>');return;}
   const p=path.resolve(root,'.'+name);if(!p.startsWith(root+path.sep)||!fs.existsSync(p)||!fs.statSync(p).isFile()){res.writeHead(404);res.end();return;}
   res.setHeader('Content-Type',p.endsWith('.css')?'text/css':p.endsWith('.js')?'text/javascript':'text/html');res.end(fs.readFileSync(p));
  });await new Promise(r=>server.listen(0,'127.0.0.1',r));
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||undefined,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
  const page=await browser.newPage({viewport:{width:390,height:844},locale:'fr-FR',timezoneId:'Europe/Paris'});page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  let lane=Promise.resolve();await page.exposeBinding('database',(_,args)=>{const job=lane.then(async()=>{await db.exec(`reset role;set request.jwt.claim.sub='00000000-0000-4000-8000-${String(args.user).padStart(12,'0')}';set role authenticated;`);try{return{data:(await db.query('select journal_cr_api($1,$2) r',[args.action,args.payload])).rows[0].r,error:null};}catch(e){return{data:null,error:{message:e.message}};}});lane=job.catch(()=>{});return job;});
  await page.goto(`http://127.0.0.1:${server.address().port}/harness`);
  await page.evaluate(()=>{window.testUser=1;const uid=()=>`00000000-0000-4000-8000-${String(testUser).padStart(12,'0')}`;window.cr=JournalCR.create({getContext:()=>({ready:true,userId:uid(),currentId:'aaaaaaaa-0000-4000-8000-000000000001',chantiers:[{id:'aaaaaaaa-0000-4000-8000-000000000001',name:'Chantier test'}],db:{rpc:(_,{p_action,p_payload})=>database({user:testUser,action:p_action,payload:p_payload})}}),toast(){},navigate:async()=>true,openAlerts(){}});cr.contextChanged();document.getElementById('launch').onclick=()=>cr.open();});
  await page.click('#launch');await page.click('[data-cr="new"]');await page.click('[data-cr="create"]');await page.waitForSelector('#crSection-catenaire');
  await page.click('#crSection-catenaire > summary');await page.click('[data-cr="configure-scopes"][data-key="catenaire"]');
  await page.check('[name="catalog_ids"][value="scope-a"]');await page.check('[name="catalog_ids"][value="scope-b"]');await page.click('[data-cr="configure-save"]');
  await page.waitForSelector('.cr-timing');assert.equal(await page.locator('.cr-timing').count(),2);
  const records=await page.evaluate(async()=>{const r=(await database({user:1,action:'list',payload:{}})).data[0];const d=(await database({user:1,action:'detail',payload:{id:r.id}})).data;return {r,d};});
  const a=records.d.sections.find(s=>s.key==='catenaire').items.find(t=>t.catalog_id==='scope-a'),b=records.d.sections.find(s=>s.key==='catenaire').items.find(t=>t.catalog_id==='scope-b');
  const open=async id=>{if(!await page.locator('#'+id).evaluate(e=>e.open))await page.click('#'+id+' > summary');};
  await open('crTiming-'+a.id);await open('crTiming-'+b.id);
  assert.equal(await page.inputValue(`#crTimingForm-${a.id} [name="start"]`),'');
  await page.fill(`#crTimingForm-${b.id} [name="start"]`,'23:30');
  await page.fill(`#crTimingForm-${a.id} [name="start"]`,'23:15');await page.fill(`#crTimingForm-${a.id} [name="end"]`,'04:30');
  await page.click(`[data-cr="timing-save"][data-id="${a.id}"]`);await page.waitForFunction(id=>document.querySelector('#crTiming-'+id).classList.contains('is-complete'),a.id);
  assert.equal(await page.inputValue(`#crTimingForm-${b.id} [name="start"]`),'23:30','Saving row A must preserve row B draft');
  await page.fill(`#crTimingForm-${b.id} [name="end"]`,'04:45');await page.click(`[data-cr="timing-save"][data-id="${b.id}"]`);await page.waitForFunction(()=>document.querySelector('#crSection-catenaire').classList.contains('is-complete'));
  assert.ok((await page.locator('.cr-progress').first().textContent()).includes('2/2'));
  await open('crSection-arf');assert.equal(await page.locator('[data-section="arf"] input[type="datetime-local"]').count(),2);assert.equal(await page.locator('[data-section="arf"] [name="precision"]').count(),0);
  await open('crAudience');await page.click('#crContactSuggestions > summary');assert.equal(await page.locator('[name="contact_pick"]:checked').count(),0);
  assert.equal(await page.inputValue('#crAudienceForm [name="recipients"]'),'');await page.check('[name="contact_pick"]');await page.click('[data-cr="contacts-add"]');
  assert.equal(await page.inputValue('#crAudienceForm [name="recipients"]'),'example@example.com');
  await page.click('[data-cr="audience"]');await page.getByText('Accès et destinataires enregistrés.',{exact:true}).waitFor();
  await open('crSection-catenaire');await open('crTiming-'+a.id);await page.locator(`#crTiming-${a.id}`).scrollIntoViewIfNeeded();
  assert.equal(await page.evaluate(()=>document.getElementById('crOffDialog').scrollWidth<=innerWidth),true);
  await page.screenshot({path:'/tmp/journal-v151-terrain.png'});
  await page.evaluate(async ({id,a})=>{const d=(await database({user:1,action:'detail',payload:{id}})).data;const row=d.sections.find(s=>s.key==='catenaire').items.find(t=>t.id===a);await database({user:1,action:'timing_assign',payload:{id,key:'catenaire',timing_id:a,version:row.version,responsible:'00000000-0000-4000-8000-000000000002'}});testUser=2;cr.contextChanged();},{id:records.r.id,a:a.id});
  await page.click('#launch');await page.click('[data-cr="report"]');await page.waitForSelector('#crSection-catenaire');assert.equal(await page.locator('[id^="crSection-"]').count(),1);assert.equal(await page.locator('#crAudience').count(),0);
  await page.click('#crClose');await page.evaluate(()=>cr.openInbox());await page.waitForSelector('.cr-inbox-item');await page.click('.cr-inbox-item');await page.waitForSelector('#crSection-catenaire[open]');
  assert.equal(errors.length,0,errors.join('\n'));console.log('PASS mobile V15.1: checkbox catalog, independent row saves, retained drafts, 2 ARF fields, explicit recipient selection, section-only rights, notification routing, no overflow or JS error.');
 }catch(e){const p=browser?.contexts()[0]?.pages()[0];if(p){console.error('UI:',await p.locator('#crNotice').textContent().catch(()=>''));await p.screenshot({path:'/tmp/journal-v151-error.png'}).catch(()=>{});}throw e;}
 finally{await browser?.close();await new Promise(r=>server?server.close(r):r());await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
