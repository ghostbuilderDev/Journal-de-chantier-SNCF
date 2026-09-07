const CACHE_NAME = 'journal-chantier-connecte-v14.7-ainm-pdf';
const APP_SHELL = [
  './briefing-integration.js?v=14.6', './briefing/index.html', './briefing/journal-bridge.js',
  './briefing/vendor/html2canvas.min.js', './briefing/vendor/jspdf.umd.min.js',
  './feedback.js?v=14.5-retours', './feedback.css?v=14.5-retours',
  './', './index.html', './styles-v13.css?v=14.7-pdf',
  './styles-v14.3.css?v=14.3-design', './mode-chantier.css?v=14.4-mode-chantier',
  './mode-chantier.js?v=14.4-mode-chantier', './app-v13.js?v=14.7-ainm-pdf',
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
  const cacheKey = navigation ? new URL('./index.html',self.registration.scope).href : request;
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
