const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const root=path.resolve(__dirname,'..');
(async()=>{
 const handlers={},elements=[],replies=[],calls=[];
 let fail=true,site={id:'aaaaaaaa-0000-4000-8000-000000000001',name:'Montreux'},user='00000000-0000-4000-8000-000000000002';
 const document={createElement(tag){const e={tag,style:{},append(){},remove(){},contentWindow:{postMessage:data=>replies.push(data)}};elements.push(e);return e},body:{append(){}}};
 const window={addEventListener:(name,fn)=>handlers[name]=fn,removeEventListener(){}};
 const context=vm.createContext({window,document,location:{href:'https://example.test/journal/',origin:'https://example.test'},crypto:require('node:crypto').webcrypto,URL,Blob,confirm:()=>true,console});
 vm.runInContext(fs.readFileSync(path.join(root,'briefing-integration.js'),'utf8'),context);
 const db={storage:{from:()=>({upload:async(path,blob)=>{calls.push({op:'upload',path});return {error:null}}})},rpc:async(name,args)=>{calls.push({op:'rpc',args});return fail?{error:{message:'network'}}:{data:{archived:true}}}};
 window.JournalBriefing.open({context:()=>({ready:true,userId:user,db,chantier:site}),toast(){},refresh(){}});
 const frame=elements.find(e=>e.tag==='iframe'),token=new URL(frame.src).searchParams.get('journal_session');
 const id='cccccccc-0000-4000-8000-000000000001';
 const send=(data,origin='https://example.test',source=frame.contentWindow)=>handlers.message({source,origin,data:{token,...data}});
 await send({type:'briefing-ready'});assert.equal(replies[0].chantier.name,'Montreux');
 const payload={type:'briefing-save',id,blob:new Blob(['%PDF-signed'],{type:'application/pdf'}),filename:'Briefing.pdf'};
 await send(payload,'https://untrusted.test');assert.equal(calls.length,0);
 site={id:'bbbbbbbb-0000-4000-8000-000000000001',name:'Other'};
 await send(payload);assert.equal(replies.at(-1).ok,false);
 fail=false;await send(payload);assert.equal(replies.at(-1).ok,true);
 await send(payload);assert.equal(calls.filter(c=>c.op==='upload').length,1);assert.equal(calls.filter(c=>c.op==='rpc').length,2);
 assert.equal(calls.at(-1).args.p_chantier_id,'aaaaaaaa-0000-4000-8000-000000000001');
 user='00000000-0000-4000-8000-000000000003';await send(payload);assert.equal(replies.at(-1).ok,false);
 // Execute the actual archive gateway code with simulated transport. No network.
 const html=fs.readFileSync(path.join(root,'briefing/index.html'),'utf8');
 for(const [,code] of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) if(code.trim()) new vm.Script(code);
 const gate=html.match(/<script id="v9-direct-archive-gateway">([\s\S]*?)<\/script>/)[1];
 let saves=0,purges=0,submits=0,generated=0,notice='';const ids=[];
 const nodes=new Map();
 const doc={getElementById:id=>nodes.get(id)||null,createElement:()=>({style:{},setAttribute(){},appendChild(){},querySelector:()=>({}),remove(){},submit(){submits++}}),body:{appendChild:e=>{if(e.id)nodes.set(e.id,e)}}};
 const win={crypto:require('node:crypto').webcrypto,showToast:m=>notice=m,confirmPdfSavedAndPurgeV67:()=>purges++,BriefingPwaPdf:{createPdf:async()=>{generated++;return {blob:new Blob(['%PDF-signed'],{type:'application/pdf'}),filename:'Briefing.pdf',meta:{chantier:'Montreux'}}}},JournalBriefingArchive:{save:async(pdf,id)=>{ids.push(id);if(++saves===1)throw Error('network')}}};
 class Reader {readAsDataURL(){this.result='data:application/pdf;base64,cGRm';this.onload()}}
 const gateContext=vm.createContext({window:win,document:doc,crypto:win.crypto,localStorage:{setItem(){},removeItem(){}},FileReader:Reader,setTimeout:fn=>{fn();return 1},clearTimeout(){},URL,Blob,console});
 vm.runInContext(gate,gateContext);
 assert.equal((await win.saveBriefingPdf()).ok,false);assert.equal(purges,0);assert.equal(submits,0);assert.match(notice,/signatures sont conservées/);
 assert.equal((await win.saveBriefingPdf()).ok,true);assert.equal(purges,1);assert.equal(submits,1);assert.equal(generated,1);assert.equal(ids[0],ids[1]);
 console.log('PASS: origine/source, chantier figé, compte changé, PDF, reprise sans doublon, aucun envoi ni purge avant archivage, SharePoint après succès, syntaxe HTML.');
})().catch(e=>{console.error(e);process.exitCode=1});
