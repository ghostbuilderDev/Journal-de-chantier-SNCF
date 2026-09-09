// Real editor and send path, with a disposable SQL database. No external send.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {setup157}=require('../supabase/tests/cr-v157-backend.cjs');
const root=path.resolve(__dirname,'..'),site='aaaaaaaa-0000-4000-8000-000000000001';
const uid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const exposed='window.TEST={app,composer,wireEvents,renderMessages,refreshCloudCurrent,refreshMessagePermission,sendComposerMessage,queueFiles,rememberComposerDraft,restoreComposerDraft,clearComposer};';
(async()=>{
 const db=new PGlite();let server,browser,lane=Promise.resolve(),failInsert=false,failUpload=false,permissionFailure=false,insertDelay=0;
 const inserted=[],uploads=[],errors=[];
 try{
  await setup157(db);
  // Nullable legacy attachment metadata omitted by the minimal SQL fixture.
  await db.exec('alter table chantier_attachments add column if not exists plan_category text, add column if not exists plan_status text, add column if not exists revision text, add column if not exists zone text;');
  server=http.createServer((req,res)=>{
   const url=new URL(req.url,'http://localhost'),name=url.pathname;
   const p=path.resolve(root,'.'+(name==='/'?'/index.html':name));
   if(!p.startsWith(root+path.sep)||!fs.existsSync(p)||!fs.statSync(p).isFile()){res.writeHead(404);res.end();return;}
   let body=fs.readFileSync(p);
   if(name==='/config.js')body='window.JOURNAL_CONFIG={};';
   if(name==='/app-v13.js')body=body.toString().replace(/  initialize\(\)\.catch[^\n]+/,exposed);
   res.setHeader('Content-Type',p.endsWith('.css')?'text/css':/\.m?js$/.test(p)?'text/javascript':p.endsWith('.html')?'text/html':'application/octet-stream');res.end(body);
  });await new Promise(r=>server.listen(0,'127.0.0.1',r));
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||undefined,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
  const host=`http://localhost:${server.address().port}`;
  async function newPage(user,{baseline=false,missing=false,nativeFailure=false}={}){
   const page=await browser.newPage({viewport:{width:390,height:844},locale:'fr-FR'});page.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',route=>new URL(route.request().url()).hostname==='localhost'?route.continue():route.abort());
   if(baseline)for(const name of ['app-v13.js','journal-composer.js','journal-v156.css']){
    const old=execFileSync('git',['show','12b4e52:'+name],{cwd:root,encoding:'utf8'});
    await page.route('**/'+name+'?*',route=>route.fulfill({contentType:name.endsWith('.css')?'text/css':'text/javascript',body:name==='app-v13.js'?old.replace(/  initialize\(\)\.catch[^\n]+/,'window.TEST={app,wireEvents,renderMessages};'):old}));
   }
   if(missing)await page.route('**/journal-composer.js?*',route=>route.fulfill({contentType:'text/javascript',body:'/* Simulate an unavailable optional editor module. */'}));
   if(nativeFailure)await page.addInitScript(()=>HTMLDialogElement.prototype.showModal=function(){throw new Error('Dialog unavailable in test');});
   await page.exposeBinding('database',(_,a)=>{
    const job=lane.then(async()=>{
     await db.exec(`reset role;set request.jwt.claim.sub='${uid(a.user)}';set role authenticated;`);
     try{
      if(a.kind==='rpc'){
       if(a.name==='journal_v142_can_write'){
        if(permissionFailure)return{data:null,error:{message:'Simulated network failure'}};
        return{data:(await db.query('select journal_v142_can_write($1) allowed',[a.payload.p_chantier_id])).rows[0].allowed,error:null};
       }
       return{data:null,error:null};
      }
      assert.ok(['chantier_messages','chantier_attachments'].includes(a.table));
      if(a.operation==='insert'){
       if(a.table==='chantier_messages'&&failInsert){failInsert=false;return{data:null,error:{message:'Envoi indisponible temporairement'}};}
       if(insertDelay)await new Promise(r=>setTimeout(r,insertDelay));
       const entries=Object.entries(a.value);assert.ok(entries.every(([k])=>/^[a-z_]+$/.test(k)));
       const result=await db.query('insert into '+a.table+'('+entries.map(([k])=>k).join(',')+') values('+entries.map((_,i)=>'$'+(i+1)).join(',')+') returning *',entries.map(([,v])=>v));
       if(a.table==='chantier_messages')inserted.push(result.rows[0]);return{data:result.rows[0],error:null};
      }
      const values=[],filters=a.filters.map(([key,op,value])=>{assert.match(key,/^[a-z_]+$/);assert.ok(['eq','lte','in'].includes(op));values.push(value);return key+(op==='in'?' = any($'+values.length+'::uuid[])':(op==='eq'?' = ':' <= ')+'$'+values.length);});
      const order=a.orders.map(([key,asc])=>{assert.match(key,/^[a-z_]+$/);return key+(asc?' asc':' desc');});
      let sql='select * from '+a.table+(filters.length?' where '+filters.join(' and '):'')+(order.length?' order by '+order.join(','):'');
      if(a.range){values.push(a.range[1]-a.range[0]+1,a.range[0]);sql+=' limit $'+(values.length-1)+' offset $'+values.length;}
      return{data:(await db.query(sql,values)).rows,error:null};
     }catch(e){return{data:null,error:{message:e.message,code:e.code}};}
    });lane=job.catch(()=>{});return job;
   });
   await page.exposeBinding('uploadFile',(_,a)=>{if(failUpload){failUpload=false;return{error:{message:'Photo interrompue'}};}uploads.push(a);return{data:{path:a.path},error:null};});
   await page.goto(host);
   await page.evaluate(({user,site})=>{
    const id='00000000-0000-4000-8000-'+String(user).padStart(12,'0');
    function from(table){
     const a={kind:'table',user,table,operation:'select',filters:[],orders:[]};
     const q={select(){return q;},insert(value){a.operation='insert';a.value=value;return q;},upsert(){return q;},eq(k,v){a.filters.push([k,'eq',v]);return q;},lte(k,v){a.filters.push([k,'lte',v]);return q;},in(k,v){a.filters.push([k,'in',v]);return q;},order(k,o={}){a.orders.push([k,o.ascending!==false]);return q;},range(x,y){a.range=[x,y];return q;},limit(){return q;},single(){return q;},maybeSingle(){return q;},then(resolve,reject){return(['chantier_messages','chantier_attachments'].includes(table)?database(a):Promise.resolve({data:[],error:null})).then(resolve,reject);}};return q;
    }
    const storage={from:()=>({upload:async(path,file)=>uploadFile({path,name:file.name,size:file.size,type:file.type}),remove:async()=>({error:null}),createSignedUrl:async()=>({data:{signedUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXKsAAAAASUVORK5CYII='},error:null})})};
    Object.assign(TEST.app,{mode:'cloud',currentId:site,user:{id,email:'user'+user+'@test.invalid'},profile:{id,full_name:'Agent '+user,email:'user'+user+'@test.invalid'},access:{platformRole:user===1?'proprietaire':null},members:[],chantiers:[{id:site,name:'Chantier test'}],db:{from,storage,rpc:(name,payload={})=>database({kind:'rpc',user,name,payload})}});
    TEST.wireEvents();TEST.renderMessages();
   },{user,site});
   return page;
  }
  // Regression proof: same authorized contributor, no locally loaded member list.
  const old=await newPage(2,{baseline:true});await old.click('#messageInput');assert.equal(await old.locator('#journalComposer').getAttribute('open'),null);assert.equal(await old.locator('#sendBtn').isVisible(),false);await old.close();
  console.log('Reproduced V15.7: contributor cannot open editor; Send is hidden.');
  async function open(page){await page.click('#messageInput');await page.waitForSelector('#journalComposer[open]');await page.waitForFunction(()=>document.querySelector('#sendBtn').textContent==='Envoyer');}
  async function send(page,text){await open(page);await page.fill('#messageInput',text);await page.click('#sendBtn');await page.waitForFunction(()=>!TEST.app.sendingMessage);assert.equal(await page.inputValue('#messageInput'),'');}
  const p=await newPage(2);await open(p);await p.fill('#messageInput','SEL 1 + 3 : 23:55');await p.press('#messageInput','Enter');await p.locator('#messageInput').pressSequentially('Fin à confirmer.');assert.equal(inserted.length,0);assert.match(await p.inputValue('#messageInput'),/\nFin/);
  await p.click('#writingClose');await open(p);assert.match(await p.inputValue('#messageInput'),/Fin à confirmer/);
  insertDelay=150;await p.evaluate(()=>{document.querySelector('#sendBtn').click();document.querySelector('#sendBtn').click();});await p.waitForFunction(()=>!TEST.app.sendingMessage);insertDelay=0;assert.equal(inserted.length,1);assert.equal(inserted[0].author_id,uid(2));assert.equal(inserted[0].chantier_id,site);assert.equal(await p.inputValue('#messageInput'),'');
  const peer=await newPage(3);await peer.evaluate(()=>TEST.refreshCloudCurrent());assert.ok(await peer.evaluate(()=>TEST.app.messages.some(m=>m.body.includes('Fin à confirmer'))));await send(peer,'Réponse du deuxième contributeur');await peer.close();
  for(const role of [1,6]){const page=await newPage(role);await send(page,'Envoi rôle '+role);await page.close();}
  console.log('SQL sends and cross-user reads OK: owner, site administrator, two contributors; no membership list required.');
  for(const role of [5,7]){const page=await newPage(role);await page.click('#messageInput');await page.waitForFunction(()=>document.querySelector('#sendBtn').disabled);assert.match(await page.textContent('#messageSendStatus'),/Lecture seule/);const count=inserted.length;await page.evaluate(()=>{document.querySelector('#messageInput').value='Interdit';return TEST.sendComposerMessage();});assert.equal(inserted.length,count);await page.close();}
  await open(p);await p.fill('#messageInput','Brouillon conservé');await p.screenshot({path:process.env.EDITOR_SCREENSHOT||'/tmp/journal-v1571-editor.png'});failInsert=true;await p.click('#sendBtn');await p.waitForFunction(()=>!TEST.app.sendingMessage);assert.match(await p.textContent('#journalComposer #messageSendStatus'),/non envoyé/);assert.equal(await p.inputValue('#messageInput'),'Brouillon conservé');await p.click('#sendBtn');await p.waitForFunction(()=>!TEST.app.sendingMessage);assert.equal(await p.inputValue('#messageInput'),'');
  permissionFailure=true;await open(p);await p.fill('#messageInput','Réseau à réessayer');const beforeNetwork=inserted.length;await p.click('#sendBtn');await p.waitForFunction(()=>!TEST.app.sendingMessage);assert.equal(inserted.length,beforeNetwork);assert.equal(await p.inputValue('#messageInput'),'Réseau à réessayer');permissionFailure=false;await p.click('#sendBtn');await p.waitForFunction(()=>!TEST.app.sendingMessage);assert.equal(await p.inputValue('#messageInput'),'');
  // Photo-only send, failed file retry reuses the persisted message and the same File.
  await p.evaluate(()=>TEST.queueFiles([new File([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXKsAAAAASUVORK5CYII='),c=>c.charCodeAt(0))],'photo.png',{type:'image/png'})]));
  failUpload=true;const beforePhoto=inserted.length;await p.click('#sendBtn');await p.waitForFunction(()=>!TEST.app.sendingMessage);assert.equal(inserted.length,beforePhoto+1);assert.equal(await p.evaluate(()=>TEST.app.pendingFiles[0].file.name),'photo.png');await p.click('#sendBtn');await p.waitForFunction(()=>!TEST.app.sendingMessage);assert.equal(inserted.length,beforePhoto+1);assert.equal(uploads.at(-1).name,'photo.png');assert.equal(await p.evaluate(()=>TEST.app.pendingFiles.length),0);
  await open(p);await p.fill('#messageInput','Droits retirés pendant la rédaction');await lane;await db.exec(`reset role;insert into journal_user_access_blocks(user_id) values('${uid(2)}');`);const beforeRevoke=inserted.length;await p.click('#sendBtn');await p.waitForFunction(()=>!TEST.app.sendingMessage);assert.equal(inserted.length,beforeRevoke);assert.match(await p.inputValue('#messageInput'),/Droits retirés/);await p.close();
  for(const option of [{missing:true},{nativeFailure:true}]){const page=await newPage(3,option);await page.click('#messageInput');assert.equal(await page.locator('#sendBtn').isVisible(),true);const bounds=await page.locator('#sendBtn').boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=390,'Fallback Send fits mobile viewport');await page.fill('#messageInput','Rédaction de secours '+JSON.stringify(option));await page.click('#sendBtn');await page.waitForFunction(()=>!TEST.app.sendingMessage);assert.equal(await page.inputValue('#messageInput'),'');await page.close();}
  assert.deepEqual(errors,[]);
  console.log('PASS V15.7.1: read-only/revoked access blocked, newline, drafts, inline errors, retry, photo-only attachment retry without duplication, missing-module and native-dialog fallback.');
 }finally{if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));await lane;await db.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
