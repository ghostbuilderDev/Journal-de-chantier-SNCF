/* Journal de chantier V15.1 — horaires par périmètre et diffusion à vérifier. */
(function(root){
 'use strict';
 const LABELS={catenaire:'Consignation caténaire',itc:'Interceptions de circulation · ITC',arf:'Horaires d’ARF · RSO',technique:'Production et suivi technique',securite:'Sécurité · tops et flops',synthese:'Synthèse finale'};
 const STATUS={a_renseigner:'À renseigner',en_cours:'En cours',complete:'Complété',a_confirmer:'À confirmer',non_concerne:'Non concerné'};
 const STATES={draft:'Brouillon',validated:'Validé',sent:'Envoyé au service email'};
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const time=v=>v?new Intl.DateTimeFormat('fr-FR',{dateStyle:'short',timeStyle:'short',timeZone:'Europe/Paris'}).format(new Date(v)):'';
 const date=v=>v?new Date(v+'T12:00:00Z').toLocaleDateString('fr-FR'):'';
 function parisLocal(iso){if(!iso)return '';const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(iso)).map(x=>[x.type,x.value]));return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;}
 function parisISO(local,offset='auto'){
  if(!local)return null;
  const valid=['+02:00','+01:00'].filter(o=>parisLocal(local+o)===local);
  if(!valid.length)throw new Error('Cette heure n’existe pas au changement d’heure de Paris.');
  if(valid.length>1 && offset==='auto')throw new Error('Heure présente deux fois au changement d’heure : choisir été ou hiver.');
  const chosen=offset==='auto'?valid[0]:offset;
  if(!valid.includes(chosen))throw new Error('Le décalage été/hiver ne correspond pas à cette date.');
  return new Date(local+chosen).toISOString();
 }
 function emailText(reports){
  return 'CR ENCADREMENT — diffusion restreinte\n\n'+reports.map(r=>`${r.chantier} · nuit du ${date(r.night)} · v${r.revision}\n`+Object.keys(LABELS).map(k=>{
   const s=r.sections.find(x=>x.key===k);if(!s)return '';
   let body=s.status==='non_concerne'?'Non concerné':s.value?.mode==='perimeters'?'\n'+(s.items||[]).filter(t=>t.active).map(t=>` • ${t.label} : ${t.status==='non_concerne'?'Non concerné':`${time(t.actual_start)} → ${time(t.actual_end)}`}${t.comment?' — '+t.comment:''}${timingDelays(t)}`).join('\n'): ['catenaire','itc','arf'].includes(k)?`${time(s.value.start)} → ${time(s.value.end)}${s.value.precision?' — '+s.value.precision:''}`:(s.value?.digest||(s.notes||[]).map(n=>`[${n.category}] ${n.body}`).join(' / '));
   return `${LABELS[k]} : ${body}`;
  }).join('\n')).join('\n\n')+'\n\nHoraires en heure de Paris.';
 }
 function timingDelays(t){return [['actual_start','planned_start','accord'],['actual_end','planned_end','restitution']].map(([actual,planned,label])=>t[actual]&&t[planned]&&Date.parse(t[actual])>Date.parse(t[planned])?` · ${label} +${Math.ceil((Date.parse(t[actual])-Date.parse(t[planned]))/60000)} min`:'').join('');}
 function create(adapter){
  const ctx=()=>adapter.getContext();let owner=null,epoch=0,dialog=null,current=null,reports=[],inbox=[],dirty=false,busy=false,timer=null,polling=false,openedFrom=null,routeDone=false;
  let mode='list',filter='all',pushReady=false,hasMore=false,catalog=[],contacts=[],configKey=null;
  const DEVICE_KEY='journal_v15_device',PUSH_KEY='journal_v15_push_user';
  let deviceId;try{deviceId=localStorage.getItem(DEVICE_KEY);if(!/^[0-9a-f-]{36}$/i.test(deviceId||'')){deviceId=crypto.randomUUID();localStorage.setItem(DEVICE_KEY,deviceId);}}catch{deviceId=crypto.randomUUID();}
  const $=id=>dialog?.querySelector('#'+id);
  const errorText=e=>e?.message||'Opération impossible. Vérifier la connexion.';
  async function rpc(action,payload={}){
   const c=ctx(),ticket=epoch;if(!c.ready||!c.db||!c.userId)throw new Error('Se connecter au journal pour accéder aux CR.');
   const {data,error}=await c.db.rpc('journal_cr_api',{p_action:action,p_payload:payload});
   if(ticket!==epoch||ctx().userId!==c.userId)throw new Error('La session a changé.');if(error)throw error;return data;
  }
  function shell(){
   if(dialog)return;
   dialog=document.createElement('dialog');dialog.id='crOffDialog';dialog.className='cr-dialog';
   dialog.setAttribute('aria-labelledby','crTitle');
   dialog.innerHTML='<header class="cr-head"><div><small>JOURNAL DE CHANTIER · V15.1</small><h2 id="crTitle">CR encadrement</h2></div><button type="button" id="crClose" class="secondary-button" aria-label="Fermer les CR">Fermer ×</button></header><div id="crNotice" role="status" aria-live="polite"></div><main id="crBody"></main><footer id="crFoot"></footer>';
   document.body.append(dialog);$('crClose').onclick=close;
   dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
   dialog.addEventListener('input',e=>{if(e.target.matches('[data-cr-search]')){filterCatalog();return;}if(e.target.closest('[data-cr-edit]')){e.target.dataset.crDirty='1';dirty=true;const el=$('crSaveState');if(el)el.textContent='Modifications non enregistrées';}});
   dialog.addEventListener('change',e=>{if(e.target.id==='crProgramGroup')filterCatalog();});
   dialog.addEventListener('click',e=>{const b=e.target.closest('[data-cr]');if(!b||busy)return;void perform(b.dataset.cr,b);});
   dialog.addEventListener('submit',e=>e.preventDefault());
   window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
  }
  function notice(text,bad=false){if($('crNotice')){$('crNotice').textContent=text;$('crNotice').className=text?(bad?'cr-notice error':'cr-notice'):'';}}
  function canLeave(){return !dirty||window.confirm('Des saisies ne sont pas enregistrées. Quitter cet écran ?');}
  function close(){if(busy||!canLeave())return;dirty=false;current=null;dialog?.close();openedFrom?.focus?.();}
  function show(){shell();if(!dialog.open){openedFrom=document.activeElement;dialog.showModal();}}
  function button(action,label,extra='',primary=false){return `<button type="button" data-cr="${action}" ${extra} class="${primary?'primary':'secondary'}-button">${label}</button>`;}
  async function open(){show();$('crBody').replaceChildren();$('crFoot').replaceChildren();mode='list';notice('Chargement…');try{reports=await rpc('list',{mine:filter==='mine'});hasMore=reports.length===200;renderList();notice('');}catch(e){notice(errorText(e),true);}}
  function renderList(){
   current=null;dirty=false;mode='list';$('crTitle').textContent='CR encadrement';
   const selected=filter==='mine'?reports.filter(r=>Number(r.mine)>0):reports;
   $('crBody').innerHTML=`<p class="cr-intro">Un formulaire par chantier et par nuit. Les CR sont réservés aux personnes autorisées.</p><div class="cr-tools">${button('new','＋ Préparer une nuit')}${button('filter',filter==='mine'?'Voir tous les CR':'Mes informations à compléter')}${button('inbox','Notifications')}</div>
    <div class="cr-report-list">${selected.map(r=>`<article class="cr-report"><label class="cr-pick"><input type="checkbox" data-report-pick value="${esc(r.id)}" ${!r.manager||r.state!=='validated'?'disabled':''} aria-label="Sélectionner ${esc(r.chantier)} pour l’envoi groupé"></label><button type="button" class="cr-report-open" data-cr="report" data-id="${esc(r.id)}"><b>${esc(r.chantier)}</b><span>Nuit du ${date(r.night)} · ${esc(STATES[r.state])} · v${r.revision}</span><small>${r.completed}/${r.total} rubriques renseignées${Number(r.mine)?` · ${r.mine} à compléter par vous`:''}</small></button><span aria-hidden="true">›</span></article>`).join('')||'<p class="cr-empty">Aucun CR à afficher. L’encadrant peut préparer la première nuit.</p>'}</div>`;
   $('crFoot').innerHTML=(hasMore?button('more','Afficher les nuits précédentes'):'')+button('group','Préparer l’envoi groupé')+'<small>Mêmes destinataires uniquement · versions validées</small>';
  }
  function renderNew(){
   mode='new';$('crTitle').textContent='Préparer le CR d’une nuit';
   const today=parisLocal(new Date().toISOString()).slice(0,10),yesterday=new Date(Date.parse(today+'T12:00:00Z')-86400000).toISOString().slice(0,10);
   $('crBody').innerHTML=`<form id="crNewForm"><label class="form-field">Chantier<select name="chantier_id">${ctx().chantiers.map(c=>`<option value="${esc(c.id)}" ${c.id===ctx().currentId?'selected':''}>${esc(c.name)}</option>`).join('')}</select></label><label class="form-field">Date de début de nuit<input name="night" type="date" required value="${yesterday}"></label><p>Le CR couvre cette nuit et le matin suivant.</p><label class="cr-check"><input name="reuse" type="checkbox" checked> Reprendre les responsables, les accès et les destinataires du dernier CR de ce chantier</label><p class="cr-muted">Les horaires et les contributions restent à renseigner. Création réservée à l’encadrement du chantier.</p></form>`;
   $('crFoot').innerHTML=button('back','Retour')+button('create','Créer le formulaire','',true);
  }
  function peopleOptions(people,selected){return '<option value="">Non affecté</option>'+people.map(p=>`<option value="${esc(p.id)}" ${p.id===selected?'selected':''}>${esc(p.full_name||'Utilisateur')}</option>`).join('');}
  function peopleChecks(people,selected,name){return people.map(p=>`<label class="cr-check"><input type="checkbox" name="${name}" value="${esc(p.id)}" ${selected.includes(p.id)?'checked':''}> ${esc(p.full_name||'Utilisateur')}</label>`).join('');}
  function clockInput(name,label,value){
   return `<label class="form-field">${label}<input type="datetime-local" name="${name}" value="${parisLocal(value)}"><select name="${name}_offset" aria-label="Décalage horaire ${label}"><option value="auto">Heure de Paris · automatique</option><option value="+02:00">Heure d’été · UTC+2</option><option value="+01:00">Heure d’hiver · UTC+1</option></select></label>`;
  }
  function fieldClock(name,label,value){
   const local=parisLocal(value),base=current.night;
   const days=[0,1,2].map(n=>new Date(Date.parse(base+'T12:00:00Z')+n*86400000).toISOString().slice(0,10));
   const selected=local.slice(0,10)||(name==='end'?days[1]:base);
   return `<div class="form-field"><label>${label}<input aria-label="${label}" type="time" name="${name}" value="${local.slice(11,16)}"></label><select name="${name}_date" aria-label="Date ${label}">${days.map(d=>`<option value="${d}" ${d===selected?'selected':''}>${date(d)}</option>`).join('')}</select><details class="cr-clock-offset"><summary>Changement d’heure</summary><select name="${name}_offset" aria-label="Décalage ${label}"><option value="auto">Automatique</option><option value="+02:00">Heure d’été</option><option value="+01:00">Heure d’hiver</option></select></details></div>`;
  }
  function readFieldClock(fd,name){return fd.get(name)?parisISO(fd.get(name+'_date')+'T'+fd.get(name),fd.get(name+'_offset')):null;}
  function timingMarkup(t,s,r,first){
   const locked=r.state!=='draft',done=['complete','non_concerne'].includes(t.status);
   return `<details class="cr-timing ${done?'is-complete':''}" id="crTiming-${t.id}" ${first&&!done?'open':''}><summary><span><b>${esc(t.label)}</b><small>${esc(t.responsible_name||s.responsible_name||'Responsable à affecter')}${t.due_at?' · attendu '+time(t.due_at):''}</small><small>${t.actual_start?time(t.actual_start):'Début attendu'} → ${t.actual_end?time(t.actual_end):'Fin attendue'}</small></span><span class="cr-status">${STATUS[t.status]}</span></summary><div class="cr-timing-content">
    <form id="crTimingForm-${t.id}" data-cr-edit data-version="${t.version}"><fieldset ${locked?'disabled':''}><div class="cr-grid">${fieldClock('start','Début réel',t.actual_start)}${fieldClock('end','Fin réelle',t.actual_end)}</div><label class="form-field">État<select name="status"><option value="auto" ${!['a_confirmer','non_concerne'].includes(t.status)?'selected':''}>Automatique selon les horaires</option><option value="a_confirmer" ${t.status==='a_confirmer'?'selected':''}>À confirmer</option><option value="non_concerne" ${t.status==='non_concerne'?'selected':''}>Non concerné — préciser le motif</option></select></label><label class="form-field">Remarque / motif<textarea name="comment" maxlength="1000" rows="2">${esc(t.comment)}</textarea></label>${!locked?button('timing-save','Enregistrer ces horaires',`data-key="${s.key}" data-id="${t.id}"`,true):''}</fieldset></form>
    ${t.updated_name?`<p class="cr-muted">Saisie : ${esc(t.updated_name)} · ${time(t.updated_at)}</p>`:''}${timingDelays(t)?`<p class="cr-delay">${esc(timingDelays(t))}</p>`:''}
    <details class="cr-timing-extra"><summary>Prévu et références</summary><p class="cr-muted">Prévu confirmé : ${time(t.planned_start)||'non renseigné'} → ${time(t.planned_end)||'non renseigné'}</p>${(t.source||[]).map(x=>`<p class="cr-source"><b>${esc(x.sheet)} · ligne ${esc(x.row)}</b><br>Demandes de l’opération, à rapprocher de ce périmètre : ${esc(x.planned_text||'non précisées')}</p>`).join('')}
    ${r.manager&&!locked?`<form id="crTimingPlan-${t.id}" data-cr-edit data-version="${t.version}"><p class="cr-muted">Renseigner le prévu après avoir vérifié son association à ce périmètre. Le réalisé reste indépendant.</p><div class="cr-grid">${fieldClock('start','Début prévu',t.planned_start)}${fieldClock('end','Fin prévue',t.planned_end)}</div>${button('timing-plan','Enregistrer le prévu',`data-key="${s.key}" data-id="${t.id}"`)}</form>`:''}</details>
    ${r.manager&&!locked?`<details class="cr-timing-extra"><summary>Responsable de ce périmètre</summary><form id="crTimingAssign-${t.id}" data-cr-edit data-version="${t.version}">${!t.catalog_id?`<label class="form-field">Libellé du périmètre<input name="label" value="${esc(t.label)}" maxlength="500" required></label>`:''}<label class="form-field">Responsable<select name="responsible">${peopleOptions(r.people,t.responsible).replace('Non affecté','Responsable de la rubrique')}</select></label>${clockInput('due_at','Échéance de cette ligne',t.due_at)}${button('timing-assign','Attribuer cette ligne',`data-key="${s.key}" data-id="${t.id}"`)}</form></details>`:''}</div></details>`;
  }
  function timingsMarkup(s,r){
   const active=(s.items||[]).filter(t=>t.active),inactive=(s.items||[]).filter(t=>!t.active),done=active.filter(t=>['complete','non_concerne'].includes(t.status)).length;
   return `<p class="cr-progress"><b>${done}/${active.length} périmètres complétés</b><br>Heures réelles d’accord et de restitution.</p>${r.manager&&r.state==='draft'?button('configure-scopes',s.key==='itc'?'Choisir les ZEP':'Choisir les secteurs / SEL',`data-key="${s.key}"`):''}
   ${active.map((t,i)=>timingMarkup(t,s,r,i===0)).join('')||`<p class="cr-empty">${s.status==='non_concerne'?'Aucun périmètre concerné cette nuit.':'L’encadrant doit sélectionner les périmètres attendus.'}</p>`}
   ${inactive.length?`<details><summary>${inactive.length} périmètre(s) retiré(s) — historique conservé</summary>${inactive.map(t=>`<p class="cr-source">${esc(t.label)} · ${time(t.actual_start)||'—'} → ${time(t.actual_end)||'—'}</p>`).join('')}</details>`:''}`;
  }
  function filterCatalog(){
   const group=$('crProgramGroup')?.value||'',q=($('crCatalogSearch')?.value||'').toLocaleLowerCase('fr');
   dialog.querySelectorAll('[data-catalog-group]').forEach(el=>{el.hidden=Boolean(group&&el.dataset.catalogGroup!==group)||!el.textContent.toLocaleLowerCase('fr').includes(q);});
  }
  function renderConfigure(key){
   mode='configure';configKey=key;const s=current.sections.find(s=>s.key===key),rows=catalog.filter(x=>x.section_key===key);
   const groups=[...new Set(catalog.map(x=>x.chantier))].sort(),siteName=ctx().chantiers.find(c=>c.id===current.chantier_id)?.name||'';
   const group=current.program_group||groups.find(g=>siteName.toLowerCase().includes(g.toLowerCase()))||'';
   $('crTitle').textContent=key==='itc'?'Choisir les ITC · S9':'Choisir les consignations · S11';
   $('crBody').innerHTML=`<p class="cr-intro">Cocher les périmètres attendus pour la nuit du ${date(current.night)}. Les groupes conservent le libellé du programme.</p><form id="crConfigureForm" data-version="${s.version}" data-cr-edit><label class="form-field">Programme de chantier<select id="crProgramGroup" name="program_group"><option value="">Tous les programmes</option>${groups.map(g=>`<option ${g===group?'selected':''}>${esc(g)}</option>`).join('')}</select></label><label class="form-field">Rechercher une référence<input id="crCatalogSearch" type="search" data-cr-search placeholder="ZEP, SEL, secteur ou voie"></label><p class="cr-muted">Les références des semaines S37 à S44 constituent une liste de choix ; seules les cases cochées seront demandées cette nuit.</p>
   <div class="cr-catalog">${rows.map(c=>`<div class="cr-catalog-entry" data-catalog-group="${esc(c.chantier)}"><label class="cr-check"><input type="checkbox" name="catalog_ids" value="${esc(c.id)}" ${(s.items||[]).some(t=>t.active&&t.catalog_id===c.id)?'checked':''}><span><b>${esc(c.label)}</b><small class="cr-block">${esc(c.chantier)} · ${esc([...new Set(c.sources.map(x=>x.sheet))].join(', '))}</small>${c.warning?`<small class="cr-warning">${esc(c.warning)}</small>`:''}</span></label></div>`).join('')||'<p>Le catalogue n’a pas encore été importé. Une référence peut être ajoutée ci-dessous.</p>'}</div>
   ${(s.items||[]).filter(t=>!t.catalog_id||!rows.some(c=>c.id===t.catalog_id)).map(t=>`<label class="cr-check"><input name="keep_ids" type="checkbox" value="${t.id}" ${t.active?'checked':''}>${esc(t.label)}</label>`).join('')}
   <label class="form-field">Ajouter un périmètre absent de la liste<input name="manual_label" maxlength="500" placeholder="Référence complète, secteur et voie"></label><label class="form-field">Motif d’un retrait, si des horaires sont déjà saisis<input name="reason" maxlength="1000"></label><label class="cr-check"><input name="non_concerne" type="checkbox" ${s.status==='non_concerne'?'checked':''}> Aucun périmètre concerné cette nuit</label></form>`;
   $('crFoot').innerHTML=button('configure-back','Retour au CR')+button('configure-save','Enregistrer la sélection','',true);filterCatalog();dirty=false;
  }
  function contactSuggestions(){
   return `<details id="crContactSuggestions"><summary>Choisir dans la liste proposée · ${contacts.length} entrées à contrôler</summary><p class="cr-muted">Aucune adresse n’est ajoutée automatiquement. Corriger si nécessaire, puis sélectionner les destinataires voulus. « Reconstituée » signifie que l’adresse complète n’était pas lisible sur la photo.</p>${contacts.map(c=>`<div class="cr-contact"><label class="cr-check"><input type="checkbox" name="contact_pick" value="${esc(c.id)}"><span><b>${esc(c.name)}</b><small class="cr-block">${c.evidence==='visible'?'Adresse lisible sur la photo':c.evidence==='inferred'?'Adresse reconstituée — à vérifier':'Adresse manquante — à compléter'}</small></span></label><input aria-label="Adresse de ${esc(c.name)}" type="email" name="contact_${esc(c.id)}" value="${esc(c.email)}" placeholder="Adresse à compléter"><small>${esc(c.note)}</small></div>`).join('')}${button('contacts-add','Ajouter les adresses sélectionnées au CR')}</details>`;
  }
  function sectionMarkup(s,r,focus){
   const locked=r.state!=='draft',isClock=['catenaire','itc','arf'].includes(s.key),perimeters=s.value?.mode==='perimeters',done=['complete','non_concerne'].includes(s.status);
   return `<details class="cr-section ${done?'is-complete':''}" id="crSection-${s.key}" ${focus===s.key?'open':''}><summary><span class="cr-status-dot">${done?'✓':'○'}</span><span><b>${LABELS[s.key]}</b><small>${esc(s.responsible_name||'Responsable à affecter')}${s.due_at?' · attendu '+time(s.due_at):''}</small></span><span class="cr-status">${STATUS[s.status]}</span></summary><div class="cr-section-content">
   ${r.manager&&!locked?`<details class="cr-assignment"><summary>Attribuer / modifier la demande</summary><form data-assign="${s.key}" data-version="${s.version}" data-cr-edit><label class="form-field">Responsable<select name="responsible">${peopleOptions(r.people,s.responsible)}</select></label>${clockInput('due_at','À renseigner avant',s.due_at)}<details><summary>Autres personnes autorisées pour cette rubrique</summary>${peopleChecks(r.people,s.contributors||[],'contributors')}</details><p class="cr-muted">Les collaborateurs du CR complet peuvent aussi intervenir. Le responsable reçoit une notification.</p>${button('assign','Enregistrer l’attribution',`data-key="${s.key}"`)} ${button('remind','Relancer',`data-key="${s.key}"`)}</form></details>`:''}
   ${perimeters?timingsMarkup(s,r):`${r.manager&&!locked&&['catenaire','itc'].includes(s.key)?button('configure-scopes','Passer aux horaires par périmètre',`data-key="${s.key}"`):''}<form data-section="${s.key}" data-version="${s.version}" data-cr-edit><fieldset ${locked?'disabled':''}>
   ${isClock?`<div class="cr-grid">${clockInput('start',s.key==='arf'?'Début d’ARF':'Début',s.value?.start)}${clockInput('end',s.key==='arf'?'Fin d’ARF':'Fin',s.value?.end)}</div>${s.key==='arf'?'<p class="cr-muted">Une seule ARF pour l’ensemble de l’intervention, toutes voies confondues.</p>':`<label class="form-field">Précision / périmètre<textarea name="precision" maxlength="1000" rows="2">${esc(s.value?.precision||'')}</textarea></label>`}`:`<label class="form-field">À retenir dans le mail du matin<textarea name="digest" maxlength="600" rows="3" placeholder="Si vide, les contributions courtes seront reprises.">${esc(s.value?.digest||'')}</textarea><small>600 caractères maximum. Tous les détails restent conservés ci-dessous.</small></label>`}
   <label class="form-field">État de la rubrique<select name="status">${Object.entries(STATUS).map(([key,label])=>`<option value="${key}" ${s.status===key?'selected':''}>${label}</option>`).join('')}</select></label>
   ${!locked?button('save','Enregistrer la rubrique',`data-key="${s.key}"`,true):''}</fieldset></form>`}
   ${s.updated_name?`<p class="cr-muted">Dernière modification de la rubrique : ${esc(s.updated_name)} · ${time(s.updated_at)}</p>`:''}
   <div class="cr-notes">${(s.notes||[]).map(n=>`<article><b>${esc({production:'Production',top:'Top',flop:'Flop',synthese:'Synthèse',precision:'Précision'}[n.category])}</b><p>${esc(n.body)}</p><small>${esc(n.author_name)} · ${time(n.created_at)}</small></article>`).join('')}</div>
   ${!locked?`<form data-note="${s.key}" data-cr-edit><label class="form-field">Ajouter un complément<select name="category">${(s.key==='technique'?['production','top','flop','precision']:s.key==='securite'?['top','flop','precision']:s.key==='synthese'?['synthese','precision']:['precision']).map(x=>`<option value="${x}">${{production:'Production réalisée',top:'Top / point positif',flop:'Flop / difficulté',synthese:'Synthèse',precision:'Précision / correction'}[x]}</option>`).join('')}</select></label><label class="form-field">Votre contribution<textarea name="body" maxlength="2000" rows="3" placeholder="Quelques lignes factuelles. Indiquer RAS explicitement si nécessaire."></textarea></label>${button('note','Ajouter ma contribution',`data-key="${s.key}"`)}</form>`:''}
   </div></details>`;
  }
  async function openReport(id,focus){const detail=await rpc('detail',{id});const meta=detail.manager?await rpc('catalog',{chantier_id:detail.chantier_id}):{catalog:[],contacts:[]};current=detail;catalog=meta.catalog;contacts=meta.contacts;renderReport(focus);}
  function renderReport(focus){
   const r=current;mode='report';dirty=false;const site=ctx().chantiers.find(c=>c.id===r.chantier_id);$('crTitle').textContent=site?.name||'CR encadrement';
   $('crBody').innerHTML=`<div class="cr-tools">${button('back','‹ Tous les CR')}${button('refresh-report','Actualiser')}<span class="cr-state">${STATES[r.state]} · v${r.revision}</span></div><p class="cr-intro">Nuit du ${date(r.night)} · <b>Diffusion restreinte</b><br><small>Horaires en heure de Paris. ${r.full_access?'Vous consultez le CR complet.':'Seules vos rubriques autorisées sont visibles.'}</small></p><p id="crSaveState" class="cr-muted" aria-live="polite">Saisies enregistrées dans le journal</p>
   ${Object.keys(LABELS).map(k=>r.sections.find(s=>s.key===k)).filter(Boolean).map(s=>sectionMarkup(s,r,focus)).join('')}
   ${r.manager?`<details class="cr-section" id="crAudience"><summary><b>Accès au CR et destinataires</b><span>${r.recipients.length} destinataire(s)</span></summary><div class="cr-section-content"><form id="crAudienceForm" data-cr-edit><fieldset ${r.state!=='draft'?'disabled':''}>${r.state==='draft'?contactSuggestions():''}<label class="form-field">Emails des destinataires<textarea name="recipients" rows="3" placeholder="Une adresse par ligne">${esc(r.recipients.join('\n'))}</textarea></label><p class="cr-muted">Seuls ces destinataires recevront la copie validée. Vérifier leur liste avant l’envoi.</p><details><summary>Collaborateurs autorisés à compléter l’ensemble du CR</summary>${peopleChecks(r.people,r.collaborators,'collaborators')}</details>${r.state==='draft'?button('audience','Enregistrer les accès et destinataires'):''}</fieldset></form></div></details>`:''}
   <details class="cr-section"><summary>Historique des saisies et des versions</summary><div class="cr-section-content">${r.history.map(h=>`<p><b>${esc(h.actor_name)}</b> · ${esc({creation:'Création',attribution:'Attribution',saisie:'Saisie',contribution:'Contribution',validation:'Validation',diffusion:'Accès et destinataires',relance:'Relance',rectificatif:'Rectificatif',perimetres:'Sélection des périmètres',timing_save:'Horaires saisis',timing_plan:'Horaires prévus',timing_assign:'Attribution d’un périmètre'}[h.action]||h.action)}${h.section_key?' · '+LABELS[h.section_key]:''}<small class="cr-block">${time(h.created_at)}${h.detail?.after?.label?' · '+esc(h.detail.after.label):''}${h.detail?.reason?' · '+esc(h.detail.reason):''}</small></p>`).join('')}
   ${(r.snapshots||[]).map(s=>`<details><summary>Version ${s.revision} validée par ${esc(s.validated_name)} · ${time(s.validated_at)}</summary><pre class="cr-preview">${esc(emailText([s.data]))}</pre></details>`).join('')}
   ${(r.deliveries||[]).map(d=>`<p>Envoi ${esc({pending:'préparé',sent:'accepté par le service email',failed:'en échec',uncertain:'à vérifier'}[d.state])} · ${time(d.sent_at||d.created_at)}</p>`).join('')}</div></details>`;
   $('crFoot').innerHTML=r.manager?(r.state==='draft'?button('validate','Valider le CR','',true):button('preview','Préparer l’envoi','',true)+button('reopen','Créer un rectificatif')):'<small>Les contributions seront relues par l’encadrant avant envoi.</small>';
   if(focus)requestAnimationFrame(()=>document.getElementById('crSection-'+focus)?.scrollIntoView({block:'start',behavior:'smooth'}));
  }
  async function preview(ids){
   const details=await Promise.all(ids.map(id=>rpc('detail',{id})));
   if(details.some(r=>!r.manager||!['validated','sent'].includes(r.state)))throw new Error('Sélectionner des CR validés.');
   const recipients=details[0].recipients;
   if(!recipients.length)throw new Error('Renseigner les destinataires dans le CR avant validation.');
   if(details.some(r=>JSON.stringify(r.recipients)!==JSON.stringify(recipients)))throw new Error('Ces CR n’ont pas les mêmes destinataires. Préparer des envois séparés.');
   const snapshots=details.map(r=>r.snapshots.find(s=>s.revision===r.revision)?.data);
   if(snapshots.some(x=>!x))throw new Error('Version validée introuvable.');
   mode='preview';current={ids,recipients,snapshots};$('crTitle').textContent='Vérifier avant d’envoyer';
   $('crBody').innerHTML=`<p><b>À :</b> ${esc(recipients.join(', '))}</p><p class="cr-muted">${ids.length} chantier(s). La copie envoyée correspond aux versions validées ci-dessous.</p><pre class="cr-preview">${esc(emailText(snapshots))}</pre><label class="cr-check"><input id="crConfirmSend" type="checkbox"> J’ai vérifié le contenu et les destinataires.</label>`;
   $('crFoot').innerHTML=button('back','Retour')+button('send','Envoyer depuis le journal','',true);
  }
  async function openInbox(){show();$('crBody').replaceChildren();$('crFoot').replaceChildren();mode='inbox';current=null;dirty=false;inbox=await rpc('inbox');renderInbox();}
  function renderInbox(){
   $('crTitle').textContent='Notifications';
   $('crBody').innerHTML=`<p class="cr-intro">Messages et demandes reçus sur vos chantiers. Les notifications restent consultables ici, même si le téléphone n’a pas affiché d’alerte.</p><div class="cr-tools">${button('enablepush',pushReady?'Alertes permanentes activées':'Activer sur ce téléphone')}${pushReady?button('disablepush','Arrêter les alertes permanentes'):''}${button('alerts','Alertes de mon chantier')}</div><p class="cr-muted">${typeof Notification==='undefined'?'Ce navigateur ne propose pas les alertes du téléphone.':Notification.permission==='denied'?'Notifications bloquées : autoriser le Journal dans les réglages du navigateur.':'Les alertes du téléphone dépendent de son autorisation et de sa connexion. Le mode chantier se règle séparément.'}</p><div class="cr-report-list">${inbox.map(n=>`<button type="button" class="cr-inbox-item ${n.read_at?'':'unread'}" data-cr="notification" data-id="${esc(n.id)}"><span>${n.read_at?'○':'●'}</span><span><b>${esc(n.title)}</b><small>${esc(ctx().chantiers.find(c=>c.id===n.chantier_id)?.name||'Chantier')} ${n.section_key?' · '+LABELS[n.section_key]:''}<br>${time(n.created_at)}</small></span><span>›</span></button>`).join('')||'<p class="cr-empty">Aucune notification. Les nouveaux événements apparaîtront ici.</p>'}</div>`;
   $('crFoot').innerHTML=button('back','Voir les CR');updateBadge();
  }
  async function routeNotification(id){
   let n=inbox.find(n=>n.id===id);if(!n){inbox=await rpc('inbox');n=inbox.find(n=>n.id===id);}
   if(!n)throw new Error('Cette notification n’est plus accessible.');
   if(n.kind==='cr'){show();await openReport(n.report_id,n.section_key);}
   else{dialog?.close();await adapter.navigate({chantierId:n.chantier_id,messageId:n.message_id});}
   await rpc('read',{id:n.id});n.read_at=new Date().toISOString();updateBadge();
  }
  async function workerMessage(type){
   const ticket=epoch,identity=owner;const reg=await navigator.serviceWorker.ready;if(ticket!==epoch)throw new Error('La session a changé.');
   const worker=navigator.serviceWorker.controller||reg.active;if(!worker)throw new Error('Fermer puis rouvrir l’application après la mise à jour.');
   return new Promise((resolve,reject)=>{const ch=new MessageChannel();const timeout=setTimeout(()=>{ch.port1.close();reject(new Error('Fermer puis rouvrir l’application pour activer les notifications V15.'));},3000);
    ch.port1.onmessage=e=>{clearTimeout(timeout);ch.port1.close();e.data?.ok?resolve():reject(new Error('Enregistrement des notifications impossible.'));};
    worker.postMessage({type,userId:identity,deviceId},[ch.port2]);});
  }
  async function enablePush(){
   const ticket=epoch;const check=()=>{if(ticket!==epoch)throw new Error('La session a changé.');};
   if(!navigator.serviceWorker||!root.PushManager||!root.Notification)throw new Error('Notifications non disponibles dans ce navigateur. Sur iPhone, ouvrir l’application installée sur l’écran d’accueil.');
   // Permission must be requested in the user gesture, before any network request.
   const permission=await Notification.requestPermission();check();if(permission!=='granted')throw new Error('Notifications non autorisées sur cet appareil.');
   const config=await rpc('push_config');check();if(!config.enabled||!config.vapid_public_key)throw new Error('Le service de notifications du journal doit être activé sur Supabase.');
   const reg=await navigator.serviceWorker.ready;check();let sub=await reg.pushManager.getSubscription();check();
   if(!sub){const str=config.vapid_public_key.replace(/-/g,'+').replace(/_/g,'/');sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:Uint8Array.from(atob(str),c=>c.charCodeAt(0))});}
   check();await workerMessage('JOURNAL_V15_STATE');check();
   await rpc('device',{device_id:deviceId,subscription:sub.toJSON()});check();
   localStorage.setItem(PUSH_KEY,owner);pushReady=true;renderInbox();notice('Messages et demandes seront signalés sur ce téléphone, même hors du mode chantier.');
  }
  async function disablePush(){await rpc('device_remove',{device_id:deviceId});await workerMessage('JOURNAL_V15_CLEAR');localStorage.removeItem(PUSH_KEY);pushReady=false;renderInbox();}
  async function perform(action,b){
   if(['back','new','filter','report','inbox','notification','group','preview','alerts','reopen','refresh-report','configure-scopes','configure-back'].includes(action)&&!canLeave())return;
   busy=true;b.disabled=true;notice('');
   try{
    if(action==='back'){dirty=false;await open();}
    else if(action==='new'){dirty=false;renderNew();}
    else if(action==='filter'){filter=filter==='all'?'mine':'all';await open();}
    else if(action==='more'){const rows=await rpc('list',{offset:reports.length,mine:filter==='mine'});hasMore=rows.length===200;reports=reports.concat(rows.filter(r=>!reports.some(old=>old.id===r.id)));renderList();}
    else if(action==='create'){
     const form=$('crNewForm');if(!form.reportValidity())return;const data=Object.fromEntries(new FormData(form));data.reuse=form.elements.reuse.checked;
     const r=await rpc('create',data);await openReport(r.id);
    }else if(action==='configure-scopes'){dirty=false;renderConfigure(b.dataset.key);}
    else if(action==='configure-back'){dirty=false;await openReport(current.id,configKey);}
    else if(action==='configure-save'){
     const f=$('crConfigureForm'),fd=new FormData(f);await rpc('timing_configure',{id:current.id,key:configKey,version:Number(f.dataset.version),catalog_ids:fd.getAll('catalog_ids'),keep_ids:fd.getAll('keep_ids'),manual_label:fd.get('manual_label'),reason:fd.get('reason'),program_group:fd.get('program_group'),non_concerne:fd.has('non_concerne')});
     dirty=false;await openReport(current.id,configKey);notice('Périmètres enregistrés. Demandes préparées pour les responsables affectés.');
    }else if(['timing-save','timing-plan','timing-assign'].includes(action)){
     const prefix={'timing-save':'crTimingForm-','timing-plan':'crTimingPlan-','timing-assign':'crTimingAssign-'}[action],f=$(prefix+b.dataset.id),fd=new FormData(f);
     const p={id:current.id,key:b.dataset.key,timing_id:b.dataset.id,version:Number(f.dataset.version)};
     if(action==='timing-assign')Object.assign(p,{label:fd.get('label'),responsible:fd.get('responsible'),due_at:parisISO(fd.get('due_at'),fd.get('due_at_offset'))});
     else Object.assign(p,{start:readFieldClock(fd,'start'),end:readFieldClock(fd,'end'),status:fd.get('status'),comment:fd.get('comment')});
     await rpc(action.replace('-','_'),p);await reloadPreserving(b.dataset.key,action,f.id);notice('Périmètre enregistré.');
    }else if(action==='contacts-add'){
     const f=$('crAudienceForm'),selected=[...f.querySelectorAll('[name="contact_pick"]:checked')];
     if(!selected.length)throw new Error('Sélectionner les personnes à ajouter.');
     const values=selected.map(x=>{const input=f.elements.namedItem('contact_'+x.value);if(!input.value.trim()||!input.checkValidity())throw new Error('Compléter ou corriger l’adresse de chaque personne sélectionnée.');return input.value.trim().toLowerCase();});
     const box=f.elements.recipients;box.value=[...new Set([...box.value.split(/[\s;,]+/).filter(Boolean).map(x=>x.toLowerCase()),...values])].join('\n');box.dataset.crDirty='1';dirty=true;
     selected.forEach(x=>{x.checked=false;delete x.dataset.crDirty;});$('crContactSuggestions').open=false;box.focus();notice('Adresses ajoutées au formulaire. Vérifier la liste puis enregistrer les destinataires.');
    }else if(action==='report')await openReport(b.dataset.id);
    else if(action==='refresh-report')await openReport(current.id);
    else if(action==='inbox')await openInbox();
    else if(action==='notification')await routeNotification(b.dataset.id);
    else if(action==='enablepush')await enablePush();
    else if(action==='disablepush')await disablePush();
    else if(action==='alerts'){dialog.close();adapter.openAlerts();}
    else if(action==='group'){const ids=[...dialog.querySelectorAll('[data-report-pick]:checked')].map(x=>x.value);if(!ids.length)throw new Error('Cocher les CR validés à regrouper.');await preview(ids);}
    else if(action==='preview')await preview([current.id]);
    else if(action==='send'){
     if(!$('crConfirmSend').checked)throw new Error('Vérifier puis confirmer les destinataires avant l’envoi.');
     const c=ctx(),ticket=epoch;const {data,error}=await c.db.functions.invoke('journal-cr-send',{body:{ids:current.ids}});
     if(ticket!==epoch)return;
     if(error){let detail;try{detail=await error.context?.json();}catch{}throw new Error(detail?.error||'Envoi non confirmé. Vérifier la configuration email et la connexion.');}
     if(data?.state!=='sent')throw new Error(data?.error||'Envoi non confirmé.');await open();notice('CR accepté par le service email. La copie envoyée est conservée dans chaque CR.');
    }else if(action==='reopen'){
     const reason=window.prompt('Motif du rectificatif :');if(!reason)return;await rpc('reopen',{id:current.id,reason});await openReport(current.id);
    }else if(action==='validate'){
     if(dirty)throw new Error('Enregistrer toutes les saisies avant validation.');
     if(!window.confirm('Valider et figer cette version du CR pour l’envoi ?'))return;
     await rpc('validate',{id:current.id});await openReport(current.id);notice('Version validée. Vérifier l’aperçu avant l’envoi.');
    }else if(action==='audience'){
     const f=$('crAudienceForm');await rpc('audience',{id:current.id,recipients:f.elements.recipients.value.split(/[\s;,]+/).filter(Boolean),collaborators:[...f.querySelectorAll('[name="collaborators"]:checked')].map(x=>x.value)});await reloadPreserving();notice('Accès et destinataires enregistrés.');
    }else{
     const key=b.dataset.key,s=current.sections.find(s=>s.key===key),payload={id:current.id,key,version:s.version};
     if(action==='note'){
      const f=dialog.querySelector(`[data-note="${key}"]`);payload.body=f.elements.body.value;payload.category=f.elements.category.value;
      // Keep this ID after an ambiguous response to make retries idempotent.
      const fingerprint=JSON.stringify([payload.body,payload.category]);if(f.dataset.noteFingerprint!==fingerprint){f.dataset.noteId=crypto.randomUUID();f.dataset.noteFingerprint=fingerprint;}payload.note_id=f.dataset.noteId;await rpc('note',payload);f.elements.body.value='';delete f.dataset.noteId;
     }else if(action==='assign'){
      const f=dialog.querySelector(`[data-assign="${key}"]`),fd=new FormData(f);payload.version=Number(f.dataset.version);Object.assign(payload,{responsible:fd.get('responsible'),due_at:parisISO(fd.get('due_at'),fd.get('due_at_offset')),contributors:fd.getAll('contributors')});await rpc('assign',payload);
     }else if(action==='remind'){await rpc('remind',payload);notice('Relance enregistrée pour le responsable.');return;}
     else if(action==='save'){
      const f=dialog.querySelector(`[data-section="${key}"]`),fd=new FormData(f);payload.version=Number(f.dataset.version);payload.status=fd.get('status');payload.value=fd.has('start')?{start:parisISO(fd.get('start'),fd.get('start_offset')),end:parisISO(fd.get('end'),fd.get('end_offset')),precision:fd.get('precision')}:{digest:fd.get('digest')};await rpc('save',payload);
     }
     await reloadPreserving(key,action);notice(action==='assign'?'Attribution enregistrée. La demande est dans les notifications du responsable.':'Saisie enregistrée.');
    }
   }catch(e){notice(errorText(e),true);}
   finally{busy=false;if(b.isConnected)b.disabled=false;}
  }
  async function reloadPreserving(savedKey,savedAction,savedFormId){
   // Preserve unrelated unsaved fields when one section is saved.
   const forms=[...dialog.querySelectorAll('form[data-cr-edit]')].filter(f=> !(savedFormId&&f.id===savedFormId||savedAction==='save'&&f.dataset.section===savedKey||savedAction==='assign'&&f.dataset.assign===savedKey||savedAction==='note'&&f.dataset.note===savedKey||!savedKey&&f.id==='crAudienceForm'));
   const drafts=forms.map(f=>({selector:f.id?'#'+f.id:f.dataset.section?`[data-section="${f.dataset.section}"]`:f.dataset.assign?`[data-assign="${f.dataset.assign}"]`:`[data-note="${f.dataset.note}"]`,values:[...f.elements].filter(e=>e.name).map(e=>({name:e.name,value:e.value,checked:e.checked,type:e.type,dirty:e.dataset.crDirty==='1'})),noteId:f.dataset.noteId,version:f.dataset.version}));
   const openKeys=[...dialog.querySelectorAll('details[id][open]')].map(x=>x.id),scroll=$('crBody').scrollTop;
   const wasDirty=dirty;await openReport(current.id,savedKey);
   let changed=false;
   for(const draft of drafts){const form=dialog.querySelector(draft.selector);if(!form)continue;for(const [i,el]of [...form.elements].filter(e=>e.name).entries()){const val=draft.values[i];if(!val||val.name!==el.name||!val.dirty)continue;el.dataset.crDirty='1';if(el.type==='checkbox'){if(el.checked!==val.checked)changed=true;el.checked=val.checked;}else{if(el.value!==val.value)changed=true;el.value=val.value;}}if(draft.noteId)form.dataset.noteId=draft.noteId;if(draft.values.some(v=>v.dirty)&&draft.version){const sameTiming=savedFormId&&form.id.slice(-36)===savedFormId.slice(-36);if(!(sameTiming&&Number(form.dataset.version)===Number(draft.version)+1))form.dataset.version=draft.version;}}
   openKeys.forEach(id=>{const el=$(id);if(el)el.open=true;});$('crBody').scrollTop=scroll;dirty=wasDirty&&changed;
   if(dirty)$('crSaveState').textContent='D’autres saisies restent à enregistrer';
  }
  function updateBadge(){const b=document.getElementById('notificationBtn');if(!b)return;const count=inbox.filter(x=>!x.read_at).length;b.dataset.unread=String(count);b.setAttribute('aria-label',`Notifications : ${count} non lues`);const span=b.querySelector('span');if(span)span.textContent=count?`Alertes (${count})`:'Alertes';}
  async function refresh(){
   if(polling||!owner||document.visibilityState==='hidden'||!navigator.onLine)return;polling=true;
   try{inbox=await rpc('inbox');updateBadge();if(!routeDone){routeDone=true;const id=new URL(location.href).searchParams.get('inbox');if(id){await routeNotification(id);const url=new URL(location.href);url.searchParams.delete('inbox');history.replaceState(history.state,'',url);}}}catch{}finally{polling=false;}
  }
  function contextChanged(){
   const next=ctx().ready?ctx().userId:null;if(owner===next)return;
   epoch++;owner=next;inbox=[];reports=[];catalog=[];contacts=[];configKey=null;current=null;dirty=false;busy=false;pushReady=false;routeDone=false;dialog?.close();$('crBody')?.replaceChildren();$('crFoot')?.replaceChildren();notice('');clearInterval(timer);updateBadge();
   if(next){try{pushReady=localStorage.getItem(PUSH_KEY)===next;}catch{}if(!pushReady&&navigator.serviceWorker)void workerMessage('JOURNAL_V15_CLEAR').catch(()=>{});timer=setInterval(refresh,30000);void refresh();if(pushReady)void restorePush();}
   else{try{localStorage.removeItem(PUSH_KEY);}catch{}if(navigator.serviceWorker)void workerMessage('JOURNAL_V15_CLEAR').catch(()=>{});}
  }
  async function restorePush(){try{const reg=await navigator.serviceWorker.ready,sub=await reg.pushManager.getSubscription();if(!sub||Notification.permission!=='granted'){pushReady=false;localStorage.removeItem(PUSH_KEY);return;}await workerMessage('JOURNAL_V15_STATE');await rpc('device',{device_id:deviceId,subscription:sub.toJSON()});}catch{pushReady=false;}}
  async function beforeLogout(){
   const c=ctx();try{localStorage.removeItem(PUSH_KEY);}catch{}pushReady=false;
   const forget=c.db?.rpc('journal_cr_api',{p_action:'device_remove',p_payload:{device_id:deviceId}});
   const clear=navigator.serviceWorker?workerMessage('JOURNAL_V15_CLEAR'):Promise.resolve();
   await Promise.race([Promise.allSettled([forget,clear]),new Promise(resolve=>setTimeout(resolve,2500))]);
  }
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')void refresh();});
  navigator.serviceWorker?.addEventListener('message',e=>{if(e.data?.type==='JOURNAL_V15_OPEN'&&owner){if(dirty){adapter.toast('Une notification vous attend. Enregistrez la saisie en cours.','warning');return;}void routeNotification(e.data.id).catch(err=>adapter.toast(errorText(err),'error'));}if(e.data?.type==='JOURNAL_V15_EVENT')void refresh();});
  return {open,openInbox,contextChanged,beforeLogout,isOpen:()=>Boolean(dialog?.open)};
 }
 root.JournalCR={create,parisLocal,parisISO,emailText};
})(typeof window==='undefined'?globalThis:window);
