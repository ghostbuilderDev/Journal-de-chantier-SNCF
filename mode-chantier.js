/* Mode chantier V14.4. No token or private message is persisted here. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.JournalModeChantier = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const HOUR = 3600000, DAY = 24 * HOUR;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  class ServerClock {
    constructor(wall = () => Date.now(), mono = () => performance.now()) { this.wall = wall; this.mono = mono; this.sync(new Date(wall()).toISOString()); }
    sync(iso) { const n = Date.parse(iso); if (!Number.isFinite(n)) return; this.server = n; this.w = this.wall(); this.m = this.mono(); }
    now() { return this.server + Math.max(0, this.mono() - this.m, this.wall() - this.w); }
  }
  function endFromChoice(choice, custom, now) {
    const end = choice === 'custom' ? new Date(custom).getTime() : now + Number(choice) * HOUR;
    if (!Number.isFinite(end) || end <= now || end - now > DAY) throw new Error('Choisis une fin dans les prochaines 24 heures. Pour un poste de nuit, sélectionne la date de demain.');
    return new Date(end).toISOString();
  }
  function parseRoute(href) {
    try { const p = new URL(href).searchParams; if (p.get('mode') !== 'chantier' || !UUID.test(p.get('chantier') || '')) return null;
      return { chantierId:p.get('chantier'), messageId:UUID.test(p.get('message') || '') ? p.get('message') : null, actionId:UUID.test(p.get('action') || '') ? p.get('action') : null };
    } catch { return null; }
  }
  function create(adapter, environment = {}) {
    const win = environment.window ?? (typeof window !== 'undefined' ? window : null);
    const doc = environment.document ?? win?.document;
    const nav = environment.navigator ?? win?.navigator;
    const storage = environment.storage ?? win?.localStorage;
    const clock = new ServerClock(environment.wallNow, environment.monoNow);
    const later = environment.setTimeout || setTimeout;
    const clockInterval = environment.setInterval || setInterval;
    const ctx = () => adapter.getContext();
    const notify = (text, tone = 'warning') => adapter.toast?.(text, tone);
    let deviceId = environment.deviceId;
    try { deviceId ||= storage?.getItem('journal_mode_device_v1'); } catch { /* storage disabled */ }
    if (!UUID.test(deviceId || '')) {
      const cryptoApi=environment.crypto||win?.crypto;
      deviceId=cryptoApi?.randomUUID?.();
      if(!deviceId&&cryptoApi?.getRandomValues){const bytes=cryptoApi.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;const hex=Array.from(bytes,v=>v.toString(16).padStart(2,'0')).join('');deviceId=`${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;}
      if(!deviceId){const noop=()=>{};return {contextChanged:noop,clear:noop,beforeLogout:noop,presence:noop,active:()=>false,openDialog:()=>notify('Ouvre le journal dans un navigateur à jour via son adresse HTTPS pour utiliser le mode chantier.')};}
    }
    try { storage?.setItem('journal_mode_device_v1', deviceId); } catch { /* ephemeral session */ }
    let owner = null, epoch = 0, serial = 0, session = null, config = null, recap = null, loading = null, busy = false;
    let workerReady = false, pending = null, dedicated = false, wakeRequested = false, wakeLock = null, wakePending = false, syncAt = 0;
    let pushLane = Promise.resolve(), workerLane = Promise.resolve(), registration = null, disposed = false;
    let route = parseRoute(win?.location?.href || ''), routeBusy = false;
    const state = () => ({ userId:owner, deviceId, session, config, recap, busy, pending, dedicated, wakeRequested, now:clock.now() });
    const valid = ticket => !disposed && ticket === epoch && owner && owner === ctx().userId;
    const current = () => session && session.user_id === owner && Date.parse(session.ends_at) > clock.now() && session.status !== 'stopped';
    const active = () => Boolean(current() && !(session.status === 'paused' && Date.parse(session.pause_until) > clock.now()));
    const pushAvailable = () => Boolean(nav?.serviceWorker && (environment.PushManager || win?.PushManager) && (environment.Notification || win?.Notification));
    const exclusivePush = job => { const task = pushLane.then(job, job); pushLane = task.catch(() => {}); return task; };
    const intentKey = () => `journal_mode_intent_v1:${deviceId}:${owner}`;
    function saveIntent() {
      if (!owner) return;
      try { if (pending) storage?.setItem(intentKey(), JSON.stringify({pending,session})); else storage?.removeItem(intentKey()); } catch { /* Worker also stores the quiet state. */ }
    }
    function loadIntent() {
      try { const saved=JSON.parse(storage?.getItem(intentKey())||'null');
        if(saved?.session?.user_id===owner && saved.session.device_id===deviceId && ['stop','pause'].includes(saved.pending?.operation)) {pending=saved.pending;session=saved.session;}
      } catch { /* Ignore damaged local intent. */ }
    }
    async function worker(message) {
      const task = workerLane.then(async () => {
        if (!nav?.serviceWorker) return false;
        const reg = registration || await nav.serviceWorker.getRegistration?.();
        const target = nav.serviceWorker.controller || reg?.active;
        if (!target) return false;
        if (message.type === 'JOURNAL_MODE_PRESENCE') { target.postMessage(message); return true; }
        const Channel = environment.MessageChannel || win?.MessageChannel;
        if (!Channel) { target.postMessage(message); return false; }
        return new Promise(resolve => { const channel = new Channel(); const timer = later(() => { channel.port1.close(); resolve(false); }, 1500);
          channel.port1.onmessage = event => { (environment.clearTimeout || clearTimeout)(timer); channel.port1.close(); resolve(event.data?.ok === true); };
          target.postMessage(message, [channel.port2]);
        });
      }).catch(() => false);
      workerLane = task; return task;
    }
    function publishWorker() {
      if (!session || !owner) return worker({ type:'JOURNAL_MODE_CLEAR', deviceId });
      return worker({ type:'JOURNAL_MODE_STATE', state:{ userId:owner,deviceId,sessionId:session.id,chantierId:session.chantier_id,
        expiresAt:session.ends_at,status:session.status,pauseUntil:session.pause_until,serverNow:new Date(clock.now()).toISOString() } });
    }
    async function rpc(name, args, ticket = epoch) {
      if (!valid(ticket)) return null;
      const result = await ctx().db.rpc(name, args);
      if (!valid(ticket)) return null;
      if (result.error) throw result.error;
      return result.data;
    }
    async function apply(data, ticket) {
      if (!data || !valid(ticket)) return false;
      clock.sync(data.server_now); session = data.session?.user_id === owner && data.session.device_id === deviceId ? data.session : null;
      if (pending && session) session = {...session,status:pending.operation==='stop'?'stopped':'paused',pause_until:pending.until};
      recap = data.recap || recap; syncAt = clock.now();
      if (session && !current()) session = { ...session,status:'stopped' };
      workerReady = await publishWorker(); if (!valid(ticket)) return false;
      if(session?.push_enabled){
        let sub=null;try{sub=await (registration||await nav?.serviceWorker?.getRegistration?.())?.pushManager?.getSubscription();}catch{}
        if(!valid(ticket))return false;
        if(!workerReady||!sub||((environment.Notification||win?.Notification)?.permission!=='granted')) session={...session,push_enabled:false};
      }
      render(); presence(); updateWake(); return true;
    }
    async function unsubscribe() {
      try { if (localStorage.getItem('journal_v15_push_user')) return true; } catch {}
      if (!nav?.serviceWorker) return;
      const reg = registration || await nav.serviceWorker.getRegistration?.();
      const sub = await reg?.pushManager?.getSubscription(); return sub ? Boolean(await sub.unsubscribe()) : true;
    }
    function clear({ unsubscribePush = true } = {}) {
      ++epoch; ++serial; owner = null; session = null; recap = null; config = null; loading = null; busy = false; workerReady = false; pending = null; wakeRequested = false;
      void publishWorker(); releaseWake(); setDedicated(false); render();
      return unsubscribePush ? exclusivePush(unsubscribe).catch(() => {}) : Promise.resolve();
    }
    async function beforeLogout() {
      const db = ctx().db, oldOwner = owner;
      // Start the authenticated request before Auth removes its token. Local silence is unconditional.
      const forget = oldOwner && db ? Promise.resolve(db.rpc('journal_mode_forget_device', {p_device_id:deviceId})).catch(() => {}) : Promise.resolve();
      if (session) { pending={operation:'stop',until:null}; session={...session,status:'stopped'}; saveIntent(); }
      const cleanup = clear();
      await Promise.race([Promise.allSettled([forget, cleanup]), new Promise(resolve => later(resolve, 2200))]);
    }
    async function restore() {
      const ticket = epoch;
      if (!valid(ticket)) return;
      if (loading) return loading;
      loading = (async () => {
        const values = await Promise.all([rpc('journal_mode_config', {}, ticket), rpc('journal_mode_state', {p_device_id:deviceId}, ticket)]);
        if (!valid(ticket)) return;
        config = values[0]; if (config?.server_now) clock.sync(config.server_now);
        if (pending?.operation==='pause' && Date.parse(pending.until)<=clock.now()) {pending=null;saveIntent();}
        if (pending) {
          try { const result=await rpc('journal_mode_control',{p_device_id:deviceId,p_operation:pending.operation,p_until:pending.until},ticket);
            if(valid(ticket)&&result){pending=null;saveIntent();await apply(result,ticket);}
          } catch { await apply(values[1],ticket); }
        } else await apply(values[1], ticket);
        await tryRoute();
      })().catch(error => { if (valid(ticket)) { config = {enabled:false,error:true}; render(); } }).finally(() => { if (valid(ticket)) loading = null; });
      return loading;
    }
    function contextChanged() {
      const next = ctx().ready ? ctx().userId : null;
      if (owner !== next) {
        const priorOwner = owner; clear({unsubscribePush:Boolean(priorOwner)}); owner = next;
        if (owner) { loadIntent(); void restore(); }
      }
      if (dedicated && ctx().tab !== 'chat') setDedicated(false);
      render(); presence(); updateWake();
      if (owner && route && !loading) void tryRoute();
    }
    function requestPermission() {
      const N = environment.Notification || win?.Notification;
      if (!pushAvailable()) return Promise.resolve('unsupported');
      if (N.permission === 'default') return Promise.resolve(N.requestPermission()).catch(()=>'denied'); // Must stay in the original tap, before any await.
      return Promise.resolve(N.permission);
    }
    function vapidBytes(value) {
      const base = String(value).replace(/-/g, '+').replace(/_/g, '/');
      const decoded = (environment.atob || win?.atob)(base.padEnd(Math.ceil(base.length / 4) * 4, '='));
      const bytes = Uint8Array.from(decoded, c => c.charCodeAt(0));
      if (bytes.length !== 65 || bytes[0] !== 4) throw new Error('Configuration des notifications indisponible.');
      return bytes;
    }
    async function subscription(permission, ticket) {
      if (permission !== 'granted' || !pushAvailable()) return null;
      return exclusivePush(async () => {
        if (!valid(ticket)) return null;
        registration = await Promise.race([nav.serviceWorker.ready,new Promise((_,reject)=>later(()=>reject(new Error('Le service de notifications tarde à répondre.')),12000))]);
        if (!valid(ticket)) return null;
        let sub = await registration.pushManager.getSubscription();
        if (!valid(ticket)) return null;
        const key = vapidBytes(config.vapid_public_key);
        if (sub?.options?.applicationServerKey) {
          const old = new Uint8Array(sub.options.applicationServerKey);
          if (old.length !== key.length || old.some((v, i) => v !== key[i])) { await sub.unsubscribe(); sub = null; }
        }
        if (!valid(ticket)) return null;
        if (!sub) sub = await registration.pushManager.subscribe({ userVisibleOnly:true,applicationServerKey:key });
        if (!valid(ticket)) { await sub.unsubscribe(); return null; }
        return sub.toJSON();
      });
    }
    async function start(options) {
      if (busy) return;
      if (!owner || owner !== ctx().userId) throw new Error('Connecte-toi avant d’activer le mode chantier.');
      const ticket = epoch, operation = ++serial;
      if (!UUID.test(options.chantierId || '') || !ctx().chantiers.some(c => c.id === options.chantierId)) throw new Error('Sélectionne un chantier accessible.');
      let end = endFromChoice(options.duration || 'custom', options.endsAt, clock.now());
      const permission = options.withPush === false ? Promise.resolve('disabled') : requestPermission();
      busy = true; render();
      try {
        await restore(); if (!valid(ticket)) return;
        if (!config?.enabled) throw new Error('Le mode chantier sera disponible après la mise à jour du serveur.');
        end = endFromChoice(options.duration || 'custom', options.endsAt, clock.now());
        const granted = await permission; if (!valid(ticket)) return;
        let sub = null, subscriptionFailed = false;
        try { sub = await subscription(granted, ticket); } catch { subscriptionFailed = true; }
        if (!valid(ticket)) return;
        const data = await rpc('journal_mode_start', {p_device_id:deviceId,p_chantier_id:options.chantierId,p_ends_at:end,p_subscription:sub}, ticket);
        if (operation !== serial || !valid(ticket) || !data) return;
        pending=null;saveIntent();
        if (!await apply(data, ticket)) return;
        if (sub && !workerReady) { await exclusivePush(unsubscribe); if(!valid(ticket))return; session={...session,push_enabled:false};subscriptionFailed=true; }
        adapter.closeModal?.();
        if (!sub || !session?.push_enabled) notify(subscriptionFailed ? 'Poste démarré. Notifications indisponibles : ouvre Mode chantier pour réessayer.' : 'Poste démarré sans notifications téléphone. Le fil reste accessible.', 'warning');
        else notify('Mode chantier activé. Les alertes s’arrêteront à la fin du poste.', 'success');
        showRecap();
      } finally { if (valid(ticket) && operation === serial) { busy = false; render(); } }
    }
    async function control(operation) {
      if (busy || !owner || !session) return;
      const ticket = epoch, request = ++serial;
      let until = null, quietConfirmed = false;
      if (operation === 'pause') until = new Date(Math.min(clock.now() + 30 * 60000, Date.parse(session.ends_at))).toISOString();
      if (operation === 'extend') {
        const end = Math.min(Date.parse(session.ends_at) + HOUR, Date.parse(session.started_at) + DAY);
        if (end <= Date.parse(session.ends_at)) throw new Error('Un poste est limité à 24 heures. Termine ce poste pour en démarrer un autre.');
        until = new Date(end).toISOString();
      }
      busy = true; render();
      if (operation === 'stop' || operation === 'pause') {
        session = {...session,status:operation === 'stop' ? 'stopped' : 'paused',pause_until:until};
        pending = {operation,until}; saveIntent(); const silenced=await publishWorker();
        if(!valid(ticket))return;
        quietConfirmed=Boolean(silenced);
        if(!silenced){quietConfirmed=await exclusivePush(unsubscribe).catch(()=>false);if(!valid(ticket))return;session={...session,push_enabled:false};saveIntent();}
        releaseWake();
        if (operation === 'stop') { wakeRequested = false; setDedicated(false); }
      }
      try {
        const data = await rpc('journal_mode_control',{p_device_id:deviceId,p_operation:operation,p_until:until},ticket);
        if (request !== serial || !valid(ticket)) return;
        pending = null; saveIntent(); await apply(data,ticket);
        notify(operation === 'stop' ? 'Poste terminé. Les notifications sont coupées.' : operation === 'pause' ? 'Alertes en pause pendant 30 minutes, au plus tard jusqu’à la fin du poste.' : session?.push_enabled ? 'Mode chantier mis à jour.' : 'Poste mis à jour sans notifications téléphone. Ouvre Mon poste pour les réactiver.', 'success');
      } catch (error) {
        if (valid(ticket)) {
          if (pending) notify(quietConfirmed ? 'Téléphone silencieux ici. La confirmation serveur attend le réseau ; ouvre de nouveau le journal dès que la connexion revient.' : 'Arrêt des alertes non confirmé. La connexion et le service de notifications sont indisponibles ; réessaie dès le retour du réseau.');
          else throw error;
        }
      } finally { if (valid(ticket) && request === serial) { busy = false; render(); } }
    }
    async function refresh() {
      const ticket = epoch; if (!valid(ticket) || busy || loading) return;
      try {
        if (pending) {
          const desired = pending;
          const data = await rpc('journal_mode_control',{p_device_id:deviceId,p_operation:desired.operation,p_until:desired.until},ticket);
          if (valid(ticket) && pending === desired) { pending = null; saveIntent(); await apply(data,ticket); }
        } else {
          const request = serial;
          const data = await rpc('journal_mode_state',{p_device_id:deviceId},ticket);
          if (request === serial && !busy) await apply(data,ticket);
        }
      } catch { /* Existing deadline remains authoritative while offline. */ }
    }
    function feedVisible() { return Boolean(owner && doc?.visibilityState === 'visible' && doc.hasFocus?.() && ctx().tab === 'chat' && ctx().currentId && !adapter.isOverlayOpen?.()); }
    function presence() {
      if (!owner || !session) return;
      const visible = feedVisible() && current() && ctx().currentId === session.chantier_id;
      void worker({type:'JOURNAL_MODE_PRESENCE',deviceId,sessionId:session.id,chantierId:session.chantier_id,visible:Boolean(visible)});
      // The server also expires this hint after 60s, even if the process is killed.
      void rpc('journal_mode_presence',{p_device_id:deviceId,p_visible:Boolean(visible),p_chantier_id:session.chantier_id}).catch(() => {});
    }
    async function releaseWake() { const lock = wakeLock; wakeLock = null; if (lock) try { await lock.release(); } catch {} }
    async function updateWake() {
      if (!wakeRequested || !dedicated || !active() || !feedVisible()) { releaseWake(); return; }
      if (!nav?.wakeLock || wakeLock || wakePending) return;
      const ticket = epoch; wakePending = true;
      try {
        const lock = await nav.wakeLock.request('screen');
        if (!valid(ticket) || !wakeRequested || !dedicated || !active() || !feedVisible()) { await lock.release(); return; }
        wakeLock = lock; lock.addEventListener?.('release', () => { if (wakeLock === lock) wakeLock = null; });
      } catch { if (valid(ticket)) { wakeRequested = false; notify('Le téléphone n’autorise pas le maintien de l’écran allumé actuellement.'); render(); } }
      finally { wakePending = false; }
    }
    function setDedicated(value) {
      dedicated = Boolean(value); doc?.body?.classList.toggle('journal-mode-feed',dedicated);
      if (!dedicated) { wakeRequested = false; releaseWake(); }
      const bar = doc?.getElementById('journalModeFeedHeader'); if (bar) bar.hidden = !dedicated;
      render();
    }
    function updateUrl(item) {
      if (!win?.history) return;
      const url = new URL(win.location.href);
      for (const key of ['mode','chantier','message','action']) url.searchParams.delete(key);
      if (item) { url.searchParams.set('mode','chantier'); url.searchParams.set('chantier',item.chantierId); if (item.messageId) url.searchParams.set('message',item.messageId); if (item.actionId) url.searchParams.set('action',item.actionId); }
      win.history.replaceState(win.history.state,'',url);
    }
    async function navigate(item) {
      const ticket = epoch;
      if (!valid(ticket) || !UUID.test(item.chantierId || '')) return;
      if (!ctx().chantiers.some(c => c.id === item.chantierId)) { route = null; notify('Ce chantier n’est plus accessible à ton compte.'); return; }
      const opened = await adapter.navigate(item);
      if (!valid(ticket) || opened === false) return;
      setDedicated(true); updateUrl(item); presence();
    }
    async function tryRoute() {
      if (!route || routeBusy || !owner || !ctx().chantiers.length || adapter.isOverlayOpen?.()) return;
      routeBusy = true; const item = route; route = null;
      try { await navigate(item); } catch { notify('L’événement ne peut pas être ouvert pour le moment.'); } finally { routeBusy = false; }
    }
    async function openFeed() { const chantierId = current() ? session.chantier_id : ctx().currentId; if (chantierId) await navigate({chantierId}); }
    function exitFeed() { setDedicated(false); updateUrl(null); presence(); }
    function setWake(value) { wakeRequested = Boolean(value); updateWake(); render(); }
    function recapMarkup() {
      if (!recap?.since) return '<p class="mode-note">Ton premier poste commence maintenant. Les prochains récapitulatifs reprendront les nouveautés depuis ton dernier poste.</p>';
      const counts = [['Messages',recap.messages],['Actions',recap.actions],['Documents',recap.documents],['Autres événements',recap.events]];
      return `<p class="mode-note">Depuis ton dernier poste, le ${escape(new Date(recap.since).toLocaleString('fr-FR',{dateStyle:'short',timeStyle:'short'}))}.</p><div class="mode-recap-grid">${counts.map(([label,n])=>`<div><b>${Math.max(0,Number(n)||0)}</b><span>${label}</span></div>`).join('')}</div>`;
    }
    function showRecap() {
      if (!doc || !adapter.openModal) return;
      adapter.openModal({title:'Ton poste commence',subtitle:'Les nouveautés restent dans le journal, sans rafale d’anciennes notifications.',body:recapMarkup(),footer:'<button class="secondary-button" id="modeRecapClose">Fermer</button><button class="primary-button" id="modeRecapFeed">Ouvrir le fil chantier</button>'});
      doc.getElementById('modeRecapClose')?.addEventListener('click',adapter.closeModal);
      doc.getElementById('modeRecapFeed')?.addEventListener('click',()=>{adapter.closeModal?.(); void openFeed().catch(e=>notify(e.message));});
    }
    function localDateTime(n) { const date = new Date(n); return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16); }
    async function openDialog() {
      contextChanged();
      if (!owner) { notify('Connecte-toi pour activer le mode chantier.'); return; }
      await restore();
      if (!owner || !doc) return;
      const sites = ctx().chantiers, on = Boolean(current());
      const title = on ? 'Ton mode chantier' : 'Démarrer un poste';
      const choices = sites.map(c=>`<option value="${escape(c.id)}" ${c.id === (on ? session.chantier_id : ctx().currentId) ? 'selected':''}>${escape(c.name)}</option>`).join('');
      const currentNote = on ? `<div class="mode-current"><b>${active() ? 'Poste en cours' : 'Pause des alertes'}</b><span>Fin automatique : ${escape(endLabel(session.ends_at))}</span><span>${session.push_enabled ? 'Notifications téléphone activées' : 'Sans notifications téléphone'}</span></div>` : '';
      adapter.openModal({title,subtitle:'Ton téléphone reste silencieux en dehors de ce poste.',body:`${currentNote}<form id="journalModeForm" class="form-grid mode-form"><label class="form-field span-2">Chantier<select name="chantier">${choices}</select></label><label class="form-field">Durée du poste<select name="duration"><option value="4">4 heures</option><option value="8" selected>8 heures</option><option value="custom">Choisir la date et l’heure de fin</option></select></label><label class="form-field" id="modeCustomWrap" hidden>Fin du poste<input name="end" type="datetime-local" value="${localDateTime(clock.now()+8*HOUR)}" min="${localDateTime(clock.now()+60000)}" max="${localDateTime(clock.now()+DAY)}"></label><label class="mode-check span-2"><input name="push" type="checkbox" checked> Recevoir les événements sur ce téléphone</label><p class="mode-note span-2">La réception dépend du réseau et des réglages du téléphone. Les publications rapprochées sont regroupées. Les mentions et attributions d’actions arrivent en priorité. Pause et fin du poste s’appliquent aussi aux événements prioritaires.</p>${!pushAvailable() ? '<p class="mode-warning span-2">Les notifications ne sont pas disponibles dans ce navigateur. Sur iPhone/iPad, ajoute le journal à l’écran d’accueil puis ouvre cette application. Le fil reste utilisable.</p>':''}<p class="mode-warning span-2" id="modeFormError" role="alert" hidden></p></form>${on ? `<div class="mode-dialog-controls"><button class="secondary-button" id="modeDialogPause">${active()?'Pause 30 min':'Reprendre'}</button><button class="secondary-button" id="modeDialogExtend">Prolonger d’une heure</button><button class="danger-button" id="modeDialogStop">Terminer le poste</button></div>`:''}`,footer:`<button class="secondary-button" id="modeDialogClose">Fermer</button><button class="primary-button" id="modeDialogStart" ${!sites.length || !config?.enabled ? 'disabled':''}>${on ? 'Redémarrer avec ces réglages' : 'Démarrer mon poste'}</button>`});
      const form = doc.getElementById('journalModeForm');
      form?.elements.duration.addEventListener('change',()=>{doc.getElementById('modeCustomWrap').hidden=form.elements.duration.value!=='custom';});
      const error = e=>{ const node=doc.getElementById('modeFormError'); if(node){node.hidden=false;node.textContent=e.message||'Le mode chantier n’a pas pu être démarré.';} };
      if (!config?.enabled) error({message:'Le service Mode chantier est indisponible. Vérifie la fin du déploiement puis réessaie.'});
      doc.getElementById('modeDialogClose')?.addEventListener('click',adapter.closeModal);
      doc.getElementById('modeDialogStart')?.addEventListener('click',()=> {
        // Deliberately no await before start: Notification.requestPermission needs this tap on iOS.
        void start({chantierId:form.elements.chantier.value,duration:form.elements.duration.value,endsAt:form.elements.end.value,withPush:form.elements.push.checked}).catch(error);
      });
      [['modeDialogPause',active()?'pause':'resume'],['modeDialogExtend','extend'],['modeDialogStop','stop']].forEach(([id,op])=>doc.getElementById(id)?.addEventListener('click',()=>{adapter.closeModal?.();void control(op).catch(e=>notify(e.message));}));
    }
    function endLabel(iso) { return new Date(iso).toLocaleString('fr-FR',{weekday:'short',hour:'2-digit',minute:'2-digit'}); }
    function render() {
      adapter.onState?.(state()); if (!doc) return;
      const on = Boolean(current()), isActive = active(), site = ctx().chantiers.find(c=>c.id===session?.chantier_id);
      const banner = doc.getElementById('journalModeBanner'); if (banner) banner.hidden = !on && !pending;
      const title = doc.getElementById('journalModeStatus'); if(title) title.textContent = pending ? 'Confirmation réseau en attente' : isActive ? 'Mode chantier actif' : 'Alertes en pause';
      const detail = doc.getElementById('journalModeDetail'); if(detail) detail.textContent = `${site?.name || 'Ton chantier'} · ${pending?.operation==='stop' ? 'Arrêt demandé' : `jusqu’à ${endLabel(session?.ends_at)}`}${on&&!session.push_enabled ? ' · Sans notifications téléphone' : ''}`;
      const pause = doc.getElementById('journalModePause'); if(pause){pause.textContent=isActive?'Pause':'Reprendre';pause.disabled=busy||Boolean(pending);}
      ['journalModeStop','journalModeExtend','modeDialogStart'].forEach(id=>{const el=doc.getElementById(id);if(el)el.disabled=busy||(id==='modeDialogStart'&&!config?.enabled);});
      ['modeChantierBtn','sidebarModeChantierBtn'].forEach(id=>{const el=doc.getElementById(id);if(el){el.classList.toggle('is-active',on);el.setAttribute('aria-label',on?'Gérer le mode chantier actif':'Démarrer le mode chantier');}});
      const head = doc.getElementById('journalModeFeedTitle'); if(head) head.textContent=ctx().chantiers.find(c=>c.id===ctx().currentId)?.name || 'Fil chantier';
      const wake = doc.getElementById('journalModeWake'); if(wake){wake.checked=wakeRequested;wake.disabled=!nav?.wakeLock||!isActive;}
    }
    function tick() {
      if (session && session.status !== 'stopped' && !current()) { session={...session,status:'stopped'}; pending=null; saveIntent(); wakeRequested=false; void publishWorker(); releaseWake(); render(); }
      if (session?.status === 'paused' && Date.parse(session.pause_until) <= clock.now() && pending?.operation !== 'stop') { pending=null;saveIntent();session={...session,status:'active',pause_until:null};void publishWorker();render(); }
      if (owner && doc?.visibilityState === 'visible' && clock.now()-syncAt>60000) { syncAt=clock.now();void refresh(); }
      if(route&&!adapter.isOverlayOpen?.())void tryRoute();
      updateWake();
    }
    function wire() {
      if (!doc) return;
      const bind=(id,fn)=>doc.getElementById(id)?.addEventListener('click',()=>{Promise.resolve(fn()).catch(e=>notify(e.message));});
      ['modeChantierBtn','sidebarModeChantierBtn'].forEach(id=>bind(id,openDialog));
      bind('journalModePause',()=>control(active()?'pause':'resume'));bind('journalModeExtend',()=>control('extend'));bind('journalModeStop',()=>control('stop'));bind('journalModeOpenFeed',openFeed);bind('journalModeReturn',exitFeed);bind('journalModeFeedSettings',openDialog);
      doc.getElementById('journalModeWake')?.addEventListener('change',event=>setWake(event.target.checked));
      const visibility=()=>{presence();updateWake();if(doc.visibilityState==='visible'){tick();void refresh();}};
      doc.addEventListener('visibilitychange',visibility);win?.addEventListener('focus',visibility);win?.addEventListener('blur',()=>{presence();releaseWake();});win?.addEventListener('online',()=>void refresh());
      win?.addEventListener('storage',event=>{if(owner&&event.key===intentKey()){pending=null;loadIntent();if(pending){void publishWorker();releaseWake();render();}else void refresh();}});
      nav?.serviceWorker?.addEventListener('message',event=>{
        const data=event.data;if(data?.type==='JOURNAL_MODE_OPEN'&&UUID.test(data.chantierId||'')){route={chantierId:data.chantierId,messageId:UUID.test(data.messageId||'')?data.messageId:null,actionId:UUID.test(data.actionId||'')?data.actionId:null};event.ports?.[0]?.postMessage({ok:true});if(adapter.isOverlayOpen?.())notify('Événement reçu. Il s’ouvrira lorsque tu auras fermé la fenêtre en cours.');void tryRoute();}
      });
      nav?.serviceWorker?.addEventListener('controllerchange',()=>{void publishWorker();presence();});
      clockInterval(tick,5000);clockInterval(presence,25000);
    }
    wire();
    return { contextChanged,restore,start,control,refresh,beforeLogout,clear,openDialog,openFeed,exitFeed,setWake,presence,tick,state,active,clock,deviceId,
      whenIdle:()=>Promise.all([pushLane,workerLane]),dispose:()=>{disposed=true;clear();} };
  }
  return { create,ServerClock,endFromChoice,parseRoute };
});
