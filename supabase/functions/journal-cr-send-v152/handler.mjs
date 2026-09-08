import {emailMarkup} from './markup.mjs';
// Only the stored, validated snapshot and its stored audience can be sent.
export function createHandler({env,rpc,fetcher=fetch}) {
 const allowed='https://ghostbuilderdev.github.io';
 return async request => {
  const origin=request.headers.get('origin');
  const headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin',
   'Access-Control-Allow-Origin':allowed,'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info',
   'Access-Control-Allow-Methods':'POST,OPTIONS'};
  const reply=(status,value)=>new Response(JSON.stringify(value),{status,headers});
  if(origin && origin!==allowed)return reply(403,{error:'Origine refusée.'});
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(request.method!=='POST')return reply(405,{error:'Méthode refusée.'});
  const token=request.headers.get('Authorization');
  if(!/^Bearer \S+$/i.test(token||''))return reply(401,{error:'Connexion requise.'});
  let input;
  try { const text=await request.text();if(text.length>4096)throw 0;input=JSON.parse(text); }
  catch{return reply(400,{error:'Demande invalide.'});}
  if(!env.RESEND_API_KEY || !env.JOURNAL_CR_FROM)return reply(503,{error:'Envoi email à configurer : adresse expéditrice vérifiée et clé Resend dans Supabase. Le CR reste enregistré.'});
  if(!Array.isArray(input.ids)||input.ids.length<1||input.ids.length>20||input.ids.some(x=>!/^[-0-9a-f]{36}$/i.test(x)))return reply(400,{error:'CR invalides.'});
  let delivery;
  try {delivery=await rpc('journal_cr_api',{p_action:'prepare_send',p_payload:{ids:input.ids}},token);}
  catch{return reply(403,{error:'Envoi refusé : vérifier les droits, les versions validées et les destinataires identiques.'});}
  if(delivery.state==='sent')return reply(200,{id:delivery.id,state:'sent'});
  let sent;
  try {
   const response=await fetcher('https://api.resend.com/emails',{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),
    headers:{'Authorization':`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`journal-cr-${delivery.id}`},
    body:JSON.stringify({from:env.JOURNAL_CR_FROM,to:delivery.recipients,subject:delivery.subject,text:delivery.body,html:emailMarkup(delivery.body)})});
   if(!response.ok){
    await rpc('journal_cr_delivery_finish',{p_id:delivery.id,p_state:response.status>=500?'uncertain':'failed',p_provider_id:null});
    return reply(502,{error:'Le service email n’a pas confirmé l’envoi. Réessayer depuis ce CR ; la même référence évite les doubles envois pendant 23 heures.'});
   }
   sent=await response.json();if(!sent?.id)throw new Error('missing_id');
  }catch{
   try{await rpc('journal_cr_delivery_finish',{p_id:delivery.id,p_state:'uncertain',p_provider_id:null});}catch{}
   return reply(502,{error:'Résultat de l’envoi incertain. Vérifier la réception ou réessayer dans les 23 heures avec ce même CR.'});
  }
  try {await rpc('journal_cr_delivery_finish',{p_id:delivery.id,p_state:'sent',p_provider_id:sent.id});}
  catch{return reply(502,{error:'Email accepté, confirmation locale en attente. Réessayer le même envoi dans les 23 heures pour synchroniser son statut.'});}
  return reply(200,{id:delivery.id,state:'sent',accepted:true});
 };
}
