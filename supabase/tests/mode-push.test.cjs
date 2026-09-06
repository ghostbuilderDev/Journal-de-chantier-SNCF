const {test} = require('node:test');
const assert = require('node:assert/strict');
const {webcrypto} = require('node:crypto');
const {pathToFileURL} = require('node:url');
const path = require('node:path');
const modulePromise = import(pathToFileURL(path.join(__dirname,'../functions/journal-mode-push/handler.mjs')).href);
const NOW = Date.parse('2026-09-06T12:00:00Z');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const env = {SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'server-only',JOURNAL_MODE_DISPATCH_SECRET:'a'.repeat(64),
  JOURNAL_VAPID_PUBLIC_KEY:'B'.repeat(87),JOURNAL_VAPID_PRIVATE_KEY:'C'.repeat(43),JOURNAL_VAPID_SUBJECT:'https://example.test/app/'};
const job = n => ({delivery_id:id(n),session_id:id(50),user_id:id(60),device_id:id(70),chantier_id:id(80),event_id:id(n+100),
  chantier_name:'Chantier A',ends_at:new Date(NOW+3600000).toISOString(),endpoint:'https://fcm.googleapis.com/fcm/send/example',
  keys:{p256dh:'B'.repeat(87),auth:'C'.repeat(22)},event_count:1,priority:false,event_kind:'message',message_id:id(91),body:'PRIVATE MESSAGE',password:'never send'});
async function setup(options={}) {
  const {createHandler} = await modulePromise;
  const calls=[],sent=[]; const jobs=options.jobs || [job(1)];
  const rpc=async (name,args) => { calls.push([name,args]);
    if (options.rpcFailure?.(name,args)) throw new Error('private error with endpoint/token');
    if (name.endsWith('_claim')) return jobs;
    if (name.endsWith('_confirm')) return options.confirm ? options.confirm(args.p_delivery_id) : jobs.find(j => j.delivery_id===args.p_delivery_id);
    return null;
  };
  const sendPush=async (...args) => {sent.push(args); await options.sendHook?.(...args); if (options.pushError) {const e=options.pushError(args); if(e)throw e;}};
  const handler=createHandler({env:options.env || env,rpc,sendPush,now:()=>NOW,cryptography:webcrypto});
  const request=(method='POST',secret=env.JOURNAL_MODE_DISPATCH_SECRET)=>new Request('https://example.test/functions/v1/journal-mode-push',{method,headers:secret?{'x-journal-dispatch-secret':secret}:{}});
  return {handler,request,calls,sent};
}
test('health reveals readiness/version only; unconfigured fail closed',async()=>{
  const a=await setup(); assert.deepEqual(await (await a.handler(a.request('GET'))).json(),{ready:true,version:'14.4'}); assert.equal(a.calls.length,0);
  const b=await setup({env:{...env,JOURNAL_VAPID_PRIVATE_KEY:''}}); assert.equal((await b.handler(b.request('GET'))).status,503);assert.equal((await b.handler(b.request())).status,503);
});
test('missing/wrong/oversized secret never queries DB and methods restricted',async()=>{
  const a=await setup();for(const secret of ['', 'wrong','x'.repeat(600)])assert.equal((await a.handler(a.request('POST',secret))).status,401);
  assert.equal((await a.handler(a.request('PUT'))).status,405);assert.equal(a.calls.length,0);
});
test('constant-time digest comparison matches equal values only',async()=>{
  const {equalSecret}=await modulePromise; assert.equal(await equalSecret('abc','abc',webcrypto),true);assert.equal(await equalSecret('abc','abd',webcrypto),false);
});
test('allowed endpoints restrict protocol/host/port/credentials and redirect-shaped spoofing',async()=>{
  const {allowedEndpoint}=await modulePromise;
  for(const url of ['https://fcm.googleapis.com/fcm/send/a','https://updates.push.services.mozilla.com/wpush/v2/a','https://web.push.apple.com/a','https://wns2-par02p.notify.windows.com/w/?token=x'])assert.equal(allowedEndpoint(url),true,url);
  for(const url of ['http://fcm.googleapis.com/a','https://fcm.googleapis.com:443/a','https://fcm.googleapis.com:444/a','https://x@fcm.googleapis.com/a','https://fcm.googleapis.com.evil.test/a','https://fcm.googleapis.com/a#x','https://127.0.0.1/a','https://169.254.169.254/a','https://localhost/a','https://notify.windows.com.evil.test/a','https://fcm.googleapis.com\\@evil.test/a'])assert.equal(allowedEndpoint(url),false,url);
});
test('confirmed payload excludes message/secrets/URLs, transport TTL=0 and priority urgency',async()=>{
  const j={...job(1),priority:true,event_count:4};const a=await setup({jobs:[j]});
  const res=await a.handler(a.request());assert.equal(res.status,200);assert.equal(a.sent.length,1);
  const [sub,text,opts]=a.sent[0],p=JSON.parse(text);assert.equal(opts.TTL,0);assert.equal(opts.contentEncoding,'aes128gcm');assert.equal(opts.urgency,'high');
  assert.equal(opts.topic.length,32);assert.equal(p.count,4);assert.equal(p.body,'4 nouveautés à consulter sur votre chantier.');
  assert.equal(text.includes('PRIVATE'),false);assert.equal(text.includes('password'),false);assert.equal(text.includes('endpoint'),false);
  assert.equal(sub.endpoint,j.endpoint);assert.equal(a.calls.at(-1)[1].p_result,'sent');assert.equal(a.calls[0][1].p_limit,40);
});
test('rights revoked, pause, or presence rejected by confirm cause no send',async()=>{
  for(const confirm of [()=>null,()=>({...job(1),status:'paused'})]){const a=await setup({confirm});await a.handler(a.request());assert.equal(a.sent.length,0);assert.equal(a.calls.at(-1)[1].p_result,'dropped');}
});
test('expired/too far expiry, mismatched ID and malformed subscription fail closed',async()=>{
  for(const patch of [{ends_at:new Date(NOW).toISOString()},{ends_at:new Date(NOW+25*3600000).toISOString()},{delivery_id:id(2)},{endpoint:'https://127.0.0.1/private'},{keys:{p256dh:'bad',auth:'bad'}},{message_id:'../../evil'},{event_count:-1}]){
    const a=await setup({confirm:()=>({...job(1),...patch})});await a.handler(a.request());assert.equal(a.sent.length,0);assert.equal(a.calls.at(-1)[1].p_result,'dropped');
  }
});
test('410 disables dead subscription; 429/network retry; bad requests dropped',async()=>{
  for(const [status,result] of [[410,'gone'],[404,'gone'],[429,'retry'],[503,'retry'],[0,'retry'],[400,'dropped'],[413,'dropped']]){
    const a=await setup({pushError:()=>({statusCode:status})});const res=await a.handler(a.request());assert.equal(a.calls.at(-1)[1].p_result,result);assert.equal(res.status,200);
  }
});
test('one failed confirmation/send/finish does not abort later jobs or leak errors',async()=>{
  const a=await setup({jobs:[job(1),job(2),job(3),job(4),job(5)],rpcFailure:(name,args)=>name.endsWith('_confirm')&&args.p_delivery_id===id(1)||name.endsWith('_finish')&&args.p_delivery_id===id(3),pushError:args=>JSON.parse(args[1]).eventId===id(102)?{statusCode:410}:null});
  const response=await a.handler(a.request()),data=await response.json();assert.equal(data.sent,3);assert.equal(data.retry,1);assert.equal(data.gone,1);assert.equal(data.errors,1);assert.equal(a.sent.length,4);
  assert.equal(JSON.stringify(data).includes('private'),false);
});
test('failed claim returns sanitized error; oversized batch rejected',async()=>{
  const a=await setup({rpcFailure:name=>name.endsWith('_claim')});assert.deepEqual(await (await a.handler(a.request())).json(),{error:'claim_unavailable'});
  const b=await setup({jobs:Array.from({length:41},(_,i)=>job(i+1))});assert.equal((await b.handler(b.request())).status,503);assert.equal(b.sent.length,0);
});

test('subscription base64url padding accepted consistently with database contract',async()=>{
  const a=await setup({jobs:[{...job(1),keys:{p256dh:'B'.repeat(87)+'=',auth:'C'.repeat(22)+'=='}}]});
  await a.handler(a.request());assert.equal(a.sent.length,1);assert.equal(a.calls.at(-1)[1].p_result,'sent');
});

test('forty devices fit one invocation while provider concurrency stays bounded at ten',async()=>{
  let active=0,peak=0;
  const a=await setup({jobs:Array.from({length:40},(_,i)=>({...job(i+1),session_id:id(200+i),user_id:id(300+i),device_id:id(400+i)})),sendHook:async()=>{
    active++;peak=Math.max(peak,active);await new Promise(resolve=>setImmediate(resolve));active--;
  }});
  const result=await (await a.handler(a.request())).json();
  assert.equal(a.sent.length,40);assert.equal(result.sent,40);assert.equal(peak,10);assert.equal(active,0);
});
