/* Complete track preparation, scoped to the chantier. No signature is copied. */
(()=>{
 'use strict';
 const legacyKey='briefing_presence_clean_v9';
 let original={};try{original=JSON.parse(localStorage.getItem(legacyKey)||'{}');}catch(_){}
 let context=null,ready=false,applying=false,key='',timer;
 const copy=x=>JSON.parse(JSON.stringify(x||{}));
 const isTrack=id=>/^(nbVoies$|voie|pkDifferent|lam|engin|nbEngins$|pointMiseVoie$|typeMiseVoie$)/i.test(id);
 function engines(value){const result=copy(value),count=Number(document.getElementById('nbVoies')?.value||0);for(const id of Object.keys(result))if(/^\d+$/.test(id)&&Number(id)>=count)delete result[id];return result;}
 function capture(){const fields={};document.querySelectorAll('input[id],select[id],textarea[id]').forEach(el=>{
  if(isTrack(el.id)&&!el.closest('#lamPopupOverlay,#enginAutreRROverlay')&&!['file','button'].includes(el.type))fields[el.id]=el.type==='checkbox'?el.checked:el.value;
 });return{fields,lamData:engines(window.lamData),enginsAutresRR:engines(window.enginsAutresRR)};}
 const initial=capture();
 function fields(data){for(const [id,value]of Object.entries(data.fields||{})){if(!isTrack(id))continue;const el=document.getElementById(id);if(el){if(el.type==='checkbox')el.checked=!!value;else if(el.type!=='file')el.value=String(value??'');}}}
 function restore(data,{rebuild=true}={}){
  if(!data?.fields)return;applying=true;
  try{
   window.lamData=copy(data.lamData);window.enginsAutresRR=copy(data.enginsAutresRR);
   if(data.fields.nbVoies&&document.getElementById('nbVoies'))document.getElementById('nbVoies').value=data.fields.nbVoies;
   if(rebuild)window.renderVoies?.();
   fields(data);window.generate?.();fields(data);
   document.querySelectorAll('[id^=pkDifferent]').forEach(el=>{const i=el.id.match(/\d+$/)?.[0];if(i!==undefined)window.togglePkVoie?.(i);});
   window.updateLamBriefing?.();
  }finally{applying=false;}
 }
 function save(){if(!key||applying)return;try{localStorage.setItem(key,JSON.stringify(capture()));}catch(_){const n=document.getElementById('briefingPreparationStatus');if(n)n.textContent='Sauvegarde des voies impossible sur cet appareil. Gardez cette page ouverte.';}}
 function start(){
  if(!ready||key)return;
  const linked=new URLSearchParams(location.search).has('journal_session');if(linked&&!context)return;
  key='journal-briefing-preparation-v158:'+(context?.id||'standalone:'+document.getElementById('chantier')?.value);
  let saved;try{saved=JSON.parse(localStorage.getItem(key)||'null');}catch(_){}
  if(!saved&&(!context||original.fields?.chantier===context.name))saved={fields:original.fields||{},lamData:original.lamData||{},enginsAutresRR:original.enginsAutresRR||{}};
  if(!saved&&context)saved=initial;
  if(saved)restore(saved);save();
  const note=document.createElement('p');note.id='briefingPreparationStatus';note.className='briefing-preparation-note';note.textContent='Configuration des voies conservée sur cet appareil pour ce chantier. À vérifier avant chaque briefing.';document.getElementById('voiesContainer')?.after(note);
 }
 const render=window.renderVoies;
 window.renderVoies=function(){
  if(applying||!ready)return render?.apply(this,arguments);
  const snapshot=capture();applying=true;try{render?.apply(this,arguments);}finally{applying=false;}
  restore(snapshot,{rebuild:false});save();
 };
 document.addEventListener('journal-briefing-context',e=>{context=e.detail;start();});
 document.addEventListener('DOMContentLoaded',()=>{
  ready=true;start();
  // Explicit full reset remains a reset; export/signature reset preserves track data.
  const reset=window.fullResetApplication;
  if(reset)window.fullResetApplication=function(){applying=true;try{return reset.apply(this,arguments);}finally{applying=false;save();}};
  const purge=window.confirmPdfSavedAndPurgeV67;
  if(purge)window.confirmPdfSavedAndPurgeV67=function(){const snapshot=capture();save();const result=purge.apply(this,arguments);restore(snapshot);save();return result;};
  for(const name of ['saveLamPopup','saveEnginAutreRRConfig']){const fn=window[name];if(fn)window[name]=function(){const result=fn.apply(this,arguments);save();return result;};}
 });
 for(const type of ['input','change'])document.addEventListener(type,()=>{if(!applying){clearTimeout(timer);timer=setTimeout(save,350);}});
 window.addEventListener('pagehide',save);window.addEventListener('beforeunload',save);
 document.addEventListener('visibilitychange',()=>{if(document.hidden)save();});
 window.BriefingPreparation={save,capture,restore};
})();
