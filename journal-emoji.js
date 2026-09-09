/* Full offline Unicode palette, shared by writing and message reactions. */
(function(root){
 'use strict';let loading;
 const groups={'Smileys & Emotion':'Visages et émotions','People & Body':'Personnes et gestes','Animals & Nature':'Animaux et nature','Food & Drink':'Alimentation','Travel & Places':'Transport et lieux','Activities':'Activités','Objects':'Objets et outils','Symbols':'Symboles','Flags':'Drapeaux'};
 const fold=s=>s.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
 async function open({title='Choisir un emoji',onSelect}){
  const esc=JournalComposer.esc,d=document.createElement('dialog');d.className='journal-emoji-dialog';d.setAttribute('aria-label',title);d.innerHTML=`<header><h2>${esc(title)}</h2><button class="secondary-button" type="button" data-close>Fermer ×</button></header><div class="emoji-search-controls"><input aria-label="Rechercher un emoji" placeholder="Rechercher un emoji"><select aria-label="Catégorie"><option value="">Tous les emojis</option>${Object.entries(groups).map(([key,label])=>`<option value="${esc(key)}">${label}</option>`).join('')}</select></div><p role="status">Chargement des emojis…</p><div class="journal-emoji-grid"></div><button type="button" class="secondary-button emoji-more" hidden>Afficher davantage</button><div class="emoji-manual"><input aria-label="Emoji du clavier" placeholder="Ou utiliser le clavier emoji"><button type="button" class="secondary-button" data-custom>Choisir</button></div>`;
  document.body.append(d);d.showModal();const close=()=>{d.close();d.remove();};d.querySelector('[data-close]').onclick=close;d.addEventListener('cancel',e=>{e.preventDefault();close();});
  const choose=emoji=>{if(!emoji||![...emoji].some(c=>/\p{Extended_Pictographic}|\p{Regional_Indicator}|[0-9#*]\ufe0f?/u.test(c))||[...emoji].length>20){d.querySelector('[role=status]').textContent='Choisir un emoji.';return;}close();onSelect(emoji);};
  d.querySelector('[data-custom]').onclick=()=>choose(d.querySelector('.emoji-manual input').value.trim());
  try{
   const entries=await(loading||(loading=fetch('data/emojis.json').then(r=>{if(!r.ok)throw new Error();return r.json();}).catch(e=>{loading=null;throw e;})));if(!d.isConnected)return;
   let limit=120;const q=d.querySelector('.emoji-search-controls input'),category=d.querySelector('select'),grid=d.querySelector('.journal-emoji-grid'),more=d.querySelector('.emoji-more');
   function render(reset=true){if(reset)limit=120;const query=fold(q.value),items=entries.filter(e=>(!category.value||category.value===e[2])&&(!query||fold(e[0]+' '+e[1]+' '+(groups[e[2]]||'')).includes(query)));grid.innerHTML=items.slice(0,limit).map(e=>`<button type="button" data-emoji="${esc(e[0])}" title="${esc(e[1])}" aria-label="${esc(e[1])}">${e[0]}</button>`).join('');more.hidden=items.length<=limit;d.querySelector('[role=status]').textContent=items.length+' emojis';if(reset)grid.scrollTop=0;}
   q.oninput=()=>render();category.onchange=()=>render();more.onclick=()=>{limit+=240;render(false);};grid.onclick=e=>{const b=e.target.closest('[data-emoji]');if(b)choose(b.dataset.emoji);};render();
  }catch{d.querySelector('[role=status]').textContent='Liste indisponible. Utilisez le clavier emoji ci-dessous.';}
 }
 root.JournalEmoji={open,closeAll:()=>document.querySelectorAll('.journal-emoji-dialog').forEach(d=>d.remove())};
})(window);
