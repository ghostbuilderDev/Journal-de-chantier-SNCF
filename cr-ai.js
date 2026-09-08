/* Shared Gemini gateway contract used by briefing/index.html. No API key in the client. */
(function(root){
 'use strict';
 const URL='https://script.google.com/macros/s/AKfycbz8O7ZV2kawKNPqv7bv1jML9R8yqrKjlZzop9wE1a8uqLO7i4aiamy_LgNwU5g7VDdP/exec';
 function plain(payload){
  if(!payload.html)return String(payload.text||'').trim();
  // Parse in an inert document; never attach returned HTML or external media.
  const doc=new DOMParser().parseFromString(String(payload.html),'text/html');
  doc.querySelectorAll('script,style,iframe,object,embed,img,svg,math,link,meta').forEach(e=>e.remove());
  doc.querySelectorAll('br').forEach(e=>e.replaceWith(doc.createTextNode('\n')));
  doc.querySelectorAll('li').forEach(e=>{e.prepend(doc.createTextNode('• '));e.append(doc.createTextNode('\n'));});
  doc.querySelectorAll('p,div,h1,h2,h3,h4,ul,ol').forEach(e=>e.append(doc.createTextNode('\n')));
  return doc.body.textContent.replace(/\n{3,}/g,'\n\n').trim();
 }
 async function improve(text,{signal}={}){
  if(!text.trim()||text.length>8000)throw new Error('Texte absent ou trop long.');
  const id='AI-'+crypto.randomUUID(),name='crAi_'+crypto.randomUUID(),frame=document.createElement('iframe'),form=document.createElement('form');
  frame.name=name;frame.hidden=true;form.hidden=true;form.method='POST';form.action=URL;form.target=name;
  // Same text-only request as the briefing; no automatic report, recipients or hours transmitted.
  for(const [key,value]of Object.entries({action:'ai_improve',requestId:id,text})){const field=document.createElement('input');field.name=key;field.value=value;form.append(field);}
  let direct=null;
  const listener=e=>{if(e.source===frame.contentWindow&&/^https:\/\/([a-z0-9-]+\.)?script\.google(?:usercontent)?\.com$/.test(e.origin)&&e.data?.type==='briefing-ai-result'&&e.data.requestId===id)direct=e.data;};
  document.body.append(frame,form);window.addEventListener('message',listener);
  function check(){if(signal?.aborted)throw new Error('Amélioration annulée.');}
  async function poll(ms){return new Promise(resolve=>{
   const cb='crAiCb_'+crypto.randomUUID().replaceAll('-',''),script=document.createElement('script');let done=false;
   const finish=value=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);delete root[cb];script.remove();resolve(value);};
   const abort=()=>finish(null),timer=setTimeout(()=>finish(null),ms);signal?.addEventListener('abort',abort,{once:true});
   root[cb]=finish;script.onerror=()=>finish(null);script.src=URL+'?action=ai_result&requestId='+encodeURIComponent(id)+'&callback='+cb;document.head.append(script);
  });}
  try{
   check();form.submit();const deadline=Date.now()+30000;
   while(Date.now()<deadline){check();const payload=direct||await poll(Math.min(2500,deadline-Date.now()));check();
    if(payload?.ok===false||payload?.state==='failed')throw new Error('Gemini n’a pas pu améliorer le texte.');
    if(payload?.state==='completed'){const result=plain(payload);if(!result)throw new Error('Gemini a renvoyé une réponse vide.');return result;}
    await new Promise(resolve=>setTimeout(resolve,650));
   }
   throw new Error('Gemini n’a pas répondu dans le délai prévu.');
  }finally{window.removeEventListener('message',listener);form.remove();frame.remove();}
 }
 root.JournalCRAI={improve,plain};
})(window);
