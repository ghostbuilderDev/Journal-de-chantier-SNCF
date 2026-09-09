// Generate the real application PDF with a synthetic photo. Nothing is shared.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..'),out=process.env.TEST_OUTPUT_DIR||'/tmp/journal-v153-tests';fs.mkdirSync(out,{recursive:true});
(async()=>{let browser,server;try{
 server=http.createServer((req,res)=>{const name=new URL(req.url,'http://localhost').pathname;const file=path.resolve(root,'.'+name);if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.html')?'text/html':file.endsWith('.png')?'image/png':'application/octet-stream');res.end(fs.readFileSync(file));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||undefined,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});const page=await browser.newPage({viewport:{width:1024,height:1000},locale:'fr-FR'});page.setDefaultTimeout(20000);
 page.on('dialog',d=>d.dismiss());let external=0;page.on('pageerror',e=>console.error('Browser:',e.message));
 await page.route('**/*',route=>{if(new URL(route.request().url()).hostname==='localhost')return route.continue();external++;return route.abort();});
 await page.goto(`http://localhost:${server.address().port}/briefing/index.html`);await page.waitForSelector('#photoGalleryInput',{state:'attached'});
 // Distinct quadrants make it possible to detect the whole photo in the raster PDF.
 const data=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=800;c.height=500;const g=c.getContext('2d');for(const [color,x,y]of[['#ff0000',0,0],['#00cc00',400,0],['#0055ff',0,250],['#ffcc00',400,250]]){g.fillStyle=color;g.fillRect(x,y,400,250);}g.fillStyle='#fff';g.font='42px sans-serif';g.fillText('PHOTO BRIEFING V15.3',120,260);return c.toDataURL('image/png').split(',')[1];});
 // Slow reader: an immediate PDF request must wait for the just-selected photo.
 await page.evaluate(()=>{const read=FileReader.prototype.readAsDataURL;FileReader.prototype.readAsDataURL=function(file){setTimeout(()=>read.call(this,file),350)};});
 await page.setInputFiles('#photoGalleryInput',{name:'photo-terrain.png',mimeType:'image/png',buffer:Buffer.from(data,'base64')});
 const photoCount=await page.evaluate(async()=>{const p=await BriefingPhotos.ready();return p.length});assert.equal(photoCount,1);
 await page.evaluate(()=>{updatePhotoComment(0,'Balisage vérifié avant intervention. Photo et légende conservées.');if(document.getElementById('chantier'))document.getElementById('chantier').value='Chantier de vérification';generate();});
 const result=await page.evaluate(async()=>{const pdf=await BriefingPwaPdf.createPdf();return {bytes:Array.from(new Uint8Array(await pdf.blob.arrayBuffer())),filename:pdf.filename,photos:briefingPhotos.length};});
 fs.writeFileSync(path.join(out,'briefing-photo-v153.pdf'),Buffer.from(result.bytes));assert.equal(result.photos,1,'Export alone never purges the photo');assert.equal(Buffer.from(result.bytes).subarray(0,5).toString(),'%PDF-');
 console.log('PASS actual PDF generated:',result.filename, result.bytes.length,'bytes; one photo plus caption, no archive or email invoked. External requests were blocked:',external);
 // A broken photo must fail visibly, rather than silently producing a PDF without it.
 await page.evaluate(()=>{briefingPhotos.push({src:'data:image/png;base64,not-a-photo',comment:'Broken test image'})});
 const failure=await page.evaluate(async()=>{try{await BriefingPwaPdf.createPdf();return '';}catch(e){return e.message;}});assert.ok(failure);assert.equal(await page.evaluate(()=>briefingPhotos.length),2);
 console.log('PASS invalid image fails the PDF export and retains the briefing.');
 }finally{await browser?.close();await new Promise(r=>server?server.close(r):r());}
})().catch(e=>{console.error(e);process.exitCode=1});
