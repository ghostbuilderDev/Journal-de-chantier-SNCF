const {clickReportAction}=require('./report-actions-helpers.cjs');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),http=require('node:http');
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite'),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {setup15104:setup15101}=require('../supabase/tests/report-numbering-v15104-backend.cjs');
const root=path.resolve(__dirname,'..'),out=process.env.TEST_OUTPUT_DIR||'/tmp/journal-v15101-tests';fs.mkdirSync(out,{recursive:true});
(async()=>{const db=new PGlite();let browser,server;
 try{
 await setup15101(db);const uid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),site='aaaaaaaa-0000-4000-8000-000000000001';
 await db.exec(`update chantiers set name='SST Montereau' where id='${site}';update journal_report_private.number_counter set next_serial=3;`);let lane=Promise.resolve(),loseTransfer=false,loseCreate=true;
 const database=(_,args)=>{const job=lane.then(async()=>{await db.exec(`reset role;set request.jwt.claim.sub='${uid(args.user)}';set role authenticated;`);
 const names={journal_cr_api:['p_action','p_payload'],journal_report_api:['p_action','p_payload'],journal_v142_can_write:['p_chantier_id']};if(!names[args.name])return {data:null,error:null};
 try{const data=(await db.query('select '+args.name+'('+names[args.name].map((_,i)=>'$'+(i+1)).join(',')+') r',names[args.name].map(k=>args.payload[k]??{}))).rows[0].r;if(args.name==='journal_report_api'&&args.payload.p_action==='create'&&loseCreate){loseCreate=false;return{data:null,error:{message:'Réponse perdue après création'}};}if(args.name==='journal_report_api'&&args.payload.p_action==='transfer'&&loseTransfer){loseTransfer=false;return{data:null,error:{message:'Réponse perdue après transfert'}};}return {data,error:null};}catch(e){return{data:null,error:{message:e.message,code:e.code}};}});lane=job.catch(()=>{});return job;};
 server=http.createServer((req,res)=>{const name=new URL(req.url,'http://localhost').pathname,p=path.resolve(root,'.'+(name==='/'?'/index.html':name));if(!p.startsWith(root+path.sep)||!fs.existsSync(p)||!fs.statSync(p).isFile()){res.writeHead(404);res.end();return;}let body=fs.readFileSync(p);
 if(name==='/app-v13.js')body=body.toString().replace(/  initialize\(\)\.catch[^\n]+/,'window.TEST={app,crOff,wireEvents,renderMessages,openDailyReportHub};');
 if(name==='/rapport/app.js')body=body.toString().replace('  boot();','  window.RJTEST={archive:archiveReportOnSharePoint,pdf:createSharePointArchivePdf,get:()=>state,set:x=>{state=x;ensureSettings();ensureState();refresh({inputs:true});},save};\n  boot();');
 if(name==='/supabase.js'||name==='/rapport/vendor/supabase.js')body=`window.supabase={createClient:()=>window.TESTCLIENT};`;
 if(name==='/config.js'||name==='/rapport/journal-config.js')body='window.JOURNAL_CONFIG={SUPABASE_URL:"http://localhost",SUPABASE_ANON_KEY:"test"};';
 res.setHeader('Content-Type',p.endsWith('.css')?'text/css':p.endsWith('.js')?'text/javascript':p.endsWith('.html')?'text/html':p.endsWith('.png')?'image/png':'application/octet-stream');res.end(body);
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));const host=`http://localhost:${server.address().port}`;
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||undefined,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});const errors=[],livePages=[];
 async function emitSignals(){const job=lane.then(async()=>{await db.exec('reset role');return (await db.query('select * from journal_notification_signals')).rows;});lane=job.catch(()=>{});const signals=await job;for(const p of livePages)if(!p.isClosed())await p.evaluate(signals=>window.fireNotificationSignal?.(signals),signals);}
 async function device(user,entry='/',width=390){const ctx=await browser.newContext({viewport:{width,height:900},locale:'fr-FR',timezoneId:'Europe/Paris',serviceWorkers:'block'});await ctx.exposeBinding('database',database);await ctx.route('**/*',r=>new URL(r.request().url()).hostname==='localhost'?r.continue():r.abort());
 await ctx.addInitScript(({user,id,site})=>{const rows=()=>[{id:site,name:'SST Montereau'}];let listener=null,last=0;window.fireNotificationSignal=signals=>{const next=signals.find(s=>s.user_id===id);if(next&&Number(next.revision)>last){last=Number(next.revision);listener?.({new:next});}};window.TESTCLIENT={channel:()=>{const ch={on:(event,options,fn)=>{if(options.table==='journal_notification_signals'){window.testSignalOptions=options;listener=fn;}return ch;},subscribe:fn=>{window.testSignalStatus=fn;fn?.('SUBSCRIBED');return ch;}};return ch;},removeChannel:async()=>{listener=null;window.testSignalStopped=true;},auth:{getUser:async()=>({data:{user:{id}}}),getSession:async()=>({data:{session:{user:{id}}}}),onAuthStateChange:f=>{window.testAuthChange=f;return{data:{subscription:{unsubscribe(){}}}};}},rpc:(name,payload={})=>database({user,name,payload}),from:()=>{const q=new Proxy({},{get:(_,k)=>k==='then'?resolve=>Promise.resolve({data:rows(),error:null}).then(resolve):()=>q});return q;}};},{user,id:uid(user),site});
 const page=await ctx.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.type()==='beforeunload'?d.accept():d.dismiss());await page.goto(host+entry);
 if(entry==='/'){await page.evaluate(({user,id,site})=>{Object.assign(TEST.app,{mode:'cloud',currentId:site,user:{id},profile:{id,full_name:'Personne '+user},access:{platformRole:'utilisateur'},chantiers:[{id:site,name:'SST Montereau'}],db:TESTCLIENT});TEST.wireEvents();TEST.crOff.contextChanged();},{user,id:uid(user),site});}
 livePages.push(page);return page;
 }
 const a=await device(2,'/rapport/index.html?chantierId='+site,390);await a.waitForSelector('[data-share-save]:not([disabled])',{state:'attached'});
 // Native V15.10 storage contains an old unscoped n° 1 and a more recent site
 // draft. Reopening must prefer the site draft and must not change its date.
 await a.evaluate(({user,site})=>{const d=structuredClone(RJTEST.get());d.reportSerial=1;d.reportUid='LEGACY-000001';d.meta.reportNo='AINM-RJ-000001-LEGACY';d.meta.date='2026-09-09';d.meta.location='Saisie à conserver du 9 septembre';d.tasks=[{id:'test-task',label:'Contrôle V2M',progress:50}];localStorage.setItem('ainm-rj-pwa-v1',JSON.stringify({...d,meta:{...d.meta,location:'Ancien brouillon incorrect'}}));localStorage.setItem('ainm-rj-v1510:'+user+':'+site,JSON.stringify(d));},{user:uid(2),site});
 await a.reload();await a.waitForSelector('[data-share-save]:not([disabled])',{state:'attached'});assert.equal(await a.evaluate(()=>RJTEST.get().meta.date),'2026-09-09');assert.equal(await a.evaluate(()=>RJTEST.get().meta.location),'Saisie à conserver du 9 septembre');assert.ok((await a.locator('#startupReportNo').textContent()).includes('attribué'));
 await a.click('#enterAppButton');await clickReportAction(a,'save');await a.waitForFunction(()=>document.querySelector('[data-status]').textContent.includes('Réponse perdue'));
 await a.reload();await a.waitForSelector('[data-share-save]:not([disabled])',{state:'attached'});await a.click('#enterAppButton');await clickReportAction(a,'save');await a.waitForURL(/reportId=/);
 await a.waitForFunction(()=>document.querySelector('[data-status]').textContent.includes('Toutes les saisies'));
 const third=new URL(a.url()).searchParams.get('reportId');assert.equal(await a.evaluate(()=>RJTEST.get().reportSerial),3);assert.equal(await a.evaluate(()=>RJTEST.get().meta.location),'Saisie à conserver du 9 septembre');
 assert.equal(await a.locator('#resetReportSerialButton').count(),0);
 // Real PDF generator and native print renderer both use the confirmed number.
 const pdf=await a.evaluate(async()=>{const file=await RJTEST.pdf(),loaded=await PDFLib.PDFDocument.load(await file.blob.arrayBuffer());return{filename:file.filename,title:loaded.getTitle(),pages:loaded.getPageCount(),size:file.blob.size};});
 assert.match(pdf.filename,/_N000003[.]pdf$/);assert.match(pdf.title,/AINM-RJ-000003-/);assert.ok(pdf.pages>0);assert.ok(pdf.size>1000);
 await a.evaluate(()=>window.print=()=>{window.printCapture={title:document.title,text:document.getElementById('printReport').textContent};});
 await a.evaluate(()=>document.getElementById('printButton').click());await a.waitForFunction(()=>!!window.printCapture);assert.match(await a.evaluate(()=>printCapture.title),/_N000003$/);assert.match(await a.evaluate(()=>printCapture.text),/AINM-RJ-000003-/);
 await a.waitForSelector('#confirmDialog[open]');await a.locator('#confirmDialog button').filter({hasText:'Annuler'}).click();
 await a.screenshot({path:path.join(out,'rapport-numero-3-mobile.png')});
 // Report opened by a direct link -> next draft -> close/reopen. This was the
 // V15.10 bug: the next draft used the previous URL's report ID as its key.
 await a.reload();await a.waitForSelector('[data-share-save]:not([disabled])',{state:'attached'});await clickReportAction(a,'next');await a.waitForSelector('#confirmDialog[open]');await a.locator('#confirmDialog button').filter({hasText:'Créer le rapport'}).click();await a.waitForURL(u=>!u.searchParams.has('reportId'));
 await a.fill('[data-path="meta.location"]','Nouveau RJ à conserver après fermeture');await a.reload();await a.waitForSelector('[data-share-save]:not([disabled])',{state:'attached'});await a.click('#enterAppButton');assert.equal(await a.locator('[data-path="meta.location"]').inputValue(),'Nouveau RJ à conserver après fermeture');
 await clickReportAction(a,'save');await a.waitForURL(/reportId=/);await a.waitForFunction(()=>document.querySelector('[data-status]').textContent.includes('Toutes les saisies'));assert.equal(await a.evaluate(()=>RJTEST.get().reportSerial),4);
 const fourth=new URL(a.url()).searchParams.get('reportId');assert.notEqual(third,fourth);
 await lane;await db.exec('reset role');let rows=(await db.query("select id,document from journal_report_private.reports order by document->>'reportSerial'")).rows;assert.equal(rows.length,2);assert.equal(rows[0].id,third);assert.equal(rows[0].document.meta.location,'Saisie à conserver du 9 septembre');assert.equal(rows[0].document.meta.date,'2026-09-09');
 // A second device shares the sequence instead of starting at n° 1.
 const b=await device(3,'/rapport/index.html?chantierId='+site,1024);await b.waitForSelector('[data-share-save]:not([disabled])',{state:'attached'});await b.click('#enterAppButton');await b.fill('[data-path="meta.location"]','Autre tablette');await clickReportAction(b,'save');await b.waitForURL(/reportId=/);await b.waitForFunction(()=>document.querySelector('[data-status]').textContent.includes('Toutes les saisies'));assert.equal(await b.evaluate(()=>RJTEST.get().reportSerial),5);
 await b.screenshot({path:path.join(out,'rapport-numero-5-ordinateur.png')});
 // Resuming an older queued PDF must not allocate a number to a new draft.
 await clickReportAction(b,'next');await b.waitForSelector('#confirmDialog[open]');await b.locator('#confirmDialog button').filter({hasText:'Créer le rapport'}).click();await b.waitForURL(u=>!u.searchParams.has('reportId'));
 const resumed=await b.evaluate(async()=>{
  const oldJob={id:'previous-job',done:false,meta:{reportUid:'previous-report',reportNo:'ANCIEN RAPPORT'},journal:true,sharepoint:'submitted'};
  const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('ainm-journal-archive-v1',1);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  await new Promise((resolve,reject)=>{const tx=db.transaction('jobs','readwrite');tx.objectStore('jobs').put(oldJob,'pending');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();
  let apiCalls=0;const rpc=TESTCLIENT.rpc,run=JournalArchive.run;TESTCLIENT.rpc=async(...args)=>{if(args[0]==='journal_report_api')apiCalls++;return rpc(...args);};JournalArchive.run=async job=>job;
  await RJTEST.archive();TESTCLIENT.rpc=rpc;JournalArchive.run=run;return{apiCalls,serial:RJTEST.get().reportSerial};
 });assert.equal(resumed.apiCalls,0);assert.equal(resumed.serial,0);
 // Network failure must not silently generate a PDF with a provisional number.
 await a.evaluate(()=>{TESTCLIENT.rpc=async()=>({error:{message:'Réseau indisponible'}});RJTEST.get().meta.location='Saisie hors connexion';RJTEST.save();});
 const failure=await a.evaluate(async()=>{try{await RJTEST.pdf();return '';}catch(e){return e.message;}});assert.match(failure,/Réseau/);assert.equal(await a.evaluate(()=>RJTEST.get().meta.location),'Saisie hors connexion');
 assert.equal(errors.length,0,errors.join('\n'));console.log('PASS V15.10.4 browser: old n° 1 draft -> n° 3, lost create acknowledgement, date retained, PDF and print n° 3, linked report -> next draft survives reload as n° 4, second device n° 5, offline export blocked with input retained.');
 }finally{await browser?.close();if(server)await new Promise(r=>server.close(r));await db.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
