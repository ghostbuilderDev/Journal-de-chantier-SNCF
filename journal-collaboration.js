/* V15.10. Targeted in-app alerts; no modal and no automatic navigation. */
(function(root){'use strict';
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function create({open}){let user=null,host=null,seen=new Set();const timers=new Set();
  function reset(next){user=next;host?.remove();host=null;timers.forEach(clearTimeout);timers.clear();try{seen=new Set(JSON.parse(sessionStorage.getItem('journal-alerts-v1510:'+user)||'[]'));}catch{seen=new Set();}}
  function update(id,items,sites){if(user!==id)reset(id);if(!id||document.visibilityState==='hidden')return;
   if(!host){host=document.createElement('aside');host.className='journal-targeted-alerts';host.setAttribute('aria-live','polite');host.setAttribute('aria-label','Notifications personnelles');document.body.append(host);}
   for(const n of items.filter(n=>!n.read_at&&(n.is_mention||n.kind==='daily_report')).slice(0,3).reverse()){
    if(seen.has(n.id))continue;seen.add(n.id);try{sessionStorage.setItem('journal-alerts-v1510:'+user,JSON.stringify([...seen].slice(-300)));}catch{}
    const card=document.createElement('article');card.innerHTML=`<button class="targeted-open"><b>${esc(n.title)}</b><span>${esc(n.actor_name||'Un collègue')} · ${esc(sites.find(s=>s.id===n.chantier_id)?.name||'Chantier')}</span><small>${esc(n.excerpt||'')}</small><strong>${n.kind==='daily_report'?'Ouvrir le rapport':'Voir le message'} →</strong></button><button class="targeted-dismiss" aria-label="Masquer cette notification">×</button>`;
    card.querySelector('.targeted-dismiss').onclick=()=>card.remove();card.querySelector('.targeted-open').onclick=async()=>{const current=user;await open(n.id);if(user===current)card.remove();};host.append(card);
    const t=setTimeout(()=>{card.remove();timers.delete(t);},12000);timers.add(t);
   }
  }
  return{update,reset};
 }
 // A signal contains no report, message or signature. The inbox RPC still checks
 // the current user's access before revealing the corresponding notification.
 function watch({client,user,onChange}){
  let channel=null,stopped=false,timer=null;
  const schedule=()=>{if(stopped)return;clearTimeout(timer);timer=setTimeout(()=>{if(!stopped)onChange();},80);};
  if(client?.channel&&user){
   try{channel=client.channel('journal-personal-alerts:'+user)
    .on('postgres_changes',{event:'*',schema:'public',table:'journal_notification_signals',filter:'user_id=eq.'+user},schedule)
    .subscribe(status=>{if(status==='SUBSCRIBED')schedule();});
   }catch{ /* The existing inbox poll remains available if Realtime is offline. */ }
  }
  return()=>{stopped=true;clearTimeout(timer);if(channel)void Promise.resolve(client.removeChannel(channel)).catch(()=>{});};
 }
 root.JournalTargetedAlerts={create,watch};
})(window);
