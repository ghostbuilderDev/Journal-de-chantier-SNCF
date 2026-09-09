// Entire journal shell with real modules and a disposable SQL backend. No real send.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),http=require('node:http');
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {setup153}=require('../supabase/tests/cr-v153-backend.cjs');
const root=path.resolve(__dirname,'..'),out=process.env.TEST_OUTPUT_DIR||'/tmp/journal-v153-tests';fs.mkdirSync(out,{recursive:true});
(async()=>{const db=new PGlite();let browser,server;
 try{
  await setup153(db);
  server=http.createServer((req,res)=>{const name=new URL(req.url,'http://localhost').pathname;
   const p=path.resolve(root,'.'+(name==='/'?'/index.html':name));if(!p.startsWith(root+path.sep)||!fs.existsSync(p)||!fs.statSync(p).isFile()){res.writeHead(404);res.end();return;}
   let body=fs.readFileSync(p);
   if(name==='/app-v13.js')body=body.toString().replace(/  initialize\(\)\.catch[^\n]+/,'window.TEST={app,feedback,crOff,modeChantier,wireEvents,renderMessages,renderActions,renderMessage};');
   if(name==='/config.js')body='window.JOURNAL_CONFIG={};';
   res.setHeader('Content-Type',p.endsWith('.css')?'text/css':p.endsWith('.js')?'text/javascript':p.endsWith('.html')?'text/html':p.endsWith('.png')?'image/png':'application/octet-stream');res.end(body);
  });await new Promise(r=>server.listen(0,'127.0.0.1',r));
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||undefined,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
  const page=await browser.newPage({viewport:{width:390,height:844},locale:'fr-FR',timezoneId:'Europe/Paris'});page.setDefaultTimeout(12000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('dialog',d=>d.accept());let lane=Promise.resolve(),loseFeedback=true;const sends=[];
  await page.exposeBinding('database',(_,args)=>{const job=lane.then(async()=>{
   await db.exec(`reset role;set request.jwt.claim.sub='00000000-0000-4000-8000-${String(args.user).padStart(12,'0')}';set role authenticated;`);
   try{
    let data;
    if(args.name==='journal_cr_api')data=(await db.query('select journal_cr_api($1,$2) r',[args.payload.p_action,args.payload.p_payload])).rows[0].r;
    else if(/^journal_feedback_[a-z_]+$/.test(args.name)){
     const entries=Object.entries(args.payload);assert.ok(entries.every(([k])=>/^p_[a-z_]+$/.test(k)));
     data=(await db.query('select '+args.name+'('+entries.map(([k],i)=>k+'=> $'+(i+1)).join(',')+') r',entries.map(([,v])=>v))).rows[0].r;
     if(args.name==='journal_feedback_create_thread'){sends.push(args.payload.p_id);if(loseFeedback){loseFeedback=false;return {error:{message:'Response lost in test'}};}}
    }else if(args.name==='journal_v142_can_write')data=true;
    else data=null;
    return{data,error:null};
   }catch(e){return{data:null,error:{message:e.message,code:e.code}};}});lane=job.catch(()=>{});return job;});
  const host=`http://localhost:${server.address().port}`;
  await page.route('**/*',route=>{if(new URL(route.request().url()).hostname==='localhost')return route.continue();return route.abort();});
  await page.goto(host);
  await page.evaluate(()=>{
   window.testUser=1;const uid=()=>`00000000-0000-4000-8000-${String(testUser).padStart(12,'0')}`;
   Object.assign(TEST.app,{mode:'cloud',currentId:'aaaaaaaa-0000-4000-8000-000000000001',user:{id:uid()},profile:{id:uid(),full_name:'Encadrant test'},chantiers:[{id:'aaaaaaaa-0000-4000-8000-000000000001',name:'Chantier test'}],db:{rpc:(name,payload={})=>database({user:testUser,name,payload})}});
   TEST.wireEvents();TEST.feedback.contextChanged();TEST.crOff.contextChanged();
  });
  // Feedback is reachable from the real mobile sidebar and retries a lost response.
  await page.click('#openSidebarBtn');await page.click('#sidebarFeedbackBtn');await page.waitForSelector('#feedbackEntryFooter');
  assert.equal(await page.locator('#appShell').evaluate(e=>e.classList.contains('sidebar-open')),false);
  await page.click('#feedbackEntryFooter [data-feedback-action=compose]');
  await page.fill('#feedbackDraftTitle','Photo manquante <test>');await page.fill('#feedbackCompose textarea[data-draft=body]','Le PDF ne contient pas la photo.');await page.click('#feedbackSubmit');
  await page.waitForFunction(()=>document.querySelector('#feedbackSubmit')?.textContent==='Réessayer la publication');
  assert.equal(await page.inputValue('#feedbackDraftTitle'),'Photo manquante <test>');await page.click('#feedbackSubmit');
  await page.waitForSelector('#feedbackReplyForm');assert.match(await page.locator('#feedbackContent').innerText(),/Photo manquante <test>/);
  assert.equal(await page.locator('#feedbackContent test').count(),0);assert.equal(sends.length,2);assert.equal(sends[0],sends[1]);
  await page.fill('#feedbackReplyBody','Précision depuis le terrain.');await page.click('#feedbackReplySubmit');await page.waitForFunction(()=>document.querySelector('.feedback-replies')?.textContent.includes('Précision depuis le terrain.')||document.querySelector('#feedbackContent')?.textContent.includes('Précision depuis le terrain.'));
  await page.click('[data-feedback-action=back]');await page.waitForSelector('#feedbackEntryFooter:not([hidden])');
  await page.screenshot({path:out+'/signalements.png'});await page.click('[data-feedback-action=close]');
  // CR assignments + double-entry tables, including week reuse and midnight.
  await page.click('#crOffBtn');await page.click('[data-cr=new]');await page.click('[data-cr=create]');await page.waitForSelector('#crSection-catenaire');
  assert.equal(await page.locator('.cr-overview tr').count(),5);
  await page.click('#crSection-catenaire [data-cr=edit-section] >> nth=0');
  assert.equal(await page.locator('#crSheet datalist').count(),0);assert.equal(await page.locator('#crSheet select[data-day]').count(),0);
  await page.selectOption('#crTimingForm [name=responsible]','00000000-0000-4000-8000-000000000002');
  let row=page.locator('[data-timing-row]').first();await row.locator('[name=ref_type]').selectOption('SEL');await row.locator('[name=reference]').fill('1 + 3 · voie 1');
  await row.locator('[name=planned_start]').fill('23:00');await row.locator('[name=planned_end]').fill('05:00');
  await page.click('[data-sheet=add-row]');let second=page.locator('[data-timing-row]').nth(1);await second.locator('[name=ref_type]').selectOption('Secteur');await second.locator('[name=reference]').fill('Montereau voie 2');await second.locator('[name=planned_start]').fill('23:15');await second.locator('[name=planned_end]').fill('05:15');
  assert.equal(await page.locator('.cr-hours').count(),2);assert.equal(await page.locator('#crSheet').evaluate(e=>e.scrollWidth<=innerWidth),true);
  await page.screenshot({path:out+'/consignation.png'});await page.click('[data-sheet=save-sheet]');await page.waitForSelector('#crSheet',{state:'detached'});
  // The assigned agent receives the request without enabling phone push.
  await page.evaluate(()=>{testUser=2;TEST.app.user.id='00000000-0000-4000-8000-000000000002';TEST.crOff.contextChanged();TEST.feedback.contextChanged();});await page.waitForSelector('.cr-task-popup[open]');await page.click('[data-task=later]');await page.waitForSelector('.cr-task-popup',{state:'detached'});
  await page.click('#crTasksBtn');await page.click('[data-cr=task-open]');await page.waitForSelector('#crTimingForm');
  assert.equal(await page.locator('#crTimingForm [name=responsible]').count(),0);assert.equal(await page.locator('#crTimingForm [name=planned_start]').count(),0);assert.equal(await page.locator('[data-timing-row]').count(),2);
  row=page.locator('[data-timing-row]').first();second=page.locator('[data-timing-row]').nth(1);
  await row.locator('[name=start]').fill('23:05');await row.locator('[name=end]').fill('05:07');await row.locator('[name=comment]').fill('Restitution après contrôle.');
  await second.locator('[name=start]').fill('23:20');await second.locator('[name=end]').fill('05:12');
  await page.click('[data-sheet=save-sheet]');await page.waitForSelector('#crSheet',{state:'detached'});
  await page.click('#crSection-catenaire [data-cr=edit-section] >> nth=0');assert.equal(await row.locator('[name=start]').inputValue(),'23:05');assert.equal(await row.locator('[name=end]').inputValue(),'05:07');await page.screenshot({path:out+'/agent-horaires.png'});await page.click('[data-sheet=close]');
  await page.evaluate(()=>{testUser=1;TEST.app.user.id='00000000-0000-4000-8000-000000000001';TEST.crOff.contextChanged();TEST.feedback.contextChanged();});
  await page.click('#crOffBtn');await page.click('[data-cr=report]');
  await page.click('#crSection-itc [data-cr=edit-section] >> nth=0');row=page.locator('[data-timing-row]').first();await row.locator('[name=reference]').fill('123 · voie 2');await page.selectOption('#crTimingForm [name=responsible]','00000000-0000-4000-8000-000000000003');await row.locator('[name=planned_start]').fill('2300');await row.locator('[name=planned_end]').fill('0500');
  await page.click('[data-sheet=save-sheet]');await page.waitForSelector('#crSheet',{state:'detached'});
  await page.click('#crSection-arf [data-cr=edit-section] >> nth=0');assert.equal(await page.locator('#crArfForm [data-clock]').count(),4);await page.selectOption('#crArfForm [name=responsible]','00000000-0000-4000-8000-000000000004');await page.fill('#crArfForm [name=planned_start]','23:30');await page.fill('#crArfForm [name=planned_end]','05:20');
  await page.screenshot({path:out+'/arf.png'});await page.click('[data-sheet=save-arf]');await page.waitForSelector('#crSheet',{state:'detached'});
  assert.ok(await page.locator('.cr-overview tr').first().locator('td').first().evaluate(e=>e.getBoundingClientRect().width)>190,'Overview label column remains readable');
  await page.screenshot({path:out+'/cr-off.png'});
  // Width at small phone size: no page-wide horizontal scroll, fields remain usable.
  await page.setViewportSize({width:320,height:740});await page.click('#crSection-catenaire [data-cr=edit-section] >> nth=0');
  assert.equal(await page.locator('#crSheet').evaluate(e=>e.scrollWidth<=innerWidth),true);assert.equal(await page.locator('#crSheet main').evaluate(e=>e.scrollWidth<=e.clientWidth+1),true);
  await page.click('[data-sheet=close]');await page.evaluate(()=>document.querySelector('#crOffDialog')?.close());
  // Original, creation announcement AND proof use their real action links.
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>{
   const site=TEST.app.currentId,u=TEST.app.user.id,at=new Date().toISOString();
   const common={chantier_id:site,author_id:u,author_name:'Encadrant test',created_at:at,attachments:[]};
   TEST.app.messages=[{...common,id:'source',body:'Contrôler le balisage'},{...common,id:'announcement',message_type:'Action',action_id:'a1',body:'Action créée : Contrôler le balisage'},{...common,id:'proof',message_type:'Action',action_id:'a1',reply_to:'source',body:'Clôture d’action — Contrôler le balisage. Vérification effectuée.'}];
   TEST.app.actions=[{id:'a1',chantier_id:site,message_id:'source',proof_message_id:'proof',created_by:u,assignee:'Agent test',title:'Contrôler le balisage',status:'terminee',close_note:'Vérification effectuée.',created_at:at}];
   TEST.renderMessages();TEST.renderActions();
  });
  assert.equal(await page.locator('.completed-feed-details').count(),3);assert.equal(await page.locator('.completed-feed-details[open]').count(),0);
  const proof=page.locator('[data-message-row=proof]');await proof.locator('summary').click();assert.match(await proof.innerText(),/Vérification effectuée/);
  await page.evaluate(()=>TEST.renderMessages({keepPosition:true}));assert.equal(await proof.locator('details').getAttribute('open'),'');
  const color=await proof.locator('.message-action-link').evaluate(e=>getComputedStyle(e).backgroundColor);assert.equal(color,'rgb(237, 248, 241)');
  await proof.locator('[data-action=open-action]').click();await page.waitForSelector('#modalBackdrop:not([hidden])');await page.click('#modalCloseBtn');
  await proof.locator('summary').click();await page.screenshot({path:out+'/actions-terminees.png'});
  await page.evaluate(()=>{TEST.app.actions[0].status='en_cours';TEST.renderMessages();});assert.equal(await page.locator('.completed-feed-details').count(),0,'Reopened action is no longer shown completed');
  assert.equal(errors.length,0,errors.join('\n'));console.log('PASS V15.3 mobile 390/320: full journal modules; feedback create/retry/reply; SEL/Secteur and ZEP; 2x2 ARF; assignee-only request + actual hours; green collapsed origin/announcement/proof, expansion persists and reopening works.');
 }catch(e){const p=browser?.contexts()[0]?.pages()[0];if(p){console.error('UI:',await p.locator('#crSheetNotice,#crNotice,#feedbackNotice').allTextContents().catch(()=>''));await p.screenshot({path:out+'/error.png'}).catch(()=>{});}throw e;}
 finally{await browser?.close();await new Promise(r=>server?server.close(r):r());await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
