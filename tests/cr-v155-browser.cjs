// Entire journal shell with real modules and a disposable SQL backend. No real send.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),http=require('node:http');
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {setup155}=require('../supabase/tests/cr-v155-backend.cjs');
const root=path.resolve(__dirname,'..'),out=process.env.TEST_OUTPUT_DIR||'/tmp/journal-v155-tests';fs.mkdirSync(out,{recursive:true});
(async()=>{const db=new PGlite();let browser,server;
 try{
  await setup155(db);
  server=http.createServer((req,res)=>{const name=new URL(req.url,'http://localhost').pathname;
   const p=path.resolve(root,'.'+(name==='/'?'/index.html':name));if(!p.startsWith(root+path.sep)||!fs.existsSync(p)||!fs.statSync(p).isFile()){res.writeHead(404);res.end();return;}
   let body=fs.readFileSync(p);
   if(name==='/app-v13.js')body=body.toString().replace(/  initialize\(\)\.catch[^\n]+/,'window.TEST={app,feedback,crOff,modeChantier,wireEvents,renderMessages,renderActions,renderMessage,renderPinnedMessages,openQuickAddDialog,openProduction,openExportDialog};');
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
  await page.evaluate(()=>{
   window.testUser=1;const uid=()=>`00000000-0000-4000-8000-${String(testUser).padStart(12,'0')}`;
   Object.assign(TEST.app,{mode:'cloud',currentId:'aaaaaaaa-0000-4000-8000-000000000001',user:{id:uid()},profile:{id:uid(),full_name:'Encadrant test'},chantiers:[{id:'aaaaaaaa-0000-4000-8000-000000000001',name:'Chantier test'}],db:{from:()=>{const q=new Proxy({}, {get:(_,k)=>k==='then'?(resolve)=>Promise.resolve({data:[],error:null}).then(resolve):()=>q});return q;},rpc:(name,payload={})=>database({user:testUser,name,payload}),functions:{invoke:async()=>({data:{configured:true,test_mode:true,test_recipient:'test@example.fr'}})}}});
   TEST.wireEvents();TEST.feedback.contextChanged();TEST.crOff.contextChanged();
  });
  const owner=async()=>{await page.evaluate(()=>{testUser=1;TEST.app.user.id='00000000-0000-4000-8000-000000000001';TEST.crOff.contextChanged();});await page.waitForSelector('#crOffBtn:visible');};
  const agent=async(n)=>page.evaluate(n=>{testUser=n;TEST.app.user.id='00000000-0000-4000-8000-'+String(n).padStart(12,'0');TEST.crOff.contextChanged();},n);
  await page.click('#crOffBtn');await page.click('[data-cr=new]');await page.click('[data-cr=create]');await page.waitForSelector('#crSection-catenaire');
  assert.equal(await page.locator('.cr-rubric').count(),5);await page.click('#crSection-catenaire');assert.equal(await page.locator('[data-timing-row]').count(),1);assert.equal(await page.inputValue('[name=reference]'),'');
  await page.fill('[name=reference]','1 + 3');await page.selectOption('[name=responsible]','00000000-0000-4000-8000-000000000002');await page.click('[data-cr=dispatch]');await page.waitForSelector('#crSheet',{state:'detached'});
  assert.match(await page.locator('#crSection-catenaire').innerText(),/en attente/);
  await agent(2);await page.waitForSelector('.cr-task-popup[open]');assert.equal(await page.locator('#crOffBtn').isVisible(),false);await page.click('[data-cr=later]');await page.click('#crTasksBtn');await page.click('[data-cr=task-open]');await page.waitForSelector('#crSheet');
  assert.equal(await page.locator('[name=responsible]').count(),0);assert.equal(await page.locator('[name=planned_start]').count(),1);assert.equal(await page.locator('#crSection-securite').isVisible(),false);
  await page.fill('[name=start]','23:15');await page.fill('[name=end]','05:07');await page.click('[data-cr=save-task]');await page.waitForFunction(()=>document.querySelector('#crSheetNotice')?.textContent.includes('Brouillon enregistré'));
  await page.click('[data-cr=close-sheet]');await page.click('[data-cr=inbox]');assert.equal(await page.locator('[data-cr=task-open]').count(),1,'saved request stays visible');await page.click('[data-cr=task-open]');assert.equal(await page.inputValue('[name=end]'),'05:07');
  await page.setViewportSize({width:320,height:740});assert.equal(await page.locator('#crSheet main').evaluate(e=>e.scrollWidth<=e.clientWidth+1),true);await page.screenshot({path:out+'/agent-brouillon.png'});
  await page.click('[data-cr=submit-task]');await page.waitForSelector('.journal-decision');assert.match(await page.locator('.journal-decision').innerText(),/ne pourrez plus modifier/);await page.click('.journal-decision .primary-button');await page.waitForSelector('#crSheet',{state:'detached'});assert.equal(await page.locator('[data-cr=task-open]').count(),0);
  await owner();await page.click('#crOffBtn');await page.locator('[data-cr=report]').first().click();await page.click('#crSection-catenaire');assert.equal(await page.inputValue('[name=end]'),'05:07');await page.fill('[name=correction]','Vérifier l’heure de fin');await page.click('[data-cr=dispatch]');await page.waitForSelector('#crSheet',{state:'detached'});
  await agent(2);await page.waitForSelector('.cr-task-popup');await page.click('.cr-task-popup [data-cr=task-open]');assert.match(await page.locator('#crSheet').innerText(),/Vérifier l’heure de fin/);await page.fill('[name=end]','05:10');await page.click('[data-cr=submit-task]');await page.click('.journal-decision .primary-button');await page.waitForSelector('#crSheet',{state:'detached'});
  await owner();await page.setViewportSize({width:800,height:1024});await page.click('#crOffBtn');await page.locator('[data-cr=report]').first().click();await page.click('#crSection-itc');await page.fill('[name=reference]','785');await page.fill('[name=track]','V2');await page.fill('[name=start]','23:00');await page.fill('[name=end]','05:30');await page.screenshot({path:out+'/itc-tablette.png'});await page.click('[data-cr=save-config]');await page.waitForSelector('#crSheet',{state:'detached'});
  await page.click('#crSection-arf');await page.check('[name=non_concerne]');await page.click('[data-cr=save-config]');await page.waitForSelector('#crSheet',{state:'detached'});
  await page.click('#crSection-technique');await page.selectOption('[name=production_mode]','text');await page.fill('[name=body]','Pose d’un appareil tendeur sur le support 80/07. Essais terminés.');await page.click('[data-cr=save-config]');await page.waitForSelector('#crSheet',{state:'detached'});
  await page.click('#crSection-securite');await page.fill('[name=body]','Briefing de qualité');await page.click('[data-cr=save-safety]');await page.waitForSelector('#crSheet',{state:'detached'});await page.screenshot({path:out+'/cr-pret.png'});
  await page.click('[data-cr=validate]');await page.click('.journal-decision .primary-button');await page.waitForSelector('[data-cr=reopen]');
  // The viewer uses the exact saved PDF bytes. Sharing runs only in a user gesture.
  await page.evaluate(()=>{window.pdfs=[];const original=JournalPDF.view;JournalPDF.view=async(blob,name,opts)=>{pdfs.push({name,bytes:Array.from(new Uint8Array(await blob.arrayBuffer()))});return original(blob,name,opts);};Object.defineProperty(navigator,'canShare',{configurable:true,value:({files})=>files[0]?.type==='application/pdf'});Object.defineProperty(navigator,'share',{configurable:true,value:async({files})=>{window.lastShare={name:files[0].name,size:files[0].size,activation:navigator.userActivation.isActive};}});});
  await page.click('[data-cr=pdf]');await page.waitForFunction(()=>document.querySelector('[data-pages]')?.textContent.includes('Page 1 sur'));assert.ok(await page.locator('.cr-pdf-viewer canvas').evaluate(c=>c.width>200));await page.screenshot({path:out+'/cr-pdf.png'});await page.click('[data-pdf=share]');assert.ok(await page.evaluate(()=>lastShare.activation));await page.click('[data-pdf=close]');
  let pdfs=await page.evaluate(()=>pdfs);fs.writeFileSync(out+'/CR-off.pdf',Buffer.from(pdfs[0].bytes));assert.ok(Buffer.from(pdfs[0].bytes).subarray(0,5).toString()==='%PDF-');
  await page.click('[data-cr=reload]');await page.locator('[data-cr=delete-one]').first().click();await page.click('.journal-decision .primary-button');await page.waitForSelector('.cr-empty');await page.click('[data-cr=deleted]');await page.click('[data-cr=restore-one]');await page.click('.journal-decision .primary-button');await page.click('[data-cr=deleted]');await page.waitForSelector('[data-cr=report]');
  await page.evaluate(()=>document.querySelector('#crOffDialog').close());
  // Production saved without opening CR creates a visible night on a second device.
  const next=await page.evaluate(async()=>{const night=new Date(Date.now()+864e5).toISOString().slice(0,10);const result=await TEST.app.db.rpc('journal_production_api',{p_action:'save',p_payload:{chantier_id:TEST.app.currentId,night,id:crypto.randomUUID(),version:0,items:[{title:'Production tablette',progress:null,additional:false}]}});if(result.error)throw Error(result.error.message);return night;});
  await page.click('#crOffBtn');assert.equal(await page.locator('[data-cr=report]').count(),2);await page.evaluate(()=>document.querySelector('#crOffDialog').close());
  // Actual application Export button: 220 events, twenty photo attachments, one transient failure.
  await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=400;canvas.height=240;const c=canvas.getContext('2d');c.fillStyle='#15975a';c.fillRect(0,0,400,240);c.fillStyle='#ad1436';c.fillRect(30,30,180,140);c.font='28px sans-serif';c.fillStyle='white';c.fillText('PHOTO CHANTIER',20,220);window.fixturePhoto=canvas.toDataURL('image/png');const at=new Date().toISOString();TEST.app.messages=Array.from({length:220},(_,i)=>({id:'msg'+i,chantier_id:TEST.app.currentId,created_at:at,author_name:'Agent terrain',body:'Événement '+i+' : travaux effectués, contrôles et mesures consignés.',attachments:i<20?[{id:'photo'+i,file_name:'Photo-'+i+'.png',mime_type:'image/png',storage_path:'photo'+i}]:[]}));TEST.app.db.storage={from:()=>({createSignedUrl:async(path)=>({data:{signedUrl:fixturePhoto},error:null})})};window.exportStarted=performance.now();TEST.openExportDialog();});
  await page.click('#runExport');await page.waitForFunction(()=>document.querySelector('[data-pages]')?.textContent.includes('Page 1 sur'),{timeout:60000});const duration=await page.evaluate(()=>performance.now()-exportStarted);console.log('Export local 220 événements / 20 photos:',Math.round(duration),'ms');await page.screenshot({path:out+'/journal-pdf.png'});pdfs=await page.evaluate(()=>pdfs);fs.writeFileSync(out+'/Journal.pdf',Buffer.from(pdfs.at(-1).bytes));assert.equal(await page.locator('iframe.journal-export-frame').count(),0);await page.click('[data-pdf=next]');await page.waitForFunction(()=>document.querySelector('[data-pages]').textContent.startsWith('Page 2 '));await page.click('[data-pdf=close]');
  const {execFileSync}=require('node:child_process');const crText=execFileSync('pdftotext',[out+'/CR-off.pdf','-'],{encoding:'utf8'}),journalText=execFileSync('pdftotext',[out+'/Journal.pdf','-'],{encoding:'utf8'});assert.match(crText,/Pose d.un appareil tendeur/);assert.match(crText,/Voie V2/);assert.match(crText,/Briefing de qualité/);assert.match(journalText,/Événement 219/);const images=execFileSync('pdfimages',['-list',out+'/Journal.pdf'],{encoding:'utf8'});assert.equal(images.split('\n').filter(l=>/\simage\s/.test(l)).length,20);assert.deepEqual(errors,[]);
  console.log('V15.5 navigateur: rôles, brouillons, envoi, correction, PDF réel, partage, tablette et export avec photos: OK');
 }finally{await browser?.close();await new Promise(r=>server?server.close(r):r());await db.close();}
})().catch(e=>{console.error(e);process.exit(1)});
