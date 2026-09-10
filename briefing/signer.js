(() => {
 'use strict';
 const token=location.hash.slice(1),form=document.getElementById('signForm'),button=document.getElementById('signSubmit'),notice=document.getElementById('signNotice');
 // Retain the original receipt key: updating the PWA must not submit a second signature.
 const key='journal-briefing-sign-v158:'+token,draftKey=key+':draft';
 let pending=null,busy=false,session=null,client=null;
 const pad=BriefingSignaturePad.create(saveDraft);
 const uppercase=value=>String(value||'').toLocaleUpperCase('fr-FR');
 function message(text,error=false){notice.textContent=text;notice.className=error?'sign-error':'';}
 function keep(){try{sessionStorage.setItem(key,JSON.stringify(pending));}catch{}}
 function normalize(input){
  const start=input.selectionStart,end=input.selectionEnd,old=input.value,value=uppercase(old);
  input.value=value;input.setCustomValidity(value.length>120?'120 caractères maximum.':'');
  if(start!==null&&document.activeElement===input)input.setSelectionRange(uppercase(old.slice(0,start)).length,uppercase(old.slice(0,end)).length);
 }
 function values(){return Object.fromEntries(new FormData(form));}
 function saveDraft(){
  if(pending?.payload||pending?.confirmed)return;
  try{sessionStorage.setItem(draftKey,JSON.stringify({values:values(),signature:pad.state()}));}catch{}
 }
 for(const name of ['nom','entreprise']){
  const field=form.elements[name];field.addEventListener('input',e=>{if(!e.isComposing)normalize(field);saveDraft();});field.addEventListener('compositionend',()=>{normalize(field);saveDraft();});field.addEventListener('blur',()=>normalize(field));
 }
 form.addEventListener('input',saveDraft);
 function setValues(data,readonly=false){for(const name of ['nom','prenom','fonction','entreprise']){const input=form.elements[name];input.value=['nom','entreprise'].includes(name)?uppercase(data?.[name]):String(data?.[name]||'');input.readOnly=readonly;}}
 function lock(value){form.querySelectorAll('input').forEach(n=>n.readOnly=value);pad.lock(value);}
 async function rpc(action,payload={}){
  if(!client)throw new Error('Connexion indisponible. Rouvrez le lien avec une connexion Internet.');
  const call=client.rpc('journal_briefing_sign',{p_token:token,p_action:action,p_payload:payload});
  const r=await(typeof call.abortSignal==='function'?call.abortSignal(AbortSignal.timeout(20000)):call);if(r.error)throw r.error;return r.data;
 }
 function received(){pending={id:pending.id,confirmed:true};keep();try{sessionStorage.removeItem(draftKey);}catch{}form.hidden=true;document.getElementById('signSuccess').hidden=false;document.getElementById('signAnother').hidden=!session?.open;message('');}
 async function send(event){
  event.preventDefault();if(busy)return;
  if(!pending?.payload){
   for(const name of ['nom','entreprise'])normalize(form.elements[name]);
   if(!form.reportValidity())return;
   if(pad.hasDraft()||!pad.value()){message('Ouvrez la zone de signature, puis appuyez sur « Valider la signature ».',true);void pad.open();return;}
   pending={id:crypto.randomUUID(),payload:{...values(),signature:pad.value()}};pending.payload.id=pending.id;keep();
  }
  busy=true;button.disabled=true;lock(true);message('Transmission de votre signature…');
  try{const result=await rpc('submit',pending.payload);if(!result?.received||result.id!==pending.id)throw new Error('Confirmation non reçue.');received();}
  catch(error){
   if(error.code==='P0001'&&/champ|PNG|Signature invalide|Dimensions/.test(error.message||'')){pending=null;keep();lock(false);saveDraft();message(error.message,true);button.textContent='Valider ma participation';}
   else{message((error.message||'Connexion interrompue.')+' Votre saisie est conservée. Réessayez pour vérifier la réception.',true);button.textContent='Réessayer la validation';}
  }finally{busy=false;button.disabled=false;}
 }
 form.addEventListener('submit',send);
 // The keyboard never submits the attendance accidentally.
 form.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.matches('input'))e.preventDefault();});
 document.getElementById('signAnother').onclick=()=>{
  pending=null;try{sessionStorage.removeItem(key);sessionStorage.removeItem(draftKey);}catch{}
  form.reset();for(const input of form.elements)input.setCustomValidity?.('');pad.reset();lock(false);button.textContent='Valider ma participation';document.getElementById('signSuccess').hidden=true;form.hidden=false;message('');
 };
 const fullscreen=document.getElementById('signFullscreen');
 if(document.fullscreenEnabled&&document.documentElement.requestFullscreen){
  fullscreen.hidden=false;
  fullscreen.onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{message('Le plein écran n’est pas disponible ici. Vous pouvez continuer à signer.');}};
  document.addEventListener('fullscreenchange',()=>{fullscreen.textContent=document.fullscreenElement?'Quitter le plein écran':'Plein écran';});
 }
 (async()=>{
  if(!/^[a-f0-9]{64}$/.test(token))throw new Error('Scannez le QR code affiché par l’encadrant pour ouvrir le bon briefing.');
  if(window.supabase&&window.JOURNAL_CONFIG?.SUPABASE_URL&&window.JOURNAL_CONFIG?.SUPABASE_ANON_KEY)client=window.supabase.createClient(window.JOURNAL_CONFIG.SUPABASE_URL,window.JOURNAL_CONFIG.SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  session=await rpc('context');document.getElementById('signSession').textContent=session.chantier+' · '+new Date(session.date+'T12:00:00').toLocaleDateString('fr-FR');
  try{pending=JSON.parse(sessionStorage.getItem(key)||'null');}catch{}
  if(pending?.confirmed){received();return;}
  if(!session.open&&!pending?.payload)throw new Error('Cette séance n’accepte plus de signature. Demandez le QR code de la séance en cours à l’encadrant.');
  form.hidden=false;message('');
  if(pending?.payload){setValues(pending.payload,true);pad.restore({accepted:pending.payload.signature});pad.lock(true);button.textContent='Réessayer la validation';message('Une validation attend sa confirmation. Réessayez pour vérifier sa réception.');}
  else{let draft;try{draft=JSON.parse(sessionStorage.getItem(draftKey)||'null');}catch{}if(draft){setValues(draft.values);pad.restore(draft.signature);message('Votre saisie en cours a été conservée.');}}
 })().catch(error=>message(error.message||'Séance inaccessible. Réessayez avec une connexion Internet.',true));
})();
