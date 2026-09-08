const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),http=require('node:http');
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {setup152}=require('../supabase/tests/cr-v152-backend.cjs');
const root=path.resolve(__dirname,'..');
(async()=>{const db=new PGlite();let browser,server;
 try{
  await setup152(db);
  server=http.createServer((req,res)=>{const name=new URL(req.url,'http://localhost').pathname;
   if(name==='/harness'){res.end('<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles-v13.css"><link rel="stylesheet" href="/cr-off.css"></head><body><button id="notificationBtn">Alertes</button><button id="launch">CR off</button><script src="/cr-ai.js"></script><script src="/cr-off.js"></script></body></html>');return;}
   const p=path.resolve(root,'.'+name);if(!p.startsWith(root+path.sep)||!fs.existsSync(p)||!fs.statSync(p).isFile()){res.writeHead(404);res.end();return;}
   res.setHeader('Content-Type',p.endsWith('.css')?'text/css':p.endsWith('.js')?'text/javascript':'text/html');res.end(fs.readFileSync(p));
  });await new Promise(r=>server.listen(0,'127.0.0.1',r));
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||undefined,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
  const page=await browser.newPage({viewport:{width:390,height:844},locale:'fr-FR',timezoneId:'Europe/Paris'});page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  let lane=Promise.resolve();await page.exposeBinding('database',(_,args)=>{const job=lane.then(async()=>{await db.exec(`reset role;set request.jwt.claim.sub='00000000-0000-4000-8000-${String(args.user).padStart(12,'0')}';set role authenticated;`);try{return{data:(await db.query('select journal_cr_api($1,$2) r',[args.action,args.payload])).rows[0].r,error:null};}catch(e){return{data:null,error:{message:e.message}};}});lane=job.catch(()=>{});return job;});
  await page.goto(`http://127.0.0.1:${server.address().port}/harness`);
  await page.evaluate(()=>{window.testUser=1;const uid=()=>`00000000-0000-4000-8000-${String(testUser).padStart(12,'0')}`;window.cr=JournalCR.create({getContext:()=>({ready:true,userId:uid(),currentId:'aaaaaaaa-0000-4000-8000-000000000001',chantiers:[{id:'aaaaaaaa-0000-4000-8000-000000000001',name:'Chantier test'}],db:{rpc:(_,{p_action,p_payload})=>database({user:testUser,action:p_action,payload:p_payload})}}),toast(){},navigate:async()=>true,openAlerts(){}});cr.contextChanged();document.getElementById('launch').onclick=()=>cr.open();});
  page.on('dialog',d=>d.accept());
  let sentText='',aiFailure=false;
  await page.route('https://script.google.com/**',async route=>{
   const url=new URL(route.request().url());
   if(route.request().method()==='POST'){sentText=new URLSearchParams(route.request().postData()).get('text');return route.fulfill({contentType:'text/html',body:'<html></html>'});}
   const cb=url.searchParams.get('callback');return route.fulfill({contentType:'text/javascript',body:`${cb}(${JSON.stringify(!sentText?{state:'pending'}:aiFailure?{state:'failed',ok:false}:{state:'completed',ok:true,html:'<p>Deux supports remplacés. Contrôles réalisés.</p><img src="x" onerror="window.injected=true">'})});`});
  });
  await page.click('#launch');await page.click('[data-cr="new"]');await page.click('[data-cr="create"]');await page.waitForSelector('#crSection-catenaire');
  assert.equal(await page.locator('.cr-overview tr').count(),5);assert.equal(await page.locator('#crSection-synthese').count(),0);
  await page.click('#crSection-catenaire [data-cr="edit-section"] >> nth=0');await page.click('[data-sheet="configure"]');
  const row=page.locator('#crConfigRows tr').first();await row.locator('[name=label]').fill('SEL 1 + 3 · Montereau voie 1');
  await row.locator('[name=planned_start]').fill('23:00');await row.locator('[name=planned_end]').fill('05:00');
  await page.selectOption('#crTableConfig [name=responsible]','00000000-0000-4000-8000-000000000002');
  await page.click('[data-sheet=add-row]');const second=page.locator('#crConfigRows tr').nth(1);await second.locator('[name=label]').fill('SEL 2 + 4 · voie 2');await second.locator('[name=planned_start]').fill('23:15');await second.locator('[name=planned_end]').fill('05:15');
  assert.equal(await page.locator('#crSheet').evaluate(e=>e.scrollWidth<=innerWidth),true);
  await page.screenshot({path:'/tmp/journal-v152-configuration.png'});
  await page.click('[data-sheet=save-config]');await page.waitForSelector('#crSheet',{state:'detached'});
  await page.evaluate(()=>{testUser=2;cr.contextChanged();});await page.waitForSelector('.cr-task-popup[open]');
  assert.match(await page.locator('.cr-task-popup').innerText(),/Consignation caténaire/);await page.click('[data-task=later]');await page.waitForSelector('.cr-task-popup',{state:'detached'});
  await page.click('#crTasksBtn');await page.click('[data-cr=task-open]');await page.waitForSelector('#crActualTable');
  assert.equal(await page.locator('.cr-overview tr').count(),3,'Assigned agent sees timing plus open collaborative production and safety');assert.equal(await page.locator('[data-sheet=configure]').count(),0);
  const actuals=page.locator('#crActualTable tr[data-row-id]');assert.equal(await actuals.count(),2);
  await actuals.nth(0).locator('[name=start]').fill('23:05');await actuals.nth(1).locator('[name=start]').fill('23:20');
  await page.click('[data-sheet=save-times]');await page.waitForSelector('#crSheet',{state:'detached'});
  await page.click('#crSection-catenaire [data-cr="edit-section"] >> nth=0');
  assert.equal(await actuals.nth(0).locator('[name=start]').inputValue(),'23:05');
  await actuals.nth(0).locator('[name=end]').fill('05:05');await actuals.nth(1).locator('[name=end]').fill('05:10');
  assert.equal(await page.locator('#crSheet').evaluate(e=>e.scrollWidth<=innerWidth),true);
  await page.screenshot({path:'/tmp/journal-v152-horaires.png'});
  await page.click('[data-sheet=save-times]');await page.waitForSelector('#crSheet',{state:'detached'});
  await page.click('#crSection-technique [data-cr="edit-section"] >> nth=0');await page.fill('#crProduction [name=body]','deux supports remplacés et contrôles faits');
  await page.click('[data-sheet=improve]');await page.waitForSelector('#crAiProposal');
  assert.equal(sentText,'deux supports remplacés et contrôles faits');assert.equal(await page.inputValue('#crProduction [name=body]'),'deux supports remplacés et contrôles faits','AI never replaces before approval');
  assert.equal(await page.evaluate(()=>window.injected),undefined);await page.click('[data-sheet=ai-apply]');assert.match(await page.inputValue('#crProduction [name=body]'),/Deux supports remplacés/);
  aiFailure=true;await page.click('[data-sheet=improve]');await page.waitForFunction(()=>document.querySelector('#crSheetNotice')?.textContent.includes('Votre texte est conservé'));
  await page.click('[data-sheet=save-production]');await page.waitForSelector('#crSheet',{state:'detached'});
  await page.click('#crSection-securite [data-cr="edit-section"] >> nth=0');assert.equal(await page.locator('#crSafety [name=responsible]').count(),0);await page.fill('#crSafety [name=body]','Balisage réalisé avant intervention.');await page.check('#crSafety [value=top]');await page.click('[data-sheet=save-safety]');await page.waitForSelector('#crSheet',{state:'detached'});
  await page.evaluate(()=>{testUser=1;cr.contextChanged();});await page.click('#launch');await page.click('[data-cr=report]');await page.waitForSelector('#crSection-arf');
  await page.click('#crSection-arf [data-cr="edit-section"] >> nth=0');assert.equal(await page.locator('#crArfForm table input[type=time]').count(),2);await page.click('[data-sheet=close]');
  await page.screenshot({path:'/tmp/journal-v152-apercu.png'});
  assert.equal(errors.length,0,errors.join('\n'));console.log('PASS mobile V15.2: compact five-rubric summary, free SEL input, two-row weekly config, agent-only popup and persistent demand without push, dismissed alert routing, start/end table saves, 2 ARF actual fields, simple production/safety and safe Gemini review/failure; no horizontal overflow or JS errors.');
 }catch(e){const p=browser?.contexts()[0]?.pages()[0];if(p){console.error('UI:',await p.locator('#crSheetNotice, #crNotice').allTextContents().catch(()=>''));await p.screenshot({path:'/tmp/journal-v152-error.png'}).catch(()=>{});}throw e;}
 finally{await browser?.close();await new Promise(r=>server?server.close(r):r());await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
