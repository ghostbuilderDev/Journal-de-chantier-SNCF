(()=>{
 'use strict';
 const token=location.hash.slice(1),form=document.getElementById('signForm'),canvas=document.getElementById('signCanvas'),button=document.getElementById('signSubmit'),notice=document.getElementById('signNotice');
 const key='journal-briefing-sign-v158:'+token;let pending=null,drawing=false,points=0,busy=false,session=null;
 const ctx=canvas.getContext('2d');ctx.lineWidth=4;ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle='#172d3b';
 let client=null;
 function message(text,error=false){notice.textContent=text;notice.className=error?'sign-error':'';}
 function keep(){try{sessionStorage.setItem(key,JSON.stringify(pending));}catch(_){}}
 function position(e){const r=canvas.getBoundingClientRect();return{x:(e.clientX-r.left)*canvas.width/r.width,y:(e.clientY-r.top)*canvas.height/r.height};}
 canvas.addEventListener('pointerdown',e=>{if(busy||pending?.payload)return;e.preventDefault();canvas.setPointerCapture(e.pointerId);drawing=true;const p=position(e);ctx.beginPath();ctx.moveTo(p.x,p.y);});
 canvas.addEventListener('pointermove',e=>{if(!drawing)return;e.preventDefault();const p=position(e);ctx.lineTo(p.x,p.y);ctx.stroke();points++;});
 for(const name of ['pointerup','pointercancel'])canvas.addEventListener(name,()=>drawing=false);
 document.getElementById('signClear').onclick=()=>{if(busy||pending?.payload)return;ctx.clearRect(0,0,canvas.width,canvas.height);points=0;};
 async function rpc(action,payload={}){if(!client)throw new Error('Connexion indisponible. Rouvrez le lien avec une connexion Internet.');const call=client.rpc('journal_briefing_sign',{p_token:token,p_action:action,p_payload:payload});const r=await(typeof call.abortSignal==='function'?call.abortSignal(AbortSignal.timeout(20000)):call);if(r.error)throw r.error;return r.data;}
 function received(){pending.confirmed=true;keep();form.hidden=true;document.getElementById('signSuccess').hidden=false;document.getElementById('signAnother').hidden=!session?.open;message('');}
 async function send(event){
  event.preventDefault();if(busy)return;
  if(!pending?.payload){if(!form.reportValidity())return;if(points<3)return message('Ajoutez votre signature avant de valider.',true);
   const values=Object.fromEntries(new FormData(form));pending={id:pending?.id||crypto.randomUUID(),payload:{...values,signature:canvas.toDataURL('image/png')}};pending.payload.id=pending.id;keep();
  }
  busy=true;button.disabled=true;form.querySelectorAll('input').forEach(n=>n.readOnly=true);message('Transmission de votre signature…');
  try{const result=await rpc('submit',pending.payload);if(!result?.received||result.id!==pending.id)throw new Error('Confirmation non reçue.');received();}
  catch(error){
   if(error.code==='P0001'&&/champ|PNG|Signature invalide|Dimensions/.test(error.message||'')){pending=null;keep();form.querySelectorAll('input').forEach(n=>n.readOnly=false);message(error.message,true);button.textContent='Valider ma signature';}
   else{message((error.message||'Connexion interrompue.')+' Votre saisie est conservée. Réessayez pour vérifier la réception.',true);button.textContent='Réessayer la validation';}
  }
  finally{busy=false;button.disabled=false;}
 }
 form.addEventListener('submit',send);
 document.getElementById('signAnother').onclick=()=>{pending=null;sessionStorage.removeItem(key);form.reset();points=0;ctx.clearRect(0,0,canvas.width,canvas.height);form.querySelectorAll('input').forEach(n=>n.readOnly=false);button.textContent='Valider ma signature';document.getElementById('signSuccess').hidden=true;form.hidden=false;};
 (async()=>{
  if(!/^[a-f0-9]{64}$/.test(token))throw new Error('Scannez le QR code affiché par l’encadrant pour ouvrir le bon briefing.');
  if(window.supabase&&window.JOURNAL_CONFIG?.SUPABASE_URL&&window.JOURNAL_CONFIG?.SUPABASE_ANON_KEY)client=window.supabase.createClient(window.JOURNAL_CONFIG.SUPABASE_URL,window.JOURNAL_CONFIG.SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  session=await rpc('context');document.getElementById('signSession').textContent=session.chantier+' · '+new Date(session.date+'T12:00:00').toLocaleDateString('fr-FR');
  try{pending=JSON.parse(sessionStorage.getItem(key)||'null');}catch(_){}
  if(pending?.confirmed){received();return;}
  if(!session.open&&!pending?.payload)throw new Error('Cette séance n’accepte plus de signature. Demandez le QR code de la séance en cours à l’encadrant.');
  form.hidden=false;message('');
  if(pending?.payload){for(const name of ['nom','prenom','fonction','entreprise']){form.elements[name].value=pending.payload[name];form.elements[name].readOnly=true;}const img=new Image();img.onload=()=>{ctx.drawImage(img,0,0);points=3;};img.src=pending.payload.signature;button.textContent='Réessayer la validation';message('Une validation attend sa confirmation. Réessayez pour vérifier sa réception.');}
 })().catch(error=>message(error.message||'Séance inaccessible. Réessayez avec une connexion Internet.',true));
})();
