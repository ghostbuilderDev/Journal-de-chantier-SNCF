/* Automatic attendance: normalized name + first name + company, newest receipt wins. */
(function(root){
 'use strict';
 const normalize=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
  .toLocaleUpperCase('fr-FR').replace(/Œ/g,'OE').replace(/Æ/g,'AE').replace(/[^\p{L}\p{N}]/gu,'');
 const sameName=(a,b)=>Boolean(normalize(a.nom)&&normalize(a.prenom))&&
  normalize(a.nom)===normalize(b.nom)&&normalize(a.prenom)===normalize(b.prenom);
 function classify(people,receipt){
  const names=people.filter(p=>sameName(p,receipt)),company=normalize(receipt.entreprise);
  let matches=names.filter(p=>normalize(p.entreprise)===company);
  // A sole saved name with a missing company is a reusable preparation row.
  if(!matches.length&&names.length===1&&(!company||!normalize(names[0].entreprise)))matches=names;
  return matches.length?{kind:'attach',participantId:matches[0].local_id,duplicates:matches.slice(1).map(p=>p.local_id)}:{kind:'add'};
 }
 function time(value){
  const ms=Date.parse(value);if(!Number.isFinite(ms))return 0n;
  const fraction=String(value).match(/\.(\d+)(?:Z|[+-]\d\d:?\d\d)$/i)?.[1]||'';
  return BigInt(ms)*1000000n+BigInt((fraction.slice(3)+'000000').slice(0,6));
 }
 function compareReceipts(a,b){
  const ta=time(a.created_at),tb=time(b.created_at);
  if(ta!==tb)return ta<tb?-1:1;
  const ai=String(a.id||''),bi=String(b.id||'');return ai===bi?0:ai<bi?-1:1;
 }
 function merge(people,receipts,{sessionId,ignoredIds=[],createId=()=>crypto.randomUUID()}={}){
  let participants=people.map(p=>({...p})),handled=new Set(ignoredIds),events=[];
  const linked=new Set(participants.map(p=>p.remote_id).filter(Boolean)),valid=new Map();
  for(const p of receipts){
   if(p?.id&&p.session_id===sessionId&&/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(p.signature||''))valid.set(p.id,p);
  }
  for(const p of [...valid.values()].sort(compareReceipts)){
   if(handled.has(p.id)||linked.has(p.id))continue;
   const decision=classify(participants,p),target=participants.find(x=>x.local_id===decision.participantId);
   let canonical=target||{local_id:createId(),nom:p.nom,prenom:p.prenom},chosen=p;
   const ids=new Set([canonical.local_id,...(decision.duplicates||[])]);
   const matches=participants.filter(x=>ids.has(x.local_id));
   for(const old of matches){
    if(old.remote_id)handled.add(old.remote_id);
    // An older batch or a retry must never restore an obsolete signature.
    if(old.signature&&old.remote_session===sessionId&&old.signed_at){
     const prior={...old,id:old.remote_id,session_id:old.remote_session,created_at:old.signed_at};
     if(compareReceipts(prior,chosen)>0)chosen=prior;
    }
   }
   canonical={...canonical,nom:String(canonical.nom||chosen.nom||'').toLocaleUpperCase('fr-FR'),
    prenom:canonical.prenom||chosen.prenom,entreprise:String(chosen.entreprise||canonical.entreprise||'').toLocaleUpperCase('fr-FR'),
    fonction:chosen.fonction||canonical.fonction||'',signature:chosen.signature,
    remote_id:chosen.id,remote_session:sessionId,signed_at:chosen.created_at};
   if(target)participants=participants.filter(x=>!ids.has(x.local_id)||x.local_id===canonical.local_id).map(x=>x.local_id===canonical.local_id?canonical:x);
   else participants.push(canonical);
   handled.add(p.id);linked.add(chosen.id);
   events.push({receipt_id:p.id,session_id:sessionId,participant_id:canonical.local_id,
    merged_ids:decision.duplicates||[],action:target?'auto_attach':'auto_add'});
  }
  return {participants,handledIds:[...handled],consumedIds:[...valid.keys()],events};
 }
 const api={normalize,sameName,classify,compareReceipts,merge};
 if(typeof module==='object'&&module.exports)module.exports=api;else root.BriefingPresenceMatching=Object.freeze(api);
})(globalThis);
