// Run: node supabase/tests/edge-delete-user.test.cjs
// The handler itself runs in a VM with simulated Auth/RPC, no live project.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const source = fs.readFileSync(require('node:path').join(__dirname, '../functions/journal-delete-user/index.ts'), 'utf8').replace(/^import .*\n/m, '');
const js = stripTypeScriptTypes(source);
const owner = '00000000-0000-4000-8000-000000000001';
const target = '00000000-0000-4000-8000-000000000002';
async function scenario({token='valid',body={user_id:target,confirmation:'SUPPRIMER'},authError=null,prepareError=null,deletionError=null,finishError=null,method='POST'}={}) {
 const calls=[]; let handler;
 const client={auth:{getUser:async(t)=>{calls.push('auth:'+t);return {data:{user:authError?null:{id:owner}},error:authError};},admin:{deleteUser:async(id,soft)=>{calls.push('delete:'+id+':'+soft);return {error:deletionError};}}},rpc:async(name,args)=>{calls.push(name);assert.equal(args.p_actor_id,owner);assert.equal(args.p_user_id,target);return {error:name.includes('prepare')?prepareError:finishError};}};
 vm.runInNewContext(js,{createClient:()=>client,Deno:{env:{get:()=> 'configured'},serve:h=>handler=h},Response,Request,console:{error:()=>{}},JSON});
 const headers={'Content-Type':'application/json'}; if(token) headers.Authorization='Bearer '+token;
 const req=new Request('https://test.invalid/function',{method,headers,body:method==='POST'?JSON.stringify(body):undefined});
 const result=await handler(req);return {status:result.status,data:result.status===204?null:await result.json(),calls};
}
(async()=>{
 let r=await scenario({token:''});assert.equal(r.status,401);assert.deepEqual(r.calls,[]);
 r=await scenario({method:'GET'});assert.equal(r.status,405);assert.deepEqual(r.calls,[]);
 r=await scenario({authError:{message:'invalid'}});assert.equal(r.status,401);assert.equal(r.calls.length,1);
 r=await scenario({body:{user_id:owner,confirmation:'SUPPRIMER'}});assert.equal(r.status,403);assert.equal(r.calls.length,1);
 r=await scenario({body:{user_id:target,confirmation:'yes'}});assert.equal(r.status,400);assert.equal(r.calls.length,1);
 r=await scenario({prepareError:{code:'42501',message:'owner required'}});assert.equal(r.status,403);assert.equal(r.calls.some(x=>x.startsWith('delete:')),false);
 r=await scenario({deletionError:{code:'failed'}});assert.equal(r.status,409);assert.match(r.data.error,/accès sont bloqués/);assert.equal(r.calls.includes('journal_v142_finish_user_deletion'),false);
 r=await scenario();assert.equal(r.status,200);assert.equal(r.data.success,true);assert.deepEqual(r.calls,['auth:valid','journal_v142_prepare_user_deletion',`delete:${target}:false`,'journal_v142_finish_user_deletion']);
 r=await scenario({finishError:{code:'failed'}});assert.equal(r.status,200);assert.equal(r.data.success,true);assert.ok(r.data.warning);
 console.log('PASS: 9 deletion-handler scenarios (simulated Auth/RPC; no production access).');
})().catch(e=>{console.error(e);process.exitCode=1;});
