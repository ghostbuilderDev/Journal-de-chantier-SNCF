/* Private organizer view; participants receive only the expiring QR capability. */
(()=>{
 'use strict';
 let context=null,current=null,storageKey='',box=null,panel=null,inflight=null,busy=false,exporting=false;
 const byId=id=>document.getElementById(id);
 const date=()=>byId('date')?.value||new Date().toLocaleDateString('en-CA',{timeZone:'Europe/Paris'});
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function notice(text){if(byId('attendanceStatus'))byId('attendanceStatus').textContent=text;if(byId('attendanceDialogStatus'))byId('attendanceDialogStatus').textContent=text;}
 const transport=(action,data)=>window.JournalBriefingAttendanceTransport.request(action,data);
 function save(){try{localStorage.setItem(storageKey,JSON.stringify(current));}catch(_){notice('Séance ouverte. Gardez le briefing ouvert sur cet appareil.');}}
 function matches(){return current&&current.date===date()&&current.chantier_id===context?.id;}
 function received(result){
  if(!current||result.id!==current.id||result.chantier_id!==context.id||result.briefing_date!==current.date)throw new Error('La réponse ne correspond pas à ce briefing.');
  current.state=result.state;current.expires_at=result.expires_at;current.count=result.signatures.length;
  if(matches()&&!current.finalized)window.BriefingPresence.merge(result.id,result.signatures);
  save();render();return result;
 }
 async function poll(){
  if(!current||!matches()||busy||current.finalized)return;
  if(inflight)return inflight;
  const id=current.id;inflight=transport('poll',{id}).then(r=>{if(current?.id===id)return received(r);}).finally(()=>inflight=null);return inflight;
 }
 function qrSvg(url){
  const qr=qrcodegen.QrCode.encodeText(url,qrcodegen.QrCode.Ecc.MEDIUM),size=qr.size+8;let d='';
  for(let y=0;y<qr.size;y++)for(let x=0;x<qr.size;x++)if(qr.getModule(x,y))d+=`M${x+4},${y+4}h1v1h-1z `;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" role="img" aria-label="QR code pour signer ce briefing" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="white"/><path d="${d}" fill="black"/></svg>`;
 }
 function url(){const link=new URL('signer.html',location.href);link.search='';link.hash=current.token;return link.href;}
 function render(){
  if(!box)return;
  const active=matches()&&!current.finalized,open=active&&current.state==='open'&&Date.parse(current.expires_at)>Date.now();
  byId('attendanceOpen').textContent=open?'Afficher le QR code':'Créer le QR code de cette séance';
  notice(active?`${current.count||0} signature(s) reçue(s) · ${open?'émargement ouvert':'émargement fermé'}`:'Chaque participant peut signer depuis son téléphone.');
  if(panel?.open){
   byId('attendanceQr').innerHTML=open?qrSvg(url()):'<p>Les signatures de cette séance sont fermées.</p>';
   byId('attendanceSessionTitle').textContent=context.name+' · '+current.date;
   byId('attendanceCopy').hidden=!open;byId('attendanceShare').hidden=!open;byId('attendancePoster').hidden=!open;byId('attendanceDisplay').hidden=!open;byId('attendanceDisplay').href=BriefingQRShare.links(current.token).display;byId('attendanceCloseSession').hidden=!open;
  }
 }
 function show(){
  if(!panel){panel=document.createElement('dialog');panel.className='briefing-qr-dialog';panel.innerHTML='<header><div><small>BRIEFING · ÉMARGEMENT</small><h2 id="attendanceSessionTitle"></h2></div><button type="button" data-qr-close>Fermer ×</button></header><p>Scannez ce QR code, renseignez votre identité et signez sur votre téléphone.</p><div id="attendanceQr"></div><p id="attendanceDialogStatus" role="status"></p><p class="qr-share-help">Partagez l’affichage sur une tablette ou un écran. À chaque briefing, ouvrez le nouveau lien reçu pour remplacer le précédent.</p><a id="attendanceDisplay" class="qr-display-link" target="_blank" rel="noopener noreferrer">Ouvrir l’affichage du QR code</a><div class="briefing-qr-actions"><button type="button" id="attendanceShare" class="qr-share-primary">Partager le QR code</button><button type="button" id="attendancePoster">Télécharger l’affiche QR</button><button type="button" id="attendanceCopy">Copier le lien de signature</button><button type="button" id="attendanceRefresh">Actualiser</button><button type="button" id="attendanceCloseSession">Terminer l’émargement</button></div>';document.body.append(panel);
   panel.querySelector('[data-qr-close]').onclick=()=>panel.close();
   byId('attendanceCopy').onclick=async()=>{try{await navigator.clipboard.writeText(url());notice('Lien de cette séance copié.');}catch(_){notice('Copie indisponible. Les participants peuvent scanner le QR code.');}};
   const shareSession=()=>({token:current.token,id:current.id,date:current.date,title:context.name});
   byId('attendanceShare').onclick=async()=>{try{notice(await BriefingQRShare.share(shareSession()));}catch(e){notice('Partage indisponible. Utilisez le lien Ouvrir l’affichage du QR code ou téléchargez l’affiche.');}};
   byId('attendancePoster').onclick=async()=>{try{await BriefingQRShare.download(shareSession());notice('Affiche téléchargée pour cette séance. Remplacez-la au prochain briefing.');}catch(e){notice(e.message);}};
   byId('attendanceRefresh').onclick=()=>void poll().catch(e=>notice(e.message));
   byId('attendanceCloseSession').onclick=async()=>{if(await JournalDialogs.confirm('Terminer l’émargement ? Ce QR code n’acceptera plus de nouvelle signature.'))try{await closeSession();}catch(e){notice(e.message);}};
  }
  if(!panel.open)panel.showModal();render();
 }
 function requireReviewed(){
  const count=window.BriefingPresence.pending().length;if(!count)return;
  panel?.close();window.BriefingPresenceReview.open();
  throw new Error(count+' signature(s) à vérifier avant de générer le PDF ou de changer de séance.');
 }
 async function open(){
  if(busy)return;busy=true;byId('attendanceOpen').disabled=true;
  try{
   if(!matches()||current.finalized||current.state==='closed'||Date.parse(current.expires_at)<=Date.now()){
    requireReviewed();
    if(current&&!current.finalized&&current.state==='open'){
     if(matches())await closeSession();else await transport('close',{id:current.id});
     requireReviewed();
    }
    const token=Array.from(crypto.getRandomValues(new Uint8Array(32)),n=>n.toString(16).padStart(2,'0')).join('');
    window.BriefingPresence.clearRemote();
    current={id:crypto.randomUUID(),token,date:date(),chantier_id:context.id,state:'opening',count:0};save();
   }
   received(await transport('open',{id:current.id,token:current.token,date:current.date,title:context.name+' · '+current.date}));show();
  }catch(error){notice(error.message);}finally{busy=false;byId('attendanceOpen').disabled=false;}
 }
 async function closeSession(){if(inflight)await inflight;if(!current||!matches()||current.finalized)return;received(await transport('close',{id:current.id}));}
 async function beforeExport(){
  requireReviewed();
  if(!current||current.finalized)return;
  if(!matches()){
   await transport('close',{id:current.id});current.finalized=true;save();window.BriefingPresence.clearRemote();render();return;
  }
  exporting=true;try{await closeSession();requireReviewed();}finally{exporting=false;}
 }
 function init(e){
  if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',()=>init(e),{once:true});return;}
  context=e.detail;storageKey='journal-briefing-qr-v158:'+context.userId+':'+context.id;
  try{current=JSON.parse(localStorage.getItem(storageKey)||'null');}catch(_){}
  if(current&&!current.finalized&&window.BriefingPresence.pending().length&&!matches()){
   byId('date').value=current.date;window.presenceSave?.();
  }
  window.BriefingPresence.retainSession(matches()&&!current.finalized?current.id:null);
  box=document.createElement('section');box.className='briefing-attendance no-print';box.innerHTML='<div><small>SIGNATURES SUR TÉLÉPHONE</small><h3>Faire signer les participants</h3><p id="attendanceStatus" role="status"></p><p>La génération du PDF termine l’émargement de cette séance.</p></div><button type="button" id="attendanceOpen">Créer le QR code de cette séance</button>';
  byId('signatureSheet')?.before(box);byId('attendanceOpen').onclick=open;render();
  if(matches()&&!current.finalized)void poll().catch(e=>notice(e.message));
 }
 document.addEventListener('journal-briefing-context',init,{once:true});
 document.addEventListener('change',e=>{
  if(e.target.id!=='date'||!current||matches())return;
  if(window.BriefingPresence.pending().length){
   e.target.value=current.date;window.presenceSave?.();panel?.close();window.BriefingPresenceReview.open();
   notice('Vérifiez les signatures reçues avant de changer la date.');return;
  }
  window.BriefingPresence.clearRemote();panel?.close();render();
 });
 document.addEventListener('DOMContentLoaded',()=>{
  const purge=window.confirmPdfSavedAndPurgeV67;
  if(purge)window.confirmPdfSavedAndPurgeV67=function(){if(current){current.finalized=true;save();render();}return purge.apply(this,arguments);};
 });
 setInterval(()=>{if(!document.hidden&&!exporting&&matches()&&!current.finalized&&current.state==='open')void poll().catch(e=>notice(e.message));},5000);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&matches())void poll().catch(e=>notice(e.message));});
 window.BriefingAttendance={beforeExport,poll,open};
})();
