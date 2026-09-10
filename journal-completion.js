/* V15.9: one shared, recoverable draft; per-item compare-and-swap, never implicit submission. */
(function(root){
 'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const clone=v=>JSON.parse(JSON.stringify(v)),eq=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 let active=null;
 function model(data){return {mode:data.mode,body:data.body,safety_clear:data.safety_clear,work:data.sheets.flatMap(s=>s.items.map((i,index)=>({...i,key:s.id+':'+index,sheet_id:s.id,index}))),notes:data.notes.map(n=>({id:n.id,body:n.body,category:n.category,version:n.version,author_name:n.author_name,updated_name:n.updated_name}))};}
 function item(w){return {title:w.title.trim(),progress:w.progress,additional:w.additional};}
 function delta(from,to){
  const p={progress:[],new_work:[],notes:[],settings:{}};
  for(const w of to.work){const old=from.work.find(x=>x.key===w.key);if(!old){if(!w.title.trim())throw new Error('Précisez l’intitulé du travail ajouté.');p.new_work.push({id:w.sheet_id,items:[item(w)]});}else if(!eq(item(old),item(w)))p.progress.push({sheet_id:w.sheet_id,index:w.index,before:item(old),next:item(w)});
   if(w.progress!==null&&(!Number.isFinite(w.progress)||w.progress<0||w.progress>100||!Number.isInteger(w.progress)))throw new Error('Le pourcentage doit être un entier entre 0 et 100.');}
  for(const n of to.notes){const old=from.notes.find(x=>x.id===n.id);if(!old||n.body!==old.body||n.category!==old.category)p.notes.push({id:n.id,version:old?.version||0,body:n.body,category:n.category});}
  for(const n of from.notes)if(!to.notes.some(x=>x.id===n.id))p.notes.push({id:n.id,version:n.version,body:n.body,category:n.category,deleted:true});
  for(const k of ['mode','body','safety_clear'])if(!eq(from[k],to[k]))p.settings[k]={before:from[k],next:to[k]};
  return p;
 }
 function changed(from,to){return !eq({...from,notes:from.notes.map(({version,author_name,updated_name,...n})=>n)},{...to,notes:to.notes.map(({version,author_name,updated_name,...n})=>n)});}
 // Preserve local edits made while saving and identify edits made to the same field by a colleague.
 function merge(from,local,remote,force=false){
  const next=clone(remote),conflicts=[];
  function field(target,key,old,mine,team,label){if(eq(old,mine))return;if((force||!eq(old,team))&&!eq(mine,team))conflicts.push({label,mine,team,resolve:v=>target[key]=v});target[key]=mine;}
  for(const k of ['mode','body','safety_clear'])field(next,k,from[k],local[k],remote[k],{mode:'Présentation',body:'Descriptif',safety_clear:'Rien à signaler'}[k]);
  for(const group of ['work','notes']){
   const key=group==='work'?'key':'id',fields=group==='work'?['title','progress','additional']:['body','category'];
   for(const mine of local[group]){
    const old=from[group].find(x=>x[key]===mine[key]),team=next[group].find(x=>x[key]===mine[key]);
    if(!old&&!team){next[group].push(clone(mine));continue;}
    if(!team){if(old&&fields.every(k=>eq(old[k],mine[k])))continue;const kept=clone(mine);next[group].push(kept);conflicts.push({label:'Élément retiré par un collègue',mine:mine.title||mine.body,team:'Retiré',resolve:v=>{next[group]=next[group].filter(x=>x!==kept);if(v!=='Retiré'){const restored=clone(mine);if(group==='notes'){restored.id=crypto.randomUUID();restored.version=0;}else{restored.sheet_id=crypto.randomUUID();restored.index=0;restored.key=restored.sheet_id+':0';}next[group].push(restored);}}});continue;}
    for(const k of fields)field(team,k,old?.[k],mine[k],team[k],(mine.title||mine.body||'Observation').slice(0,70)+' · '+({progress:'avancement',body:'texte',title:'travail',category:'Top / Flop',additional:'travail ajouté'}[k]));
   }
   if(group==='notes')for(const old of from.notes)if(!local.notes.some(x=>x.id===old.id)){
    const team=next.notes.find(x=>x.id===old.id);if(team&&(!eq(team.body,old.body)||team.category!==old.category))conflicts.push({label:'Observation modifiée après votre retrait',mine:'Retirer',team:team.body,resolve:v=>{if(v==='Retirer')next.notes=next.notes.filter(x=>x.id!==old.id);}});
    else next.notes=next.notes.filter(x=>x.id!==old.id);
   }
  }
  return {next,conflicts};
 }
 async function open(c){
  if(active){if(active.id===c.id){active.tab=c.tab||active.tab;active.render();return;}if(!await active.close())return;}
  const d=document.createElement('dialog');d.id='completionDialog';d.className='completion-dialog';d.setAttribute('aria-labelledby','completionTitle');
  const state={id:c.id,tab:c.tab||'production',data:null,base:null,form:null,pending:null,conflicts:[],timer:null,poll:null,saving:null,closing:false,stopped:false,storage:true};active=state;
  const key='journal-completion-v159:'+c.userId+':'+c.id;
  const valid=()=>!state.stopped&&(!c.valid||c.valid());
  const $=selector=>d.querySelector(selector),notice=(text,bad=false)=>{if(!valid())return;$('#completionStatus').textContent=text;$('#completionStatus').classList.toggle('error',bad);};
  function persist(){if(!state.form)return;try{localStorage.setItem(key,JSON.stringify({base:state.base,form:state.form,pending:state.pending,generation:state.data?.generation,review:state.conflicts.length>0}));state.storage=true;}catch(_){state.storage=false;notice('Sauvegarde sur cet appareil indisponible. Gardez la fenêtre ouverte jusqu’à confirmation du serveur.',true);}}
  const dirty=()=>state.base&&changed(state.base,state.form);
  const editable=()=>state.data?.report_state==='draft'&&(state.data?.state==='open'||state.data?.manager);
  async function rpc(action,payload={}){if(!valid())throw new Error('Le compte a changé.');let timeout;try{const result=await Promise.race([c.rpc('completion_'+action,{id:c.id,...payload}),new Promise((_,reject)=>timeout=setTimeout(()=>reject(new Error('Confirmation non reçue. Votre saisie est conservée ; réessayez.')),25000))]);if(!valid())throw new Error('Le compte a changé.');return result;}finally{clearTimeout(timeout);}}
  function render(){
   if(!valid()||!state.data)return;
   const data=state.data,form=state.form,locked=!editable(),completed=form.work.filter(x=>x.progress!==null).length;
   $('#completionHeading').textContent=data.chantier+' · nuit du '+new Date(data.night+'T12:00:00').toLocaleDateString('fr-FR');
   $('#completionBody').innerHTML=`<div class="completion-state ${data.state==='submitted'?'submitted':''}"><b>${data.state==='submitted'?'✓ Transmis à l’encadrant':'Saisie partagée en cours'}</b><span>${data.state==='submitted'?esc(data.submitted_name||'')+' · le CR reste à vérifier':esc(data.agents.map(x=>x.name).join(', ')||'Vous pouvez renseigner les volets et désigner des agents.')}</span></div>${data.correction?`<p class="completion-correction"><b>Complément demandé</b><br>${esc(data.correction)}</p>`:''}${data.manager&&data.report_state==='draft'?`<details class="completion-responsibles"><summary>Responsables · ${data.agents.length} agent(s)</summary><p>Les agents sélectionnés partagent les deux volets.</p><div class="completion-people">${data.people.map(p=>`<label><input type="checkbox" data-person="${p.id}" ${data.agents.some(a=>a.id===p.id)?'checked':''}>${esc(p.name||'Agent')}</label>`).join('')}</div><label class="completion-label">Consigne ou complément demandé<input id="completionCorrection" maxlength="1000" value="${esc(data.correction)}"></label><button type="button" data-completion="assign">${data.state==='submitted'?'Renvoyer pour complément':'Envoyer la demande aux agents'}</button></details>`:''}<nav class="completion-tabs" aria-label="Volets"><button type="button" data-completion="production" aria-pressed="${state.tab==='production'}">Production <span>${completed}/${form.work.length}</span></button><button type="button" data-completion="safety" aria-pressed="${state.tab==='safety'}">Sécurité <span>${form.notes.length}</span></button></nav><div id="completionConflict" ${state.conflicts.length?'':'hidden'}></div><fieldset ${locked?'disabled':''}><section ${state.tab==='production'?'':'hidden'}><label class="completion-label">Présentation<select data-setting="mode"><option value="items" ${form.mode==='items'?'selected':''}>Avancement par travail</option><option value="text" ${form.mode==='text'?'selected':''}>Descriptif libre</option></select></label>${form.mode==='items'?`<div class="completion-table-wrap"><table class="completion-table"><thead><tr><th>Travaux prévus / ajoutés</th><th>Réalisé</th></tr></thead><tbody>${form.work.map(w=>`<tr data-work="${w.key}"><td><textarea data-work-field="title" aria-label="Travail" maxlength="500" rows="2">${esc(w.title)}</textarea>${state.base.work.some(x=>x.key===w.key)?'':`<button type="button" data-completion="remove-work" data-key="${w.key}">Retirer</button>`}<label class="completion-check"><input type="checkbox" data-work-field="additional" ${w.additional?'checked':''}> Travail ajouté</label></td><td><label><input type="number" data-work-field="progress" aria-label="Pourcentage réalisé" min="0" max="100" step="1" value="${w.progress??''}" placeholder="—"><span>% réalisé</span></label></td></tr>`).join('')}</tbody></table></div><button type="button" data-completion="add-work">+ Ajouter un travail réalisé</button>`:''}<label class="completion-label">${form.mode==='items'?'Précisions sur la production':'Travaux réalisés'}<textarea data-setting="body" rows="6" maxlength="8000" placeholder="Décrire les travaux réalisés…">${esc(form.body)}</textarea></label><button type="button" data-completion="improve">Améliorer</button><div id="completionProposal"></div></section><section ${state.tab==='safety'?'':'hidden'}><p>Un fait observé, puis Top ou Flop. Les contributions restent modifiables pendant la séance.</p><div class="completion-notes">${form.notes.map(n=>`<article data-note="${n.id}"><div><label>Classement<select data-note-field="category"><option value="top" ${n.category==='top'?'selected':''}>Top · bonne pratique</option><option value="flop" ${n.category==='flop'?'selected':''}>Flop · à améliorer</option></select></label><button type="button" data-completion="remove-note" data-id="${n.id}" aria-label="Retirer cette observation">×</button></div><textarea data-note-field="body" aria-label="Observation sécurité" rows="4" maxlength="2000" placeholder="Décrire le fait de sécurité…">${esc(n.body)}</textarea><small>${esc(n.author_name||'Nouvelle observation')}${n.updated_name&&n.updated_name!==n.author_name?' · complété par '+esc(n.updated_name):''}</small></article>`).join('')}</div><button type="button" data-completion="add-note">+ Ajouter une observation</button><label class="completion-check"><input type="checkbox" data-setting="safety_clear" ${form.safety_clear?'checked':''} ${form.notes.length?'disabled':''}> Rien à signaler en sécurité</label></section></fieldset>`;
   $('#completionSave').hidden=locked;$('#completionSubmit').hidden=locked||data.state==='submitted';$('#completionSubmit').textContent='Transmettre au CR off';
   if(state.conflicts.length)renderConflicts();
  }
  state.render=render;
  function renderConflicts(){
   const area=$('#completionConflict');area.hidden=false;area.innerHTML='<b>Deux saisies à rapprocher</b><p>Choisissez les informations à garder. Aucune saisie de collègue n’a été écrasée.</p>'+state.conflicts.map((x,i)=>`<article><strong>${esc(x.label)}</strong><button type="button" data-completion="resolve-mine" data-index="${i}">Ma saisie : ${esc(x.mine??'Vide')}</button><button type="button" data-completion="resolve-team" data-index="${i}">Enregistré : ${esc(x.team??'Vide')}</button></article>`).join('');
  }
  function accept(data,from=state.form){const remote=model(data),m=merge(from,state.form,remote);state.data=data;state.base=remote;state.form=m.next;state.conflicts=m.conflicts;persist();}
  function schedule(){persist();clearTimeout(state.timer);if(!state.conflicts.length&&editable())state.timer=setTimeout(()=>void flush().catch(()=>{}),900);notice('Modifications en cours · sauvegarde automatique');}
  async function flush(){
   clearTimeout(state.timer);if(state.saving){await state.saving;if(dirty()&&!state.conflicts.length)return flush();return;}
   if(state.conflicts.length)throw new Error('Choisissez les saisies à conserver avant d’enregistrer.');
   if(!state.pending&&!dirty())return;
   if(!editable())throw new Error('La complétude est transmise. Demandez sa réouverture à l’encadrant.');
   const sent=state.pending?.sent||clone(state.form);let payload;
   try{payload=state.pending?.payload||{generation:state.data.generation,request_id:crypto.randomUUID(),...delta(state.base,sent)};}catch(e){persist();notice(e.message,true);throw e;}
   state.pending={sent,payload};persist();notice('Enregistrement sur le serveur…');
   state.saving=(async()=>{try{const data=await rpc('patch',payload);state.pending=null;accept(data,sent);if(state.conflicts.length){render();notice('Un collègue a aussi modifié ces informations. Vérifiez les choix ci-dessous.',true);}else{notice('✓ Saisie enregistrée · vous pouvez fermer et reprendre plus tard');if(!dirty()&&!d.contains(document.activeElement))render();}c.onSaved?.(data);}
    catch(e){if(!valid())throw e;if(e.code){state.pending=null;persist();if(/collègue|modifi|retiré|renvoyée|transmis|déplacé/i.test(e.message)){try{const data=await rpc('detail');accept(data,state.base);render();if(!state.conflicts.length)notice(e.message+' Vérifiez puis enregistrez à nouveau.',true);}catch(_){}}}notice(e.message||'Connexion interrompue. Saisie conservée.',true);throw e;}
    finally{state.saving=null;persist();}})();
   await state.saving;if(dirty()&&!state.conflicts.length&&editable())return flush();
  }
  function destroy(){if(state.stopped)return;persist();state.stopped=true;clearTimeout(state.timer);clearInterval(state.poll);window.removeEventListener('pagehide',persist);window.removeEventListener('beforeunload',unload);document.removeEventListener('visibilitychange',visibility);d.remove();if(active===state)active=null;c.onClosed?.();}
  async function close(){if(state.closing)return false;state.closing=true;try{await flush();destroy();return true;}catch(e){notice(e.message,true);if(!state.storage)return false;const ok=await JournalDialogs.confirm('La saisie reste conservée sur cet appareil, mais certaines modifications ne sont pas encore enregistrées sur le serveur. Masquer la fenêtre et reprendre plus tard ?',{accept:'Masquer'});if(ok){destroy();return true;}return false;}finally{state.closing=false;}}
  state.close=close;state.destroy=destroy;
  function unload(e){persist();if(!state.storage&&(dirty()||state.pending)){e.preventDefault();e.returnValue='';}}
  function visibility(){if(document.hidden){persist();if(editable())void flush().catch(()=>{});}else void poll();}
  async function poll(){if(!valid()||document.hidden||state.saving||dirty()||state.pending||state.conflicts.length||d.querySelector('.completion-responsibles[open]')||d.contains(document.activeElement)&&['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName))return;try{const data=await rpc('detail');if(!state.data||data.version!==state.data.version||data.report_state!==state.data.report_state){state.data=data;state.base=model(data);state.form=clone(state.base);persist();render();notice(data.state==='submitted'?'Informations transmises par '+(data.submitted_name||'un responsable')+'. Le CR reste à vérifier.':'Informations de l’équipe actualisées.');}}catch(e){notice(e.message,true);}}
  d.innerHTML='<header><div><small id="completionHeading">Chargement du chantier…</small><h2 id="completionTitle">Complétude du CR off</h2></div><button type="button" data-completion="close">Fermer ×</button></header><p id="completionStatus" role="status">Chargement de la saisie partagée…</p><main id="completionBody"></main><footer><button type="button" id="completionSave" data-completion="save" hidden>Enregistrer</button><button type="button" id="completionSubmit" data-completion="submit" class="completion-primary" hidden>Transmettre au CR off</button></footer>';
  d.addEventListener('cancel',e=>{e.preventDefault();void close();});d.addEventListener('submit',e=>e.preventDefault());
  d.addEventListener('input',e=>{
   if(!editable()||!state.form)return;const n=e.target;
   if(n.dataset.setting){state.form[n.dataset.setting]=n.type==='checkbox'?n.checked:n.value;schedule();if(n.dataset.setting==='mode')render();}
   if(n.dataset.workField){const w=state.form.work.find(x=>x.key===n.closest('[data-work]').dataset.work);w[n.dataset.workField]=n.type==='checkbox'?n.checked:n.type==='number'?(n.value===''?null:Number(n.value)):n.value;schedule();}
   if(n.dataset.noteField){state.form.notes.find(x=>x.id===n.closest('[data-note]').dataset.note)[n.dataset.noteField]=n.value;schedule();}
  });
  let actionBusy=false;
  d.addEventListener('click',async e=>{
   const b=e.target.closest('[data-completion]');if(!b)return;const action=b.dataset.completion;
   if(action==='close')return void close();if(action==='production'||action==='safety'){state.tab=action;render();return;}
   if(actionBusy)return;
   if(action==='resolve-mine'||action==='resolve-team'){const x=state.conflicts[Number(b.dataset.index)];x.resolve(action==='resolve-mine'?x.mine:x.team);state.conflicts.splice(Number(b.dataset.index),1);persist();render();if(!state.conflicts.length)schedule();return;}
   actionBusy=true;b.disabled=true;
   try{
    if(action==='save'){await flush();render();notice(state.data.state==='submitted'?'✓ Enregistré. Le CR reste à vérifier par l’encadrant.':'✓ Enregistré. La demande reste ouverte.');}
    if(action==='add-work'){const id=crypto.randomUUID();state.form.work.push({sheet_id:id,key:id+':0',index:0,title:'',progress:null,additional:true});persist();render();$('.completion-table tr:last-child textarea')?.focus();}
    if(action==='remove-work'){if(!state.base.work.some(w=>w.key===b.dataset.key)){state.form.work=state.form.work.filter(w=>w.key!==b.dataset.key);render();schedule();}}
    if(action==='add-note'){state.form.notes.push({id:crypto.randomUUID(),version:0,body:'',category:'top'});state.form.safety_clear=false;render();schedule();$('.completion-notes article:last-child textarea')?.focus();}
    if(action==='remove-note'){state.form.notes=state.form.notes.filter(n=>n.id!==b.dataset.id);render();schedule();}
    if(action==='assign'){const users=[...d.querySelectorAll('[data-person]:checked')].map(x=>x.dataset.person),correction=$('#completionCorrection').value;await flush();const beforeAssign=clone(state.form),data=await rpc('assign',{request_id:crypto.randomUUID(),version:state.data.version,users,correction});accept(data,beforeAssign);render();notice(users.length?'Demande transmise aux agents sélectionnés.':'Aucun agent désigné. Vous pouvez compléter les deux volets.');c.onSaved?.(data);}
    if(action==='submit'){
     await flush();const checked=await rpc('detail');if(checked.version!==state.data.version){accept(checked,state.base);render();throw new Error('Des informations ont évolué. Vérifiez-les puis transmettez.');}
     if(!await JournalDialogs.confirm('Transmettre la production et la sécurité à l’encadrant ? Les agents ne pourront plus modifier directement cette saisie, sauf si l’encadrant rouvre la demande. Le CR complet ne sera ni validé ni envoyé.',{title:'Transmettre au CR off',accept:'Transmettre'}))return;
     const data=await rpc('submit',{request_id:crypto.randomUUID(),version:state.data.version,confirmed:true});accept(data);c.onSaved?.(data);destroy();
    }
    if(action==='improve'){const initial=state.form.body,proposal=await c.improve(initial,state.data.chantier_id);if(!valid())return;$('#completionProposal').innerHTML=`<div class="completion-proposal"><h3>Proposition à relire</h3><textarea id="completionImproved" rows="6" maxlength="8000">${esc(proposal)}</textarea><button type="button" data-completion="apply-proposal">Utiliser cette proposition</button><button type="button" data-completion="discard-proposal">Garder mon texte</button></div>`;$('#completionProposal').dataset.original=initial;$('#completionProposal').scrollIntoView({block:'nearest'});}
    if(action==='apply-proposal'){if($('#completionProposal').dataset.original!==state.form.body&&!await JournalDialogs.confirm('Votre texte a changé pendant l’amélioration. Le remplacer par cette proposition ?'))return;state.form.body=$('#completionImproved').value;render();schedule();}
    if(action==='discard-proposal')$('#completionProposal').replaceChildren();
   }catch(error){notice(error.message||'Opération impossible. Votre saisie est conservée.',true);}finally{actionBusy=false;b.disabled=false;}
  });
  document.body.append(d);d.showModal();window.addEventListener('pagehide',persist);window.addEventListener('beforeunload',unload);document.addEventListener('visibilitychange',visibility);
  try{
   const data=await rpc('detail');state.data=data;state.base=model(data);state.form=clone(state.base);
   let recovered;try{recovered=JSON.parse(localStorage.getItem(key)||'null');}catch(_){}
   if(recovered?.base&&recovered?.form&&(changed(recovered.base,recovered.form)||recovered.pending)){
    state.base=recovered.base;state.form=recovered.form;state.pending=recovered.pending;
    if(!state.pending){const m=merge(recovered.base,recovered.form,model(data),recovered.review||recovered.generation!==data.generation);state.base=model(data);state.form=m.next;state.conflicts=m.conflicts;}
    if(recovered.generation!==data.generation&&state.pending){state.pending=null;accept(data,recovered.base);}
    notice('Votre saisie en cours a été retrouvée. Vérifiez-la avant de poursuivre.');
   }else notice(data.state==='submitted'?'Informations transmises. L’encadrant peut les vérifier et les modifier.':'Les deux volets sont sauvegardés au fil de la saisie.');
   persist();render();state.poll=setInterval(()=>void poll(),5000);
   if(editable()&&dirty()&&!state.conflicts.length)state.timer=setTimeout(()=>void flush().catch(()=>{}),900);
  }catch(e){notice(e.message,true);}
 }
 root.JournalCompletion={open,closeAll:()=>active?.destroy(),isOpen:()=>Boolean(active),model,delta,merge};
})(window);
