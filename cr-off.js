/* Journal de chantier V15.3 — horaires par périmètre et diffusion à vérifier. */
(function(root){
 'use strict';
 const LABELS={catenaire:'Consignation caténaire',itc:'ITC · Interceptions',arf:'ARF · RSO',technique:'Production réalisée',securite:'Sécurité · tops et flops',synthese:'Synthèse finale'};
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
 function normalClock(value){const raw=String(value||'').trim();let m=raw.match(/^(\d{1,2}):(\d{2})$/)||raw.match(/^(\d{2})(\d{2})$/);return m&&Number(m[1])<24&&Number(m[2])<60?m[1].padStart(2,'0')+':'+m[2]:null;}
 function splitReference(label='',key='catenaire'){const text=String(label||'').trim();const m=text.match(key==='itc'?/^ZEP\s+(.+)$/i:/^(SEL|Secteur)\s+(.+)$/i);if(key==='itc')return {type:'ZEP',reference:m?m[1]:text};return m?{type:m[1].toLowerCase()==='sel'?'SEL':'Secteur',reference:m[2]}:{type:text?'':'SEL',reference:text};}
 function legacyEmailText(reports){
  return 'CR ENCADREMENT — diffusion restreinte\n\n'+reports.map(r=>`${r.chantier} · nuit du ${date(r.night)} · v${r.revision}\n`+Object.keys(LABELS).map(k=>{
   const s=r.sections.find(x=>x.key===k);if(!s)return '';
   let body=s.status==='non_concerne'?'Non concerné':s.value?.mode==='perimeters'?'\n'+(s.items||[]).filter(t=>t.active).map(t=>` • ${t.label} : ${t.status==='non_concerne'?'Non concerné':`${time(t.actual_start)} → ${time(t.actual_end)}`}${t.comment?' — '+t.comment:''}${timingDelays(t)}`).join('\n'): ['catenaire','itc','arf'].includes(k)?`${time(s.value.start)} → ${time(s.value.end)}${s.value.precision?' — '+s.value.precision:''}`:(s.value?.body||s.value?.digest||(s.notes||[]).map(n=>`[${n.category}] ${n.body}`).join(' / '));
   return `${LABELS[k]} : ${body}`;
  }).join('\n')).join('\n\n')+'\n\nHoraires en heure de Paris.';
 }
 function emailText(reports){
  return reports.map(r=>{
   if(r.format!=='15.2')return legacyEmailText([r]);
   const lines=['CR OFF — DIFFUSION RESTREINTE',`${r.chantier} · nuit du ${date(r.night)} · v${r.revision}`];
   for(const key of ['technique','securite','catenaire','itc','arf']){
    const s=r.sections.find(s=>s.key===key);if(!s)continue;lines.push('\n'+LABELS[key].toUpperCase());
    if(s.status==='non_concerne'){lines.push(key==='securite'?'Rien à signaler':'Non concerné');continue;}
    if(key==='technique')lines.push(s.value.body||s.value.digest||(s.notes||[]).map(n=>n.body).join('\n'));
    else if(key==='securite')lines.push((s.notes||[]).map(n=>` • ${n.category.toUpperCase()} — ${n.body} (${n.author_name})`).join('\n')||s.value.digest||'');
    else if(s.value.mode==='perimeters')lines.push((s.items||[]).filter(t=>t.active).map(t=>` • ${t.label}\n   Prévu : ${time(t.planned_start)||'—'} → ${time(t.planned_end)||'—'}\n   Réel : ${t.status==='non_concerne'?'Non pris':`${time(t.actual_start)||'—'} → ${time(t.actual_end)||'—'}`}${t.comment?'\n   Commentaire : '+t.comment:''}`).join('\n'));
    else if(key==='arf'&&Object.hasOwn(s.value,'planned_start'))lines.push(` • ARF\n   Prévu : ${time(s.value.planned_start)||'—'} → ${time(s.value.planned_end)||'—'}\n   Réel : ${time(s.value.start)||'—'} → ${time(s.value.end)||'—'}${s.value.precision?'\n   Commentaire : '+s.value.precision:''}`);
    else lines.push(`Début : ${time(s.value.start)||'—'} · Fin : ${time(s.value.end)||'—'}${s.value.precision?'\n'+s.value.precision:''}`);
   }
   return lines.join('\n')+'\n\nHoraires en heure de Paris.';
  }).join('\n\n');
 }
 function timingDelays(t){return [['actual_start','planned_start','accord'],['actual_end','planned_end','restitution']].map(([actual,planned,label])=>t[actual]&&t[planned]&&Date.parse(t[actual])>Date.parse(t[planned])?` · ${label} +${Math.ceil((Date.parse(t[actual])-Date.parse(t[planned]))/60000)} min`:'').join('');}
 function create(adapter){
  const ctx=()=>adapter.getContext();let owner=null,epoch=0,dialog=null,current=null,reports=[],inbox=[],dirty=false,busy=false,timer=null,polling=false,openedFrom=null,routeDone=false;
  let sheet=null,taskPopup=null,tasks=[],shownTasks=new Set(),sheetMode=null,sheetKey=null,aiController=null;
  let mode='list',filter='all',pushReady=false,hasMore=false,catalog=[],contacts=[],configKey=null;
  const DEVICE_KEY='journal_v15_device',PUSH_KEY='journal_v15_push_user';
  let deviceId;try{deviceId=localStorage.getItem(DEVICE_KEY);if(!/^[0-9a-f-]{36}$/i.test(deviceId||'')){deviceId=crypto.randomUUID();localStorage.setItem(DEVICE_KEY,deviceId);}}catch{deviceId=crypto.randomUUID();}
  const $=id=>sheet?.querySelector('#'+id)||dialog?.querySelector('#'+id);
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
   dialog.innerHTML='<header class="cr-head"><div><small>JOURNAL DE CHANTIER · V15.3</small><h2 id="crTitle">CR encadrement</h2></div><button type="button" id="crClose" class="secondary-button" aria-label="Fermer les CR">Fermer ×</button></header><div id="crNotice" role="status" aria-live="polite"></div><main id="crBody"></main><footer id="crFoot"></footer>';
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
  function close(){if(busy||!canLeave())return;closeSheet(true);dirty=false;current=null;dialog?.close();openedFrom?.focus?.();}
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
   const localNow=parisLocal(new Date().toISOString()),today=localNow.slice(0,10),yesterday=new Date(Date.parse(today+'T12:00:00Z')-86400000).toISOString().slice(0,10);
   $('crBody').innerHTML=`<form id="crNewForm"><label class="form-field">Chantier<select name="chantier_id">${ctx().chantiers.map(c=>`<option value="${esc(c.id)}" ${c.id===ctx().currentId?'selected':''}>${esc(c.name)}</option>`).join('')}</select></label><label class="form-field">Date de début de nuit<input name="night" type="date" required value="${Number(localNow.slice(11,13))<12?yesterday:today}"></label><p>Le CR couvre cette nuit et le matin suivant.</p><label class="cr-check"><input name="reuse" type="checkbox" checked> Reprendre les responsables, les destinataires et la configuration de la semaine</label><p class="cr-muted">Les horaires prévus enregistrés pour cette semaine seront repris. Les horaires réels et la production restent à renseigner. Création réservée à l’encadrement du chantier.</p></form>`;
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
  function contactSuggestions(){
   return `<details id="crContactSuggestions"><summary>Choisir dans la liste proposée · ${contacts.length} entrées à contrôler</summary><p class="cr-muted">Aucune adresse n’est ajoutée automatiquement. Corriger si nécessaire, puis sélectionner les destinataires voulus. « Reconstituée » signifie que l’adresse complète n’était pas lisible sur la photo.</p>${contacts.map(c=>`<div class="cr-contact"><label class="cr-check"><input type="checkbox" name="contact_pick" value="${esc(c.id)}"><span><b>${esc(c.name)}</b><small class="cr-block">${c.evidence==='visible'?'Adresse lisible sur la photo':c.evidence==='inferred'?'Adresse reconstituée — à vérifier':'Adresse manquante — à compléter'}</small></span></label><input aria-label="Adresse de ${esc(c.name)}" type="email" name="contact_${esc(c.id)}" value="${esc(c.email)}" placeholder="Adresse à compléter"><small>${esc(c.note)}</small></div>`).join('')}${button('contacts-add','Ajouter les adresses sélectionnées au CR')}</details>`;
  }
  function sectionMarkup(s,r){
   const timing=['catenaire','itc','arf'].includes(s.key),items=(s.items||[]).filter(t=>t.active),complete=['complete','non_concerne'].includes(s.status);
   const text=s.key==='technique'?productionText(s):s.key==='securite'?(s.notes||[]).map(n=>n.body).join(' · '):s.key==='arf'?`${shortTime(s.value.start)} → ${shortTime(s.value.end)}`:`${items.length} ${s.key==='itc'?'ZEP':'secteurs / SEL'} · ${items.filter(t=>['complete','non_concerne'].includes(t.status)).length} renseignés`;
   return `<tr id="crSection-${s.key}" class="${complete?'is-complete':''}"><td><button class="cr-row-open" data-cr="edit-section" data-key="${s.key}"><span class="cr-rubric-icon" aria-hidden="true">${{catenaire:'ϟ',itc:'⇄',arf:'✓',technique:'▤',securite:'◇'}[s.key]}</span><span><b>${LABELS[s.key]}</b><small>${esc(timing?(s.responsible_name||'À attribuer'):text.slice(0,95)||'À compléter')}</small></span></button></td><td><span class="cr-status">${complete?'✓ ':''}${STATUS[s.status]}</span>${timing&&s.key!=='arf'?`<small class="cr-block">${items.filter(t=>['complete','non_concerne'].includes(t.status)).length} / ${items.length} renseignés</small>`:''}</td><td>${button('edit-section','›',`data-key="${s.key}" aria-label="Ouvrir ${esc(LABELS[s.key])}"`)}</td></tr>`;
  }
  async function openReport(id,focus){const detail=await rpc('detail',{id});const meta=detail.manager?await rpc('catalog',{chantier_id:detail.chantier_id}):{catalog:[],contacts:[]};current=detail;catalog=meta.catalog;contacts=meta.contacts;renderReport(focus);}
  function renderReport(focus){
   const r=current;mode='report';dirty=false;const site=ctx().chantiers.find(c=>c.id===r.chantier_id);$('crTitle').textContent=site?.name||'CR encadrement';
   $('crBody').innerHTML=`<div class="cr-tools">${button('back','‹ Tous les CR')}${button('refresh-report','Actualiser')}<span class="cr-state">${STATES[r.state]} · v${r.revision}</span></div><p class="cr-intro">Nuit du ${date(r.night)} · <b>Diffusion restreinte</b><br><small>${r.full_access?'CR privé · à relire avant envoi':'Vos rubriques et contributions'}</small></p><p id="crSaveState" class="cr-muted cr-save-status" aria-live="polite">✓ Saisies enregistrées</p>
   <table class="cr-overview"><caption class="cr-sr">Rubriques du CR</caption><colgroup><col style="width:62%"><col style="width:28%"><col style="width:10%"></colgroup><tbody>${Object.keys(LABELS).filter(k=>k!=='synthese').map(k=>r.sections.find(s=>s.key===k)).filter(Boolean).map(s=>sectionMarkup(s,r)).join('')}</tbody></table>
   ${r.manager?`<details class="cr-section" id="crAudience"><summary><b>Accès au CR et destinataires</b><span>${r.recipients.length} destinataire(s)</span></summary><div class="cr-section-content"><form id="crAudienceForm" data-cr-edit><fieldset ${r.state!=='draft'?'disabled':''}>${r.state==='draft'?contactSuggestions():''}<label class="form-field">Emails des destinataires<textarea name="recipients" rows="3" placeholder="Une adresse par ligne">${esc(r.recipients.join('\n'))}</textarea></label><p class="cr-muted">Seuls ces destinataires recevront la copie validée. Vérifier leur liste avant l’envoi.</p><details><summary>Collaborateurs autorisés à compléter l’ensemble du CR</summary>${peopleChecks(r.people,r.collaborators,'collaborators')}</details>${r.state==='draft'?button('audience','Enregistrer les accès et destinataires'):''}</fieldset></form></div></details>`:''}
   <details class="cr-section"><summary>Historique des saisies et des versions</summary><div class="cr-section-content">${r.history.map(h=>`<p><b>${esc(h.actor_name)}</b> · ${esc({tableau:'Références et prévu',production:'Production renseignée',arf:'Horaires ARF',prevu_arf:'Prévu ARF',creation:'Création',attribution:'Attribution',saisie:'Saisie',contribution:'Contribution',validation:'Validation',diffusion:'Accès et destinataires',relance:'Relance',rectificatif:'Rectificatif',perimetres:'Sélection des périmètres',timing_save:'Horaires saisis',timing_plan:'Horaires prévus',timing_assign:'Attribution d’un périmètre'}[h.action]||h.action)}${h.section_key?' · '+LABELS[h.section_key]:''}<small class="cr-block">${time(h.created_at)}${h.detail?.after?.label?' · '+esc(h.detail.after.label):''}${h.detail?.reason?' · '+esc(h.detail.reason):''}</small></p>`).join('')}
   ${(r.snapshots||[]).map(s=>`<details><summary>Version ${s.revision} validée par ${esc(s.validated_name)} · ${time(s.validated_at)}</summary><pre class="cr-preview">${esc(emailText([s.data]))}</pre></details>`).join('')}
   ${(r.deliveries||[]).map(d=>`<p>Envoi ${esc({pending:'préparé',sent:'accepté par le service email',failed:'en échec',uncertain:'à vérifier'}[d.state])} · ${time(d.sent_at||d.created_at)}</p>`).join('')}</div></details>`;
   $('crFoot').innerHTML=r.manager?(r.state==='draft'?button('validate','Valider le CR','',true):button('preview','Préparer l’envoi','',true)+button('reopen','Créer un rectificatif')):'<small>Les contributions seront relues par l’encadrant avant envoi.</small>';
   if(focus&&r.sections.some(s=>s.key===focus))openSection(focus);
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
  async function openInbox(){show();$('crBody').replaceChildren();$('crFoot').replaceChildren();mode='inbox';current=null;dirty=false;[inbox,tasks]=await Promise.all([rpc('inbox'),rpc('tasks')]);renderInbox();}
  function renderInbox(){
   $('crTitle').textContent='Demandes et notifications';
   $('crBody').innerHTML=`<p class="cr-intro">Messages et demandes reçus sur vos chantiers. Les notifications restent consultables ici, même si le téléphone n’a pas affiché d’alerte.</p><div class="cr-tools">${button('enablepush',pushReady?'Alertes permanentes activées':'Activer sur ce téléphone')}${pushReady?button('disablepush','Arrêter les alertes permanentes'):''}${button('alerts','Alertes de mon chantier')}</div><p class="cr-muted">${typeof Notification==='undefined'?'Ce navigateur ne propose pas les alertes du téléphone.':Notification.permission==='denied'?'Notifications bloquées : autoriser le Journal dans les réglages du navigateur.':'Les alertes du téléphone dépendent de son autorisation et de sa connexion. Le mode chantier se règle séparément.'}</p><div id="crTaskList">${taskListMarkup()}</div><div class="cr-report-list">${inbox.map(n=>`<button type="button" class="cr-inbox-item ${n.read_at?'':'unread'}" data-cr="notification" data-id="${esc(n.id)}"><span>${n.read_at?'○':'●'}</span><span><b>${esc(n.title)}</b><small>${esc(ctx().chantiers.find(c=>c.id===n.chantier_id)?.name||'Chantier')} ${n.section_key?' · '+LABELS[n.section_key]:''}<br>${time(n.created_at)}</small></span><span>›</span></button>`).join('')||'<p class="cr-empty">Aucune notification. Les nouveaux événements apparaîtront ici.</p>'}</div>`;
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
   if(['edit-section','back','new','filter','report','inbox','notification','group','preview','alerts','reopen','refresh-report','configure-scopes','configure-back'].includes(action)&&!canLeave())return;
   busy=true;b.disabled=true;notice('');
   try{
    if(action==='edit-section'){openSection(b.dataset.key);}
    else if(action==='back'){dirty=false;await open();}
    else if(action==='new'){dirty=false;renderNew();}
    else if(action==='filter'){filter=filter==='all'?'mine':'all';await open();}
    else if(action==='more'){const rows=await rpc('list',{offset:reports.length,mine:filter==='mine'});hasMore=rows.length===200;reports=reports.concat(rows.filter(r=>!reports.some(old=>old.id===r.id)));renderList();}
    else if(action==='create'){
     const form=$('crNewForm');if(!form.reportValidity())return;const data=Object.fromEntries(new FormData(form));data.reuse=form.elements.reuse.checked;
     const r=await rpc('create',data);await openReport(r.id);
    }else if(action==='contacts-add'){
     const f=$('crAudienceForm'),selected=[...f.querySelectorAll('[name="contact_pick"]:checked')];
     if(!selected.length)throw new Error('Sélectionner les personnes à ajouter.');
     const values=selected.map(x=>{const input=f.elements.namedItem('contact_'+x.value);if(!input.value.trim()||!input.checkValidity())throw new Error('Compléter ou corriger l’adresse de chaque personne sélectionnée.');return input.value.trim().toLowerCase();});
     const box=f.elements.recipients;box.value=[...new Set([...box.value.split(/[\s;,]+/).filter(Boolean).map(x=>x.toLowerCase()),...values])].join('\n');box.dataset.crDirty='1';dirty=true;
     selected.forEach(x=>{x.checked=false;delete x.dataset.crDirty;});$('crContactSuggestions').open=false;box.focus();notice('Adresses ajoutées au formulaire. Vérifier la liste puis enregistrer les destinataires.');
    }else if(action==='task-open'){await openTask(b.dataset.id);}
    else if(action==='task-unmute'){const t=tasks.find(t=>t.id===b.dataset.id);await rpc('task_ack',{task_id:t.id,token:t.token,muted:false});tasks=await rpc('tasks');renderInbox();}
    else if(action==='report')await openReport(b.dataset.id);
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
     const c=ctx(),ticket=epoch;const {data,error}=await c.db.functions.invoke('journal-cr-send-v152',{body:{ids:current.ids}});
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
  const shortTime=v=>v?parisLocal(v).slice(11,16):'—';
  const productionText=s=>s.value?.body||s.value?.digest||(s.notes||[]).map(n=>n.body).join('\n');
  function closeSheet(force=false){
   if(!force&&(busy||!canLeave()))return false;
   aiController?.abort();aiController=null;sheet?.remove();sheet=null;sheetMode=null;dirty=false;return true;
  }
  function makeSheet(title,body,foot){
   sheet?.remove();sheet=document.createElement('dialog');sheet.id='crSheet';sheet.className='cr-dialog cr-sheet';
   sheet.setAttribute('aria-labelledby','crSheetTitle');
   sheet.innerHTML=`<header class="cr-head"><h2 id="crSheetTitle">${esc(title)}</h2><button type="button" data-sheet="close" class="secondary-button">Fermer ×</button></header><div id="crSheetNotice" role="status" aria-live="polite"></div><main>${body}</main><footer>${foot}</footer>`;
   sheet.addEventListener('submit',e=>e.preventDefault());
   sheet.addEventListener('cancel',e=>{e.preventDefault();closeSheet();});
   sheet.addEventListener('input',e=>{if(e.target.closest('[data-cr-edit]'))dirty=true;if(e.target.type==='date')e.target.dataset.manual='1';updateClockDays();});
   sheet.addEventListener('change',e=>{if(e.target.closest('[data-cr-edit]'))dirty=true;if(e.target.closest('.cr-clock')&&e.target.type==='text'){const value=normalClock(e.target.value);if(value)e.target.value=value;}updateClockDays();});
   sheet.addEventListener('click',e=>{const b=e.target.closest('[data-sheet]');if(b&&!busy)void sheetAction(b.dataset.sheet,b);});
   document.body.append(sheet);sheet.showModal();updateClockDays();
  }
  function sb(action,label,attrs='',primary=false){return `<button type="button" data-sheet="${action}" ${attrs} class="${primary?'primary':'secondary'}-button">${label}</button>`;}
  function sheetNotice(message,error=false){const el=$('crSheetNotice');if(el){el.textContent=message;el.className=message?'cr-notice'+(error?' error':''):'';}}
  function clockDate(day){return new Date(Date.parse(current.night+'T12:00Z')+day*86400000).toISOString().slice(0,10);}
  function compactClock(name,value,label,defaultValue){
   const local=parisLocal(value),hint=parisLocal(value||defaultValue),dst=current.night.slice(5,7)==='10'&&Number(current.night.slice(8))>=23;
   return `<span class="cr-clock" data-clock="${name}" data-hint="${hint}"><span class="cr-clock-main"><input type="text" inputmode="numeric" autocomplete="off" name="${name}" aria-label="${esc(label)}" placeholder="hh:mm" maxlength="5" value="${local.slice(11,16)}"><small data-clock-day></small></span><span class="cr-clock-date" hidden><input type="date" name="${name}_date" aria-label="Date ${esc(label)}" value="${hint.slice(0,10)||current.night}"></span>${dst?`<span class="cr-clock-dst"><select name="${name}_offset" aria-label="Changement d’heure ${esc(label)}"><option value="auto">Paris</option><option value="+02:00">Heure d’été</option><option value="+01:00">Heure d’hiver</option></select></span>`:''}</span>`;
  }
  function clockLocal(el,name){
   const input=el.querySelector(`[name="${name}"]`),value=String(input?.value||'').trim();if(!value)return '';
   const clock=normalClock(value);if(!clock)throw new Error(`${input.getAttribute('aria-label')} : saisir une heure entre 00:00 et 23:59.`);
   const holder=input.closest('.cr-clock'),manual=holder.querySelector(`[name="${name}_date"]`),hint=holder.dataset.hint;
   if(manual.dataset.manual==='1'){if(!manual.value)throw new Error('Précisez la date de cet horaire.');return manual.value+'T'+clock;}
   let day=hint?Math.round((Date.parse(hint.slice(0,10)+'T12:00Z')-Date.parse(current.night+'T12:00Z'))/86400000):clock<'12:00'?1:0;
   if(name.endsWith('end')){
    const start=clockLocal(el,name==='planned_end'?'planned_start':'start');
    if(start){const sd=Math.round((Date.parse(start.slice(0,10)+'T12:00Z')-Date.parse(current.night+'T12:00Z'))/86400000);day=Math.max(day,sd);if(day===sd&&clock<start.slice(11,16))day++;}
   }
   return clockDate(day)+'T'+clock;
  }
  function compactValue(el,name){const local=clockLocal(el,name);return local?parisISO(local,el.querySelector(`[name="${name}_offset"]`)?.value||'auto'):null;}
  function updateClockDays(scope=sheet){
   scope?.querySelectorAll('[data-clock]').forEach(holder=>{try{const local=clockLocal(holder.closest('[data-timing-row],#crArfForm'),holder.dataset.clock);const day=local?Math.round((Date.parse(local.slice(0,10)+'T12:00Z')-Date.parse(current.night+'T12:00Z'))/86400000):null;holder.querySelector('[data-clock-day]').textContent=day===null?'':day===0?'soir':'+ '+day+' j';const input=holder.querySelector('[type=date]');if(!input.dataset.manual&&local)input.value=local.slice(0,10);}catch{holder.querySelector('[data-clock-day]').textContent='';}});
  }
  function readClock(value){return `<span class="cr-read-clock">${shortTime(value)}${value?`<small>${date(parisLocal(value).slice(0,10)).slice(0,5)}</small>`:''}</span>`;}
  function weekCheck(){return '<label class="cr-check cr-week"><input type="checkbox" name="remember_week" checked> Garder les références et le prévu pour les prochaines nuits de la semaine</label>';}
  function hoursTable(t,manager,key){
   const arf=key==='arf',v=arf?t.value||{}:t;
   return `<table class="cr-hours"><caption class="cr-sr">${arf?'Horaires ARF':esc(t.label||'Horaires de la référence')} · prévu et réel</caption><thead><tr><th scope="col">Horaires</th><th scope="col">Début</th><th scope="col">Fin</th></tr></thead><tbody><tr class="cr-hours-plan"><th scope="row">Prévu</th><td>${manager?compactClock('planned_start',v.planned_start,'Début prévu'):readClock(v.planned_start)}</td><td>${manager?compactClock('planned_end',v.planned_end,'Fin prévue'):readClock(v.planned_end)}</td></tr><tr class="cr-hours-actual"><th scope="row">Réel</th><td>${compactClock('start',arf?v.start:t.actual_start,'Début réel',v.planned_start)}</td><td>${compactClock('end',arf?v.end:t.actual_end,'Fin réelle',v.planned_end)}</td></tr></tbody></table>`;
  }
  function timingRow(t={}){
   const manager=current.manager&&current.state==='draft',type=splitReference(t.label,sheetKey);
   return `<section class="cr-timing-row" data-timing-row data-row-id="${esc(t.id||'')}" data-version="${t.version||0}"><div class="cr-ref-head">${manager?`<label class="cr-selected"><input name="selected" type="checkbox" ${t.active!==false?'checked':''} aria-label="Demander cette référence"></label>${sheetKey==='catenaire'?`<select name="ref_type" aria-label="Type de consignation"><option value="SEL" ${type.type==='SEL'?'selected':''}>SEL</option><option value="Secteur" ${type.type==='Secteur'?'selected':''}>Secteur</option>${!type.type?'<option value="" selected>Type…</option>':''}</select>`:'<span class="cr-ref-tag">ZEP</span>'}<input name="reference" aria-label="${sheetKey==='itc'?'Référence ZEP':'Numéro ou nom du secteur ou SEL'}" maxlength="480" value="${esc(type.reference)}" placeholder="Numéro ou nom…">`:`<b>${esc(t.label)}</b>`}${sb('dates','Dates', 'aria-expanded="false"')}</div>${hoursTable(t,manager,sheetKey)}<div class="cr-row-bottom"><label class="cr-check"><input name="non_concerne" type="checkbox" ${t.status==='non_concerne'?'checked':''}> Non pris</label><label class="cr-row-comment"><span class="cr-sr">Commentaire ou retard</span><input name="comment" maxlength="1000" value="${esc(t.comment||'')}" placeholder="Commentaire / retard (facultatif)"></label></div>${t.updated_name?`<small class="cr-author">Dernière saisie · ${esc(t.updated_name)}</small>`:''}</section>`;
  }
  function openSection(key,configure=false){
   sheetKey=key;sheetMode='edit';dirty=false;
   const s=current.sections.find(s=>s.key===key);if(!s)return;
   const locked=current.state!=='draft',manager=current.manager&&!locked,active=(s.items||[]).filter(t=>t.active),timing=['catenaire','itc'].includes(key);
   const assignee=s.responsible_name?`<span>Demande confiée à <b>${esc(s.responsible_name)}</b></span>`:'<span>Responsable à désigner</span>';
   const assignment=manager?`<label class="cr-assignee"><span>${key==='arf'?'Responsable · RSO':key==='itc'?'Responsable · RPD':'Responsable · caténaire'}</span><select name="responsible">${peopleOptions(current.people,s.responsible)}</select></label>`:`<p class="cr-assigned">${assignee}</p>`;
   const intro=`<p class="cr-sheet-meta">Nuit du ${date(current.night)} · heure de Paris <span>Le lendemain est indiqué automatiquement.</span></p>`;
   let body=intro,foot=sb('close','Retour au CR');
   if(timing){
    body+=`<form id="crTimingForm" data-cr-edit data-version="${s.version}"><fieldset ${locked?'disabled':''}>${assignment}<div id="crTimingRows">${(active.length?active:manager?[{}]:[]).map(t=>timingRow(t)).join('')}</div>${manager?sb('add-row',key==='itc'?'＋ Ajouter une ZEP':'＋ Ajouter un secteur / SEL')+weekCheck():''}${!active.length&&!manager?'<p class="cr-empty">Aucune référence demandée cette nuit.</p>':''}${manager&&(s.items||[]).some(t=>t.actual_start||t.actual_end)?'<details class="cr-change-reason"><summary>Motif d’un changement de référence</summary><input name="reason" maxlength="1000" placeholder="À préciser si vous retirez ou renommez une référence déjà renseignée"></details>':''}</fieldset></form>`;
    if(!locked&&(manager||active.length))foot+=sb('save-sheet',manager?'Enregistrer et demander':'Enregistrer les horaires','',true);
   }else if(key==='arf'){
    body+=`<form id="crArfForm" data-cr-edit data-version="${s.version}"><fieldset ${locked?'disabled':''}>${assignment}<section class="cr-timing-row"><div class="cr-ref-head"><b>Attestation ARF · toutes les voies</b>${sb('dates','Dates','aria-expanded="false"')}</div>${hoursTable(s,manager,key)}<div class="cr-row-bottom"><label class="cr-check"><input name="non_concerne" type="checkbox" ${s.status==='non_concerne'?'checked':''}> Non concerné</label><label class="cr-row-comment"><span class="cr-sr">Commentaire ou retard</span><input name="comment" maxlength="1000" value="${esc(s.value.precision)}" placeholder="Commentaire / retard (facultatif)"></label></div></section>${manager?weekCheck():''}</fieldset></form>`;
    if(!locked)foot+=sb('save-arf',manager?'Enregistrer et demander':'Enregistrer les horaires','',true);
   }else if(key==='technique'){
    body+=`<form id="crProduction" data-cr-edit data-version="${s.version}"><label class="form-field">Travaux réalisés cette nuit<textarea name="body" rows="12" maxlength="8000" ${locked?'readonly':''} placeholder="Décrivez succinctement ce qui a été réalisé…">${esc(productionText(s))}</textarea></label><small>${s.updated_name?'Dernière saisie : '+esc(s.updated_name):'Les participants autorisés peuvent compléter ce texte.'}</small></form>`;
    if(!locked)foot+=sb('improve','✨ Améliorer avec Gemini')+sb('save-production','Enregistrer la production','',true);
   }else if(key==='securite'){
    body+=`<div class="cr-notes">${(s.notes||[]).map(n=>`<article><b>${n.category==='top'?'✓ TOP':n.category==='flop'?'! FLOP':esc(n.category)} · ${esc(n.author_name)}</b><p>${esc(n.body)}</p></article>`).join('')}</div>`;
    if(!locked){body+=`<form id="crSafety" data-cr-edit data-version="${s.version}"><label class="form-field">Action ou fait observé<textarea name="body" maxlength="2000" rows="6" placeholder="Décrivez le fait de sécurité…"></textarea></label><div class="cr-tools"><label class="cr-check"><input type="radio" name="category" value="top" checked> ✓ Top</label><label class="cr-check"><input type="radio" name="category" value="flop"> ! Flop</label></div><small>Votre nom sera ajouté automatiquement.</small></form>`;foot+=sb('improve','✨ Améliorer')+sb('save-safety','Ajouter le fait','',true);if(!s.notes?.length)foot+=sb('safety-clear','Rien à signaler');}
   }
   makeSheet(LABELS[key],body,foot);
  }
  async function sheetAction(action,b){
   if(action==='close'){closeSheet();return;}
   if(action==='dates'){const row=b.closest('[data-timing-row],#crArfForm');const show=b.getAttribute('aria-expanded')!=='true';b.setAttribute('aria-expanded',String(show));row.querySelectorAll('.cr-clock-date').forEach(el=>el.hidden=!show);return;}
   if(action==='add-row'){if($('crTimingRows').children.length>=40){sheetNotice('40 références maximum.',true);return;}$('crTimingRows').insertAdjacentHTML('beforeend',timingRow());dirty=true;$('crTimingRows').lastElementChild.querySelector('[name=reference]')?.focus();return;}
   if(action==='improve'){await improveText();return;}
   if(action==='ai-apply'){const ai=$('crAiProposal');const target=sheet.querySelector('textarea[name=body]');if(ai&&target){target.value=ai.value;dirty=true;$('crAiReview').remove();target.focus();}return;}
   if(action==='ai-cancel'){$('crAiReview')?.remove();return;}
   busy=true;b.disabled=true;sheetNotice('');const reportId=current.id,key=sheetKey;
   try{
    let payload={id:reportId,key},api;
    if(action==='save-sheet'){
     const f=$('crTimingForm'),s=current.sections.find(s=>s.key===key),manager=current.manager;
     const rows=[...f.querySelectorAll('[data-timing-row]')].map(el=>{
      const old=s.items.find(t=>t.id===el.dataset.rowId),selected=manager?el.querySelector('[name=selected]').checked:true;
      const reference=manager?el.querySelector('[name=reference]').value.trim():'';
      const type=key==='itc'?'ZEP':manager?el.querySelector('[name=ref_type]').value:'';
      if(manager&&selected&&(!reference||!type))throw new Error('Choisissez le type et indiquez le numéro ou le nom de chaque référence.');
      const label=manager?type+' '+reference:old.label;
      const start=compactValue(el,'start'),end=compactValue(el,'end'),non=el.querySelector('[name=non_concerne]').checked;
      if(non&&(start||end))throw new Error('Une référence « Non pris » ne peut pas conserver d’horaires réels. Décochez « Non pris » ou effacez ces heures.');
      return {id:el.dataset.rowId||null,version:Number(el.dataset.version),selected,label,planned_start:manager?compactValue(el,'planned_start'):old.planned_start,planned_end:manager?compactValue(el,'planned_end'):old.planned_end,start,end,status:non?'non_concerne':'auto',comment:el.querySelector('[name=comment]').value};
     });
     const sameTime=(a,b)=>!a&&!b||a&&b&&Date.parse(a)===Date.parse(b);
     const changed=manager&&(String(s.responsible||'')!==f.elements.responsible.value||(s.items||[]).filter(t=>t.active).length!==rows.filter(t=>t.selected).length||rows.some(row=>{const old=s.items.find(t=>t.id===row.id);return !old||row.label!==old.label||row.selected!==old.active||!sameTime(row.planned_start,old.planned_start)||!sameTime(row.planned_end,old.planned_end);}));
     payload={...payload,version:Number(f.dataset.version),rows,configure:Boolean(changed),responsible:manager?f.elements.responsible.value:undefined,remember_week:manager&&f.elements.remember_week.checked,reason:f.elements.reason?.value||''};
     api='timing_sheet';
    }else if(action==='save-arf'){
     const f=$('crArfForm');payload={...payload,version:Number(f.dataset.version),start:compactValue(f,'start'),end:compactValue(f,'end'),comment:f.elements.comment.value,non_concerne:f.elements.non_concerne.checked};
     if(current.manager)Object.assign(payload,{responsible:f.elements.responsible.value,planned_start:compactValue(f,'planned_start'),planned_end:compactValue(f,'planned_end'),remember_week:f.elements.remember_week.checked});api='arf_save';
    }else if(action==='save-production'){
     const f=$('crProduction');payload={...payload,version:Number(f.dataset.version),body:f.elements.body.value};api='production_save';
    }else if(action==='save-safety'){
     const f=$('crSafety');const body=f.elements.body.value.trim();if(!body)throw new Error('Décrivez le fait de sécurité avant de l’ajouter.');
     const category=f.elements.category.value,fingerprint=JSON.stringify([body,category]);if(f.dataset.fingerprint!==fingerprint){f.dataset.noteId=crypto.randomUUID();f.dataset.fingerprint=fingerprint;}
     payload={...payload,note_id:f.dataset.noteId,body,category};api='note';
    }else if(action==='safety-clear'){payload.version=Number($('crSafety').dataset.version);api='safety_clear';}else return;
    if(action==='save-arf'&&payload.non_concerne&&(payload.start||payload.end))throw new Error('Effacez les horaires réels ou décochez « Non concerné ».');
    await rpc(api,payload);dirty=false;closeSheet(true);await openReport(reportId);void refresh();notice(action==='save-sheet'&&payload.configure?'Configuration enregistrée. La demande est accessible au responsable dans « Mes demandes ».':'Saisie enregistrée.');
   }catch(e){sheetNotice(errorText(e),true);}finally{busy=false;if(b.isConnected)b.disabled=false;}
  }
  async function improveText(){
   const target=sheet.querySelector('textarea[name=body]'),original=target?.value.trim();if(!original){sheetNotice('Écrire le texte à améliorer.',true);return;}
   const ticket=epoch,sourceSheet=sheet;aiController?.abort();aiController=new AbortController();busy=true;sheetNotice('Gemini prépare une proposition…');
   try{
    const text=await root.JournalCRAI.improve(original,{signal:aiController.signal});
    if(ticket!==epoch||sheet!==sourceSheet)return;
    if(text.length>target.maxLength)throw new Error('Proposition trop longue. Raccourcir le texte et réessayer.');
    $('crAiReview')?.remove();sheet.querySelector('main').insertAdjacentHTML('beforeend',`<section id="crAiReview" class="cr-ai-review"><h3>Proposition Gemini</h3><p class="cr-muted">Vérifiez les faits et les chiffres. Le texte d’origine est conservé jusqu’à votre choix.</p><textarea id="crAiProposal" rows="8" maxlength="${target.maxLength}">${esc(text)}</textarea><div class="cr-tools">${sb('ai-apply','Utiliser cette proposition','',true)}${sb('ai-cancel','Garder mon texte')}</div></section>`);$('crAiReview').scrollIntoView({block:'nearest'});sheetNotice('Proposition à relire avant utilisation.');
   }catch(e){if(sheet===sourceSheet)sheetNotice(errorText(e)+' Votre texte est conservé.',true);}finally{busy=false;}
  }
  function renderTaskEntry(){
   let btn=document.getElementById('crTasksBtn');if(!btn){btn=document.createElement('button');btn.type='button';btn.id='crTasksBtn';btn.className='secondary-button';btn.onclick=()=>{if(!canLeave())return;closeSheet(true);void openInbox();};const host=document.getElementById('crOffBtn');if(host)host.after(btn);else document.body.append(btn);}
   btn.hidden=!tasks.length;btn.textContent=`Mes demandes (${tasks.length})`;btn.setAttribute('aria-label',btn.textContent);
  }
  function taskListMarkup(){return tasks.length?`<h3>Mes horaires à renseigner</h3>${tasks.map(t=>`<article class="cr-task-item"><b>${esc(t.chantier)} · ${LABELS[t.section_key]}</b><small>Nuit du ${date(t.night)}${t.expected_end?' · fin prévue '+time(t.expected_end):''}${t.muted?' · rappels inhibés':''}</small><div class="cr-tools">${button('task-open','Renseigner',`data-id="${t.id}"`)}${t.muted?button('task-unmute','Réactiver les rappels',`data-id="${t.id}"`):''}</div></article>`).join('')}`:'';}
  async function openTask(id,muted){
   const t=tasks.find(t=>t.id===id);if(!t)throw new Error('Demande terminée ou réattribuée.');
   if(!canLeave())return;closeSheet(true);taskPopup?.remove();taskPopup=null;show();await openReport(t.report_id,t.section_key);
   // Reading a request does not disable its end-of-session reminder.
   await rpc('task_ack',{task_id:t.id,token:t.token,...(typeof muted==='boolean'?{muted}:{})});t.dismissed_token=t.token;
  }
  function showNextTask(){
   if(!owner||document.visibilityState==='hidden'||busy||dirty||sheet?.open||dialog?.open||taskPopup?.open||document.querySelector('dialog[open]'))return;
   const t=tasks.find(t=>!t.muted&&t.token!==t.dismissed_token&&!shownTasks.has(t.id+':'+t.token));if(!t)return;
   shownTasks.add(t.id+':'+t.token);taskPopup=document.createElement('dialog');taskPopup.className='cr-task-popup';taskPopup.setAttribute('aria-labelledby','crTaskPopupTitle');
   taskPopup.innerHTML=`<h2 id="crTaskPopupTitle">${t.reminder?'Fin de séance : horaires à compléter':'Une demande vous est attribuée'}</h2><p><b>${esc(t.chantier)}</b><br>${LABELS[t.section_key]}<br><small>Nuit du ${date(t.night)}${t.expected_end?' · fin prévue '+time(t.expected_end):''}</small></p><div class="cr-tools"><button data-task="open" class="primary-button">Renseigner</button><button data-task="later" class="secondary-button">Plus tard</button></div><label class="cr-check"><input type="checkbox" id="crMuteTask"> Inhiber les rappels pour cette demande</label><p class="cr-muted">La demande reste dans « Mes demandes ».</p><p id="crTaskError" role="status"></p>`;
   const dismiss=async()=>{try{await rpc('task_ack',{task_id:t.id,token:t.token,muted:taskPopup.querySelector('#crMuteTask').checked});taskPopup.remove();taskPopup=null;tasks=await rpc('tasks');renderTaskEntry();}catch(e){if(taskPopup)taskPopup.querySelector('#crTaskError').textContent=errorText(e);}};
   taskPopup.addEventListener('cancel',e=>{e.preventDefault();void dismiss();});
   taskPopup.addEventListener('click',e=>{const b=e.target.closest('[data-task]');if(!b)return;if(b.dataset.task==='open')void openTask(t.id,taskPopup.querySelector('#crMuteTask').checked).catch(e=>adapter.toast(errorText(e),'warning'));else void dismiss();});
   document.body.append(taskPopup);taskPopup.showModal();
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
   if(polling||!owner||document.visibilityState==='hidden'||!navigator.onLine)return;const pollEpoch=epoch;polling=true;
   try{const both=await Promise.all([rpc('inbox'),rpc('tasks')]);inbox=both[0];tasks=both[1];updateBadge();renderTaskEntry();if(!routeDone){routeDone=true;const id=new URL(location.href).searchParams.get('inbox');if(id){await routeNotification(id);const url=new URL(location.href);url.searchParams.delete('inbox');history.replaceState(history.state,'',url);}}showNextTask();}catch{}finally{if(pollEpoch===epoch)polling=false;}
  }
  function contextChanged(){
   const next=ctx().ready?ctx().userId:null;if(owner===next)return;
   epoch++;closeSheet(true);taskPopup?.remove();taskPopup=null;tasks=[];shownTasks.clear();owner=next;inbox=[];reports=[];catalog=[];contacts=[];configKey=null;current=null;dirty=false;busy=false;pushReady=false;routeDone=false;dialog?.close();$('crBody')?.replaceChildren();$('crFoot')?.replaceChildren();notice('');clearInterval(timer);polling=false;updateBadge();renderTaskEntry();
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
  return {open,openInbox,contextChanged,beforeLogout,isOpen:()=>Boolean(dialog?.open||sheet?.open||taskPopup?.open)};
 }
 root.JournalCR={create,parisLocal,parisISO,emailText,normalClock,splitReference};
})(typeof window==='undefined'?globalThis:window);
