// Entire journal shell with real modules and a disposable SQL backend. No real send.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),http=require('node:http');
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {setup154}=require('../supabase/tests/cr-v154-backend.cjs');
const root=path.resolve(__dirname,'..'),out=process.env.TEST_OUTPUT_DIR||'/tmp/journal-v154-tests';fs.mkdirSync(out,{recursive:true});
(async()=>{const db=new PGlite();let browser,server;
 try{
  await setup154(db);
  server=http.createServer((req,res)=>{const name=new URL(req.url,'http://localhost').pathname;
   const p=path.resolve(root,'.'+(name==='/'?'/index.html':name));if(!p.startsWith(root+path.sep)||!fs.existsSync(p)||!fs.statSync(p).isFile()){res.writeHead(404);res.end();return;}
   let body=fs.readFileSync(p);
   if(name==='/app-v13.js')body=body.toString().replace(/  initialize\(\)\.catch[^\n]+/,'window.TEST={app,feedback,crOff,modeChantier,wireEvents,renderMessages,renderActions,renderMessage,renderPinnedMessages,openQuickAddDialog,openProduction,openExportDialog};');
   if(name==='/config.js')body='window.JOURNAL_CONFIG={};';
   res.setHeader('Content-Type',p.endsWith('.css')?'text/css':(p.endsWith('.js')||p.endsWith('.mjs'))?'text/javascript':p.endsWith('.html')?'text/html':p.endsWith('.png')?'image/png':'application/octet-stream');res.end(body);
  });await new Promise(r=>server.listen(0,'127.0.0.1',r));
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||undefined,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
  const page=await browser.newPage({viewport:{width:390,height:844},locale:'fr-FR',timezoneId:'Europe/Paris'});page.setDefaultTimeout(12000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('dialog',d=>d.accept());let lane=Promise.resolve(),loseFeedback=true;const sends=[];
  await page.exposeBinding('database',(_,args)=>{const job=lane.then(async()=>{
   await db.exec(`reset role;set request.jwt.claim.sub='00000000-0000-4000-8000-${String(args.user).padStart(12,'0')}';set role authenticated;`);
   try{
    let data;
    if(args.name==='journal_cr_api')data=(await db.query('select journal_cr_api($1,$2) r',[args.payload.p_action,args.payload.p_payload])).rows[0].r;
    else if(args.name==='journal_production_api')data=(await db.query('select journal_production_api($1,$2) r',[args.payload.p_action,args.payload.p_payload])).rows[0].r;
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
   Object.assign(TEST.app,{mode:'cloud',currentId:'aaaaaaaa-0000-4000-8000-000000000001',user:{id:uid()},profile:{id:uid(),full_name:'Encadrant test'},chantiers:[{id:'aaaaaaaa-0000-4000-8000-000000000001',name:'Chantier test'}],db:{from:()=>{const q=new Proxy({}, {get:(_,k)=>k==='then'?(resolve)=>Promise.resolve({data:[],error:null}).then(resolve):()=>q});return q;},rpc:(name,payload={})=>database({user:testUser,name,payload}),functions:{invoke:async()=>({data:{configured:true,test_mode:true,test_recipient:'test@example.fr'}})}}});
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
  assert.equal(await page.locator('.completed-feed-details').count(),1);assert.equal(await page.locator('.completed-feed-details[open]').count(),0);
  const proof=page.locator('#messageFeed > [data-message-row=proof]');await proof.locator('summary').click();assert.match(await proof.innerText(),/Vérification effectuée/);
  await page.evaluate(()=>TEST.renderMessages({keepPosition:true}));assert.equal(await proof.locator('details').getAttribute('open'),'');
  const color=await proof.locator('.message-action-link').first().evaluate(e=>getComputedStyle(e).backgroundColor);assert.equal(color,'rgb(237, 248, 241)');
  await proof.locator('[data-action=open-action]').first().click();await page.waitForSelector('#modalBackdrop:not([hidden])');await page.click('#modalCloseBtn');
  await proof.locator('summary').click();await page.screenshot({path:out+'/actions-terminees.png'});
  await page.evaluate(()=>{TEST.app.actions[0].status='en_cours';TEST.renderMessages();});assert.equal(await page.locator('.completed-feed-details').count(),0,'Reopened action is no longer shown completed');

  // One completed card, replies retained, three-minute pin expiry without a reload.
  await page.evaluate(()=>{TEST.app.actions[0].status='terminee';TEST.app.actions[0].closed_at=new Date().toISOString();TEST.renderMessages();TEST.renderPinnedMessages();});
  assert.equal(await page.locator('#messageFeed > .action-completed').count(),1);
  assert.equal(await page.locator('#pinnedMessages').isVisible(),true);
  await page.evaluate(()=>{TEST.app.actions[0].closed_at=new Date(Date.now()-181000).toISOString();TEST.renderPinnedMessages();});
  assert.equal(await page.locator('#pinnedMessages').isVisible(),false);
  // Real SQL production creation, then confirm percentages from the CR itself.
  await page.evaluate(()=>TEST.openQuickAddDialog());
  await page.selectOption('#quickAddForm [name=message_type]','Production');
  await page.fill('#productionRows textarea','Pose de deux appareils tendeurs');
  await page.click('[data-production=save]');await page.waitForSelector('#productionDialog',{state:'detached'});
  await page.click('#crOffBtn');await page.click('.cr-report-open >> nth=0');await page.click('#crSection-technique [data-cr=edit-section] >> nth=0');
  assert.match(await page.locator('#crSheet').innerText(),/Travaux prévus/);
  assert.equal(await page.inputValue('#crSheet [data-production-row] textarea'),'Pose de deux appareils tendeurs');
  await page.fill('#crSheet [data-production-row] input[type=number]','50');
  await page.click('[data-sheet=add-production]');await page.fill('#crExtraProduction textarea','Nettoyage complémentaire');
  await page.screenshot({path:out+'/production-partagee.png'});
  await page.click('[data-sheet=save-production]');await page.waitForSelector('#crSheet',{state:'detached'});
  assert.match(await page.locator('#crReadiness').innerText(),/Destinataire/);
  await page.click('[data-cr=validate]');assert.match(await page.locator('#crNotice').innerText(),/Destinataire/);
  await page.click('#crAudience summary >> nth=0');await page.fill('#crAudienceForm [name=recipients]','test@example.fr');
  assert.match(await page.locator('#crReadiness').innerText(),/enregistrer les modifications/);await page.click('[data-cr=audience]');
  // Complete remaining rubric data directly in the fixture, preserving UI production.
  await page.evaluate(async()=>{const list=await TEST.app.db.rpc('journal_cr_api',{p_action:'list',p_payload:{}}),r=list.data[0];window.previewReportId=r.id;
   const detail=(await TEST.app.db.rpc('journal_cr_api',{p_action:'detail',p_payload:{id:r.id}})).data;
   for(const sec of detail.sections.filter(s=>['catenaire','itc'].includes(s.key))){await TEST.app.db.rpc('journal_cr_api',{p_action:'timing_sheet',p_payload:{id:r.id,key:sec.key,version:sec.version,configure:true,reason:'Préparation du test',rows:sec.items.map(t=>({id:t.id,version:t.version,selected:true,label:t.label,start:t.actual_start||new Date().toISOString(),end:t.actual_end||new Date().toISOString(),planned_start:t.planned_start,planned_end:t.planned_end,status:'auto'}))}});}
   const arf=detail.sections.find(s=>s.key==='arf');await TEST.app.db.rpc('journal_cr_api',{p_action:'arf_save',p_payload:{id:r.id,key:'arf',version:arf.version,start:new Date().toISOString(),end:new Date().toISOString()}});
   const sec=detail.sections.find(s=>s.key==='securite');await TEST.app.db.rpc('journal_cr_api',{p_action:'safety_clear',p_payload:{id:r.id,key:'securite',version:sec.version}});
  });
  await page.click('[data-cr=refresh-report]');await page.click('[data-cr=validate]');await page.waitForSelector('.journal-decision');
  assert.match(await page.locator('.journal-decision').innerText(),/Valider et figer/);await page.click('.journal-decision .primary-button');await page.waitForSelector('[data-cr=preview]');
  await page.click('[data-cr=preview]');await page.waitForSelector('#crEmailPreview');
  const email=page.frameLocator('#crEmailPreview');await email.locator('h1').waitFor();assert.match(await email.locator('body').innerText(),/50 % réalisé/);assert.equal(await email.locator('table').count(),3);
  await page.screenshot({path:out+'/apercu-email.png'});await page.click('#crClose');
  // Large journal export uses a separate document and does not re-render the feed.
  await page.evaluate(()=>{TEST.app.messages=Array.from({length:1000},(_,i)=>({id:'print-'+i,chantier_id:TEST.app.currentId,author_name:'Agent test',created_at:new Date(Date.now()-i*60000).toISOString(),message_type:'Technique',body:'Relevé technique '+i,attachments:[]}));TEST.app.actions=[];});
  const started=Date.now();await page.click('#exportBtn');await page.click('#runExport');await page.waitForSelector('[data-export=print]:enabled');
  assert.ok(Date.now()-started<7000,'1000 text events prepare without network wait');assert.equal(await page.frameLocator('.journal-export-frame').locator('article').count(),1000);
  await page.screenshot({path:out+'/export-journal.png'});await page.click('[data-export=close]');
  // Export actual photos from the already decoded feed cache, at print resolution.
  await page.evaluate(async()=>{const c=document.createElement('canvas');c.width=2000;c.height=1500;const g=c.getContext('2d');g.fillStyle='#c9ddcf';g.fillRect(0,0,2000,1500);g.fillStyle='#294a36';g.font='130px sans-serif';g.fillText('PHOTO TERRAIN',300,740);const url=c.toDataURL('image/png');const image=new Image();image.src=url;image.hidden=true;document.body.append(image);await image.decode();TEST.app.messages=Array.from({length:3},(_,i)=>({id:'photo-'+i,chantier_id:TEST.app.currentId,created_at:new Date().toISOString(),author_name:'Agent terrain',message_type:'Technique',body:'Contrôle technique '+(i+1),attachments:[{id:'file-'+i,file_name:'Releve-'+(i+1)+'.png',mime_type:'image/png',signed_url:url}]}));TEST.openExportDialog();});
  await page.click('#runExport');await page.waitForSelector('[data-export=print]:enabled');const printed=page.frameLocator('.journal-export-frame');assert.equal(await printed.locator('img').count(),3);assert.equal(await printed.locator('img').first().evaluate(i=>i.naturalWidth),1000);
  const html=await page.locator('.journal-export-frame').evaluate(f=>f.contentDocument.documentElement.outerHTML),pdfPage=await browser.newPage();await pdfPage.setContent(html);await pdfPage.pdf({path:out+'/journal-impression.pdf',format:'A4',printBackground:true});await pdfPage.close();await page.click('[data-export=close]');
  // Confirmation dismissal never validates the report or invokes a browser alert.
  let nativeDialogs=0;page.on('dialog',()=>nativeDialogs++);await page.evaluate(()=>{window.decision=JournalDialogs.confirm('Confirmer cette opération ?');});await page.click('.journal-decision .secondary-button');assert.equal(await page.evaluate(()=>decision),false);assert.equal(nativeDialogs,0);
  assert.equal(errors.length,0,errors.join('\n'));console.log('PASS V15.4 mobile 390/320: full journal modules; feedback create/retry/reply; SEL/Secteur and ZEP; 2x2 ARF; assignee-only request + actual hours; unique completed card and 3-minute pin; shared production, precise blockers, real email layout, 1000-event export and optimized photo PDF.');
 }catch(e){const p=browser?.contexts()[0]?.pages()[0];if(p){console.error('UI:',await p.locator('#crSheetNotice,#crNotice,#feedbackNotice').allTextContents().catch(()=>''));await p.screenshot({path:out+'/error.png'}).catch(()=>{});}throw e;}
 finally{await browser?.close();await new Promise(r=>server?server.close(r):r());await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
