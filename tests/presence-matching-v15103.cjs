const {test}=require('node:test'),assert=require('node:assert/strict');
const {normalize,classify,merge,compareReceipts}=require('../briefing/presence-matching.js');
const session='session-today',png='data:image/png;base64,aW1hZ2U=';
const person=(extra={})=>({local_id:'saved',nom:'DUPONT',prenom:'Élodie',entreprise:'S.N.C.F.',fonction:'RSO',signature:'',...extra});
const receipt=(id,extra={})=>({id,session_id:session,nom:'Dupont',prenom:'Elodie',entreprise:'SNCF',fonction:'Agent terrain',signature:png,created_at:'2026-09-10T18:00:00.000001+00:00',...extra});
let sequence=0;const run=(people,rows,extra={})=>merge(people,rows,{sessionId:session,createId:()=>`new-${++sequence}`,...extra});
test('Case, accents, separators and company punctuation identify the saved person',()=>{
 assert.equal(normalize('D’Haÿ'),normalize("d'hay"));assert.equal(normalize('Jean‑Pierre'),normalize('Jean Pierre'));
 const r=run([person()], [receipt('r1')]);assert.equal(r.participants.length,1);assert.equal(r.participants[0].local_id,'saved');assert.equal(r.participants[0].remote_id,'r1');
});
test('A new QR participant is added immediately without review',()=>{
 const r=run([], [receipt('r1')]);assert.equal(r.participants.length,1);assert.equal(r.participants[0].nom,'DUPONT');assert.equal(r.participants[0].entreprise,'SNCF');assert.deepEqual(r.consumedIds,['r1']);
});
test('The latest signature replaces the old one while preserving the saved row',()=>{
 const old=person({signature:'data:image/png;base64,b2xk',remote_id:'old',remote_session:session,signed_at:'2026-09-10T17:00:00Z'});
 const r=run([old], [receipt('new')]);assert.equal(r.participants.length,1);assert.equal(r.participants[0].signature,png);assert.equal(r.participants[0].local_id,'saved');assert.ok(r.handledIds.includes('old'));assert.equal(old.remote_id,'old','Input state is not mutated');
});
test('Changing the function does not create another person',()=>{
 const r=run([person()], [receipt('r1',{fonction:'RPT'})]);assert.equal(r.participants.length,1);assert.equal(r.participants[0].fonction,'RPT');
});
test('Equal names at different companies remain separate',()=>{
 assert.equal(classify([person({entreprise:'ENTREPRISE A'})],receipt('r1',{entreprise:'ENTREPRISE B'})).kind,'add');
 assert.equal(run([person({entreprise:'ENTREPRISE A'})], [receipt('r1',{entreprise:'ENTREPRISE B'})]).participants.length,2);
});
test('A single saved name without company can be completed automatically',()=>{
 const r=run([person({entreprise:''})],[receipt('r1')]);assert.equal(r.participants.length,1);assert.equal(r.participants[0].entreprise,'SNCF');
});
test('Duplicate rows of the same identity become one row; unrelated rows remain',()=>{
 const r=run([person(),person({local_id:'duplicate'}),person({local_id:'other-company',entreprise:'Autre'})],[receipt('r1')]);
 assert.equal(r.participants.length,2);assert.equal(r.participants[0].local_id,'saved');assert.equal(r.participants[1].local_id,'other-company');assert.deepEqual(r.events[0].merged_ids,['duplicate']);
});
test('Repeated polling, retries and duplicate receipts do not add rows',()=>{
 const first=run([],[receipt('r1'),receipt('r1')]);const repeated=run(first.participants,[receipt('r1')],{ignoredIds:first.handledIds});
 assert.deepEqual(repeated.participants,first.participants);assert.equal(repeated.events.length,0);
});
test('Newest receipt wins even with reversed batches and sub-millisecond timestamps',()=>{
 const newer=receipt('a',{created_at:'2026-09-10T18:00:00.000009+00:00',signature:'data:image/png;base64,bmV3'}),older=receipt('z');
 assert.ok(compareReceipts(newer,older)>0);
 const first=run([],[newer,older]);assert.equal(first.participants[0].remote_id,'a');
 const delayed=run(first.participants,[receipt('y',{created_at:'2026-09-10T19:59:59+02:00'})]);assert.equal(delayed.participants[0].signature,newer.signature);
});
test('Pending receipts from another session never enter this briefing',()=>{
 const r=run([],[receipt('r1'),receipt('old',{session_id:'yesterday'})]);assert.equal(r.participants.length,1);assert.deepEqual(r.consumedIds,['r1']);
});
test('Previously removed receipts remain removed; a new signature can be received',()=>{
 const r=run([],[receipt('removed'),receipt('new')],{ignoredIds:['removed']});assert.equal(r.participants.length,1);assert.equal(r.participants[0].remote_id,'new');
});
