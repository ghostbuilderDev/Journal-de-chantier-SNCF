(()=>{
 'use strict';const token=location.hash.slice(1),$=id=>document.getElementById(id);let client=null,loading=false,currentId=null;
 function hide(text){$('displayQr').hidden=true;$('displayQr').replaceChildren();$('displayHelp').hidden=true;$('displayNotice').textContent=text;}
 async function refresh(){
  if(loading)return;loading=true;
  try{if(!/^[a-f0-9]{64}$/.test(token))throw new Error('Ouvrez le lien partagé par l’encadrant pour cette séance.');if(!client){const c=window.JOURNAL_CONFIG;if(!c||!window.supabase)throw new Error('Connexion indisponible. Réessayez avec Internet.');client=supabase.createClient(c.SUPABASE_URL,c.SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});}
   const {data,error}=await client.rpc('journal_briefing_sign',{p_token:token,p_action:'context',p_payload:{}}).abortSignal(AbortSignal.timeout(15000));if(error)throw error;
   if(currentId&&data.id!==currentId)throw new Error('Le briefing a changé. Ouvrez le nouveau lien partagé.');currentId=data.id;
   $('displaySite').textContent=data.chantier;$('displayDate').textContent=new Date(data.date+'T12:00:00').toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long',year:'numeric'});$('displaySession').textContent='Séance '+data.id.slice(0,8);
   if(!data.open){hide('Émargement fermé. Pour le prochain briefing, ouvrez le nouveau lien partagé par l’encadrant.');return;}
   $('displayQr').innerHTML=BriefingQRShare.svg(BriefingQRShare.links(token).sign);$('displayQr').hidden=false;$('displayHelp').hidden=false;$('displayNotice').textContent='Émargement ouvert · vérifiez le chantier et la date avant de signer.';
  }catch(e){hide(e.message||'Impossible de vérifier la séance. Actualisez avec une connexion Internet.');}finally{loading=false;}
 }
 $('displayRefresh').onclick=refresh;$('displayFullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch(_){$('displayNotice').textContent='Utilisez le zoom de la tablette pour agrandir l’affichage.';}};
 document.addEventListener('fullscreenchange',()=>{$('displayFullscreen').textContent=document.fullscreenElement?'Quitter le plein écran':'Plein écran';});document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh();});window.addEventListener('online',refresh);window.addEventListener('hashchange',()=>location.reload());
 setInterval(()=>{if(!document.hidden)void refresh();},5000);void refresh();
})();
