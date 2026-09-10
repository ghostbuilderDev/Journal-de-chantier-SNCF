// Actual journal + briefing + two independent participant browsers, disposable SQL only.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),http=require('node:http');
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {setup15101}=require('../supabase/tests/collaboration-v15101-backend.cjs');
const root=path.resolve(__dirname,'..'),out=process.env.TEST_OUTPUT_DIR||'/tmp/journal-v15103-signature-tests';fs.mkdirSync(out,{recursive:true});
(async()=>{const db=new PGlite();let browser,server;
 try{
  await setup15101(db);
  const uid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),site='aaaaaaaa-0000-4000-8000-000000000001';
  const day=(await db.query('select current_date::text d')).rows[0].d,plus=n=>new Date(Date.parse(day+'T12:00Z')+n*864e5).toISOString().slice(0,10);
  await db.exec(`set request.jwt.claim.sub='${uid(1)}';set role authenticated;`);
  const api=async(a,p)=>(await db.query('select journal_cr_api($1,$2) r',[a,p])).rows[0].r;
  const source=await api('create',{chantier_id:site,night:plus(-1)}),detail=await api('detail',source);
  for(const key of ['itc','catenaire'])await api('field_configure',{id:source.id,key,version:detail.sections.find(s=>s.key===key).version,responsible:uid(2),data:{rows:[{label:key==='itc'?'ZEP 785':'SEL 1 + 3',track:key==='itc'?'V2M':'',planned_start:plus(-1)+'T21:55:00Z',planned_end:day+'T03:10:00Z',start:plus(-1)+'T22:05:00Z',end:day+'T03:00:00Z'}]}});
  let lane=Promise.resolve(),loseFirstSignature=true,concealNewReceipts=false;
  const database=(_,args)=>{const job=lane.then(async()=>{
   await db.exec(`reset role;set request.jwt.claim.sub='${args.user?uid(args.user):''}';set role ${args.user?'authenticated':'anon'};`);
   const names={journal_cr_api:['p_action','p_payload'],journal_briefing_manage:['p_action','p_payload'],journal_briefing_sign:['p_token','p_action','p_payload'],journal_v142_can_write:['p_chantier_id']};
   if(!names[args.name])return{data:null,error:null};
   try{const data=(await db.query('select '+args.name+'('+names[args.name].map((_,i)=>'$'+(i+1)).join(',')+') r',names[args.name].map(k=>args.payload[k]))).rows[0].r;if(args.name==='journal_briefing_manage'&&concealNewReceipts&&!args.full&&data?.signatures)data.signatures=data.signatures.filter(p=>!p.id.startsWith('00000000-0000-4000-8000-'));if(args.name==='journal_briefing_sign'&&args.payload.p_action==='submit'&&loseFirstSignature){loseFirstSignature=false;return{data:null,error:{message:'Réponse interrompue dans le test'}};}return{data,error:null};}
   catch(e){return{data:null,error:{message:e.message,code:e.code}};}
  });lane=job.catch(()=>{});return job;};
  server=http.createServer((req,res)=>{const name=new URL(req.url,'http://localhost').pathname;
   if(name==='/test-blank.html'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Upgrade fixture</title>');return;}
   const p=path.resolve(root,'.'+(name==='/'?'/index.html':name));if(!p.startsWith(root+path.sep)||!fs.existsSync(p)||!fs.statSync(p).isFile()){res.writeHead(404);res.end();return;}
   let body=fs.readFileSync(p);
   if(name==='/app-v13.js')body=body.toString().replace(/  initialize\(\)\.catch[^\n]+/,'window.TEST={app,crOff,wireEvents,renderMessages};');
   if(name==='/config.js')body='window.JOURNAL_CONFIG={SUPABASE_URL:"http://localhost",SUPABASE_ANON_KEY:"test-publishable"};';
   if(name==='/supabase.js')body='window.supabase={createClient:()=>({rpc:(name,payload)=>database({user:0,name,payload})})};';
   res.setHeader('Content-Type',p.endsWith('.css')?'text/css':(p.endsWith('.js')||p.endsWith('.mjs'))?'text/javascript':p.endsWith('.html')?'text/html':p.endsWith('.png')?'image/png':'application/octet-stream');res.end(body);
  });await new Promise(r=>server.listen(0,'127.0.0.1',r));
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||undefined,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
  const host=`http://localhost:${server.address().port}`,errors=[];
  async function newDevice(width=390,height=844){const ctx=await browser.newContext({viewport:{width,height},locale:'fr-FR',timezoneId:'Europe/Paris',serviceWorkers:'block'});await ctx.exposeBinding('database',database);await ctx.route('**/*',route=>new URL(route.request().url()).hostname==='localhost'?route.continue():route.abort());const page=await ctx.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>{errors.push('Native dialog: '+d.message());void d.dismiss();});return page;}
  const page=await newDevice();await page.goto(host);
  await page.evaluate(()=>{
   const site='aaaaaaaa-0000-4000-8000-000000000001',userId='00000000-0000-4000-8000-000000000001';
   Object.assign(TEST.app,{mode:'cloud',currentId:site,user:{id:userId},profile:{id:userId,full_name:'Encadrant test'},access:{platformRole:'proprietaire'},chantiers:[{id:site,name:'SST Montereau'}],db:{from:()=>{const q=new Proxy({}, {get:(_,k)=>k==='then'?(resolve)=>Promise.resolve({data:[],error:null}).then(resolve):()=>q});return q;},rpc:(name,payload={})=>database({user:1,name,payload})}});
   TEST.wireEvents();TEST.crOff.contextChanged();TEST.renderMessages();
  });
  await page.setViewportSize({width:1024,height:900});
  await page.evaluate(()=>JournalBriefing.open({context:()=>({ready:true,userId:TEST.app.user.id,db:TEST.app.db,chantier:TEST.app.chantiers[0]}),toast:()=>{},refresh:async()=>{}}));
  let frame=page.frames().find(f=>f.url().includes('/briefing/index.html'));if(!frame){await page.waitForSelector('iframe');frame=await page.locator('iframe').contentFrame();}
  // FrameLocator can be used for controls; evaluate via the real Frame after load.
  await page.frameLocator('iframe').locator('#attendanceOpen').waitFor();frame=page.frames().find(f=>f.url().includes('/briefing/index.html'));
  await frame.selectOption('#nbVoies','4');await frame.fill('#voieNom3','V4 BIS');await frame.selectOption('#voieS93','Circulée');await frame.selectOption('#voieS113','Caténaire mise hors tension');await frame.check('#pkDifferent3');await frame.fill('#voiePkDebut3','80,200');await frame.fill('#voiePkFin3','80,900');await frame.check('#voieTravail3');
  await frame.evaluate(()=>{window.lamData={3:{count:1,commonPoint:true,commonPk:'80,200',commonSecteur:'1 + 3',commonMiseVoie:'plateforme',engins:[{nom:'LAM 42',type:'Lorry',pk:'80,200',secteur:'1 + 3',miseVoie:'Accès nord'}]}};window.enginsAutresRR={3:{enabled:true,voie:'V4 BIS',type:'Pelle rail-route',piste:true,voieDirecte:false,obs:'Engin de réserve'}};BriefingPreparation.save();});
  const tracks=await frame.evaluate(()=>BriefingPreparation.capture());
  await frame.goto(frame.url());await frame.waitForSelector('#attendanceOpen');
  assert.equal(await frame.inputValue('#nbVoies'),'4');assert.equal(await frame.inputValue('#voieNom3'),'V4 BIS');assert.equal(await frame.inputValue('#voieS93'),'Circulée');assert.equal(await frame.inputValue('#voieS113'),'Caténaire mise hors tension');assert.ok(await frame.isChecked('#pkDifferent3'));assert.equal(await frame.inputValue('#voiePkFin3'),'80,900');
  assert.deepEqual(await frame.evaluate(()=>BriefingPreparation.capture().lamData),tracks.lamData);assert.deepEqual(await frame.evaluate(()=>BriefingPreparation.capture().enginsAutresRR),tracks.enginsAutresRR);
  // Twenty saved unsigned names from yesterday. Employer/function may change today.
  await frame.evaluate(()=>{
   const people=[['Màrtin','Participant 1'],['Durand','Participant 2'],...Array.from({length:16},(_,i)=>['Agent '+i,'Prénom '+i]),['Petit','Alex'],['Petit','Alex']];
   for(const [nom,prenom]of people){presenceOpen();document.getElementById('presenceNom').value=nom;document.getElementById('presencePrenom').value=prenom;document.getElementById('presenceEntreprise').value='ENTREPRISE TEST';presenceValidate();}
  });
  assert.equal((await frame.evaluate(()=>BriefingPresence.list())).length,20);
  assert.equal((await frame.evaluate(()=>BriefingPresence.list())).filter(p=>p.signature).length,0,'A blank manual canvas is unsigned');
  await frame.goto(frame.url());await frame.waitForSelector('#attendanceOpen');
  assert.equal((await frame.evaluate(()=>BriefingPresence.list())).length,20);
  await frame.fill('#date',day);await frame.click('#attendanceOpen');await frame.waitForSelector('.briefing-qr-dialog[open] svg');
  const qr=await frame.evaluate(()=>{const entry=Object.entries(localStorage).find(([k])=>k.startsWith('journal-briefing-qr-v158:'));return JSON.parse(entry[1]);});
  await page.screenshot({path:path.join(out,'briefing-qr-tablette.png')});fs.writeFileSync(path.join(out,'briefing-qr.svg'),await frame.locator('#attendanceQr svg').evaluate(n=>n.outerHTML));
  const signerURL=host+'/briefing/signer.html#'+qr.token;
  for(const [n,nom]of [[1,'Martin'],[2,'Durand']]){
   const signer=await newDevice();await signer.goto(signerURL);await signer.waitForSelector('#signForm:visible');
   await signer.fill('[name=nom]',nom);await signer.fill('[name=prenom]','Participant '+n);await signer.fill('[name=fonction]','RSO');await signer.fill('[name=entreprise]','Entreprise test');
   assert.equal(await signer.inputValue('[name=nom]'),nom.toUpperCase());assert.equal(await signer.inputValue('[name=entreprise]'),'ENTREPRISE TEST');
   await signer.click('#signOpen');await signer.waitForSelector('#signatureDialog[open]');
   let bounds=await signer.locator('#signatureEditor').boundingBox();assert.ok(bounds.height>400);assert.ok(bounds.width>300);await signer.mouse.move(bounds.x+20,bounds.y+50);await signer.mouse.down();await signer.mouse.move(bounds.x+120,bounds.y+30,{steps:8});await signer.mouse.move(bounds.x+80,bounds.y+75,{steps:8});await signer.mouse.move(bounds.x+230,bounds.y+65,{steps:8});await signer.mouse.up();
   if(n===1){
    await signer.screenshot({path:path.join(out,'signature-agrandie-mobile.png')});
    await signer.click('#signatureClose');await signer.reload();await signer.waitForSelector('#signForm:visible');assert.equal(await signer.inputValue('[name=nom]'),nom.toUpperCase());
    await signer.click('#signOpen');await signer.waitForSelector('#signatureApply:not([disabled])');
    await signer.setViewportSize({width:844,height:390});await signer.waitForTimeout(150);await signer.screenshot({path:path.join(out,'signature-agrandie-paysage.png')});
    await signer.click('#signatureClear');assert.equal(await signer.locator('#signatureApply').isDisabled(),true);
    bounds=await signer.locator('#signatureEditor').boundingBox();await signer.mouse.move(bounds.x+30,bounds.y+30);await signer.mouse.down();await signer.mouse.move(bounds.x+200,bounds.y+80,{steps:12});await signer.mouse.move(bounds.x+350,bounds.y+25,{steps:12});await signer.mouse.up();
    await signer.setViewportSize({width:390,height:844});await signer.waitForTimeout(150);
   }
   await signer.click('#signatureApply');await signer.waitForSelector('#signatureDialog',{state:'hidden'});
   assert.ok(await signer.locator('#signSignatureHint').textContent().then(t=>t.includes('validée')));
   if(n===1){await signer.screenshot({path:path.join(out,'signature-formulaire-mobile.png')});await signer.reload();await signer.waitForSelector('#signForm:visible');assert.ok((await signer.locator('#signSignatureHint').textContent()).includes('validée'));}
   assert.ok((await signer.title()).includes('Journal de chantier'));assert.equal(await signer.locator('body').textContent().then(t=>/github|ghostbuilder/i.test(t)),false);
   const beforeSubmit=await database(null,{user:1,name:'journal_briefing_manage',payload:{p_action:'poll',p_payload:{id:qr.id}}});assert.equal(beforeSubmit.data.signatures.length,n-1,'Accepting a drawing never submits attendance');
   await signer.click('#signSubmit');if(n===1){await signer.getByRole('button',{name:'Réessayer la validation'}).waitFor();await signer.reload();await signer.getByRole('button',{name:'Réessayer la validation'}).waitFor();assert.equal(await signer.inputValue('[name=nom]'),nom.toUpperCase());await signer.click('#signSubmit');}await signer.waitForSelector('#signSuccess:visible');await signer.reload();await signer.waitForSelector('#signSuccess:visible');
  }
  await frame.click('#attendanceRefresh');await frame.waitForFunction(()=>BriefingPresence.list().filter(p=>p.remote_id).length===2);
  const people=await frame.evaluate(()=>BriefingPresence.list());assert.deepEqual(people.filter(p=>p.remote_id).map(p=>p.nom),['MÀRTIN','DURAND']);assert.equal(people.length,20);assert.ok(people.filter(p=>p.remote_id).every(p=>p.entreprise==='ENTREPRISE TEST'));
  const received=await database(null,{user:1,name:'journal_briefing_manage',payload:{p_action:'poll',p_payload:{id:qr.id}}});assert.deepEqual(received.data.signatures.map(p=>p.nom),['MARTIN','DURAND']);assert.equal(people.filter(p=>p.remote_session===qr.id).length,2);assert.equal(await frame.locator('#presenceRows img').count(),2);await frame.click('[data-qr-close]');
  // Simulate an upgrade while five receipts are still quarantined by V15.10.2.
  concealNewReceipts=true;
  const png=await frame.evaluate(()=>{const c=document.createElement('canvas');c.width=600;c.height=240;const x=c.getContext('2d');x.strokeStyle='#173c55';x.lineWidth=4;x.beginPath();x.moveTo(30,180);x.lineTo(180,30);x.lineTo(160,190);x.lineTo(450,50);x.stroke();return c.toDataURL('image/png');});
  assert.notEqual(png,people[0].signature);
  async function addReceipt(id,nom,prenom,entreprise){
   const r=await database(null,{user:0,name:'journal_briefing_sign',payload:{p_token:qr.token,p_action:'submit',p_payload:{id:uid(id),nom,prenom,entreprise,fonction:'Agent terrain',signature:png}}});
   assert.equal(r.error,null);return r.data.id;
  }
  await addReceipt(201,'Martin','Participant 1','Entreprise TEST');
  await addReceipt(202,'Bob','Marley','SNCF');
  await addReceipt(203,'BOB','Marley','S.N.C.F.');
  await addReceipt(204,'Bob','Marley','AUTRE ENTREPRISE');
  await addReceipt(205,'Petit','Alex','ENTREPRISE TEST');
  const all=await database(null,{user:1,full:true,name:'journal_briefing_manage',payload:{p_action:'poll',p_payload:{id:qr.id}}});assert.equal(all.error,null);
  const waiting=all.data.signatures.filter(p=>p.id.startsWith('00000000-0000-4000-8000-'));
  assert.equal(waiting.length,5);
  const frameURL=frame.url();await frame.goto(host+'/test-blank.html');
  await frame.evaluate(queue=>{const k='briefing_presence_clean_v9',s=JSON.parse(localStorage.getItem(k));s.pendingRemote=queue;localStorage.setItem(k,JSON.stringify(s));},waiting);
  await frame.goto(frameURL);await frame.waitForSelector('#attendanceOpen');
  await frame.waitForFunction(()=>BriefingPresence.pending().length===0);
  assert.equal(await frame.locator('#presenceReviewDialog,#presenceReviewOpen,.presence-review-notice').count(),0,'No manual review remains in the interface');
  let merged=await frame.evaluate(()=>BriefingPresence.list());assert.equal(merged.length,21,'New participant added, duplicate rows consolidated, different company retained');
  assert.equal(merged.find(p=>p.nom==='MÀRTIN').remote_id,uid(201));assert.equal(merged.find(p=>p.nom==='MÀRTIN').signature,png,'New signature automatically replaces the previous image');
  assert.equal(merged.filter(p=>p.nom==='BOB').length,2);assert.equal(merged.find(p=>p.nom==='BOB'&&p.entreprise==='S.N.C.F.').remote_id,uid(203));
  assert.equal(merged.filter(p=>p.nom==='PETIT'&&p.prenom==='Alex').length,1);
  assert.equal(await frame.locator('#presenceRows img').count(),5);
  // Repeated and reversed responses cannot bring an older signature back.
  concealNewReceipts=false;await frame.evaluate(()=>BriefingAttendance.poll());
  await frame.evaluate(rows=>BriefingPresence.merge(rows[0].session_id,rows.reverse()),all.data.signatures);
  assert.deepEqual(await frame.evaluate(()=>BriefingPresence.list()),merged);
  await frame.goto(frameURL);await frame.waitForSelector('#attendanceOpen');await frame.evaluate(()=>BriefingAttendance.poll());
  assert.deepEqual(await frame.evaluate(()=>BriefingPresence.list()),merged);assert.equal(await frame.evaluate(()=>BriefingPresence.pending().length),0);
  await page.setViewportSize({width:390,height:844});await frame.locator('.briefing-attendance').scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(out,'signatures-automatiques-mobile.png')});
  await frame.click('#attendanceOpen');await frame.waitForSelector('.briefing-qr-dialog[open] svg');await frame.click('[data-qr-close]');
  await page.setViewportSize({width:1024,height:900});
  // Export freezes the session first, then captures actual signatures in the PDF.
  const pdf=await frame.evaluate(async()=>{const r=await BriefingPwaPdf.createPdf();return {bytes:Array.from(new Uint8Array(await r.blob.arrayBuffer())),filename:r.filename};});
  fs.writeFileSync(path.join(out,'briefing-qr-v15103.pdf'),Buffer.from(pdf.bytes));assert.equal(Buffer.from(pdf.bytes).subarray(0,5).toString(),'%PDF-');assert.ok(pdf.bytes.length>20000);
  const closed=await database(null,{user:0,name:'journal_briefing_sign',payload:{p_token:qr.token,p_action:'context',p_payload:{}}});assert.equal(closed.data.open,false);
  const after=await frame.evaluate(()=>BriefingPreparation.capture());assert.deepEqual(after.lamData,tracks.lamData);assert.equal(after.fields.voieNom3,'V4 BIS');
  await frame.evaluate(()=>confirmPdfSavedAndPurgeV67());await frame.waitForFunction(()=>!BriefingPresence.list().some(p=>p.signature));await frame.evaluate(()=>BriefingAttendance.poll());assert.equal(await frame.locator('#presenceRows img').count(),0);assert.equal(await frame.inputValue('#voieNom3'),'V4 BIS');
  await frame.goto(frame.url());await frame.waitForSelector('#attendanceOpen');assert.equal(await frame.inputValue('#voieNom3'),'V4 BIS');assert.equal(await frame.locator('#presenceRows img').count(),0);
  // A different chantier must not inherit this site's roads or remote signatures.
  await page.evaluate(()=>JournalBriefing.open({context:()=>({ready:true,userId:TEST.app.user.id,db:TEST.app.db,chantier:{id:'bbbbbbbb-0000-4000-8000-000000000001',name:'Autre chantier'}}),toast:()=>{},refresh:async()=>{}}));
  const otherFrame=await page.locator('iframe').last().contentFrame();await otherFrame.locator('#attendanceOpen').waitFor();assert.equal(await otherFrame.locator('#voieNom3').count(),0);assert.equal(await otherFrame.locator('#presenceRows img').count(),0);
  console.log('PASS V15.10.3: 20 saved names, two phone signatures, pending V15.10.2 receipts imported without review, new participants added, latest signature replaces old image, duplicate identity rows consolidated, different companies remain separate, no rollback on retry/reload, QR and signed PDF work, tracks and PWA data retained.');
  assert.deepEqual(errors,[]);
 }catch(e){console.error('Browser verification failed:',e.message);throw e;}
 finally{if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));await db.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
