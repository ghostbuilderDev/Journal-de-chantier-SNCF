const {PGlite}=require(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8').replace(/^\\set ON_ERROR_STOP on\s*$/gm,'');
(async()=>{
 const db=new PGlite();
 try {
  for(const f of ['tests/backend-fixture.sql','tests/backend-production-shape.sql','migrations/20260906000300_v14_2_contraintes_reelles.sql'])await db.exec(read(f));
  await db.exec(`alter table storage.objects add column metadata jsonb;
   alter table storage.objects add unique(bucket_id,name);
   alter table chantier_documents add column description text;
   alter table chantier_documents add unique(storage_path);
   alter table chantier_document_folders add check(root_code in ('securite','plans','qualite','personnalise'));
   insert into chantier_document_folders(chantier_id,root_code,name,is_root) values('aaaaaaaa-0000-4000-8000-000000000001','securite','Sécurité',true);
   drop policy old_storage_permissive on storage.objects;
   create function public.journal_document_path_chantier_id(p_path text) returns uuid language sql immutable as $$select split_part(p_path,'/',2)::uuid$$;`);
  await db.exec(read('migrations/20260907000600_briefing_archive.sql'));
  const migration=read('migrations/20260907000700_archive_rapports_journaliers.sql');
  await db.exec(migration);await db.exec(migration);
  const site='aaaaaaaa-0000-4000-8000-000000000001',other='bbbbbbbb-0000-4000-8000-000000000001';
  const user=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
  const login=async n=>db.exec(`reset role; set request.jwt.claim.sub='${user(n)}'; set role authenticated;`);
  const reserve=(siteId=site,hash='a'.repeat(64))=>db.query('select (reserve_journal_report($1,$2,$3,$4)).*',[siteId,hash,'Rapport.pdf',20]);
  const finish=id=>db.query('select (finalize_journal_report($1)).*',[id]);
  const upload=(r,size=20)=>db.query('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)',['chantier-documents',r.storage_path,{size,mimetype:'application/pdf'}]);
  await login(2);await assert.rejects(reserve(other),/Accès/);
  const r=(await reserve()).rows[0];
  assert.equal((await reserve()).rows[0].id,r.id);
  await assert.rejects(finish(r.id),/absent ou incomplet/);
  await upload(r);const result=(await finish(r.id)).rows[0];assert.equal(result.file_name,'Rapport.pdf');
  assert.equal((await finish(r.id)).rows[0].id,r.id);
  await assert.rejects(upload(r),/duplicate key/);
  await db.exec('reset role');
  assert.equal((await db.query('select count(*)::int as n from chantier_messages')).rows[0].n,1,'Aucun message ajouté par le rapport');
  assert.equal((await db.query("select count(*)::int as n from chantier_document_folders where name='Rapports journaliers'")).rows[0].n,1);
  // Le briefing garde son fil + son dossier après la migration du rapport.
  await login(2);const briefingId='cccccccc-0000-4000-8000-000000000001';
  await db.query('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)',['chantier-documents',`documents/${site}/${briefingId}/briefing-${user(2)}.pdf`,{size:20,mimetype:'application/pdf'}]);
  assert.equal((await db.query('select journal_archive_briefing($1,$2,$3,$4) as r',[briefingId,site,'Briefing.pdf',20])).rows[0].r.archived,true);
  await login(3);await assert.rejects(finish(r.id),/non autorisée/);
  // Un autre membre ne peut pas utiliser une réservation appartenant à A.
  await assert.rejects(db.query('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)',['chantier-documents',r.storage_path+'x',{size:20,mimetype:'application/pdf'}]),/row-level security/);
  for(const n of [5,7]){await login(n);await assert.rejects(reserve(),/Accès/);}
  await login(2);const pending=(await reserve(site,'b'.repeat(64))).rows[0];await upload(pending,19);
  await assert.rejects(finish(pending.id),/incomplet/);
  await db.exec(`reset role; insert into journal_user_access_blocks(user_id) values('${user(2)}');`);
  await login(2);assert.equal((await db.query('select journal_can_archive_report($1) as ok',[site])).rows[0].ok,false);
  await assert.rejects(reserve(),/Accès/);await assert.rejects(finish(pending.id),/non autorisée/);
  await assert.rejects(db.query('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)',['chantier-documents',pending.storage_path,{size:20,mimetype:'application/pdf'}]),/row-level security/);
  await db.exec('reset role');
  assert.equal((await db.query('select count(*)::int as n from chantier_messages')).rows[0].n,2);
  assert.equal((await db.query("select count(*)::int as n from chantier_documents where file_name='Historique.pdf'")).rows[0].n,1);
  console.log('PASS PostgreSQL: coexistence briefing+rapport, fil inchangé par AINM, historique conservé, dossier unique, reprise idempotente, PDF incomplet, cloisonnement, lecteur/non-membre/compte révoqué refusés, migration rejouable.');
 }finally{await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
