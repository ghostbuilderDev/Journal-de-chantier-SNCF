(function(root){
 'use strict';
 const format=v=>v?new Date(v).toLocaleString('fr-FR',{timeZone:'Europe/Paris'}):'';
 const imageFile=f=>(f.mime_type||f.type||'').startsWith('image/')||/\.(jpg|jpeg|png|webp|gif)$/i.test(f.file_name||f.name||'');
 const source=f=>f.full_signed_url||f.signed_url||f.data_url||f.url||'';
 const key=f=>String(f.id||f.storage_path||source(f));
 function select(messages,scope={}){return messages.filter(m=>{const day=JournalCR.parisLocal(m.created_at).slice(0,10);return !m.deleted_at&&(!scope.from||day>=scope.from)&&(!scope.to||day<=scope.to)&&(scope.scope!=='important'||JournalFeed.pinned(m));});}
 async function photo(f,options,signal){
  const url=await options.resolvePhoto?.(f)||source(f);if(!url)throw new Error('Photo inaccessible');
  const response=await fetch(url,{signal,credentials:'omit'});if(!response.ok)throw new Error('Photo inaccessible');const blob=await response.blob();let bitmap;
  try{bitmap=await createImageBitmap(blob);const scale=Math.min(1,1400/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);const data=canvas.toDataURL('image/jpeg',.8);canvas.width=canvas.height=1;return data;}finally{bitmap?.close();}
 }
 function open(options){
  const valid=options.valid||(()=>true),messages=select(options.messages,options.scope),files=[...new Map(messages.flatMap(m=>m._history||[m]).flatMap(m=>m.attachments||[]).filter(imageFile).map(f=>[key(f),f])).values()],photos=new Map();let busy=false,closed=false,controllers=[];
  const d=document.createElement('dialog');d.className='cr-export-progress';d.innerHTML='<header><h2>Créer le PDF du journal</h2><button class="secondary-button" data-export="close">Fermer ×</button></header><main><p role="status">Préparation…</p><progress></progress><p data-missing></p></main><footer><button class="secondary-button" data-export="retry" hidden>Réessayer</button><button class="primary-button" data-export="partial" hidden>Créer avec les photos disponibles</button></footer>';
  const status=d.querySelector('[role=status]'),bar=d.querySelector('progress');const close=()=>{closed=true;controllers.forEach(c=>c.abort());d.remove();photos.clear();};
  d.addEventListener('cancel',e=>{e.preventDefault();close();});d.addEventListener('click',e=>{const a=e.target.closest('[data-export]')?.dataset.export;if(a==='close')close();if(a==='retry'&&!busy)void prepare();if(a==='partial'&&!busy)void generate();});
  async function generate(){busy=true;try{if(!valid())throw new Error('La session a changé.');status.textContent='Mise en page du PDF…';const doc=await JournalPDF.document(options.site.name,`${options.site.lineTrack||''}\nPériode : ${options.scope.from||'début du chantier'} au ${options.scope.to||'dernier message'}\n${messages.length} événements · édition du ${format(new Date())}`);
   const missing=options.scope.photos==='none'?[]:files.filter(f=>!photos.has(key(f)));if(missing.length)doc.text(`ÉDITION INCOMPLÈTE : ${missing.length} photo(s) indisponible(s).`,{bold:true,color:[170,20,40]});
   if(options.scope.include_pilotage&&options.pilotage){const fragment=new DOMParser().parseFromString(options.pilotage,'text/html');doc.heading('Suivi opérationnel');doc.text([...fragment.body.querySelectorAll('p')].map(e=>e.textContent).join('\n'));}
   if(options.documents?.length){doc.heading('Registre documentaire');for(const item of options.documents)doc.text(`${item.file_name} · ${item.folderLabel||''} · ${format(item.created_at)}`);}
   doc.heading('Chronologie');let n=0;
   for(const m of messages){if(closed)return;if(!valid())throw new Error('La session a changé.');if(m._completedAction)doc.heading('Action terminée · '+m._completedAction.title);for(const event of m._history||[m]){doc.text(`${format(event.created_at)} · ${event.author_name||''}${event.zone?' · '+event.zone:''}`,{bold:true,size:9});doc.text(event.body||'');for(const f of event.attachments||[]){const name=f.file_name||f.name||'Pièce jointe';if(imageFile(f)&&options.scope.photos!=='none'){const data=photos.get(key(f));if(data)doc.photo(data,name);else doc.text('Photo indisponible : '+name,{color:[170,20,40]});}else doc.text('Pièce jointe : '+name,{size:9});}}if(++n%8===0){status.textContent=`Mise en page : ${n} / ${messages.length}`;await new Promise(r=>setTimeout(r,0));}}
   const blob=doc.finish();if(closed)return;close();await JournalPDF.view(blob,'Journal-'+options.site.name.replace(/[^a-zA-Z0-9-]/g,'_')+'.pdf',{title:'Journal · '+options.site.name,valid});
  }catch(e){status.textContent=e.message;d.querySelector('[data-export=retry]').hidden=false;}finally{busy=false;}}
  async function prepare(){busy=true;bar.hidden=false;d.querySelector('[data-export=retry]').hidden=true;d.querySelector('[data-export=partial]').hidden=true;const wanted=options.scope.photos==='none'?[]:files.filter(f=>!photos.has(key(f)));let at=0,done=0;bar.max=wanted.length||1;bar.value=0;
   const worker=async()=>{while(at<wanted.length&&!closed&&valid()){const f=wanted[at++];for(let attempt=0;attempt<2;attempt++){const c=new AbortController();controllers.push(c);const deadline=setTimeout(()=>c.abort(),20000);try{let abort;let data;try{data=await Promise.race([photo(f,options,c.signal),new Promise((_,reject)=>{abort=()=>reject(new Error('Délai de chargement dépassé'));c.signal.addEventListener('abort',abort,{once:true});})]);}finally{c.signal.removeEventListener('abort',abort);}if(!closed&&valid())photos.set(key(f),data);break;}catch{}finally{clearTimeout(deadline);controllers=controllers.filter(x=>x!==c);}}bar.value=++done;status.textContent=`Photos préparées : ${done} / ${wanted.length}`;}};
   await Promise.all(Array.from({length:Math.min(3,wanted.length)},worker));busy=false;if(closed)return;if(!valid()){close();return;}bar.hidden=true;const missing=options.scope.photos==='none'?[]:files.filter(f=>!photos.has(key(f)));
   if(missing.length){status.textContent=`${missing.length} photo(s) n’ont pas pu être téléchargées. Vérifiez la connexion puis réessayez.`;d.querySelector('[data-missing]').textContent=missing.map(f=>f.file_name||f.name||'Photo').join(', ');d.querySelector('[data-export=retry]').hidden=false;d.querySelector('[data-export=partial]').hidden=false;}else await generate();
  }
  document.body.append(d);d.showModal();if(!messages.length){status.textContent='Aucun événement dans cette période. Modifiez les dates pour créer le journal.';bar.hidden=true;}else void prepare();return {close};
 }
 root.JournalExport={open,select};
})(window);
