/* Match an attendance receipt to an existing row. Never guess between homonyms. */
(function(root){
 'use strict';
 const normalize=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
  .toLocaleUpperCase('fr-FR').replace(/Œ/g,'OE').replace(/Æ/g,'AE').replace(/[\s'’ʼ‐‑–—-]+/g,'');
 const sameName=(a,b)=>Boolean(normalize(a.nom)&&normalize(a.prenom))&&
  normalize(a.nom)===normalize(b.nom)&&normalize(a.prenom)===normalize(b.prenom);
 function classify(people,receipt){
  const matches=people.filter(p=>sameName(p,receipt));
  if(matches.length===1&&!matches[0].signature)return {kind:'attach',participantId:matches[0].local_id};
  return {kind:matches.length>1?'homonyms':matches.length===1?'signed':'unknown',candidates:matches.map(p=>p.local_id)};
 }
 const api={normalize,sameName,classify};
 if(typeof module==='object'&&module.exports)module.exports=api;else root.BriefingPresenceMatching=Object.freeze(api);
})(globalThis);
