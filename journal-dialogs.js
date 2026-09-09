/* Branded, accessible confirmations. Never auto-accept a destructive action. */
(function(root){
 'use strict';let sequence=0;
 function ask(message,{kind='confirm',title='',value='',accept='Confirmer'}={}){
  return new Promise(resolve=>{
   const focus=document.activeElement,id='journalDecision'+(++sequence),d=document.createElement('dialog');
   d.className='journal-decision';d.setAttribute('aria-labelledby',id);
   const heading=document.createElement('h2');heading.id=id;heading.textContent=title||message;d.append(heading);
   if(title){const text=document.createElement('p');text.textContent=message;d.append(text);}
   let input;if(kind==='prompt'){input=document.createElement('textarea');input.rows=3;input.value=value;input.setAttribute('aria-label',message);d.append(input);}
   const foot=document.createElement('footer');d.append(foot);
   const finish=result=>{d.close();d.remove();if(focus?.isConnected)focus.focus();resolve(result);};
   if(kind!=='alert'){const cancel=document.createElement('button');cancel.className='secondary-button';cancel.textContent='Annuler';cancel.onclick=()=>finish(kind==='prompt'?null:false);foot.append(cancel);}
   const ok=document.createElement('button');ok.className='primary-button';ok.textContent=kind==='alert'?'Fermer':accept;ok.onclick=()=>finish(kind==='prompt'?input.value:true);foot.append(ok);
   d.addEventListener('cancel',e=>{e.preventDefault();finish(kind==='prompt'?null:false);});
   document.body.append(d);d.showModal();(input||foot.firstElementChild).focus();
  });
 }
 root.JournalDialogs={confirm:(message,options)=>ask(message,options),prompt:(message,value='')=>ask(message,{kind:'prompt',value}),alert:message=>ask(message,{kind:'alert'})};
})(window);
