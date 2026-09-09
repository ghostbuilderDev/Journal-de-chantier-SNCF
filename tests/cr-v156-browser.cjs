// Entire journal shell with real modules and a disposable SQL backend. No real send.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),http=require('node:http');
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {setup156}=require('../supabase/tests/cr-v156-backend.cjs');
const root=path.resolve(__dirname,'..'),out=process.env.TEST_OUTPUT_DIR||'/tmp/journal-v156-tests';fs.mkdirSync(out,{recursive:true});
(async()=>{const db=new PGlite();let browser,server;
 try{
  await setup156(db);
  server=http.createServer((req,res)=>{const name=new URL(req.url,'http://localhost').pathname;
   const p=path.resolve(root,'.'+(name==='/'?'/index.html':name));if(!p.startsWith(root+path.sep)||!fs.existsSync(p)||!fs.statSync(p).isFile()){res.writeHead(404);res.end();return;}
   let body=fs.readFileSync(p);
   if(name==='/app-v13.js')body=body.toString().replace(/  initialize\(\)\.catch[^\n]+/,'window.TEST={app,feedback,crOff,modeChantier,wireEvents,renderMessages,renderActions,renderMessage,renderPinnedMessages,openQuickAddDialog,openProduction,openExportDialog,composer,rememberComposerDraft,restoreComposerDraft,clearComposer,clearSessionPrivateState,queueFiles,openEmojiPicker,openReactionPicker,polishComposerText,sendComposerMessage};');
   if(name==='/config.js')body='window.JOURNAL_CONFIG={};';
   res.setHeader('Content-Type',p.endsWith('.css')?'text/css':(p.endsWith('.js')||p.endsWith('.mjs'))?'text/javascript':p.endsWith('.html')?'text/html':p.endsWith('.png')?'image/png':'application/octet-stream');res.end(body);
  });await new Promise(r=>server.listen(0,'127.0.0.1',r));
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||undefined,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
  const page=await browser.newPage({viewport:{width:390,height:844},locale:'fr-FR',timezoneId:'Europe/Paris'});page.setDefaultTimeout(12000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('dialog',d=>{errors.push('Unexpected native dialog');d.dismiss();});let lane=Promise.resolve(),loseFeedback=true;const sends=[];
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
  const setupPage=async()=>page.evaluate(()=>{
   window.testUser=1;const uid='00000000-0000-4000-8000-000000000001',site='aaaaaaaa-0000-4000-8000-000000000001';
   Object.assign(TEST.app,{mode:'cloud',currentId:site,user:{id:uid},profile:{id:uid,full_name:'Encadrant test'},access:{platformRole:'proprietaire'},chantiers:[{id:site,name:'SST Montereau'}],db:{from:()=>{const q=new Proxy({}, {get:(_,k)=>k==='then'?(resolve)=>Promise.resolve({data:[],error:null}).then(resolve):()=>q});return q;},rpc:(name,payload={})=>database({user:testUser,name,payload})}});
   TEST.wireEvents();TEST.crOff.contextChanged();TEST.renderMessages();
  });await setupPage();
  await page.locator('#messageInput').click();await page.waitForSelector('#journalComposer[open]');
  await page.locator('#messageInput').fill('SEL 1 + 3 : début à 23:55.');await page.locator('#messageInput').press('Enter');await page.locator('#messageInput').pressSequentially('Fin à confirmer.');
  assert.equal(await page.inputValue('#messageInput'),'SEL 1 + 3 : début à 23:55.\nFin à confirmer.');assert.equal(await page.evaluate(()=>TEST.app.sendingMessage),false);
  await page.evaluate(()=>TEST.queueFiles([new File([new Uint8Array([1,2,3])],'preuve.pdf',{type:'application/pdf'}),new File([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXKsAAAAASUVORK5CYII='),c=>c.charCodeAt(0))],'photo.png',{type:'image/png'})]));
  await page.click('#writingClose');await page.locator('#messageInput').click();assert.equal(await page.evaluate(()=>TEST.app.pendingFiles[0].file.name),'preuve.pdf');assert.match(await page.inputValue('#messageInput'),/Fin à confirmer/);
  // Browser reload reconstructs the File and the multiline draft from IndexedDB.
  await page.evaluate(()=>TEST.rememberComposerDraft());await page.evaluate(()=>JournalComposer.read(TEST.app.user.id+':'+TEST.app.currentId));await page.reload();await setupPage();await page.evaluate(()=>TEST.restoreComposerDraft());await page.waitForFunction(()=>TEST.app.pendingFiles.length===2);assert.equal(await page.evaluate(()=>TEST.app.pendingFiles[0].file.size),3);assert.match(await page.inputValue('#messageInput'),/\nFin à confirmer/);
  await page.locator('#messageInput').click();await page.waitForFunction(()=>document.querySelector('#attachmentPreview img')?.naturalWidth===1);await page.screenshot({path:path.join(out,'redaction-mobile.png')});
  await page.evaluate(()=>{JournalCRAI.improve=async text=>text.replace('début à','Début à');});await page.click('[data-writing=polishBtn]');await page.waitForSelector('#writingAIProposal');await page.fill('#writingAIProposal','SEL 1 + 3 : Début à 23:55.\nFin à confirmer.');await page.click('#applyWritingAI');await page.waitForSelector('#journalComposer[open]');assert.match(await page.inputValue('#messageInput'),/Début/);assert.equal(await page.evaluate(()=>TEST.app.pendingFiles.length),2);assert.equal(await page.evaluate(()=>TEST.app.sendingMessage),false);
  await page.click('[data-writing=emojiBtn]');await page.waitForSelector('.journal-emoji-grid button');assert.equal(await page.locator('.journal-emoji-dialog [role=status]').textContent(),'3944 emojis');await page.selectOption('.journal-emoji-dialog select','Objects');await page.locator('.journal-emoji-grid button').first().click();assert.equal(await page.evaluate(()=>TEST.app.pendingFiles.length),2);
  await page.click('#writingClose');
  const reactionMarkup=await page.evaluate(()=>TEST.renderMessage({id:'22222222-0000-4000-8000-000000000001',chantier_id:TEST.app.currentId,author_id:TEST.app.user.id,author_name:'Agent',body:'Message',created_at:new Date().toISOString(),attachments:[]}));assert.equal((reactionMarkup.match(/data-action="open-reactions"/g)||[]).length,1);assert.ok(!reactionMarkup.includes('reaction-add'));
  await page.evaluate(()=>TEST.crOff.open());await page.click('[data-cr=new]');await page.click('[data-cr=create]');await page.waitForSelector('[data-cr=edit-section][data-key=catenaire]');await page.click('[data-cr=edit-section][data-key=catenaire]');
  assert.equal(await page.locator('[name=reference]').inputValue(),'');assert.equal(await page.locator('[name=reference_choice] option').count(),13);assert.equal(await page.locator('[name=start]').isVisible(),false);
  const choice=await page.locator('[name=reference_choice] option').nth(1).getAttribute('value');await page.selectOption('[name=reference_choice]',choice);assert.ok(await page.inputValue('[name=reference]'));await page.fill('[name=reference]','1 + 3 périmètre adapté');
  await page.locator('.cr-schedule > summary').click();await page.fill('[name=start]','00:15');await page.fill('[name=end]','04:45');await page.locator('.cr-schedule > summary').click();await page.selectOption('[name=responsible]','00000000-0000-4000-8000-000000000002');await page.screenshot({path:path.join(out,'consignation-mobile.png')});await page.click('[data-cr=dispatch]');await page.waitForSelector('#crSheet',{state:'detached'});
  // Responsible sees only their form, with same suggestions and hidden schedule.
  await page.evaluate(()=>{testUser=2;TEST.app.user.id='00000000-0000-4000-8000-000000000002';TEST.crOff.contextChanged();});await page.waitForSelector('#crTasksBtn:visible');await page.evaluate(()=>TEST.crOff.openInbox());await page.click('#crBody [data-cr=task-open]');await page.locator('.cr-schedule > summary').click();assert.equal(await page.inputValue('[name=start]'),'00:15');await page.click('[data-cr=save-task]');assert.ok(await page.locator('#crSheet').isVisible());await page.click('[data-cr=submit-task]');await page.click('.journal-decision .primary-button');await page.waitForSelector('#crSheet',{state:'detached'});
  // A tablet starts from the same persisted CR, no fresh preparation needed.
  await page.evaluate(()=>{testUser=1;TEST.app.user.id='00000000-0000-4000-8000-000000000001';TEST.crOff.contextChanged();});await page.setViewportSize({width:1024,height:768});await page.evaluate(()=>TEST.crOff.open());await page.waitForSelector('.cr-report');assert.equal(await page.locator('[data-cr=restore],[data-cr=deleted]').count(),0);await page.click('[data-cr=delete-one]');await page.click('.journal-decision .primary-button');await page.waitForSelector('.cr-empty');await page.click('[data-cr=new]');await page.click('[data-cr=create]');await page.waitForSelector('[data-cr=edit-section][data-key=catenaire]');await page.click('[data-cr=edit-section][data-key=catenaire]');assert.equal(await page.inputValue('[name=reference]'),'');assert.equal(await page.inputValue('[name=start]'),'');assert.equal(await page.inputValue('[name=responsible]'),'');await page.screenshot({path:path.join(out,'consignation-tablette.png')});
  assert.deepEqual(errors,[]);console.log('V15.6 browser OK: multiline, IndexedDB files, popup/AI preservation, full emojis, editable source suggestions, collapsed schedules, private request save/send, deletion/recreation, tablet.');
 }finally{if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));await db.close();}
})().catch(e=>{console.error(e.stack);process.exit(1)});
