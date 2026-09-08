/* Optional full browser + PostgreSQL exercise. No production services contacted. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),http=require('node:http');
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..');
(async()=>{
 const db=new PGlite();let browser,server;
 try{
  for(const f of ['supabase/tests/backend-fixture.sql','supabase/tests/backend-production-shape.sql','supabase/migrations/20260906000300_v14_2_contraintes_reelles.sql','supabase/migrations/20260908000100_v15_cr_encadrement.sql'])await db.exec(fs.readFileSync(path.join(root,f),'utf8').replace(/^\\set ON_ERROR_STOP on\s*$/gm,''));
  server=http.createServer((req,res)=>{if(req.url==='/harness'){res.end('<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles-v13.css"><link rel="stylesheet" href="/cr-off.css"></head><body><button id="notificationBtn"><span>Alertes</span></button><button id="launch">CR off</button><script src="/cr-off.js"></script></body></html>');return;}const name=new URL(req.url,'http://localhost').pathname;const p=path.resolve(root,'.'+name);if(!p.startsWith(root+path.sep)||!fs.existsSync(p)||!fs.statSync(p).isFile()){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',p.endsWith('.css')?'text/css':p.endsWith('.js')?'text/javascript':p.endsWith('.html')?'text/html':'application/octet-stream');let bytes=fs.readFileSync(p);if(p===path.join(root,'app-v13.js'))bytes=Buffer.from(bytes.toString().replace('  initialize().catch', '  window.__v15Test={app,openAdminDashboardDialog,renderMessage};\n  initialize().catch'));res.end(bytes);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||undefined,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});const page=await browser.newPage({viewport:{width:390,height:844}});page.setDefaultTimeout(8000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  let lane=Promise.resolve();await page.exposeBinding('database',(_,args)=>{const job=lane.then(async()=>{await db.exec(`reset role;set request.jwt.claim.sub='00000000-0000-4000-8000-${String(args.user).padStart(12,'0')}';set role authenticated;`);try{return{data:(await db.query('select journal_cr_api($1,$2) as r',[args.action,args.payload])).rows[0].r,error:null};}catch(e){return{data:null,error:{message:e.message}};}});lane=job.catch(()=>{});return job;});
  await page.goto(`http://127.0.0.1:${server.address().port}/harness`);
  await page.evaluate(()=>{window.testUser=1;const uid=()=>`00000000-0000-4000-8000-${String(window.testUser).padStart(12,'0')}`;window.cr=JournalCR.create({getContext:()=>({ready:true,userId:uid(),currentId:'aaaaaaaa-0000-4000-8000-000000000001',chantiers:[{id:'aaaaaaaa-0000-4000-8000-000000000001',name:'Chantier A · Caténaire'}],db:{rpc:(_,{p_action,p_payload})=>window.database({user:window.testUser,action:p_action,payload:p_payload})}}),toast(){},navigate:async()=>true,openAlerts(){}});cr.contextChanged();document.getElementById('launch').onclick=()=>cr.open();});
  await page.click('#launch');await page.click('[data-cr="new"]');await page.click('[data-cr="create"]');await page.waitForSelector('#crSection-catenaire');
  assert.equal(await page.locator('.cr-section[id^="crSection-"]').count(),6);
  await page.click('#crSection-catenaire > summary');await page.click('#crSection-catenaire .cr-assignment > summary');
  await page.selectOption('[data-assign="catenaire"] [name="responsible"]','00000000-0000-4000-8000-000000000002');
  await page.click('[data-cr="assign"][data-key="catenaire"]');await page.getByText('Attribution enregistrée.',{exact:false}).waitFor();
  await page.click('#crSection-technique > summary');
  await page.fill('[data-note="technique"] [name="body"]','20 supports caténaires posés.');
  await page.click('[data-cr="note"][data-key="technique"]');await page.getByText('20 supports caténaires posés.',{exact:true}).waitFor();
  await page.selectOption('[data-section="technique"] [name="status"]','complete');await page.click('[data-cr="save"][data-key="technique"]');
  await page.waitForFunction(()=>document.querySelector('#crSection-technique').classList.contains('is-complete'));
  // A draft in a different section is retained when one rubric is saved.
  await page.click('#crSection-synthese > summary');await page.fill('[data-note="synthese"] [name="body"]','Saisie conservée pendant une autre sauvegarde');
  await page.selectOption('[data-section="technique"] [name="status"]','a_confirmer');await page.click('[data-cr="save"][data-key="technique"]');
  await page.waitForFunction(()=>document.querySelector('#crSaveState').textContent.includes('restent'));
  assert.equal(await page.inputValue('[data-note="synthese"] [name="body"]'),'Saisie conservée pendant une autre sauvegarde');
  assert.equal(await page.evaluate(()=>document.getElementById('crOffDialog').scrollWidth<=innerWidth),true);
  await page.screenshot({path:process.env.V15_SCREENSHOT||'/tmp/journal-v15-mobile.png'});
  await page.evaluate(()=>{window.testUser=2;cr.contextChanged();});await page.click('#launch');await page.click('[data-cr="report"]');
  assert.equal(await page.locator('.cr-section[id^="crSection-"]').count(),1);assert.equal(await page.locator('#crAudience').count(),0);
  await page.click('#crClose');await page.evaluate(()=>cr.openInbox());await page.waitForSelector('.cr-inbox-item');await page.click('.cr-inbox-item');await page.waitForSelector('#crSection-catenaire[open]');
  assert.equal(errors.length,0,errors.join('\n'));
  const dst=await page.evaluate(()=>{const out=[];for(const value of ['2026-03-29T02:30','2026-10-25T02:30']){try{JournalCR.parisISO(value);}catch(e){out.push(e.message)}}return out;});assert.equal(dst.length,2);
  const boot=await browser.newPage({viewport:{width:390,height:844}});const bootErrors=[];boot.on('pageerror',e=>bootErrors.push(e.message));
  await boot.route('https://**/*',r=>r.abort());
  await boot.goto(`http://127.0.0.1:${server.address().port}/index.html`);await boot.waitForFunction(()=>Boolean(window.__v15Test));
  await boot.evaluate(async()=>{
   const {app,openAdminDashboardDialog}=window.__v15Test;
   app.mode='cloud';app.user={id:'00000000-0000-4000-8000-000000000001'};app.access.platformRole='proprietaire';app.chantiers=[];
   app.db={rpc:async()=>({data:[{user_id:'user-pending',full_name:'Zoé Inscrite',email:'zoe@example.com',request_status:'en_attente',memberships:[]},{user_id:'user-active',full_name:'Alain Autorisé',email:'alain@example.com',global_role:'administrateur_general',memberships:[]}],error:null})};
   await openAdminDashboardDialog();
  });
  assert.equal(await boot.locator('.admin-account-card').first().getAttribute('data-account-state'),'pending');
  assert.equal(await boot.locator('.admin-account-card details[open]').count(),0);
  await boot.selectOption('#dashboardState','pending');assert.equal(await boot.locator('.admin-account-card:visible').count(),1);
  await boot.click('.admin-account-card:visible summary');assert.equal(await boot.locator('.admin-account-card details[open]').count(),1);
  assert.ok(await boot.locator('.admin-account-card:visible .mini-avatar').evaluate(e=>e.getBoundingClientRect().width)<=31);
  await boot.screenshot({path:'/tmp/journal-v15-admin.png'});
  const done=await boot.evaluate(()=>{const a=window.__v15Test.app;a.currentId='site';a.actions=[{id:'a',chantier_id:'site',message_id:'m',title:'Action contrôlée',status:'terminee',created_by:a.user.id}];return window.__v15Test.renderMessage({id:'m',chantier_id:'site',author_id:a.user.id,body:'Texte',created_at:new Date().toISOString(),attachments:[]});});
  assert.match(done,/completed-feed-action/);assert.equal(bootErrors.length,0,bootErrors.join('\n'));
  console.log('PASS démarrage réel, administration compacte et recherche des inscriptions, action terminée repliée.');
  console.log('PASS navigateur mobile + PostgreSQL : création, affectation, contribution, statuts, conservation des brouillons, rubrique privée, notification vers le champ, minuit / changements d’heure, aucun débordement ni erreur JS.');
 }catch(e){const p=browser?.contexts()[0]?.pages()[0];if(p){console.error('UI:',await p.locator('#crNotice').textContent().catch(()=>''));await p.screenshot({path:'/tmp/journal-v15-error.png'}).catch(()=>{});}throw e;}finally{await browser?.close();await new Promise(resolve=>server?server.close(resolve):resolve());await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
