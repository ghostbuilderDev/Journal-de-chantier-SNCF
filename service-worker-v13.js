const CACHE_NAME = 'journal-chantier-connecte-v15.9';
const APP_SHELL = [
  './journal-completion.js?v=15.9', './journal-v159.css?v=15.9',
  './briefing/afficher-qr.html', './briefing/afficher-qr.js?v=15.9', './briefing/briefing-qr-share.js?v=15.9', './briefing/briefing-v159.css?v=15.9',
  './journal-composer.js?v=15.7.1', './journal-emoji.js?v=15.6', './data/emojis.json', './journal-v156.css?v=15.7.1',
  './journal-pdf.js?v=15.8', './journal-v155.css?v=15.5',
  './vendor/pdfjs/standard_fonts/LiberationSans-Regular.ttf', './vendor/pdfjs/standard_fonts/LiberationSans-Bold.ttf',
  './vendor/pdfjs/pdf.min.mjs', './vendor/pdfjs/pdf.worker.min.mjs',
  './journal-v154.css?v=15.4', './journal-dialogs.js?v=15.4', './journal-feed.js?v=15.4', './journal-production.js?v=15.9', './journal-export.js?v=15.5', './supabase/functions/_shared/cr-email.mjs?v=15.4',
  './journal-v153.css?v=15.3',
  './cr-fields.js?v=15.8', './journal-v157.css?v=15.7', './cr-off.js?v=15.9', './cr-ai.js?v=15.6', './cr-off.css?v=15.3',
  './briefing-integration.js?v=15.9', './briefing/index.html', './briefing/journal-bridge.js?v=15.8', './briefing/signer.html', './briefing/signer.js?v=15.8', './briefing/briefing-v158.css?v=15.8', './briefing/briefing-preparation.js?v=15.8', './briefing/briefing-attendance.js?v=15.9', './briefing/vendor/qrcodegen.js?v=15.8',
  './briefing/vendor/html2canvas.min.js', './briefing/vendor/jspdf.umd.min.js',
  './feedback.js?v=15.4', './feedback.css?v=15.3',
  './', './index.html', './styles-v13.css?v=14.7-pdf',
  './styles-v14.3.css?v=14.3-design', './mode-chantier.css?v=14.4-mode-chantier',
  './mode-chantier.js?v=15.0', './app-v13.js?v=15.9',
  './supabase.js?v=14.2-collaborateurs', './config.js?v=14.2-collaborateurs',
  './manifest.webmanifest', './journal-chantier-logo-v14.png'
];
const MODE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MODE_DB = 'journal-chantier-mode';
const MODE_TAG = 'journal-mode-';
const modePresence = new Map();
let modeQueue = Promise.resolve();
function modeSerial(fn) { const result = modeQueue.then(fn); modeQueue = result.catch(() => {}); return result; }
function modeInScope(value) {
  try { const url = new URL(value), scope = new URL(self.registration.scope); return url.origin === scope.origin && url.pathname.startsWith(scope.pathname); } catch { return false; }
}
function modeStore(operation, value) {
  return new Promise((resolve,reject) => {
    const opening = indexedDB.open(MODE_DB,1);
    opening.onupgradeneeded = () => { if (!opening.result.objectStoreNames.contains('state')) opening.result.createObjectStore('state'); };
    opening.onerror = () => reject(new Error('mode_store_unavailable'));
    opening.onsuccess = () => {
      const db = opening.result; let tx;
      try { tx = db.transaction('state',operation === 'read' ? 'readonly' : 'readwrite'); } catch (error) { db.close(); reject(error); return; }
      const store = tx.objectStore('state');
      const request = operation === 'read' ? store.get('current') : operation === 'clear' ? store.delete('current') : store.put(value,'current');
      let result;
      request.onsuccess = () => { result = request.result; };
      tx.oncomplete = () => { db.close(); resolve(result || null); };
      tx.onerror = tx.onabort = () => { db.close(); reject(new Error('mode_store_unavailable')); };
    };
  });
}
function modeState(value) {
  if (!value || !['userId','deviceId','sessionId','chantierId'].every(k => MODE_UUID.test(value[k] || ''))) return null;
  if (!['active','paused','stopped'].includes(value.status)) return null;
  const expiry = Date.parse(value.expiresAt), pause = value.pauseUntil == null ? null : Date.parse(value.pauseUntil);
  const serverNow = value.serverNow == null ? Date.now() : Date.parse(value.serverNow);
  if (!Number.isFinite(serverNow) || !Number.isFinite(expiry) || expiry > serverNow + 25*3600000 || pause !== null && !Number.isFinite(pause)) return null;
  return {userId:value.userId,deviceId:value.deviceId,sessionId:value.sessionId,chantierId:value.chantierId,
    expiresAt:new Date(expiry).toISOString(),clockOffset:serverNow-Date.now(),status:value.status,pauseUntil:pause === null ? null : new Date(pause).toISOString()};
}
function modeNow(state) { return Date.now() + (Number.isFinite(state?.clockOffset) ? state.clockOffset : 0); }
function modeActive(state) {
  return !!state && Date.parse(state.expiresAt) > modeNow(state) && (state.status === 'active' || state.status === 'paused' && state.pauseUntil && Date.parse(state.pauseUntil) <= modeNow(state));
}
function modePayload(value,now = Date.now()) {
  if (!value || value.version !== '14.4' || !['userId','deviceId','sessionId','chantierId','eventId'].every(k => MODE_UUID.test(value[k] || ''))) return null;
  if (value.messageId && !MODE_UUID.test(value.messageId) || value.actionId && !MODE_UUID.test(value.actionId)) return null;
  const expiry = Date.parse(value.expiresAt);
  if (!Number.isFinite(expiry) || expiry <= now || expiry > now + 25*3600000) return null;
  if (!Number.isInteger(value.count) || value.count < 1 || value.count > 9999 || typeof value.priority !== 'boolean') return null;
  return {version:'14.4',userId:value.userId,deviceId:value.deviceId,sessionId:value.sessionId,chantierId:value.chantierId,
    eventId:value.eventId,expiresAt:new Date(expiry).toISOString(),count:value.count,priority:value.priority,
    title:typeof value.title === 'string' ? value.title.replace(/[\u0000-\u001f\u007f-\u009f]/g,'').slice(0,100) : 'Journal de chantier',
    messageId:value.messageId || null,actionId:value.actionId || null};
}
function modeMatches(state,payload) { return !!state && ['userId','deviceId','sessionId','chantierId'].every(k => state[k] === payload[k]); }
async function modeCloseNotifications() {
  const notifications = await self.registration.getNotifications();
  notifications.filter(n => typeof n.tag === 'string' && n.tag.startsWith(MODE_TAG)).forEach(n => n.close());
}
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  // Activate after existing pages close, preserving work in progress.
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith('journal-chantier-connecte-') && key !== CACHE_NAME)
    .map(key => caches.delete(key)))));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || !modeInScope(event.request.url)) return;
  const request = event.request;
  const navigation = request.mode === 'navigate';
  const shell = new Set(APP_SHELL.map(path => new URL(path,self.registration.scope).href));
  if (!navigation && !shell.has(request.url)) return;
  const pageUrl = new URL(request.url);
  pageUrl.search = ''; pageUrl.hash = '';
  if (pageUrl.pathname.endsWith('/')) pageUrl.pathname += 'index.html';
  // Each static page has its own navigation fallback. A QR form must never
  // replace the journal home page in the offline cache.
  if (navigation && !shell.has(pageUrl.href)) return;
  const cacheKey = navigation ? pageUrl.href : request;
  event.respondWith(fetch(request).then(response => {
    if (response?.ok) {
      const clone = response.clone();
      event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.put(cacheKey,clone)));
    }
    return response;
  }).catch(async () => (await caches.match(cacheKey)) || new Response('Hors ligne',{status:503})));
});
self.addEventListener('message', event => {
  if (!event.source || !modeInScope(event.source.url)) return;
  const message = event.data || {};
  if (!['JOURNAL_MODE_STATE','JOURNAL_MODE_CLEAR','JOURNAL_MODE_PRESENCE'].includes(message.type)) return;
  event.waitUntil(modeSerial(async () => {
    if (message.type === 'JOURNAL_MODE_PRESENCE') {
      if (!['deviceId','sessionId','chantierId'].every(k => MODE_UUID.test(message[k] || ''))) throw new Error('invalid_presence');
      if (message.visible === true) modePresence.set(event.source.id,{deviceId:message.deviceId,sessionId:message.sessionId,chantierId:message.chantierId,at:Date.now()});
      else modePresence.delete(event.source.id);
    } else if (message.type === 'JOURNAL_MODE_CLEAR') {
      if (!MODE_UUID.test(message.deviceId || '')) throw new Error('invalid_device');
      const old = await modeStore('read');
      // A stale page must not clear another device's persisted state.
      if (!old || old.deviceId === message.deviceId) { await modeStore('clear'); modePresence.clear(); await modeCloseNotifications(); }
    } else {
      const state = modeState(message.state);
      if (!state) throw new Error('invalid_state');
      const old = await modeStore('read');
      const same = old && modeMatches(old,state);
      await modeStore('write',{...state,seen:same && Array.isArray(old.seen) ? old.seen : []});
      if (!same || !modeActive(state)) { modePresence.clear(); await modeCloseNotifications(); }
    }
    event.ports?.[0]?.postMessage({ok:true});
  }).catch(() => { event.ports?.[0]?.postMessage({ok:false}); }));
});
self.addEventListener('push', event => {
  event.waitUntil(modeSerial(async () => {
    let raw; try { raw = event.data?.json(); } catch { return; }
    if (raw?.version === '14.4' && (await v15Store('read'))?.userId === raw.userId) return;
    const state = await modeStore('read');
    const payload = modePayload(raw,modeNow(state)); if (!payload) return;
    if (!modeActive(state) || !modeMatches(state,payload) || Date.parse(payload.expiresAt) > Date.parse(state.expiresAt)) return;
    const seen = Array.isArray(state.seen) ? state.seen : [];
    if (seen.includes(payload.eventId)) return;
    const windows = await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const visible = windows.find(client => {
      const presence = modePresence.get(client.id);
      return modeInScope(client.url) && client.visibilityState === 'visible' && client.focused && presence && Date.now()-presence.at < 60000 &&
        presence.deviceId === payload.deviceId && presence.sessionId === payload.sessionId && presence.chantierId === payload.chantierId;
    });
    if (visible) visible.postMessage({type:'JOURNAL_MODE_EVENT',chantierId:payload.chantierId,messageId:payload.messageId,actionId:payload.actionId,count:payload.count});
    else {
      // Never reuse an arbitrary payload body or URL: only validated identifiers and generic text.
      await self.registration.showNotification(payload.title || 'Journal de chantier', {
        body:payload.count > 1 ? `${payload.count} nouveautés à consulter sur votre chantier.` : 'Une nouveauté à consulter sur votre chantier.',
        icon:new URL('journal-chantier-logo-v14.png',self.registration.scope).href,
        tag:MODE_TAG+payload.sessionId,renotify:payload.priority,silent:false,requireInteraction:false,
        timestamp:Date.now(),data:payload
      });
    }
    await modeStore('write',{...state,seen:[...seen.slice(-127),payload.eventId]});
  }).catch(() => {})); // Storage failure is silent: never notify without matching local identity.
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(modeSerial(async () => {
    const state = await modeStore('read');
    const payload = modePayload(event.notification.data,modeNow(state)); if (!payload || !modeMatches(state,payload)) return;
    const target = new URL(self.registration.scope);
    target.searchParams.set('chantier',payload.chantierId); target.searchParams.set('mode','chantier');
    if (payload.messageId) target.searchParams.set('message',payload.messageId);
    if (payload.actionId) target.searchParams.set('action',payload.actionId);
    const windows = await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const client = windows.find(c => modeInScope(c.url));
    if (client) {
      // Wake a suspended background page before asking it to route. Never reload its draft.
      await client.focus();
      const handled = await new Promise(resolve => {
        const channel = new MessageChannel();
        const timeout = setTimeout(() => { channel.port1.close(); resolve(false); },800);
        channel.port1.onmessage = answer => { clearTimeout(timeout); channel.port1.close(); resolve(answer.data?.ok === true); };
        client.postMessage({type:'JOURNAL_MODE_OPEN',chantierId:payload.chantierId,messageId:payload.messageId,actionId:payload.actionId},[channel.port2]);
      });
      if (!handled) await self.clients.openWindow(target.href);
    } else await self.clients.openWindow(target.href);
  }).catch(() => {}));
});

// V15: independent, persistent notifications. Payloads contain identifiers only.
function v15Store(operation,value){
 return new Promise((resolve,reject)=>{
  const opening=indexedDB.open('journal-v15-notifications',1);
  opening.onupgradeneeded=()=>opening.result.createObjectStore('state');
  opening.onerror=()=>reject(new Error('state_unavailable'));
  opening.onsuccess=()=>{
   const db=opening.result,tx=db.transaction('state',operation==='read'?'readonly':'readwrite'),store=tx.objectStore('state');
   const req=operation==='read'?store.get('identity'):operation==='clear'?store.delete('identity'):store.put(value,'identity');let result;
   req.onsuccess=()=>{result=req.result;};tx.oncomplete=()=>{db.close();resolve(result||null);};tx.onerror=tx.onabort=()=>{db.close();reject(new Error('state_unavailable'));};
  };
 });
}
function v15Payload(p){return p?.version==='15' && ['userId','deviceId','id'].every(k=>MODE_UUID.test(p[k]||'')) && Date.parse(p.expiresAt)>Date.now() && Date.parse(p.expiresAt)<Date.now()+25*3600000;}
self.addEventListener('message',event=>{
 const m=event.data;if(!event.source||!modeInScope(event.source.url)||!['JOURNAL_V15_STATE','JOURNAL_V15_CLEAR'].includes(m?.type))return;
 event.waitUntil(modeSerial(async()=>{
  if(!MODE_UUID.test(m.deviceId||''))throw new Error('device');
  const old=await v15Store('read');
  if(m.type==='JOURNAL_V15_CLEAR'){
   if(!old||old.deviceId===m.deviceId)await v15Store('clear');
  }else{
   if(!MODE_UUID.test(m.userId||''))throw new Error('user');
   await v15Store('write',{userId:m.userId,deviceId:m.deviceId,seen:old?.userId===m.userId?old.seen||[]:[]});
  }
  if(m.type==='JOURNAL_V15_CLEAR'||old?.userId!==m.userId){for(const n of await self.registration.getNotifications()){if(n.tag?.startsWith('journal-v15-'))n.close();}}
  event.ports?.[0]?.postMessage({ok:true});
 }).catch(()=>event.ports?.[0]?.postMessage({ok:false})));
});
self.addEventListener('push',event=>{
 let p;try{p=event.data?.json();}catch{return;}if(!v15Payload(p))return;
 p={version:'15',userId:p.userId,deviceId:p.deviceId,id:p.id,expiresAt:p.expiresAt};
 event.waitUntil(modeSerial(async()=>{
  const state=await v15Store('read');if(!state||state.userId!==p.userId||state.deviceId!==p.deviceId||(state.seen||[]).includes(p.id))return;
  const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  windows.filter(c=>modeInScope(c.url)).forEach(c=>c.postMessage({type:'JOURNAL_V15_EVENT'}));
  await self.registration.showNotification('Journal de chantier',{
   body:'Un message ou une demande vous attend dans le journal.',icon:new URL('journal-chantier-logo-v14.png',self.registration.scope).href,
   tag:'journal-v15-'+p.id,data:p,renotify:false
  });
  await v15Store('write',{...state,seen:[...(state.seen||[]).slice(-127),p.id]});
 }).catch(()=>{}));
});
self.addEventListener('notificationclick',event=>{
 const p=event.notification.data;if(!p||p.version!=='15')return;event.notification.close();
 event.waitUntil(modeSerial(async()=>{
  const state=await v15Store('read');if(!state||state.userId!==p.userId||state.deviceId!==p.deviceId||!MODE_UUID.test(p.id||''))return;
  const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true}),client=windows.find(c=>modeInScope(c.url));
  if(client){await client.focus();client.postMessage({type:'JOURNAL_V15_OPEN',id:p.id});}
  else{const url=new URL(self.registration.scope);url.searchParams.set('inbox',p.id);await self.clients.openWindow(url.href);}
 }).catch(()=>{}));
});
