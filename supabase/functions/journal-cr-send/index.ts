import {createHandler} from './handler.mjs';
const env=Object.fromEntries(['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','RESEND_API_KEY','JOURNAL_CR_FROM'].map(k=>[k,Deno.env.get(k)||'']));
async function rpc(name:string,args:Record<string,unknown>,authorization?:string){
 const response=await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${name}`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),
  headers:{'Content-Type':'application/json','apikey':env.SUPABASE_SERVICE_ROLE_KEY,'Authorization':authorization||`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`},body:JSON.stringify(args)});
 if(!response.ok)throw new Error('rpc_failed');const text=await response.text();return text?JSON.parse(text):null;
}
Deno.serve(createHandler({env,rpc}));
