/* CR off V15.7 — a single editable reference, native times, dates on demand. */
(function(root){
 'use strict';
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const fold=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('fr');
 const plusDay=(day,n=1)=>new Date(Date.parse(day+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
 let sequence=0;

 // Keep an existing instant exactly. For a newly entered repeated local hour,
 // keep the former offset when possible, otherwise use the first occurrence
 // compatible with the start. The browser never has to expose offset controls.
 function scheduleISO(local,previous='',notBefore=''){
  if(!local)return null;
  const {parisLocal}=root.JournalCR;
  if(previous&&parisLocal(previous)===local)return new Date(previous).toISOString();
  let choices=['+02:00','+01:00'].filter(offset=>parisLocal(local+offset)===local)
   .map(offset=>({offset,iso:new Date(local+offset).toISOString()}));
  if(!choices.length)throw new Error('Cette heure n’existe pas à cette date en heure de Paris. Choisir une autre heure.');
  if(notBefore){const later=choices.filter(c=>Date.parse(c.iso)>=Date.parse(notBefore));if(later.length)choices=later;}
  if(previous&&parisLocal(previous).slice(0,10)===local.slice(0,10)){
   const oldLocal=parisLocal(previous),oldMinute=Math.floor(Date.parse(previous)/60000);
   const sameOffset=choices.find(c=>Math.floor(Date.parse(oldLocal+c.offset)/60000)===oldMinute);
   if(sameOffset)return sameOffset.iso;
  }
  return choices[0].iso;
 }
 function clock(name,label,value,night){
  const local=root.JournalCR.parisLocal(value),ending=name.endsWith('end');
  const day=local.slice(0,10)||(ending?plusDay(night):night);
  return `<div class="cr-time-cell"><input type="time" step="60" lang="fr" name="${name}" value="${local.slice(11,16)}" data-original="${esc(value)}" aria-label="${label}"><label class="cr-date-label" hidden>Date ${ending?'de fin':'de début'}<input type="date" name="${name}_date" value="${day}" data-fixed="${value?'true':'false'}" aria-label="Date ${label}"></label></div>`;
 }
 function reference(ref,key,id){
  return `<div class="cr-reference-picker"><label for="${id}-input">Intitulé</label><div class="cr-reference-control"><input id="${id}-input" name="reference" value="${esc(ref.reference)}" placeholder="Choisir ou écrire…" maxlength="480" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${id}-list" aria-haspopup="listbox"><button type="button" data-cr-field="references" aria-label="Choisir un intitulé" aria-controls="${id}-list" aria-expanded="false">⌄</button></div><div class="cr-reference-options" hidden><p role="status"></p><div id="${id}-list" role="listbox" aria-label="${key==='itc'?'ZEP':'SEL et secteurs'} disponibles"></div></div></div>`;
 }
 function row(item={},key,night){
  const id='cr-reference-'+(++sequence),ref=root.JournalCR.splitReference(item.label,key);
  return `<section class="cr-timing-card cr-timing-v157" data-timing-row data-id="${esc(item.id||'')}" data-version="${item.version||0}" data-night="${esc(night)}">
   ${key==='arf'?'':`<div class="cr-ref-head">${key==='catenaire'?`<label>Type<select name="ref_type"><option ${ref.type!=='Secteur'?'selected':''}>SEL</option><option ${ref.type==='Secteur'?'selected':''}>Secteur</option></select></label>`:'<b>ZEP</b>'}<button type="button" data-cr="remove-row" class="cr-button" aria-label="Retirer cette ligne">×</button></div>${reference(ref,key,id)}${key==='itc'?`<label class="cr-track">Voie<input name="track" value="${esc(item.track)}" placeholder="Ex. V1" maxlength="100"></label>`:''}`}
   <div class="cr-timing-toolbar"><span>Horaires</span><button type="button" data-cr-field="dates" aria-expanded="false">Date <span aria-hidden="true">⌄</span></button></div>
   <table class="cr-hours"><thead><tr><th><span class="cr-sr-only">Horaires</span></th><th>Début</th><th>Fin</th></tr></thead><tbody>${key==='arf'?'':`<tr><th scope="row">Prévu</th><td>${clock('planned_start','Début prévu',item.planned_start,night)}</td><td>${clock('planned_end','Fin prévue',item.planned_end,night)}</td></tr>`}<tr class="cr-hours-actual"><th scope="row">Réel</th><td>${clock('start','Début réel',item.start,night)}</td><td>${clock('end','Fin réelle',item.end,night)}</td></tr></tbody></table>
   <div class="cr-row-comment"><label class="cr-check"><input name="non_concerne" type="checkbox" ${item.non_concerne?'checked':''}> ${key==='arf'?'Non concernée':'Non pris'}</label><label>Commentaire / retard<input name="comment" value="${esc(item.comment)}" maxlength="1000" placeholder=""></label></div></section>`;
 }
 function readClock(row,name){
  const input=row.querySelector(`[name=${name}]`),value=input?.value;
  if(!value)return null;
  const day=row.querySelector(`[name=${name}_date]`).value;
  if(!day)throw new Error('Ouvrir « Date » et préciser la date de '+(name.endsWith('end')?'fin':'début')+'.');
  const normal=root.JournalCR.normalClock(value);
  if(!normal)throw new Error('Sélectionner une heure valide.');
  const beginning=name==='end'?'start':name==='planned_end'?'planned_start':null;
  return scheduleISO(day+'T'+normal,input.dataset.original,beginning?readClock(row,beginning):'');
 }
 function inferDates(row){
  const night=row.dataset.night;
  for(const prefix of ['planned_','']){
   const start=row.querySelector(`[name=${prefix}start]`),end=row.querySelector(`[name=${prefix}end]`);
   const startDay=row.querySelector(`[name=${prefix}start_date]`),endDay=row.querySelector(`[name=${prefix}end_date]`);
   if(!start||!end||!startDay||!endDay)continue;
   if(start.value&&startDay.dataset.fixed!=='true')startDay.value=start.value<'12:00'?plusDay(night):night;
   if(end.value&&endDay.dataset.fixed!=='true')endDay.value=start.value?(end.value<start.value?plusDay(startDay.value):startDay.value):(end.value<'12:00'?plusDay(night):night);
  }
 }
 function bind(sheet,{key,choices=[]}){
  const close=picker=>{
   picker.querySelector('.cr-reference-options').hidden=true;
   picker.querySelector('[role=combobox]').setAttribute('aria-expanded','false');
   picker.querySelector('[role=combobox]').removeAttribute('aria-activedescendant');
   picker.querySelector('[data-cr-field=references]').setAttribute('aria-expanded','false');
  };
  const closeAll=except=>sheet.querySelectorAll('.cr-reference-picker').forEach(p=>{if(p!==except)close(p);});
  const open=(picker,query='')=>{
   closeAll(picker);
   const type=key==='itc'?'ZEP':picker.closest('[data-timing-row]').querySelector('[name=ref_type]').value;
   const tokens=fold(query).split(/\s+/).filter(Boolean);
   const available=choices.filter(c=>c.type===type);
   const matches=available.filter(c=>tokens.every(t=>fold(c.label+' '+(c.sites||[]).join(' ')).includes(t)));
   const panel=picker.querySelector('.cr-reference-options'),list=panel.querySelector('[role=listbox]'),input=picker.querySelector('[role=combobox]');
   panel.querySelector('[role=status]').textContent=matches.length?`${matches.length} ${type} · choisir ou écrire librement`:'Aucune correspondance · saisie libre';
   list.innerHTML=`<button type="button" role="option" aria-selected="false" tabindex="-1" id="${list.id}-empty" data-cr-field="reference-choice" data-id="">Laisser vide</button>`+matches.map(c=>`<button type="button" role="option" aria-selected="false" tabindex="-1" id="${list.id}-${esc(c.id)}" data-cr-field="reference-choice" data-id="${esc(c.id)}">${esc(c.label)}</button>`).join('');
   panel.hidden=false;input.setAttribute('aria-expanded','true');input.removeAttribute('aria-activedescendant');picker.querySelector('[data-cr-field=references]').setAttribute('aria-expanded','true');
  };
  const choose=(picker,id)=>{
   const input=picker.querySelector('[name=reference]'),choice=choices.find(c=>c.id===id);
   input.value=choice?.reference||'';
   input.dispatchEvent(new CustomEvent('input',{bubbles:true,detail:{fromChoice:true}}));
   close(picker);input.focus({preventScroll:true});
  };
  sheet.addEventListener('click',event=>{
   const target=event.target.closest('[data-cr-field]'),picker=event.target.closest('.cr-reference-picker');
   if(!picker)closeAll();
   if(event.target.matches('input[type=time]')&&!event.target.matches(':disabled')){
    try{event.target.showPicker?.();}catch(_){/* The native input remains usable if showPicker is unavailable. */}
   }
   if(!target||target.matches(':disabled'))return;
   const row=target.closest('[data-timing-row]');
   if(target.dataset.crField==='dates'){
    const expanded=target.getAttribute('aria-expanded')!=='true';
    target.setAttribute('aria-expanded',String(expanded));row.querySelectorAll('.cr-date-label').forEach(x=>x.hidden=!expanded);
   }else if(target.dataset.crField==='references'){
    if(picker.querySelector('.cr-reference-options').hidden)open(picker);else close(picker);
   }else if(target.dataset.crField==='reference-choice')choose(picker,target.dataset.id);
  });
  sheet.addEventListener('input',event=>{
   const input=event.target,row=input.closest('[data-timing-row]');if(!row)return;
   if(input.name==='reference'&&!event.detail?.fromChoice)open(input.closest('.cr-reference-picker'),input.value);
   if(input.type==='date')input.dataset.fixed='true';
   if(input.type==='time'||input.type==='date')inferDates(row);
  });
  sheet.addEventListener('change',event=>{
   if(event.target.name==='ref_type')closeAll();
   if(event.target.type==='date'){event.target.dataset.fixed='true';inferDates(event.target.closest('[data-timing-row]'));}
  });
  sheet.addEventListener('focusout',event=>{const picker=event.target.closest('.cr-reference-picker');if(picker&&!picker.contains(event.relatedTarget))close(picker);});
  sheet.addEventListener('keydown',event=>{
   const picker=event.target.closest('.cr-reference-picker');if(!picker||event.target.name!=='reference'||event.isComposing)return;
   const input=event.target,panel=picker.querySelector('.cr-reference-options');
   if(['ArrowDown','ArrowUp'].includes(event.key)){
    event.preventDefault();if(panel.hidden)open(picker,input.value);
    const options=[...panel.querySelectorAll('[role=option]')],index=options.findIndex(x=>x.id===input.getAttribute('aria-activedescendant'));
    const next=options[(index+(event.key==='ArrowDown'?1:-1)+options.length)%options.length];
    options.forEach(x=>x.setAttribute('aria-selected',String(x===next)));input.setAttribute('aria-activedescendant',next.id);next.scrollIntoView({block:'nearest'});
   }else if(event.key==='Enter'&&!panel.hidden){
    event.preventDefault();const active=panel.querySelector('[aria-selected=true]');if(active)choose(picker,active.dataset.id);else close(picker);
   }else if(event.key==='Escape'&&!panel.hidden){event.preventDefault();event.stopPropagation();close(picker);}
   else if(event.key==='Tab')close(picker);
  });
 }
 root.JournalCRFields={row,bind,readClock,scheduleISO};
})(typeof window==='undefined'?globalThis:window);
