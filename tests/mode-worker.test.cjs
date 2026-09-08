const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const {MessageChannel} = require('node:worker_threads');
const SOURCE = fs.readFileSync(path.join(__dirname,'../service-worker-v13.js'),'utf8');
const NOW = Date.parse('2026-09-06T12:00:00Z');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const SCOPE = 'https://example.test/Journal-de-chantier-SNCF/';
const state = patch => ({userId:id(1),deviceId:id(2),sessionId:id(3),chantierId:id(4),expiresAt:new Date(NOW+3600000).toISOString(),status:'active',pauseUntil:null,...patch});
const payload = patch => ({version:'14.4',...state(),eventId:id(8),count:1,priority:false,title:'Chantier A',body:'DO NOT DISPLAY PRIVATE',messageId:id(9),...patch});
function database(backing) {return {open(name){const dbBacking=name==='journal-v15-notifications'?(backing.v15||(backing.v15={})):backing;const opening={};queueMicrotask(()=>{
  if(backing.fail){opening.onerror?.();return;}
  opening.result={objectStoreNames:{contains:()=>true},close(){},transaction(){const tx={objectStore(){return {
    get(){const r={};queueMicrotask(()=>{r.result=dbBacking.current;r.onsuccess?.();tx.oncomplete?.();});return r;},
    put(value){const r={};queueMicrotask(()=>{dbBacking.current=structuredClone(value);r.onsuccess?.();tx.oncomplete?.();});return r;},
    delete(){const r={};queueMicrotask(()=>{dbBacking.current=null;r.onsuccess?.();tx.oncomplete?.();});return r;}
  };}};return tx;}};opening.onsuccess?.();});return opening;}};}
function harness(backing={}) {
  const events={},shows=[],closed=[],opened=[],navigated=[],messages=[],acks=[];
  const browser={now:NOW,windows:[],notifications:[]};
  class Clock extends Date {static now(){return browser.now;}}
  const registration={scope:SCOPE,getNotifications:async()=>browser.notifications,showNotification:async(title,options)=>{
    shows.push({title,...options});browser.notifications.push({tag:options.tag,close:()=>closed.push(options.tag)});
  }};
  const self={registration,location:new URL(SCOPE),addEventListener:(name,fn)=>{(events[name]||(events[name]=[])).push(fn);},clients:{matchAll:async()=>browser.windows,openWindow:async url=>{opened.push(url);}}};
  const context=vm.createContext({self,indexedDB:database(backing),Date:Clock,URL,Response,Map,Set,Promise,MessageChannel,setTimeout,clearTimeout,
    caches:{keys:async()=>[],open:async()=>({addAll:async()=>{},put:async()=>{}})},fetch:async()=>new Response('shell')});
  vm.runInContext(SOURCE,context);
  const source={id:'page1',url:SCOPE};
  async function emit(name,parts={}) {const waiting=[];for(const handler of events[name])handler({...parts,waitUntil:p=>waiting.push(p)});await Promise.all(waiting);}
  const post=async(data,src=source)=>{await emit('message',{data,source:src,ports:[{postMessage:a=>acks.push(a)}]});};
  const push=async(p=payload())=>emit('push',{data:{json:()=>p}});
  const click=async(p=payload())=>emit('notificationclick',{notification:{data:p,close:()=>closed.push('clicked')}});
  function client(patch={}){return {id:'page1',url:SCOPE,visibilityState:'visible',focused:true,postMessage:(m,ports)=>{messages.push(m);ports?.[0]?.postMessage({ok:true});ports?.[0]?.close();},navigate:async url=>{navigated.push(url);return browser.windows[0];},focus:async()=>{},...patch};}
  return {browser,backing,shows,closed,opened,navigated,messages,acks,post,push,click,emit,client};
}
test('push requires a matching persisted user/device/session/chantier',async()=>{
  const h=harness();await h.push();assert.equal(h.shows.length,0);
  await h.post({type:'JOURNAL_MODE_STATE',state:state()});
  for(const patch of [{userId:id(11)},{deviceId:id(12)},{sessionId:id(13)},{chantierId:id(14)}])await h.push(payload(patch));
  assert.equal(h.shows.length,0);await h.push();assert.equal(h.shows.length,1);
  assert.equal(h.shows[0].body,'Une nouveauté à consulter sur votre chantier.');assert.equal(h.shows[0].data.body,undefined);
});
test('state persistence strips JWT/secret fields and ACK follows write',async()=>{
  const h=harness();await h.post({type:'JOURNAL_MODE_STATE',state:state({access_token:'PRIVATE JWT',endpoint:'secret'})});
  assert.equal(h.acks[0].ok,true);assert.equal(JSON.stringify(h.backing).includes('PRIVATE'),false);assert.equal(h.backing.current.endpoint,undefined);
});
test('expired, paused, stopped, and shortened sessions stay quiet',async()=>{
  for(const s of [state({expiresAt:new Date(NOW).toISOString()}),state({status:'paused',pauseUntil:new Date(NOW+60000).toISOString()}),state({status:'stopped'}),state({expiresAt:new Date(NOW+60000).toISOString()})]){
    const h=harness();await h.post({type:'JOURNAL_MODE_STATE',state:s});await h.push();assert.equal(h.shows.length,0);
  }
  const h=harness();await h.post({type:'JOURNAL_MODE_STATE',state:state({status:'paused',pauseUntil:new Date(NOW-1000).toISOString()})});await h.push();assert.equal(h.shows.length,1);
});
test('expired/malformed payloads are rejected before displaying',async()=>{
  const h=harness();await h.post({type:'JOURNAL_MODE_STATE',state:state()});
  for(const patch of [{expiresAt:new Date(NOW).toISOString()},{eventId:'../bad'},{actionId:'https://evil.test'},{count:0},{count:10000},{priority:'yes'},{version:'14.3'}])await h.push(payload(patch));
  await h.emit('push',{data:{json(){throw new Error('invalid JSON');}}});assert.equal(h.shows.length,0);
});
test('notification dedup survives worker restart and state heartbeat',async()=>{
  const backing={},a=harness(backing);await a.post({type:'JOURNAL_MODE_STATE',state:state()});await a.push();
  const b=harness(backing);await b.post({type:'JOURNAL_MODE_STATE',state:state()});await b.push();assert.equal(b.shows.length,0);await b.push(payload({eventId:id(10),priority:true}));assert.equal(b.shows[0].renotify,true);
});
test('foreground exact feed presence suppresses OS notification, stale/hidden/different feed does not',async()=>{
  for(const [patch,presencePatch,expected] of [[{},{},0],[{focused:false},{},1],[{visibilityState:'hidden'},{},1],[{},{chantierId:id(15)},1]]){
    const h=harness();h.browser.windows=[h.client(patch)];await h.post({type:'JOURNAL_MODE_STATE',state:state()});
    await h.post({type:'JOURNAL_MODE_PRESENCE',deviceId:id(2),sessionId:id(3),chantierId:id(4),visible:true,...presencePatch});await h.push();assert.equal(h.shows.length,expected);
  }
  const h=harness();h.browser.windows=[h.client()];await h.post({type:'JOURNAL_MODE_STATE',state:state()});await h.post({type:'JOURNAL_MODE_PRESENCE',deviceId:id(2),sessionId:id(3),chantierId:id(4),visible:true});h.browser.now+=61000;await h.push();assert.equal(h.shows.length,1);
});
test('pause and offline clear remove notifications before ACK and reject future pushes',async()=>{
  const h=harness();await h.post({type:'JOURNAL_MODE_STATE',state:state()});await h.push();
  await h.post({type:'JOURNAL_MODE_STATE',state:state({status:'paused',pauseUntil:new Date(NOW+60000).toISOString()})});assert.equal(h.closed.length,1);
  await h.post({type:'JOURNAL_MODE_CLEAR',deviceId:id(2)});assert.equal(h.backing.current,null);assert.equal(h.acks.at(-1).ok,true);
  await h.push(payload({eventId:id(12)}));assert.equal(h.shows.length,1);
});
test('out of scope state messages and unavailable IDB fail closed',async()=>{
  const h=harness();await h.post({type:'JOURNAL_MODE_STATE',state:state()},{id:'evil',url:'https://evil.test/'});await h.push();assert.equal(h.shows.length,0);
  const j=harness({fail:true});await j.post({type:'JOURNAL_MODE_STATE',state:state()});assert.equal(j.acks[0].ok,false);await j.push();assert.equal(j.shows.length,0);
});
test('click builds scoped URL solely from validated IDs and reuses live window without reload',async()=>{
  const h=harness();await h.post({type:'JOURNAL_MODE_STATE',state:state()});h.browser.windows=[h.client()];
  await h.click(payload({url:'https://evil.test/exfil',actionId:id(10)}));assert.equal(h.navigated.length,0);assert.equal(h.opened.length,0);assert.equal(h.messages[0].type,'JOURNAL_MODE_OPEN');assert.equal(h.messages[0].url,undefined);
  h.browser.windows=[];await h.click(payload({url:'https://evil.test/exfil'}));const u=new URL(h.opened[0]);assert.equal(u.origin,'https://example.test');assert.equal(u.pathname,'/Journal-de-chantier-SNCF/');assert.equal(u.searchParams.get('chantier'),id(4));assert.equal(u.searchParams.get('message'),id(9));
});
test('click cannot open after logout, wrong identity or malicious action ID',async()=>{
  const h=harness();await h.post({type:'JOURNAL_MODE_STATE',state:state()});await h.click(payload({userId:id(15)}));await h.click(payload({actionId:'../../x'}));
  await h.post({type:'JOURNAL_MODE_CLEAR',deviceId:id(2)});await h.click();assert.equal(h.opened.length,0);
});
test('server clock corrects initial phone offset and expiry',async()=>{
  const h=harness();h.browser.now=NOW-2*86400000;await h.post({type:'JOURNAL_MODE_STATE',state:state({serverNow:new Date(NOW).toISOString()})});await h.push();assert.equal(h.shows.length,1);
  h.browser.now+=3600001;await h.push(payload({eventId:id(99)}));assert.equal(h.shows.length,1);
});

test('unresponsive old/background window keeps draft and fallback opens another scoped window',async()=>{
  const h=harness();await h.post({type:'JOURNAL_MODE_STATE',state:state()});
  h.browser.windows=[h.client({postMessage:(_m,ports)=>{ports?.[0]?.close();}})];
  await h.click();assert.equal(h.navigated.length,0);assert.equal(h.opened.length,1);assert.equal(new URL(h.opened[0]).origin,'https://example.test');
});

test('V15 persistent push is generic, deduplicated, identity checked and cleared on logout',async()=>{
 const h=harness();const p={version:'15',id:id(22),userId:id(1),deviceId:id(23),expiresAt:new Date(NOW+3600000).toISOString(),body:'PRIVATE'};
 await h.push(p);assert.equal(h.shows.length,0);
 await h.post({type:'JOURNAL_V15_STATE',userId:id(1),deviceId:id(23)});
 await h.push({...p,userId:id(2)});assert.equal(h.shows.length,0);
 await h.push(p);await h.push(p);assert.equal(h.shows.length,1);assert.equal(h.shows[0].body.includes('PRIVATE'),false);
 await h.post({type:'JOURNAL_V15_CLEAR',deviceId:id(23)});await h.push({...p,id:id(24)});assert.equal(h.shows.length,1);
});
test('V15 suppresses duplicate legacy alerts when permanent notifications are active',async()=>{
 const h=harness();await h.post({type:'JOURNAL_MODE_STATE',state:state()});await h.post({type:'JOURNAL_V15_STATE',userId:id(1),deviceId:id(23)});
 await h.push();assert.equal(h.shows.length,0);
 await h.post({type:'JOURNAL_V15_CLEAR',deviceId:id(23)});await h.push();assert.equal(h.shows.length,1);
});
