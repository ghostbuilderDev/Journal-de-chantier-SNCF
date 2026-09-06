// Pure dispatcher. All capabilities are injected; no credentials appear in responses/logs.
export const VERSION = '14.4';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const B64 = /^[A-Za-z0-9_-]+$/;
const DAY = 86400000;
export function allowedEndpoint(value) {
  if (typeof value !== 'string' || value.length > 4096 || /[\s\\\u0000-\u001f]/.test(value)) return false;
  try {
    const u = new URL(value), authority = value.split('/')[2];
    if (u.protocol !== 'https:' || u.username || u.password || u.hash || u.port || authority.includes(':') || u.pathname.length < 2) return false;
    return u.hostname === 'fcm.googleapis.com' || u.hostname === 'web.push.apple.com' ||
      /^(?:[a-z0-9-]+\.)*push\.services\.mozilla\.com$/.test(u.hostname) ||
      /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.notify\.windows\.com$/.test(u.hostname);
  } catch { return false; }
}
export async function equalSecret(a, b, cryptography = globalThis.crypto) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length > 512 || b.length > 512) return false;
  const bytes = new TextEncoder();
  const [x,y] = await Promise.all([a,b].map(v => cryptography.subtle.digest('SHA-256', bytes.encode(v))));
  const xx = new Uint8Array(x), yy = new Uint8Array(y); let difference = 0;
  for (let i = 0; i < xx.length; i++) difference |= xx[i] ^ yy[i];
  return difference === 0;
}
export function configured(env) {
  const keys = [env.JOURNAL_VAPID_PUBLIC_KEY, env.JOURNAL_VAPID_PRIVATE_KEY];
  if (!keys.every(k => typeof k === 'string' && B64.test(k)) || keys[0].length !== 87 || keys[1].length !== 43) return false;
  if (typeof env.JOURNAL_MODE_DISPATCH_SECRET !== 'string' || env.JOURNAL_MODE_DISPATCH_SECRET.length < 32) return false;
  if (!env.SUPABASE_SERVICE_ROLE_KEY || !env.SUPABASE_URL) return false;
  try { return new URL(env.JOURNAL_VAPID_SUBJECT).protocol === 'https:'; } catch { return false; }
}
function deliveryPayload(job, now) {
  if (!job || !['delivery_id','session_id','user_id','device_id','chantier_id','event_id'].every(k => UUID.test(job[k] || ''))) return null;
  const end = Date.parse(job.ends_at);
  if (!Number.isFinite(end) || end <= now + 1000 || end > now + DAY + 60000) return null;
  if (job.status && job.status !== 'active') return null;
  if (!allowedEndpoint(job.endpoint) || !job.keys || !/^[A-Za-z0-9_-]{87}=?$/.test(job.keys.p256dh || '') || !/^[A-Za-z0-9_-]{22}={0,2}$/.test(job.keys.auth || '')) return null;
  const count = Number(job.event_count);
  if (!Number.isInteger(count) || count < 1 || count > 9999) return null;
  if (job.message_id && !UUID.test(job.message_id) || job.action_id && !UUID.test(job.action_id)) return null;
  const kind = {message:'Un nouveau message', action:'Une action à consulter', document:'Un nouveau document', event:'Un nouvel événement'}[job.event_kind] || 'Une nouveauté';
  const name = typeof job.chantier_name === 'string' ? job.chantier_name.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').slice(0,100) : 'Journal de chantier';
  return {version:VERSION, userId:job.user_id, deviceId:job.device_id, sessionId:job.session_id, chantierId:job.chantier_id,
    expiresAt:new Date(end).toISOString(), eventId:job.event_id, count, priority:job.priority === true,
    title:name || 'Journal de chantier', body:count > 1 ? `${count} nouveautés à consulter sur votre chantier.` : `${kind} sur votre chantier.`,
    ...(job.message_id ? {messageId:job.message_id} : {}), ...(job.action_id ? {actionId:job.action_id} : {})};
}
function response(status, body) {
  return new Response(JSON.stringify(body), {status, headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
}
export function createHandler({env, rpc, sendPush, now = Date.now, cryptography = globalThis.crypto}) {
  return async request => {
    const ready = configured(env);
    if (request.method === 'GET') return response(ready ? 200 : 503, {ready,version:VERSION});
    if (request.method !== 'POST') return response(405,{error:'method_not_allowed'});
    if (!ready) return response(503,{error:'not_configured'});
    if (!await equalSecret(request.headers.get('x-journal-dispatch-secret'), env.JOURNAL_MODE_DISPATCH_SECRET, cryptography)) return response(401,{error:'unauthorized'});
    // Body is deliberately ignored: callers cannot choose users, endpoints or payloads.
    let jobs;
    try { jobs = await rpc('journal_mode_dispatch_claim',{p_limit:40}); }
    catch { return response(503,{error:'claim_unavailable'}); }
    if (!Array.isArray(jobs) || jobs.length > 40) return response(503,{error:'invalid_claim'});
    const counts = {sent:0,retry:0,gone:0,dropped:0,errors:0};
    async function finish(id, result) {
      counts[result]++;
      try { await rpc('journal_mode_dispatch_finish',{p_delivery_id:id,p_result:result}); }
      catch { counts.errors++; } // Lease expiry permits recovery; one job never aborts the batch.
    }
    async function dispatch(job) {
      if (!job || !UUID.test(job.delivery_id || '')) { counts.errors++; return; }
      let confirmed;
      try { confirmed = await rpc('journal_mode_dispatch_confirm',{p_delivery_id:job.delivery_id}); }
      catch { await finish(job.delivery_id,'retry'); return; }
      // Confirm atomically rechecks owner, rights, pause, end, current endpoint and presence.
      if (!confirmed || confirmed.delivery_id !== job.delivery_id) { await finish(job.delivery_id,'dropped'); return; }
      const payload = deliveryPayload(confirmed,now());
      if (!payload) { await finish(job.delivery_id,'dropped'); return; }
      try {
        await sendPush({endpoint:confirmed.endpoint,keys:confirmed.keys}, JSON.stringify(payload), {
          TTL:0, contentEncoding:'aes128gcm', urgency:payload.priority ? 'high' : 'normal',
          topic:confirmed.session_id.replaceAll('-',''), timeout:Math.min(8000,Math.max(1,Date.parse(confirmed.ends_at)-now())),
          vapidDetails:{subject:env.JOURNAL_VAPID_SUBJECT, publicKey:env.JOURNAL_VAPID_PUBLIC_KEY, privateKey:env.JOURNAL_VAPID_PRIVATE_KEY}
        });
        await finish(job.delivery_id,'sent');
      } catch (error) {
        const code = Number(error?.statusCode || 0);
        await finish(job.delivery_id,code === 404 || code === 410 ? 'gone' : code === 400 || code === 413 ? 'dropped' : 'retry');
      }
    }
    // Forty deliveries, ten lanes: at most 4*(8s confirm + 8s send + 8s finish) + 8s claim.
    // This 104s I/O budget stays below the 120s SQL lease and Supabase free 150s limit.
    let cursor = 0;
    await Promise.all(Array.from({length:Math.min(10,jobs.length)},async () => {
      while (cursor < jobs.length) await dispatch(jobs[cursor++]);
    }));
    return response(200,{ok:true,version:VERSION,...counts});
  };
}
