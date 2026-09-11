/* Real composer, SQL membership checks, attachment writes, viewer and PDF.
   The shared harness replaces only external auth/network, never production data. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');

module.exports = async function checkAlbums({p, newPage, open, inserted, uploads, failFile, db, waitDatabase}) {
  const output = process.env.ALBUM_TEST_OUTPUT || '/tmp/journal-albums-v15106';
  fs.mkdirSync(output, {recursive:true});
  const images = await p.evaluate(() => Array.from({length:7}, (_,i) => {
    const canvas = document.createElement('canvas'); canvas.width=640; canvas.height=480;
    const ctx=canvas.getContext('2d');ctx.fillStyle=['#587769','#ad855a','#417885','#7184a1','#967a83','#627853','#bd7755'][i];ctx.fillRect(0,0,640,480);
    ctx.strokeStyle='#e5e1d4';ctx.lineWidth=22;ctx.beginPath();ctx.moveTo(80,480);ctx.lineTo(255,0);ctx.moveTo(420,480);ctx.lineTo(320,0);ctx.stroke();
    ctx.fillStyle='white';ctx.font='bold 52px sans-serif';ctx.fillText('Vue '+(i+1),32,90);
    return {name:'vue-'+(i+1)+'.png',data:canvas.toDataURL('image/png')};
  }));
  const files=images.map(x=>({name:x.name,mimeType:'image/png',buffer:Buffer.from(x.data.split(',')[1],'base64')}));
  const before=inserted.length;
  await open(p);
  assert.equal(await p.locator('#galleryInput').getAttribute('multiple'),'');
  assert.equal(await p.locator('#cameraInput').getAttribute('capture'),'environment');
  const chooser=p.waitForEvent('filechooser');
  await p.click('[data-writing="galleryBtn"]');await (await chooser).setFiles(files.slice(0,5));
  await p.locator('[data-action="remove-pending"][data-index="1"]').click();
  assert.equal(await p.locator('.pending-files .pending-file').count(),4);
  for (const file of files.slice(5)) {
    const camera=p.waitForEvent('filechooser');
    await p.click('[data-action="take-another-photo"]');await (await camera).setFiles(file);
  }
  await p.locator('#fileInput').setInputFiles({name:'notice.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\nfixture')});
  await p.fill('#messageInput','Les photos de la séance');await p.press('#messageInput','Enter');
  await p.locator('#cameraInput').dispatchEvent('cancel');
  assert.equal(inserted.length,before,'Selecting photos or Enter never sends a message');
  assert.match(await p.textContent('.pending-album-heading'),/Album de 6 photos/);
  assert.equal(await p.locator('.pending-file').count(),7,'Six photos and one document');
  // Annotation uses the existing editor and must preserve all other files.
  await p.click('[data-action="annotate-pending"][data-index="0"]');
  await p.waitForFunction(()=>!document.getElementById('saveAnnotation').disabled);
  await p.click('#cancelAnnotation');
  assert.equal(await p.locator('.pending-file').count(),7);
  await p.click('#writingClose');await open(p);
  await p.evaluate(()=>TEST.rememberComposerDraft());
  await p.reload();await p.rebind();await p.evaluate(()=>TEST.restoreComposerDraft());
  await p.waitForFunction(()=>TEST.app.pendingFiles.length===7);await open(p);
  assert.equal(await p.inputValue('#messageInput'),'Les photos de la séance\n');
  assert.deepEqual(await p.evaluate(()=>TEST.app.pendingFiles.map(x=>x.file.name)),['vue-1.png','vue-3.png','vue-4.png','vue-5.png','vue-6.png','vue-7.png','notice.pdf']);
  await p.screenshot({path:path.join(output,'composer-mobile.png')});
  // Failure in the middle of an album: retry appends only the missing photo
  // to the original message, even after leaving and reopening the editor.
  const uploadedBefore=uploads.length;failFile('vue-4.png');
  await p.click('#sendBtn');await p.waitForFunction(()=>!TEST.app.sendingMessage);
  assert.equal(inserted.length,before+1);
  const messageId=inserted.at(-1).id;
  assert.equal(uploads.length,uploadedBefore+6);
  assert.deepEqual(await p.evaluate(()=>TEST.app.pendingFiles.map(x=>x.file.name)),['vue-4.png']);
  await p.click('#writingClose');await p.click('#messageInput');
  await p.click('#sendBtn');await p.waitForFunction(()=>!TEST.app.sendingMessage);
  assert.equal(inserted.length,before+1);
  assert.equal(uploads.length,uploadedBefore+7);
  await waitDatabase();
  const rows=(await db.query('select id,file_name from chantier_attachments where message_id=$1',[messageId])).rows;
  assert.equal(rows.length,7);assert.equal(new Set(rows.map(x=>x.file_name)).size,7);
  assert.equal(await p.evaluate(()=>TEST.app.pendingFiles.length),0);
  console.log('PASS album send: gallery, repeated camera, remove, annotation cancel, draft reload, newline, partial retry, one SQL message and seven unique attachments.');

  // Another authorized user sees the same album, including the retried file.
  const peer=await newPage(3);await peer.evaluate(()=>TEST.refreshCloudCurrent());
  async function decorate(page) {
    await page.evaluate(({messageId,images})=>{
      const message=TEST.app.messages.find(m=>m.id===messageId);
      for (const file of message.attachments) {
        const image=images.find(x=>x.name===file.file_name);
        if(image)file.signed_url=file.full_signed_url=image.data;
      }
      TEST.renderMessages();
    },{messageId,images});
  }
  await decorate(peer);
  const row=peer.locator(`[data-message-row="${messageId}"]`);
  assert.equal(await row.locator('.photo-album button').count(),4);
  assert.equal(await row.locator('.album-more').textContent(),'+2');
  assert.equal(await row.locator('.file-attachment').count(),1);
  await row.locator('.photo-album button').nth(3).click();
  assert.equal(await peer.textContent('#photoViewerPosition'),'4 / 6');
  assert.equal(await peer.locator('#photoViewerPosition').isVisible(),true,'Counter is visible on mobile');
  assert.equal(await peer.locator('#photoViewerNext span').isVisible(),true,'Navigation labels stay visible');
  await peer.click('#photoViewerNext');assert.equal(await peer.textContent('#photoViewerPosition'),'5 / 6');
  await peer.press('#photoViewerClose','ArrowRight');assert.equal(await peer.textContent('#photoViewerPosition'),'6 / 6');
  assert.equal(await peer.locator('#photoViewerNext').isDisabled(),true);
  await peer.click('#photoViewerPrevious');assert.equal(await peer.textContent('#photoViewerPosition'),'5 / 6');
  await peer.locator('.photo-viewer-stage').dispatchEvent('pointerdown',{pointerId:1,isPrimary:true,clientX:300,clientY:300,pointerType:'touch'});
  await peer.locator('.photo-viewer-stage').dispatchEvent('pointerup',{pointerId:1,isPrimary:true,clientX:80,clientY:305,pointerType:'touch'});
  assert.equal(await peer.textContent('#photoViewerPosition'),'6 / 6');
  // A two-finger gesture is not interpreted as an album swipe.
  const stage=peer.locator('.photo-viewer-stage');
  await stage.dispatchEvent('pointerdown',{pointerId:1,isPrimary:true,clientX:80,clientY:300});
  await stage.dispatchEvent('pointerdown',{pointerId:2,isPrimary:false,clientX:150,clientY:300});
  await stage.dispatchEvent('pointerup',{pointerId:1,isPrimary:true,clientX:300,clientY:300});
  await stage.dispatchEvent('pointerup',{pointerId:2,isPrimary:false,clientX:350,clientY:300});
  assert.equal(await peer.textContent('#photoViewerPosition'),'6 / 6');
  await peer.screenshot({path:path.join(output,'viewer-mobile.png')});
  await peer.press('#photoViewerClose','Escape');assert.equal(await peer.locator('#photoViewer').isVisible(),false);
  await row.locator('.photo-album button').first().click();
  assert.equal(await peer.locator('#photoViewerPrevious').isDisabled(),true);
  await peer.press('#photoViewerClose','Tab');
  assert.equal(await peer.evaluate(()=>document.getElementById('photoViewer').contains(document.activeElement)),true);
  await peer.click('#photoViewerClose');
  await row.scrollIntoViewIfNeeded();await peer.screenshot({path:path.join(output,'album-mobile.png')});
  // Compact, non-overlapping mosaics for all sizes and orientations.
  for(const viewport of [{width:320,height:700},{width:390,height:844},{width:844,height:390},{width:820,height:1180},{width:1280,height:900}]) {
    await peer.setViewportSize(viewport);
    for (const count of [1,2,3,4,6,10]) {
      await peer.evaluate(({messageId,count})=>{
        const message=TEST.app.messages.find(m=>m.id===messageId);
        window.albumOriginal ||= structuredClone(message.attachments);
        const photos=window.albumOriginal.filter(x=>x.mime_type.startsWith('image/'));
        message.attachments=Array.from({length:count},(_,i)=>({...photos[i%photos.length],id:photos[i%photos.length].id+'-'+i}));
        TEST.renderMessages();
      },{messageId,count});
      const metrics=await row.locator('.photo-album').evaluate(el=>({width:el.getBoundingClientRect().width,left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right,tiles:[...el.children].map(x=>({x:x.getBoundingClientRect().x,y:x.getBoundingClientRect().y,width:x.getBoundingClientRect().width,height:x.getBoundingClientRect().height}))}));
      assert.equal(metrics.tiles.length,Math.min(count,4));
      assert.ok(metrics.left>=0 && metrics.right<=viewport.width,'Album stays inside viewport');
      if(count>1)assert.ok(metrics.tiles[1].x>metrics.tiles[0].x,'Two columns on mobile too');
      if(count===3)assert.ok(metrics.tiles[0].height>metrics.tiles[1].height*1.8,'Three-photo layout');
      if(count>4)assert.equal(await row.locator('.album-more').textContent(),'+'+(count-4));
      if(count===6&&viewport.width===1280)await peer.screenshot({path:path.join(output,'album-desktop.png')});
    }
  }
  await peer.evaluate(messageId=>{TEST.app.messages.find(m=>m.id===messageId).attachments=window.albumOriginal;TEST.renderMessages();},messageId);
  console.log('PASS album display: cross-user access, 1/2/3/4/6/10 photos, five viewports, overlay, original viewer, next/previous, keyboard, touch and pinch separation.');

  // Export reads all six originals from the message, never the four DOM tiles.
  await peer.evaluate(messageId=>{
    const view=JournalPDF.view;
    JournalPDF.view=async(blob,...args)=>{window.albumPdf=await blob.arrayBuffer();return view(blob,...args);};
    const message=TEST.app.messages.find(m=>m.id===messageId);
    JournalExport.open({site:{name:'Album test'},messages:[message],documents:[],scope:{photos:'included'},resolvePhoto:file=>file.full_signed_url});
  },messageId);
  await peer.waitForFunction(()=>!!window.albumPdf,null,{timeout:20000});
  const pdf=Buffer.from(await peer.evaluate(()=>Array.from(new Uint8Array(window.albumPdf))));
  const pdfPath=path.join(output,'album-six-photos.pdf');fs.writeFileSync(pdfPath,pdf);
  const inventory=JSON.parse(execFileSync('python3',['-c',`import sys,json
from pypdf import PdfReader
r=PdfReader(sys.argv[1]);images=set()
for p in r.pages:
 for ref in p.get('/Resources',{}).get('/XObject',{}).values():
  if ref.get_object().get('/Subtype')=='/Image':images.add((ref.idnum,ref.generation))
print(json.dumps({'images':len(images),'text':'\\n'.join(p.extract_text() or '' for p in r.pages)}))`,pdfPath],{encoding:'utf8'}));
  assert.equal(inventory.images,6);
  for(const name of ['vue-1.png','vue-3.png','vue-4.png','vue-5.png','vue-6.png','vue-7.png','notice.pdf'])assert.ok(inventory.text.includes(name),name+' retained in PDF');
  assert.ok(!inventory.text.includes('Photo indisponible'));
  await peer.close();
  console.log('PASS actual PDF: six embedded original photos, captions and document entry retained beyond the four visible tiles.');
};

if(require.main===module){process.env.JOURNAL_ALBUM_TEST='1';require('./messages-v1571-browser.cjs');}
