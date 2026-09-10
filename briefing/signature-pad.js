/* QR signature editor. Draft and accepted signature are distinct; no network writes. */
(() => {
 'use strict';
 const png = value => typeof value === 'string' && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value) ? value : '';
 function create(onChange) {
  const dialog = document.getElementById('signatureDialog'), canvas = document.getElementById('signatureEditor');
  const preview = document.getElementById('signCanvas'), openButton = document.getElementById('signOpen');
  const apply = document.getElementById('signatureApply'), help = document.getElementById('signatureStatus');
  let accepted = '', working = '', dirty = false, ink = false, locked = false, drawing = false, ready = false, generation = 0;
  const context = canvas.getContext('2d');
  function contain(target, source) {
   const c = target.getContext('2d'), scale = Math.min(target.width / source.width, target.height / source.height);
   c.drawImage(source, (target.width-source.width*scale)/2, (target.height-source.height*scale)/2, source.width*scale, source.height*scale);
  }
  async function loadImage(data) { const img = new Image(); img.src = data; await img.decode(); return img; }
  function changed() { onChange?.(); }
  function state() { return {accepted,working,dirty}; }
  function controls() {
   apply.disabled = locked || !ready || !ink;
   document.getElementById('signatureClear').disabled = locked || !ready;
   openButton.disabled = locked;
   document.getElementById('signSignatureHint').textContent = dirty ? 'Signature en cours : ouvrir pour la valider.' : accepted ? 'Signature validée · appuyer pour la modifier' : 'Appuyer ici pour signer';
  }
  async function paintPreview() {
   const ticket = ++generation, image = accepted ? await loadImage(accepted).catch(()=>null) : null;
   if(ticket!==generation)return;
   preview.getContext('2d').clearRect(0,0,preview.width,preview.height);
   if(image)contain(preview,image);
   controls();
  }
  function fit() {
   if(!dialog.open)return;
   const r=canvas.getBoundingClientRect();if(!r.width||!r.height)return;
   const scale=Math.min(devicePixelRatio||1,1200/r.width,720/r.height);
   const width=Math.max(1,Math.round(r.width*scale)),height=Math.max(1,Math.round(r.height*scale));
   if(canvas.width===width&&canvas.height===height)return;
   const copy=document.createElement('canvas');copy.width=canvas.width;copy.height=canvas.height;copy.getContext('2d').drawImage(canvas,0,0);
   canvas.width=width;canvas.height=height;drawing=false;
   if(ink)contain(canvas,copy);
   if(ready&&ink){working=canvas.toDataURL('image/png');changed();}
  }
  function snapshot() { working=ink?canvas.toDataURL('image/png'):'';dirty=true;controls();changed(); }
  function close() { if(drawing){drawing=false;snapshot();}dialog.close();controls(); }
  async function open() {
   if(locked||dialog.open)return;
   ready=false;ink=false;context.clearRect(0,0,canvas.width,canvas.height);dialog.showModal();fit();controls();help.textContent='Signez avec le doigt. Vous pouvez tourner votre téléphone.';
   const data=dirty?working:(working||accepted);
   if(data){const image=await loadImage(data).catch(()=>null);if(image&&dialog.open){contain(canvas,image);ink=true;}}
   ready=true;controls();
  }
  function point(e) { const r=canvas.getBoundingClientRect();return {x:(e.clientX-r.left)*canvas.width/r.width,y:(e.clientY-r.top)*canvas.height/r.height}; }
  canvas.addEventListener('pointerdown',e=>{
   if(!ready||locked||drawing||e.button>0)return;
   e.preventDefault();canvas.setPointerCapture(e.pointerId);drawing=true;const p=point(e);
   context.lineWidth=Math.max(2,2.7*canvas.width/canvas.getBoundingClientRect().width);context.lineCap='round';context.lineJoin='round';context.strokeStyle='#172d3b';context.beginPath();context.moveTo(p.x,p.y);
  });
  canvas.addEventListener('pointermove',e=>{if(!drawing)return;e.preventDefault();const p=point(e);context.lineTo(p.x,p.y);context.stroke();ink=true;});
  for(const event of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(event,()=>{if(drawing){drawing=false;snapshot();}});
  function crop() {
   const {width:w,height:h}=canvas,bytes=context.getImageData(0,0,w,h).data;
   let left=w,right=0,top=h,bottom=0;
   for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(bytes[(y*w+x)*4+3]>0){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
   if(left>right)return '';
   left=Math.max(0,left-18);top=Math.max(0,top-18);right=Math.min(w-1,right+18);bottom=Math.min(h-1,bottom+18);
   const output=document.createElement('canvas');output.width=right-left+1;output.height=bottom-top+1;output.getContext('2d').drawImage(canvas,left,top,output.width,output.height,0,0,output.width,output.height);return output.toDataURL('image/png');
  }
  document.getElementById('signatureClear').onclick=()=>{if(locked||!ready)return;context.clearRect(0,0,canvas.width,canvas.height);ink=false;snapshot();help.textContent='La zone est effacée. Vous pouvez recommencer.';};
  apply.onclick=()=>{if(locked||!ready||!ink)return;accepted=crop();if(!accepted)return;working=canvas.toDataURL('image/png');dirty=false;void paintPreview();changed();close();};
  document.getElementById('signatureClose').onclick=close;
  dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
  openButton.onclick=()=>void open();
  new ResizeObserver(fit).observe(canvas);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&drawing){drawing=false;snapshot();}});
  return {open,state,hasDraft:()=>dirty,value:()=>accepted,
   restore(value={}) { accepted=png(value.accepted);working=png(value.working);dirty=Boolean(value.dirty);void paintPreview(); },
   lock(value) { locked=Boolean(value);controls(); },
   reset() { accepted='';working='';dirty=false;ink=false;context.clearRect(0,0,canvas.width,canvas.height);void paintPreview(); }
  };
 }
 window.BriefingSignaturePad={create};
})();
