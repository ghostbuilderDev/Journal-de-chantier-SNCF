const {test}=require('node:test'),assert=require('node:assert/strict');
const {classify,normalize}=require('../briefing/presence-matching.js');
const person=(id,extra={})=>({local_id:id,nom:'DUPONT',prenom:'Élodie',entreprise:'SNCF',fonction:'RSO',signature:'',...extra});
test('Case, accents and whitespace are presentation differences',()=>{
 assert.deepEqual(classify([person('existing')],{nom:'  Dupont ',prenom:'elodie',entreprise:'SNCF RÉSEAU',fonction:'Responsable sécurité'}),{kind:'attach',participantId:'existing'});
});
test('Compound names and common apostrophes normalize consistently',()=>{
 assert.equal(normalize('D’Haÿ'),normalize("d'hay"));assert.equal(normalize('Jean‑Pierre'),normalize('Jean Pierre'));
});
test('Two homonyms always need review, even if only one is unsigned',()=>{
 assert.equal(classify([person('one'),person('two',{signature:'signed'})],person('receipt')).kind,'homonyms');
});
test('A second submission does not replace a signature automatically',()=>{
 assert.equal(classify([person('one',{signature:'signed'})],person('receipt')).kind,'signed');
});
test('A typo or different first name never appends or attaches automatically',()=>{
 for(const data of [{nom:'DUPOND',prenom:'Élodie'},{nom:'DUPONT',prenom:'Émilie'},{nom:'DUPONT',prenom:''}])assert.equal(classify([person('one')],data).kind,'unknown');
});
test('A new participant must be confirmed by the organizer',()=>{
 assert.equal(classify([],person('receipt')).kind,'unknown');
});
