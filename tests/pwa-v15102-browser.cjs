// Actual service workers: install all three scopes, retain drafts, offline QR shell.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..');
(async()=>{let browser,server;try{
 const missing=[];
 server=http.createServer((req,res)=>{const pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname==='/pwa-probe.html'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Test PWA</title>');return;}
  if(pathname.startsWith('/rest/')){res.setHeader('Cache-Control','no-store');res.end('{"private":"fixture"}');return;}
  const p=path.resolve(root,'.'+(pathname.endsWith('/')?pathname+'index.html':pathname));if(!p.startsWith(root+path.sep)||!fs.existsSync(p)){missing.push(pathname);res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',p.endsWith('.js')?'text/javascript':p.endsWith('.mjs')?'text/javascript':p.endsWith('.css')?'text/css':p.endsWith('.html')?'text/html':p.endsWith('.json')||p.endsWith('.webmanifest')?'application/manifest+json':p.endsWith('.png')?'image/png':'application/octet-stream');res.end(fs.readFileSync(p));
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));const host=`http://localhost:${server.address().port}`;
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||undefined,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
 const ctx=await browser.newContext({viewport:{width:390,height:844},locale:'fr-FR'});await ctx.route('**/*',r=>new URL(r.request().url()).hostname==='localhost'?r.continue():r.abort());const page=await ctx.newPage();page.setDefaultTimeout(20000);await page.goto(host+'/pwa-probe.html');
 await page.evaluate(()=>{localStorage.setItem('existing-draft-fixture','conserver');});
 const scopes=await page.evaluate(async()=>{const urls=['/service-worker-v13.js?v=15.10.2','/briefing/service-worker.js','/rapport/service-worker.js'];for(const url of urls){const r=await navigator.serviceWorker.register(url);if(!r.active)await new Promise((resolve,reject)=>{const worker=r.installing||r.waiting;worker.addEventListener('statechange',()=>{if(worker.state==='activated')resolve();if(worker.state==='redundant')reject(new Error('Worker installation failed: '+url));});});}return(await navigator.serviceWorker.getRegistrations()).map(r=>new URL(r.scope).pathname).sort();});
 assert.deepEqual(scopes,['/','/briefing/','/rapport/']);assert.deepEqual(missing,[]);
 await page.reload();await page.evaluate(()=>fetch('/rest/v1/rpc/private-test',{method:'POST',body:'{}'}));
 const cached=await page.evaluate(async()=>{const files=[];for(const name of await caches.keys()){const cache=await caches.open(name);files.push(...(await cache.keys()).map(r=>r.url));}return files;});
 assert.ok(cached.some(u=>u.endsWith('signature-pad.js?v=15.10.1')));assert.equal(cached.some(u=>u.includes('/rest/')),false);
 assert.ok(cached.some(u=>u.endsWith('presence-review.js?v=15.10.2')));assert.ok(cached.some(u=>u.endsWith('presence-matching.js?v=15.10.2')));
 assert.equal(await page.evaluate(()=>localStorage.getItem('existing-draft-fixture')),'conserver');
 const token='a'.repeat(64);await ctx.setOffline(true);await page.goto(host+'/briefing/signer.html#'+token);assert.equal(new URL(page.url()).hash,'#'+token);assert.equal(await page.title(),'Journal de chantier – Briefing au pied de l’opération');assert.equal(await page.locator('#signForm').count(),1);assert.equal(await page.locator('#signatureDialog').count(),1);
 if(await page.locator('#signFullscreen').isVisible()){await page.click('#signFullscreen');await page.waitForFunction(()=>Boolean(document.fullscreenElement));assert.equal(new URL(page.url()).hash,'#'+token);await page.click('#signFullscreen');await page.waitForFunction(()=>!document.fullscreenElement);}
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'briefing/manifest.json'),'utf8'));assert.equal(manifest.display,'standalone');assert.equal(manifest.scope,'./');assert.ok(await page.locator('link[rel=manifest]').count());
 console.log('PASS V15.10.2 PWA: root/briefing/report workers and static assets install, private requests not cached, drafts retained, QR URL and correct offline page preserved.');
 }finally{await browser?.close();if(server)await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
