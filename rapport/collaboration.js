(function(root){'use strict';
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let adapter,client,owner,site,record=null,ready=false,applying=false,busy=false,timer,changed=false,problem=false,pending=null,panel,actions,operation=null,bootLocked=false;
 const url=new URL(location.href),initialId=url.searchParams.get('reportId');
 const storeKey=()=>`daily-report:${owner}:${record?.id||site}`;
 const valid=()=>ready&&owner;
 const activeKey=()=>`daily-report-active:${owner}:${site}`;
 const clean=doc=>{const d=structuredClone(doc);if(d.settings)delete d.settings.admin;delete d.collaboration;return d;};
 const content=doc=>{const d=clean(doc);delete d.reportSerial;delete d.reportUid;delete d.updatedAt;if(d.meta){delete d.meta.reportNo;delete d.meta.previousReportNo;}return JSON.stringify(d);};
 const numbered=()=>['confirmed','legacy'].includes(record?.numbering);
 const stamp=t=>new Date(t).toLocaleString('fr-FR',{timeZone:'Europe/Paris'});
 async function rpc(action,payload){const who=owner;const r=await client.rpc('journal_report_api',{p_action:action,p_payload:payload});if(who!==owner||!valid())throw new Error('Le compte a changé. Rouvrez le rapport depuis le journal.');if(r.error)throw r.error;return r.data;}
 function notice(text,error=false){actions?.status(text,error);const n=panel?.querySelector('[data-status]');if(n){n.textContent=text;n.classList.toggle('error',error);}}
 function lock(){actions?.enable(ready);const locked=!ready||!!record&&!record.can_edit;if(!ready){document.querySelector('.app-main').inert=true;bootLocked=true;}else if(bootLocked){document.querySelector('.app-main').inert=false;bootLocked=false;}document.getElementById('moreButton').disabled=locked;document.getElementById('newReportButton').disabled=!ready||busy;document.getElementById('enterAppButton').disabled=!ready;const next=panel?.querySelector('[data-share-next]');if(next)next.disabled=!ready||busy;
  for(const k of ['save','transfer','validate']){const button=panel?.querySelector('[data-share-'+k+']');if(button)button.disabled=locked||busy;}
 }
 function remember(result){record=result;localStorage.setItem(activeKey(),record.id);url.searchParams.set('reportId',record.id);history.replaceState(null,'',url);adapter.scope(owner,record.id);adapter.numbering(record.numbering);}

 function render(){const view=actions?.capture();panel.innerHTML=`<div class="shared-heading"><div><small>Rapport journalier collaboratif</small><h2>${esc(record?.chantier||'Rapport de ce chantier')}</h2></div><span>${record?.state==='validated'?'✓ Validé':record?.numbering==='legacy'?'Déjà archivé':record?'Brouillon partagé':'Brouillon sur cet appareil'}</span></div><p><strong>${esc(numbered()?record.document.meta.reportNo:"Numéro attribué au premier enregistrement")}</strong></p><p data-status role="status"></p><div class="shared-actions"><button data-share-transfer>Transférer le rapport journalier</button><button data-share-save>Enregistrer sur le serveur</button><button data-share-validate>Valider le rapport journalier</button><button data-share-reload>Actualiser le rapport</button><button data-share-backup>Sauvegarder ma saisie en fichier</button><button data-share-next>Créer le rapport suivant</button></div><details><summary>Historique du rapport</summary><button data-share-recovery>Récupérer la saisie conservée avant actualisation</button>${record?.history?.map(h=>`<p><b>${esc(h.event)}</b> · ${esc(h.actor_name)}<br><small>${stamp(h.created_at)}${h.detail?.recipients?' → '+h.detail.recipients.map(p=>esc(p.name)).join(', '):''}</small></p>`).join('')||'<p>Le créateur sera identifié au premier enregistrement sur le serveur.</p>'}</details>`;
  panel.querySelector('[data-share-next]').onclick=()=>{actions?.close();document.getElementById('newReportButton').click();};
  panel.querySelector('[data-share-save]').onclick=()=>{actions?.close();void perform(save);};
  panel.querySelector('[data-share-transfer]').onclick=()=>{actions?.close();void perform(transfer);};
  panel.querySelector('[data-share-validate]').onclick=()=>{actions?.close();void perform(finalize);};
  panel.querySelector('[data-share-reload]').onclick=()=>{actions?.close();void perform(reload);};
  panel.querySelector('[data-share-backup]').onclick=()=>{actions?.close();adapter.backup();};
  panel.querySelector('[data-share-recovery]').onclick=()=>void perform(async()=>{const old=await JournalComposer.read(storeKey()+':before-reload');if(old?.document)adapter.backup(old.document);else notice('Aucune saisie conservée avant actualisation sur cet appareil.');});
  panel.querySelector('[data-share-reload]').hidden=!record;
  for(const k of ['save','transfer','validate'])panel.querySelector('[data-share-'+k+']').disabled=!ready||!!record&&!record.can_edit;
  actions?.restore(view);adapter.numbering(record?.numbering);lock();notice(record?.numbering==='legacy'&&record.state==='draft'?'Ce rapport a déjà été archivé. Utilisez « Créer le rapport suivant » pour une nouvelle séance.':record?.state==='validated'?`Validé par ${record.validated_name} le ${stamp(record.validated_at)}. Le PDF reste accessible ci-dessous.`:record&&!record.can_edit?'Rapport transmis. Les destinataires poursuivent sa saisie.':changed?'Modifications à enregistrer.':record?'Toutes les saisies sont enregistrées sur le serveur.':'Enregistrez ou transférez le rapport pour permettre sa reprise par un collègue.');
  // Keep navigation and exports available for former contributors and validated reports.
  if(record&&!record.can_edit){document.querySelectorAll('.app-main canvas').forEach(c=>c.inert=true);document.querySelector('.app-main').inert=false;document.querySelectorAll('.app-main input,.app-main textarea,.app-main select,.app-main button').forEach(b=>{b.disabled=!(b.hasAttribute('data-scroll-target')||['previousPage','nextPage','printButton','exportButton','archiveSharePointButton','journalDownloadButton','journalResumeButton','journalRefreshButton'].includes(b.id));});}
 }
 async function persist(){if(!owner)return;await JournalComposer.write(storeKey(),{document:adapter.get(),version:record?.version,changed,pending});}
 function apply(doc){adapter.numbering(record?.numbering);applying=true;try{document.querySelectorAll('.app-main input,.app-main textarea,.app-main select,.app-main button').forEach(b=>b.disabled=false);document.querySelectorAll('.app-main canvas').forEach(c=>c.inert=false);adapter.set(doc);}finally{applying=false;}}
 function mutation(){if(!ready||applying||record&&!record.can_edit)return;changed=true;void persist().catch(()=>notice('Sauvegarde locale indisponible. Gardez cette page ouverte et enregistrez sur le serveur.',true));clearTimeout(timer);notice('Saisie conservée sur cet appareil · enregistrement en cours…');if(record&&!problem)timer=setTimeout(()=>void perform(save),1200);}
 async function send(action,payload){pending={action,payload};await persist();const result=await rpc(action,payload);pending=null;return result;}
 async function save(){
  if(!ready)throw new Error('Connectez-vous au journal pour enregistrer ce rapport.');clearTimeout(timer);
  if(pending){
   const oldKey=storeKey(),request=pending,result=await rpc(request.action,request.payload),submitted=request.payload.document;
   if(submitted&&content(adapter.get())!==content(submitted)&&content(result.document)!==content(submitted)){
    remember(result);pending=null;problem=true;await persist();throw new Error('Le rapport partagé a changé pendant la reprise. Sauvegardez votre saisie en fichier, puis actualisez avant de continuer.');
   }
   remember(result);pending=null;
   if(request.action==='transfer'||request.action==='validate'){changed=false;await persist();render();return record;}
   changed=submitted?content(adapter.get())!==content(submitted):changed;
   if(!changed)apply(record.document);else adapter.identity(record.document);
   await persist();if(oldKey!==storeKey())await JournalComposer.write(oldKey,null);render();
  }
  if(problem)throw new Error('Votre saisie est conservée. Sauvegardez-la en fichier puis actualisez le rapport partagé pour comparer les modifications.');
  if(record&&!record.can_edit)throw new Error('Ce rapport a été transféré ou validé.');
  if(record&&!changed&&numbered())return record;
  const oldKey=storeKey(),doc=clean(adapter.get()),id=record?.id||crypto.randomUUID();
  const result=await send(record?'save':'create',{id,request_id:crypto.randomUUID(),...(record?{version:record.version}:{chantier_id:site}),document:doc});
  remember(result);changed=content(adapter.get())!==content(doc);
  if(!changed)apply(record.document);else adapter.identity(record.document);
  await persist();if(oldKey!==storeKey())await JournalComposer.write(oldKey,null);render();if(changed)mutation();return record;
 }
 async function reload(){if(!record&&!initialId)return;if((changed||pending)&&!await adapter.confirm({title:'Actualiser le rapport partagé',message:'Votre saisie actuelle sera conservée dans une sauvegarde sur cet appareil. La version du serveur remplacera les champs affichés. Continuer ?',confirmLabel:'Actualiser'}))return;
  if(changed||pending)await JournalComposer.write(storeKey()+':before-reload',{document:adapter.get(),version:record?.version});
  const r=await rpc('detail',{id:record?.id||initialId});record=r;changed=false;pending=null;problem=false;apply(r.document);await persist();render();
 }
 async function transfer(){await save();
  const people=(await rpc('directory',{chantier_id:site})).filter(p=>p.id!==owner&&p.can_assign);
  const d=document.createElement('dialog');d.className='shared-transfer';d.innerHTML=`<h2>Transférer le rapport journalier</h2><p>Le rapport enregistré sera confié aux personnes sélectionnées. Elles recevront une notification.</p><div>${people.map(p=>`<label><input type="checkbox" value="${p.id}"><span>${esc(p.name)}<small>${esc(p.company||'')}</small></span></label>`).join('')||'<p>Aucun autre contributeur autorisé dans ce chantier.</p>'}</div><p role="status"></p><footer><button data-cancel>Annuler</button><button data-send>Transférer</button></footer>`;document.body.append(d);d.showModal();
  d.querySelector('[data-cancel]').onclick=()=>d.close();d.onclose=()=>d.remove();
  d.querySelector('[data-send]').onclick=async()=>{const users=[...d.querySelectorAll('input:checked')].map(e=>e.value);if(!users.length){d.querySelector('[role=status]').textContent='Choisir au moins une personne.';return;}d.querySelector('[data-send]').disabled=true;
   try{const recovering=pending?.action==='transfer';if(changed||pending)await save();if(recovering){render();notice('Rapport transféré. Les destinataires ont été notifiés.');d.close();return;}record=await send('transfer',{id:record.id,version:record.version,request_id:crypto.randomUUID(),users});changed=false;await persist();render();notice('Rapport transféré. Les destinataires ont été notifiés.');d.close();}catch(e){d.querySelector('[role=status]').textContent=e.message;d.querySelector('[data-send]').disabled=false;}
  };
 }
 async function finalize(){await save();const missing=adapter.checks().filter(c=>!c.ok);if(missing.length)throw new Error(missing.map(c=>c.message).join(' '));if(!await adapter.confirm({title:'Valider définitivement le rapport ?',message:'Le rapport sera figé avec votre nom et la date de validation. Il ne pourra plus être modifié ni transféré. Cette validation ne déclenche aucun envoi externe.',confirmLabel:'Valider définitivement'}))return;
  record=await send('validate',{id:record.id,version:record.version,request_id:crypto.randomUUID(),confirmed:true});changed=false;await persist();render();
 }
 async function perform(fn){if(busy)return;busy=true;lock();operation=(async()=>{try{await fn();}catch(e){if(/participant|version|changé/.test(e.message))problem=true;notice(e.message+' Votre saisie est conservée.',true);}finally{busy=false;operation=null;lock();}})();return operation;}
 async function prepareExport(){
  if(operation)await operation;
  if(busy)throw new Error('Un enregistrement est en cours. Réessayez dans un instant.');
  if(!ready)throw new Error('Une connexion au journal est nécessaire pour confirmer le numéro avant de générer le PDF. Votre saisie reste conservée.');
  busy=true;lock();try{
   if(!record||record.can_edit)await save();
   if(!numbered())throw new Error('Installez la mise à jour du serveur pour attribuer un numéro unique à ce rapport.');
   if(changed||pending)throw new Error('Des modifications restent à enregistrer avant de générer le PDF.');
   return {id:record.id,reportNo:record.document.meta.reportNo,reportUid:record.document.reportUid};
  }finally{busy=false;lock();}
 }
 async function beforeNew(){
  await prepareExport();
  await JournalComposer.write(storeKey()+':before-new',{document:adapter.get(),version:record?.version});
 }
 async function start(a){adapter=a;site=url.searchParams.get('chantierId');panel=document.createElement('section');panel.id='sharedReportPanel';panel.className='shared-report no-print';document.querySelector('.topbar').after(panel);if(!site){panel.textContent='Ouvrez ce rapport depuis un chantier dans Journal de chantier.';return;}
  actions=root.JournalReportActions?.mount(panel);
  client=root.supabase.createClient(JOURNAL_CONFIG.SUPABASE_URL,JOURNAL_CONFIG.SUPABASE_ANON_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
  if(initialId){document.querySelector('.app-main').inert=true;document.getElementById('startupScreen').hidden=true;document.body.classList.add('app-entered');}
  panel.textContent='Connexion au rapport partagé…';notice(panel.textContent);lock();
  try{const result=await client.auth.getUser();if(result.error||!result.data.user)throw new Error('Connectez-vous au journal puis rouvrez le rapport.');owner=result.data.user.id;ready=true;
   const activeId=initialId||localStorage.getItem(activeKey());
   if(activeId){
    const result=await rpc('detail',{id:activeId});if(result.chantier_id!==site)throw new Error('Ce rapport ne correspond pas au chantier demandé.');remember(result);
    const local=await JournalComposer.read(storeKey());
    if(local?.changed||local?.pending){
     // V15.10 could store the next draft under the previous report ID. Keep
     // that payload as a recoverable file, never overwrite the shared report.
     if(!local.pending&&local.document?.reportUid&&local.document.reportUid!==record.document.reportUid){await JournalComposer.write(storeKey()+':before-reload',local);apply(record.document);}
     else{apply(local.document);changed=true;pending=local.pending;problem=local.version!==record.version&&!pending;}
    }else apply(record.document);
   }else{
    adapter.scope(owner,site);const local=await JournalComposer.read(storeKey()),native=adapter.local(owner,site);
    if(local?.document){apply(local.document);changed=!!local.changed;pending=local.pending;}
    else if(native?.schema===1){apply(native);changed=true;}
   }
   render();if(problem)notice('Le rapport partagé a changé. Votre brouillon est affiché et conservé : sauvegardez-le puis actualisez pour comparer.',true);
  }catch(e){ready=false;panel.textContent=e.message;notice(e.message,true);lock();}
  client.auth.onAuthStateChange((_event,session)=>{if(owner&&session?.user?.id!==owner){ready=false;owner=null;clearTimeout(timer);document.querySelector('.app-shell').inert=true;document.querySelectorAll('dialog[open]').forEach(d=>d.close());panel.textContent='Le compte a changé. Rouvrez ce rapport depuis le journal.';notice(panel.textContent,true);actions?.enable(false);}});
  root.addEventListener('journal-report-change',mutation);root.addEventListener('beforeunload',e=>{if(changed||pending){e.preventDefault();e.returnValue='';}});
 }
 function newReport(){if(!ready)return;actions?.close();clearTimeout(timer);record=null;pending=null;problem=false;changed=true;url.searchParams.delete('reportId');history.replaceState(null,'',url);localStorage.removeItem(activeKey());adapter.scope(owner,site);adapter.numbering('pending');document.querySelectorAll('.app-main canvas').forEach(c=>c.inert=false);void persist();document.querySelectorAll('.app-main input,.app-main textarea,.app-main select,.app-main button').forEach(b=>b.disabled=false);render();}
 root.JournalReportCollaboration={start,newReport,change:mutation,prepareExport,beforeNew,reference:()=>record&&({id:record.id,reportNo:record.document.meta.reportNo})};
})(window);
