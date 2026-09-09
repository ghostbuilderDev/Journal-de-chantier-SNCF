// Entire journal shell with real modules and a disposable SQL backend. No real send.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),http=require('node:http');
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {setup157}=require('../supabase/tests/cr-v157-backend.cjs');
const root=path.resolve(__dirname,'..'),out=process.env.TEST_OUTPUT_DIR||'/tmp/journal-v157-tests';fs.mkdirSync(out,{recursive:true});
(async()=>{const db=new PGlite();let browser,server;
 try{
  await setup157(db);
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
   }catch(e){console.error('Test RPC error:',args.name,e.message);return{data:null,error:{message:e.message,code:e.code}};}});lane=job.catch(()=>{});return job;});
  const host=`http://localhost:${server.address().port}`;
  await page.route('**/*',route=>{if(new URL(route.request().url()).hostname==='localhost')return route.continue();return route.abort();});
  await page.goto(host);
  const setupPage=async()=>page.evaluate(()=>{
   window.testUser=1;const uid='00000000-0000-4000-8000-000000000001',site='aaaaaaaa-0000-4000-8000-000000000001';
   Object.assign(TEST.app,{mode:'cloud',currentId:site,user:{id:uid},profile:{id:uid,full_name:'Encadrant test'},access:{platformRole:'proprietaire'},chantiers:[{id:site,name:'SST Montereau'}],db:{from:()=>{const q=new Proxy({}, {get:(_,k)=>k==='then'?(resolve)=>Promise.resolve({data:[],error:null}).then(resolve):()=>q});return q;},rpc:(name,payload={})=>database({user:testUser,name,payload})}});
   TEST.wireEvents();TEST.crOff.contextChanged();TEST.renderMessages();
  });await setupPage();
  const uid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
  const day=new Date().toISOString().slice(0,10),plus=n=>new Date(Date.parse(day+'T12:00Z')+n*864e5).toISOString().slice(0,10);
  const nativeTimes=async()=>{
   assert.equal(await page.locator('#crSheet input[type=time]').count(),4);
   for(const name of ['planned_start','planned_end','start','end']){
    assert.ok(await page.locator(`[name=${name}]`).isVisible());
    assert.equal(await page.locator(`[name=${name}_date]`).isVisible(),false);
    assert.equal(await page.locator(`[name=${name}]`).getAttribute('required'),null);
   }
   assert.equal(await page.locator('.cr-clock-offset').count(),0);
   assert.ok(!(await page.locator('.cr-hours').textContent()).includes('Facultatif'));
  };
  await page.evaluate(()=>TEST.crOff.open());await page.click('[data-cr=new]');await page.click('[data-cr=create]');
  await page.click('[data-cr=edit-section][data-key=catenaire]');await nativeTimes();
  assert.equal(await page.locator('[data-timing-row]').count(),1);assert.equal(await page.locator('[name=reference]').count(),1);
  assert.equal(await page.inputValue('[name=reference]'),'');assert.equal(await page.getByText('Intitulé',{exact:true}).count(),1);
  await page.click('[data-cr-field=references]');assert.equal(await page.locator('.cr-reference-options [role=option]').count(),15);
  await page.getByRole('option',{name:'SEL 1 SR Samois - St Mammes V1',exact:true}).click();
  assert.equal(await page.inputValue('[name=reference]'),'1 SR Samois - St Mammes V1');
  await page.fill('[name=reference]','mammès samois');assert.ok(await page.getByRole('option',{name:'SEL 1 SR Samois - St Mammes V1',exact:true}).isVisible());
  await page.locator('[name=reference]').press('Escape');assert.ok(await page.locator('#crSheet').isVisible());
  await page.click('[data-cr-field=references]');await page.getByRole('option',{name:'Laisser vide',exact:true}).click();assert.equal(await page.inputValue('[name=reference]'),'');
  await page.selectOption('[name=ref_type]','Secteur');await page.click('[data-cr-field=references]');
  assert.equal(await page.locator('.cr-reference-options [role=option]').count(),24);
  assert.ok(await page.getByRole('option',{name:'SR St Melun- samois V1',exact:true}).isVisible());
  await page.getByRole('option',{name:'SR St Melun- samois V1',exact:true}).click();
  await page.selectOption('[name=ref_type]','SEL');await page.fill('[name=reference]','1 + 3 périmètre adapté');await page.locator('[name=reference]').press('Tab');
  // A touch invokes the standard picker. The OS-drawn clock is outside headless Chromium.
  await page.evaluate(()=>{window.pickerCalls=0;HTMLInputElement.prototype.showPicker=function(){pickerCalls++;};});
  await page.click('[name=planned_start]');assert.equal(await page.evaluate(()=>pickerCalls),1);
  await page.fill('[name=planned_start]','23:55');await page.fill('[name=planned_end]','05:10');
  await page.fill('[name=start]','00:15');await page.fill('[name=end]','04:45');
  assert.equal(await page.inputValue('[name=planned_start_date]'),day);assert.equal(await page.inputValue('[name=planned_end_date]'),plus(1));
  assert.equal(await page.inputValue('[name=start_date]'),plus(1));assert.equal(await page.inputValue('[name=end_date]'),plus(1));
  await page.click('[data-cr-field=dates]');assert.ok(await page.locator('[name=start_date]').isVisible());
  await page.fill('[name=end_date]',plus(2));await page.fill('[name=end]','04:50');assert.equal(await page.inputValue('[name=end_date]'),plus(2));
  await page.click('[data-cr-field=dates]');assert.equal(await page.locator('[name=end_date]').isVisible(),false);assert.ok(await page.locator('[name=end]').isVisible());
  await page.selectOption('[name=responsible]',uid(2));
  // A second line has its own date toggle and blank editable reference.
  await page.click('[data-cr=add-row]');assert.equal(await page.locator('[data-timing-row]').count(),2);
  const second=page.locator('[data-timing-row]').nth(1);assert.equal(await second.locator('[name=reference]').inputValue(),'');
  await second.locator('[data-cr-field=dates]').click();assert.ok(await second.locator('[name=start_date]').isVisible());assert.equal(await page.locator('[data-timing-row]').first().locator('[name=start_date]').isVisible(),false);
  await second.locator('[data-cr=remove-row]').click();
  await page.screenshot({path:path.join(out,'consignation-mobile.png')});
  await page.click('[data-cr=dispatch]');await page.waitForSelector('#crSheet',{state:'detached'}).catch(async e=>{console.error('Form notice:',await page.locator('#crSheetNotice').textContent());throw e;});
  // ITC keeps a free Voie field and the full expanded source catalogue.
  await page.click('[data-cr=edit-section][data-key=itc]');await nativeTimes();
  await page.click('[data-cr-field=references]');assert.equal(await page.locator('.cr-reference-options [role=option]').count(),28);
  await page.getByRole('option',{name:'ZEP Type G 704 (Précaire)',exact:true}).click();
  await page.fill('[name=track]','V2 bis');await page.fill('[name=start]','23:50');await page.fill('[name=end]','05:00');
  await page.click('[data-cr=save-config]');await page.waitForSelector('#crSheet',{state:'detached'});
  await page.click('[data-cr=edit-section][data-key=itc]');assert.equal(await page.inputValue('[name=track]'),'V2 bis');assert.equal(await page.inputValue('[name=reference]'),'Type G 704 (Précaire)');await nativeTimes();
  await page.screenshot({path:path.join(out,'itc-mobile.png')});await page.click('[data-cr=close-sheet]');
  await page.click('[data-cr=edit-section][data-key=arf]');await nativeTimes();assert.equal(await page.locator('[name=reference]').count(),0);
  await page.fill('[name=start]','00:25');await page.fill('[name=end]','04:30');await page.click('[data-cr=save-config]');await page.waitForSelector('#crSheet',{state:'detached'});
  await page.click('[data-cr=edit-section][data-key=arf]');await nativeTimes();assert.equal(await page.inputValue('[name=start]'),'00:25');
  assert.equal(await page.inputValue('[name=planned_start]'),'');assert.equal(await page.inputValue('[name=planned_end]'),'');await page.click('[data-cr=close-sheet]');
  // The assigned agent receives only their form, may save and then submit.
  await page.evaluate(()=>{testUser=2;TEST.app.user.id='00000000-0000-4000-8000-000000000002';TEST.crOff.contextChanged();});
  await page.waitForSelector('#crTasksBtn:visible');await page.evaluate(()=>TEST.crOff.openInbox());await page.click('#crBody [data-cr=task-open]');await nativeTimes();
  assert.equal(await page.inputValue('[name=start]'),'00:15');assert.equal(await page.inputValue('[name=end_date]'),plus(2));
  await page.click('[data-cr=save-task]');assert.ok(await page.locator('#crSheet').isVisible());await nativeTimes();
  await page.click('[data-cr=submit-task]');await page.click('.journal-decision .primary-button');await page.waitForSelector('#crSheet',{state:'detached'});
  await page.evaluate(()=>{testUser=1;TEST.app.user.id='00000000-0000-4000-8000-000000000001';TEST.crOff.contextChanged();});await page.setViewportSize({width:1024,height:768});
  await page.evaluate(()=>TEST.crOff.open());await page.waitForSelector('.cr-report');await page.click('.cr-report [data-cr=report]');
  await page.click('[data-cr=edit-section][data-key=catenaire]');await nativeTimes();assert.equal(await page.inputValue('[name=end]'),'04:50');assert.equal(await page.inputValue('[name=end_date]'),plus(2));
  await page.screenshot({path:path.join(out,'consignation-tablette.png')});await page.click('[data-cr-field=dates]');await page.screenshot({path:path.join(out,'dates-tablette.png')});
  await page.click('[data-cr=close-sheet]');await page.evaluate(()=>{const rpc=TEST.app.db.rpc;TEST.app.db.rpc=async(name,payload)=>{const result=await rpc(name,payload);if(name==='journal_cr_api'&&payload.p_action==='detail')result.data.state='validated';return result;};});await page.click('[data-cr=refresh-report]');await page.click('[data-cr=edit-section][data-key=catenaire]');assert.ok(await page.locator('[name=start]').isDisabled());await page.click('[data-cr-field=dates]');assert.ok(await page.locator('[name=start_date]').isVisible());assert.ok(await page.locator('[name=start_date]').isDisabled());
  assert.deepEqual(errors,[]);console.log('V15.7 browser OK: native time controls, dates toggled independently, overnight/weekend persistence, editable catalogues, ITC track, ARF, private save/submit, tablet.');
 }finally{if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));await db.close();}
})().catch(e=>{console.error(e.stack);process.exit(1)});
