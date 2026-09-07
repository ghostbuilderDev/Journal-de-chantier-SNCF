const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'app-v13.js'),'utf8');
function fn(name){const start=source.search(new RegExp('  (?:async )?function '+name+'\\('));assert.ok(start>=0,name);const tail=source.slice(start);const next=tail.slice(1).search(/\n  (?:async )?function /);return next<0?tail:tail.slice(0,next+1);}
(async()=>{
 const nodes={},tabs=[],urls=[],notices=[];let modal,manager=true,fail=false,waiter;
 const app={user:{id:'A'},db:{},portalApps:[]};
 const context={console,URL,app,
  window:{open(url){const tab={url,opener:{},location:{replace:u=>urls.push(u)},close(){this.closed=true}};tabs.push(tab);return tab}},
  navigator:{userAgent:'Android'},
  signedDocumentUrl:async(_item,options)=>{if(fail)throw Error('Accès refusé');if(waiter)await waiter;return options?.force?'https://files.test/new-signed-pdf':'https://files.test/old-signed-pdf'},
  toast:(m)=>notices.push(m),friendlyError:e=>e.message,closeModal(){},
  escapeHtml:s=>String(s).replace(/</g,'&lt;'),formatBytes:()=>'',formatDateTime:()=>'',
  documentCanPreview:()=>true,documentIsImage:()=>false,documentIsText:()=>false,documentIsPdf:()=>true,canManageDocuments:()=>manager,
  openModal:m=>{modal=m;for(const id of (m.body+m.footer).matchAll(/id="([^"]+)"/g))nodes[id[1]]={addEventListener(_,cb){this.click=cb}}},
  $:id=>nodes[id]
 };
 const ctx=vm.createContext(context);
 vm.runInContext(fn('openDocumentInBrowser')+'\n'+fn('openDocumentViewer'),ctx);
 const item={file_name:'Briefing.pdf',mime_type:'application/pdf'};
 await ctx.openDocumentViewer(item);assert.ok(nodes.openDocumentPdf);assert.doesNotMatch(modal.body,/<iframe/);
 nodes.openDocumentPdf.click();assert.equal(tabs.length,1,'Fenêtre créée avant requête');await new Promise(setImmediate);
 assert.equal(tabs[0].opener,null);assert.equal(urls[0],'https://files.test/new-signed-pdf');
 nodes.adminOpenDocument.click();await new Promise(setImmediate);assert.equal(urls[1],urls[0]);
 manager=false;await ctx.openDocumentViewer(item);assert.doesNotMatch(modal.footer,/adminOpenDocument/);assert.match(modal.body,/openDocumentPdf/);
 fail=true;await ctx.openDocumentInBrowser(item);assert.equal(tabs.at(-1).closed,true);assert.match(notices.at(-1),/Accès refusé/);fail=false;
 let release;waiter=new Promise(r=>release=r);const pending=ctx.openDocumentInBrowser(item);app.user={id:'B'};release();await pending;waiter=null;
 assert.equal(tabs.at(-1).closed,true);assert.match(notices.at(-1),/compte a changé/);
 // Portail : ajout chantier réservé à AINM, branche briefing préservée.
 let chantier={id:'site-A'},ready=true,briefing=0;
 context.isCloudReady=()=>ready;context.currentChantier=()=>chantier;context.safePortalUrl=x=>new URL(x).href;
 context.refreshCloudCurrent=()=>{};context.openPortalAppDialog=()=>{};context.window.JournalBriefing={open:()=>briefing++};
 vm.runInContext(['ainmPortalApp','isAinmPortalApp','portalAppById','openPortalApp'].map(fn).join('\n'),ctx);
 ctx.openPortalApp(ctx.ainmPortalApp());assert.equal(new URL(tabs.at(-1).url).searchParams.get('chantierId'),'site-A');
 assert.equal(new URL(tabs.at(-1).url).searchParams.size,1);
 ctx.openPortalApp({icon_key:'briefing'});assert.equal(briefing,1);
 ctx.openPortalApp({url:'https://example.test/tool'});assert.equal(tabs.at(-1).url,'https://example.test/tool');
 ready=false;const count=tabs.length;ctx.openPortalApp(ctx.ainmPortalApp());assert.equal(tabs.length,count);
 assert.equal(ctx.portalAppById('integrated-ainm').name,'Rapport journalier');
 console.log('PASS: bouton bleu et bouton bas, renouvellement URL, ouverture immédiate, refus accès/changement compte, portail AINM et branche briefing conservée.');
})().catch(e=>{console.error(e);process.exitCode=1});
