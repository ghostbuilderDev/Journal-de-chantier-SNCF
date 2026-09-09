import {createHandler} from './handler.mjs';
const env=Object.fromEntries(['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','GEMINI_API_KEY','JOURNAL_GEMINI_MODEL'].map(k=>[k,Deno.env.get(k)||'']));
async function authorize(authorization:string,site:string,count:boolean){
 // PostgREST validates the user's signed JWT; the RPC checks active membership.
 const r=await fetch(env.SUPABASE_URL+'/rest/v1/rpc/journal_writing_access',{method:'POST',signal:AbortSignal.timeout(10000),headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:authorization,'Content-Type':'application/json'},body:JSON.stringify({p_site:site,p_count:count})});return r.ok&&(await r.json())===true;
}
Deno.serve(createHandler({env,authorize}));
