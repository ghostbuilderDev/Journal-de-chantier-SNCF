// npm registry verified: web-push 3.6.7, integrity recorded in V14.4 release notes.
import webpush from 'npm:web-push@3.6.7';
import { createHandler } from './handler.mjs';
const env = Object.fromEntries(['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','JOURNAL_MODE_DISPATCH_SECRET',
  'JOURNAL_VAPID_PUBLIC_KEY','JOURNAL_VAPID_PRIVATE_KEY','JOURNAL_VAPID_SUBJECT'].map(k => [k,Deno.env.get(k) || '']));
async function rpc(name: string, args: Record<string,unknown>) {
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method:'POST', redirect:'error', signal:AbortSignal.timeout(8000),
    headers:{'Content-Type':'application/json','apikey':env.SUPABASE_SERVICE_ROLE_KEY,'Authorization':`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`},
    body:JSON.stringify(args)
  });
  if (!response.ok) throw new Error('rpc_failed');
  const text = await response.text(); return text ? JSON.parse(text) : null;
}
// web-push encrypts and signs; fetch enforces a complete timeout and refuses redirects.
async function sendPush(subscription: unknown, payload: string, options: Record<string,unknown>) {
  const details = webpush.generateRequestDetails(subscription,payload,options);
  const response = await fetch(details.endpoint, {
    method:'POST', headers:details.headers, body:new Uint8Array(details.body),
    redirect:'error', signal:AbortSignal.timeout(Math.min(8000,Math.max(1,Number(options.timeout) || 8000)))
  });
  if (!response.ok) { const error = new Error('push_failed'); Object.assign(error,{statusCode:response.status}); throw error; }
  await response.body?.cancel();
}
Deno.serve(createHandler({env,rpc,sendPush}));
