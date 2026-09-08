const {test}=require('node:test'),assert=require('node:assert/strict');
const config={RESEND_API_KEY:'private-key',JOURNAL_CR_FROM:'Journal <journal@example.com>'};
const id='00000000-0000-4000-8000-000000000001';
const request=(extra={})=>new Request('https://project.supabase.co/functions/v1/journal-cr-send',{method:'POST',headers:{Authorization:'Bearer real-user-jwt','Origin':'https://ghostbuilderdev.github.io'},body:JSON.stringify({ids:[id],...extra})});
async function setup(options={}){const {createHandler}=await import('../functions/journal-cr-send/handler.mjs');let calls=[],sends=[];
 const rpc=async(name,args,token)=>{calls.push({name,args,token});if(name==='journal_cr_api'){if(options.deny)throw Error('denied');return {id,recipients:['chef@example.com'],subject:'CR validé',body:'Copie validée',state:'pending'};}if(options.finishFails)throw Error('network');};
 return {handler:createHandler({env:options.noConfig?{}:config,rpc,fetcher:async(url,req)=>{sends.push({url,req});if(options.timeout)throw Error('timeout');return new Response(JSON.stringify(options.providerFail?{error:'failed'}:{id:'email-1'}),{status:options.providerFail?422:200});}}),calls,sends};}
test('email uses the caller rights and stored recipients/content, ignoring browser substitutions',async()=>{
 const h=await setup(),r=await h.handler(request({to:['attacker@example.com'],body:'REPLACED'}));assert.equal(r.status,200);assert.equal(h.calls[0].token,'Bearer real-user-jwt');
 const body=JSON.parse(h.sends[0].req.body);assert.deepEqual(body.to,['chef@example.com']);assert.equal(body.text,'Copie validée');assert.equal(h.sends[0].req.headers['Idempotency-Key'],'journal-cr-'+id);assert.equal(h.calls.at(-1).args.p_state,'sent');
});
test('no rights means no outbound email',async()=>{const h=await setup({deny:true});assert.equal((await h.handler(request())).status,403);assert.equal(h.sends.length,0);});
test('missing configuration is explicit and never claims sent',async()=>{const h=await setup({noConfig:true}),r=await h.handler(request());assert.equal(r.status,503);assert.match((await r.json()).error,/configurer/);assert.equal(h.sends.length,0);});
test('timeout remains uncertain and provider rejection is failed',async()=>{for(const options of [{timeout:true},{providerFail:true}]){const h=await setup(options);assert.equal((await h.handler(request())).status,502);assert.equal(h.calls.at(-1).args.p_state,options.timeout?'uncertain':'failed');}});
test('successful external send with failed local record is never announced as fully archived',async()=>{const h=await setup({finishFails:true});assert.equal((await h.handler(request())).status,502);});
test('cross-origin and anonymous email requests are refused',async()=>{const h=await setup();assert.equal((await h.handler(new Request('https://test',{method:'POST',headers:{Origin:'https://evil.test'}}))).status,403);assert.equal((await h.handler(new Request('https://test',{method:'POST'}))).status,401);});
