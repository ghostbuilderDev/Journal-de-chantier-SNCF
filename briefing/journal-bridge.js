/* Connexion au journal : aucun jeton de connexion dans les messages. */
(() => {
 'use strict';
 const query = new URLSearchParams(location.search);
 const token = query.get('journal_session');
 if (!token || window.parent === window) return;
 let origin;
 try { origin = new URL(query.get('journal_origin')).origin; } catch { return; }
 let context = null, pending = new Map();
 window.addEventListener('message', event => {
  if (event.source !== parent || event.origin !== origin || event.data?.token !== token) return;
  const data = event.data;
  if (data.type === 'journal-context') {
   context = data.chantier;
   const saveButton = document.querySelector('[onclick="saveBriefingPdf()"]');
   if (saveButton) {
    saveButton.textContent = 'Enregistrer · Journal et SharePoint';
    if (saveButton.nextElementSibling) saveButton.nextElementSibling.textContent = 'Le PDF signé est classé dans le fil et les archives de ce chantier avant l’envoi SharePoint. En cas d’erreur, gardez cette page ouverte et réessayez.';
   }
   const preset = document.getElementById('chantierPreset'), other = document.getElementById('chantierAutre');
   if (preset && other) {
    preset.value = '__autre__'; other.value = context.name;
    window.syncChantierSelection?.(); preset.disabled = true; other.readOnly = true;
   }
   const banner = document.createElement('p');
   banner.textContent = 'Journal de ' + context.name + ' · Fil d’actualité et Sécurité / Briefings';
   banner.style.cssText = 'padding:12px;background:#e8f4ef;color:#163f32;font:15px sans-serif';
   document.body.prepend(banner);
  }
  if (data.type === 'journal-saved' && pending.has(data.id)) {
   const p = pending.get(data.id); clearTimeout(p.timer); pending.delete(data.id);
   data.ok ? p.resolve(data) : p.reject(new Error(data.error || 'Enregistrement journal impossible.'));
  }
 });
 parent.postMessage({type:'briefing-ready',token}, origin);
 window.JournalBriefingArchive = {
  save(pdf, id) {
   if (!context) return Promise.reject(new Error('Liaison avec le journal indisponible. Rouvrez le briefing depuis le chantier.'));
   if (pdf.meta?.chantier !== context.name) return Promise.reject(new Error('Le chantier du PDF ne correspond pas au journal. Vérifiez les informations chantier.'));
   return new Promise((resolve,reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Confirmation du journal non reçue. Gardez cette page ouverte et réessayez.')); }, 90000);
    pending.set(id,{resolve,reject,timer});
    parent.postMessage({type:'briefing-save',token,id,blob:pdf.blob,filename:pdf.filename},origin);
   });
  }
 };
})();
