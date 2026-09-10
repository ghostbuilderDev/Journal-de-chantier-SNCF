/* Le parent seul écrit dans Supabase. Le chantier et l’auteur sont figés à l’ouverture. */
window.JournalBriefing = {
 open(adapter) {
  const context = adapter.context();
  if (!context.ready || !context.userId || !context.chantier) return adapter.toast('Connectez-vous et ouvrez un chantier avant de lancer le briefing.', 'warning');
  const site = {...context.chantier}, owner = context.userId, db = context.db;
  const token = crypto.randomUUID();
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;background:white;display:flex;flex-direction:column';
  const bar = document.createElement('div');
  bar.style.cssText = 'padding:10px;display:flex;align-items:center;gap:12px;background:#173a50;color:white';
  const close = document.createElement('button'); close.textContent = 'Retour au journal';
  const label = document.createElement('span'); label.textContent = 'Briefing · ' + site.name;
  bar.append(close,label);
  const frame = document.createElement('iframe');
  frame.allow = 'web-share; clipboard-write; fullscreen';
  frame.title = 'Briefing du chantier ' + site.name;
  frame.style.cssText = 'width:100%;flex:1;border:0';
  const target = new URL('./briefing/index.html', location.href);
  target.searchParams.set('journal_session', token); target.searchParams.set('journal_origin', location.origin);
  frame.src = target.href;
  overlay.append(bar,frame);
  let busy = false;
  const results = new Map(), uploads = new Set();
  function valid() { const c = adapter.context(); return c.ready && c.userId === owner && c.db === db; }
  function reply(id, result) { frame.contentWindow?.postMessage({type:'journal-saved',token,id,...result},target.origin); }
  async function receive(event) {
   if (event.source !== frame.contentWindow || event.origin !== target.origin || event.data?.token !== token) return;
   const data = event.data;
   if (data.type === 'briefing-ready') {
    if (!valid()) return;
    frame.contentWindow.postMessage({type:'journal-context',token,userId:owner,chantier:{id:site.id,name:site.name}},target.origin);
    return;
   }
   if(data.type==='briefing-attendance'){
    const respond=result=>frame.contentWindow?.postMessage({type:'journal-attendance-result',token,id:data.id,...result},target.origin);
    if(!valid())return respond({ok:false,error:'Session du journal expirée. Reconnectez-vous.'});
    if(!['open','poll','close'].includes(data.action)||JSON.stringify(data.payload||{}).length>8000)return respond({ok:false,error:'Demande invalide.'});
    try{
     const response=await db.rpc('journal_briefing_manage',{p_action:data.action,p_payload:{...data.payload,chantier_id:site.id}});
     if(response.error)throw response.error;
     if(!valid())throw new Error('Le compte du journal a changé.');
     respond({ok:true,data:response.data});
    }catch(error){respond({ok:false,error:/journal_briefing_manage|schema cache/.test(error.message||'')?'Installer la mise à jour V15.8 du serveur pour activer les signatures QR.':error.message||'Émargement indisponible.'});}
    return;
   }
   if (data.type !== 'briefing-save') return;
   if (!valid()) return reply(data.id,{ok:false,error:'Session du journal expirée ou compte changé. Reconnectez-vous au même compte.'});
   if (busy) return;
   if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.id || '')) return;
   if (results.has(data.id)) return reply(data.id, results.get(data.id));
   busy = true; close.disabled = true;
   try {
    const blob = data.blob;
    if (!(blob instanceof Blob) || blob.type !== 'application/pdf' || blob.size < 5 || blob.size > 48*1024*1024 || await blob.slice(0,5).text() !== '%PDF-') throw new Error('PDF absent, invalide ou supérieur à 48 Mo.');
    if (!valid()) throw new Error('Session du journal interrompue.');
    const filename = String(data.filename || 'Briefing.pdf').replace(/[\x00-\x1f/\\]/g,'_').slice(0,176).replace(/\.pdf$/i,'') + '.pdf';
    const path = `documents/${site.id}/${data.id}/briefing-${owner}.pdf`;
    if (!uploads.has(data.id)) {
     const result = await db.storage.from('chantier-documents').upload(path,blob,{contentType:'application/pdf',upsert:false});
     // A lost upload response may leave the object present. Never overwrite it.
     if (result.error && !['409','Duplicate','ResourceAlreadyExists'].includes(String(result.error.statusCode || result.error.code))) throw result.error;
     uploads.add(data.id);
    }
    if (!valid()) throw new Error('Session du journal interrompue.');
    const result = await db.rpc('journal_archive_briefing',{p_id:data.id,p_chantier_id:site.id,p_filename:filename,p_bytes:blob.size});
    if (result.error) throw result.error;
    if (!result.data?.archived) throw new Error('Le journal n’a pas confirmé l’archivage.');
    const saved = {ok:true,...result.data}; results.set(data.id,saved); reply(data.id,saved);
    label.textContent = 'Briefing enregistré · ' + site.name;
    Promise.resolve(adapter.refresh()).catch(() => {});
   } catch (error) {
    const raw = String(error?.message || '');
    const message = /journal_archive_briefing|schema cache/.test(raw) ? 'La mise à jour des archives doit être installée dans Supabase. Le briefing reste ouvert.' : 'Enregistrement non confirmé : ' + (raw || 'vérifiez la connexion puis réessayez.');
    reply(data.id,{ok:false,error:message});
   } finally { busy = false; close.disabled = false; }
  }
  window.addEventListener('message', receive);
  close.onclick = async () => {
   if (busy || !(await JournalDialogs.confirm('Revenir au journal ? Enregistrez le briefing avant de fermer cette page.'))) return;
   window.removeEventListener('message', receive); overlay.remove();
  };
  document.body.append(overlay);
 }
};
