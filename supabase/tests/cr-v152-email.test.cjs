const test=require('node:test'),assert=require('node:assert/strict');
test('email layout uses escaped stored text and renders separate planned/actual table',async()=>{
 const{emailMarkup}=await import('../functions/journal-cr-send-v152/markup.mjs');
 const html=emailMarkup('CR OFF — DIFFUSION RESTREINTE\n\nCONSIGNATIONS CATÉNAIRES\n • SEL <1>\n   Prévu : 23:00 → 05:00\n   Réel : 23:10 → 05:05\n   Commentaire : <img src=x onerror=alert(1)>');
 assert.match(html,/<table/);assert.match(html,/SEL &lt;1&gt;/);assert.match(html,/23:00 → 05:00/);assert.match(html,/23:10 → 05:05/);assert.doesNotMatch(html,/<img|<script/);assert.equal(emailMarkup('Legacy version'),undefined);
});
test('new endpoint keeps bearer auth, configured sender and immutable server text',async()=>{
 const{createHandler}=await import('../functions/journal-cr-send-v152/handler.mjs');let submitted;
 const handler=createHandler({env:{RESEND_API_KEY:'test-only',JOURNAL_CR_FROM:'sender@example.com'},rpc:async(name)=>name==='journal_cr_api'?{id:'stored-delivery',recipients:['chosen@example.com'],subject:'CR test',body:'CR OFF — DIFFUSION RESTREINTE\n\nPRODUCTION RÉALISÉE\nTexte validé'}:{},fetcher:async(url,opts)=>{submitted=JSON.parse(opts.body);return new Response('{"id":"mock-provider"}',{status:200});}});
 assert.equal((await handler(new Request('https://example.com',{method:'POST',body:'{}'}))).status,401);
 const result=await handler(new Request('https://example.com',{method:'POST',headers:{Authorization:'Bearer test'},body:JSON.stringify({ids:['aaaaaaaa-0000-4000-8000-000000000001'],text:'Texte client ignoré',recipients:['unwanted@example.com']})}));
 assert.equal(result.status,200);assert.deepEqual(submitted.to,['chosen@example.com']);assert.match(submitted.html,/Texte validé/);assert.doesNotMatch(submitted.html,/Texte client ignoré/);
});
