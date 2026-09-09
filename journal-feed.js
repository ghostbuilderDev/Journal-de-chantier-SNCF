(function(root){
 'use strict';
 function project(messages,actions,links){
  const groups=new Map(),hidden=new Set(),byId=new Map(messages.map(m=>[String(m.id),m]));
  const linkedByMessage=new Map(),byAction=new Map(),replies=new Map();
  for(const message of messages){
   const linked=links(message);linkedByMessage.set(String(message.id),linked);
   if(!message.deleted_at)for(const action of linked){const key=String(action.id),list=byAction.get(key)||[];list.push(message);byAction.set(key,list);}
   if(message.reply_to&&!message.deleted_at){const key=String(message.reply_to),list=replies.get(key)||[];list.push(message);replies.set(key,list);}
  }
  const complete=actions.filter(a=>a.status==='terminee');
  for(const action of complete){
   const history=[...(byAction.get(String(action.id))||[])];
   if(!history.length)continue;
   // Include replies, even when they do not carry action_id, without deleting them.
   const ids=new Set(history.map(m=>String(m.id)));
   for(let i=0;i<history.length;i++)for(const m of replies.get(String(history[i].id))||[])if(!ids.has(String(m.id))){ids.add(String(m.id));history.push(m);}
   history.sort((a,b)=>new Date(a.created_at)-new Date(b.created_at)||String(a.id).localeCompare(String(b.id)));
   const proof=byId.get(String(action.proof_message_id)),last=proof||history[history.length-1];
   const at=action.closed_at||proof?.created_at||last.created_at;
   const card={...last,id:proof?.id||'completed-'+action.id,created_at:at,body:action.close_note||last.body,_completedAction:action,_history:history};
   groups.set(String(action.id),card);
   for(const m of history){const tied=linkedByMessage.get(String(m.id))||[];if(!tied.length||tied.every(a=>a.status==='terminee'))hidden.add(String(m.id));}
  }
  return [...messages.filter(m=>!hidden.has(String(m.id))),...groups.values()].sort((a,b)=>new Date(a.created_at)-new Date(b.created_at)||String(a.id).localeCompare(String(b.id)));
 }
 function pinned(message,now=Date.now()){
  if(message.deleted_at)return false;
  if(message._completedAction){const at=Date.parse(message.created_at);return now>=at&&now<at+180000;}
  return Boolean(message.is_important);
 }
 const api={project,pinned};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.JournalFeed=api;
})(typeof window!=='undefined'?window:globalThis);
