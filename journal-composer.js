/* V15.6: one live textarea and attachment collection, moved without cloning. */
(function(root){
 'use strict';
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let dbPromise;
 function database(){return dbPromise||(dbPromise=new Promise((resolve,reject)=>{const r=indexedDB.open('journal-writing-v156',1);r.onupgradeneeded=()=>r.result.createObjectStore('drafts');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);}));}
 const writes=new Map();
 async function read(key){await writes.get(key);const db=await database();return new Promise((resolve,reject)=>{const r=db.transaction('drafts').objectStore('drafts').get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
 function write(key,value){const operation=(writes.get(key)||Promise.resolve()).catch(()=>{}).then(async()=>{const db=await database();await new Promise((resolve,reject)=>{const t=db.transaction('drafts','readwrite'),s=t.objectStore('drafts');value?s.put(value,key):s.delete(key);t.oncomplete=resolve;t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error);});});writes.set(key,operation);operation.finally(()=>{if(writes.get(key)===operation)writes.delete(key);}).catch(()=>{});return operation;}
 function create(a){
  const shell=a.shell,input=a.input,anchor=document.createComment('composer position');shell.before(anchor);
  const dialog=document.createElement('dialog');dialog.id='journalComposer';dialog.className='journal-composer-dialog';dialog.setAttribute('aria-labelledby','writingTitle');
  dialog.innerHTML=`<header><div><small id="writingSite"></small><h2 id="writingTitle">Rédiger un message</h2></div><button type="button" class="secondary-button" id="writingClose">Mettre de côté ×</button></header><div class="writing-toolbar"><button type="button" data-writing="cameraBtn">▣ Photo</button><button type="button" data-writing="attachBtn">⌁ Pièce jointe</button><button type="button" data-writing="emojiBtn">☺ Emoji</button><button type="button" data-writing="polishBtn">✦ Améliorer le message</button></div><main></main><p class="writing-status" role="status">Entrée ajoute une ligne. Seul « Envoyer » publie le message.</p>`;
  document.body.append(dialog);let suspended=false,wasOpen=false;
  function open(){if(dialog.open||!a.allowed())return;wasOpen=true;dialog.querySelector('#writingSite').textContent=a.site();dialog.querySelector('main').append(shell);shell.hidden=false;input.rows=8;dialog.showModal();resize();input.focus({preventScroll:true});}
  function close({discardView=false}={}){if(!wasOpen&&!dialog.open)return;a.save();dialog.close();anchor.after(shell);input.rows=1;wasOpen=false;suspended=false;if(discardView)dialog.querySelector('.writing-review')?.remove();a.refresh?.();}
  function suspend(){if(dialog.open){a.save();dialog.close();suspended=true;}}
  function resume(){if(suspended&&wasOpen&&a.allowed()){suspended=false;dialog.showModal();resize();}}
  function resize(){if(dialog.open){const v=window.visualViewport;dialog.style.setProperty('--writing-height',Math.round(v?.height||innerHeight)+'px');}}
  dialog.querySelector('#writingClose').onclick=()=>close();dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
  dialog.addEventListener('click',e=>{const button=e.target.closest('[data-writing]');if(button)document.getElementById(button.dataset.writing)?.click();});
  dialog.addEventListener('submit',e=>e.preventDefault());window.visualViewport?.addEventListener('resize',resize);window.addEventListener('resize',resize);
  window.addEventListener('pagehide',()=>a.save());window.addEventListener('popstate',()=>{if(dialog.open)close();});
  input.addEventListener('focus',()=>open());input.addEventListener('input',()=>a.save());
  function status(text){dialog.querySelector('.writing-status').textContent=text;}
  return{open,close,suspend,resume,status,isOpen:()=>dialog.open||suspended};
 }
 root.JournalComposer={create,read,write,esc};
})(window);
