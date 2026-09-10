/* Organizer-only review. The public QR page never receives the saved roster. */
(()=>{
 'use strict';
 let panel=null,box=null,selected=null;
 const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const api=()=>window.BriefingPresence;
 const label=p=>[p.nom,p.prenom].filter(Boolean).join(' ');
 function update(){
  if(!box){const sheet=document.getElementById('signatureSheet');if(!sheet)return;
   box=document.createElement('section');box.className='presence-review-notice no-print';box.hidden=true;
   box.innerHTML='<div><strong id="presenceReviewCount"></strong><p>Vérifiez le participant avant de rattacher sa signature. Les noms déjà enregistrés sont conservés.</p></div><button type="button" id="presenceReviewOpen">Vérifier les signatures</button>';
   sheet.before(box);box.querySelector('button').onclick=open;
  }
  const count=api()?.pending().length||0;box.hidden=!count;
  document.getElementById('presenceReviewCount').textContent=count+' signature'+(count>1?'s':'')+' à vérifier';
  if(panel?.open&&(!selected||!api().pending().some(p=>p.id===selected.id)))showNext();
 }
 function showNext(){
  selected=api().pending()[0];
  if(!selected){panel.close();return;}
  const people=api().list(),decision=BriefingPresenceMatching.classify(people,selected);
  const reason=decision.kind==='homonyms'?'Plusieurs participants portent ce nom.' :decision.kind==='signed'?'Ce participant a déjà une signature.' : 'Ce nom ne correspond pas avec certitude à un participant enregistré.';
  const options=people.map((p,i)=>'<option value="'+esc(p.local_id)+'">'+esc((i+1)+'. '+label(p)+' · '+(p.entreprise||'Entreprise non renseignée')+' · '+(p.fonction||'Fonction non renseignée')+(p.signature?' · Déjà signé':''))+'</option>').join('');
  panel.innerHTML='<header><div><small>BRIEFING · ÉMARGEMENT</small><h2 id="presenceReviewTitle">Vérifier une signature</h2></div><button type="button" data-review="close">Plus tard ×</button></header>'+
   '<main><p>'+esc(reason)+' Aucune ligne supplémentaire n’a été créée.</p><article><strong>'+esc(label(selected))+'</strong><p>'+esc(selected.entreprise)+' · '+esc(selected.fonction)+'</p><img alt="Signature reçue" src="'+esc(selected.signature)+'"></article>'+
   '<label for="presenceReviewPerson">Rattacher à un participant déjà enregistré</label><select id="presenceReviewPerson"><option value="">Choisir le participant…</option>'+options+'</select><p id="presenceReviewExisting"></p><p id="presenceReviewError" role="alert"></p></main>'+
   '<footer><button type="button" data-review="attach" disabled>Rattacher la signature</button><button type="button" data-review="ignore" hidden>Conserver la signature déjà présente</button><button type="button" data-review="new">Ajouter comme nouveau participant</button></footer>';
  const select=panel.querySelector('select');
  function change(){
   const p=people.find(p=>p.local_id===select.value);selected.target=p||null;
   panel.querySelector('[data-review=attach]').disabled=!p;
   panel.querySelector('[data-review=attach]').textContent=p?.signature?'Remplacer la signature après vérification':'Rattacher la signature';
   panel.querySelector('[data-review=ignore]').hidden=!p?.signature;
   panel.querySelector('#presenceReviewExisting').textContent=p?(p.signature?'Une signature est déjà présente. Elle sera conservée tant que vous ne confirmez pas son remplacement.':'La signature complétera cette ligne, sans ajouter de nom.') : '';
  }
  select.onchange=change;
  // Only preselect a sole exact-name match, never one of several homonyms.
  if(decision.candidates?.length===1)select.value=decision.candidates[0];change();
 }
 async function click(event){
  const action=event.target.closest('[data-review]')?.dataset.review;if(!action)return;
  if(action==='close'){panel.close();return;}
  const receipt=selected,target=receipt?.target;if(!receipt)return;
  try{
   if(action==='new'&&!await JournalDialogs.confirm('Ajouter '+label(receipt)+' comme nouveau participant ? Vérifiez que cette personne ne figure pas déjà dans la liste.'))return;
   if(action==='attach'&&target?.signature&&!await JournalDialogs.confirm('Remplacer la signature de '+label(target)+' par la signature reçue ? Confirmez uniquement s’il s’agit bien de la même personne.'))return;
   api().resolve(receipt.id,action,target?.local_id,target?.signature||'');
   showNext();update();
  }catch(error){panel.querySelector('#presenceReviewError').textContent=error.message;}
 }
 function open(){
  if(!api()?.pending().length)return;
  if(!panel){panel=document.createElement('dialog');panel.className='presence-review-dialog no-print';panel.id='presenceReviewDialog';panel.setAttribute('aria-labelledby','presenceReviewTitle');panel.addEventListener('click',e=>void click(e));document.body.append(panel);}
  showNext();if(!panel.open)panel.showModal();
 }
 document.addEventListener('briefing-presence-changed',update);
 document.addEventListener('DOMContentLoaded',update);
 window.BriefingPresenceReview={open};
})();
