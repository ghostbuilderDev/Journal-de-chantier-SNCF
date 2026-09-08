import {allowedEndpoint,equalSecret} from '../journal-mode-push/handler.mjs';
export function createHandler({env,rpc,sendPush}){
 return async request=>{
  if(request.method!=='POST')return new Response('Method not allowed',{status:405});
  if(!env.JOURNAL_MODE_DISPATCH_SECRET || !await equalSecret(request.headers.get('x-journal-dispatch-secret')||'',env.JOURNAL_MODE_DISPATCH_SECRET))return new Response('Unauthorized',{status:401});
  if(!env.JOURNAL_VAPID_PUBLIC_KEY||!env.JOURNAL_VAPID_PRIVATE_KEY)return new Response('Push not configured',{status:503});
  try{
   const jobs=await rpc('journal_v15_push_jobs',{});let count=0;
   for(let offset=0;offset<jobs.length;offset+=5){
    await Promise.allSettled(jobs.slice(offset,offset+5).map(async j=>{
     let status='retry';
     if(!allowedEndpoint(j.endpoint)){status='gone';}
     else try{
      await sendPush({endpoint:j.endpoint,keys:j.keys},JSON.stringify({version:'15',userId:j.user_id,deviceId:j.device_id,id:j.id,expiresAt:j.expires_at}),
       {TTL:300,timeout:8000,urgency:'normal',vapidDetails:{subject:env.JOURNAL_VAPID_SUBJECT,publicKey:env.JOURNAL_VAPID_PUBLIC_KEY,privateKey:env.JOURNAL_VAPID_PRIVATE_KEY}});
      status='sent';count++;
     }catch(e){if([404,410].includes(e.statusCode))status='gone';}
     await rpc('journal_v15_push_finish',{p_id:j.id,p_device:j.device_id,p_lease:j.lease,p_status:status});
    }));
   }
   return Response.json({processed:count});
  }catch{return new Response('Unavailable',{status:503});}
 };
}
