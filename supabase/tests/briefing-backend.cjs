const {PGlite}=require(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8').replace(/^\\set ON_ERROR_STOP on\s*$/gm,'');
(async()=>{
 const db=new PGlite();
 try {
  for (const f of ['tests/backend-fixture.sql','tests/backend-production-shape.sql','migrations/20260906000300_v14_2_contraintes_reelles.sql']) await db.exec(read(f));
  await db.exec(`alter table storage.objects add column metadata jsonb;
   alter table chantier_documents add column description text;
   insert into chantier_document_folders(chantier_id,root_code,name,is_root) values('aaaaaaaa-0000-4000-8000-000000000001','securite','Sécurité',true);
   drop policy old_storage_permissive on storage.objects;
   create function public.journal_document_path_chantier_id(p_path text) returns uuid language sql immutable as $$select split_part(p_path,'/',2)::uuid$$;`);
  const migration=read('migrations/20260907000600_briefing_archive.sql');
  await db.exec(migration); await db.exec(migration);
  const site='aaaaaaaa-0000-4000-8000-000000000001', other='bbbbbbbb-0000-4000-8000-000000000001';
  const id='cccccccc-0000-4000-8000-000000000001';
  const user=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
  const login=async n=>db.exec(`reset role; set request.jwt.claim.sub='${user(n)}'; set role authenticated;`);
  const call=(siteId=site,docId=id,size=20)=>db.query('select journal_archive_briefing($1,$2,$3,$4) as r',[docId,siteId,'Briefing.pdf',size]);
  await login(2);
  await assert.rejects(call(),/pas été reçu/);
  await assert.rejects(call(other),/Accès/);
  await db.query('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)', ['chantier-documents',`documents/${site}/${id}/briefing-${user(2)}.pdf`,{size:20,mimetype:'application/pdf'}]);
  const first=await call();assert.equal(first.rows[0].r.archived,true);
  assert.deepEqual((await call()).rows,first.rows);
  await login(3);await assert.rejects(call(),/déjà utilisé/);
  await login(5);await assert.rejects(call(),/Accès/);
  await assert.rejects(db.query('insert into storage.objects(bucket_id,name) values($1,$2)',['chantier-documents',`documents/${site}/${id}/briefing-${user(5)}.pdf`]),/row-level security/);
  await login(7);await assert.rejects(call(),/Accès/);
  await db.exec('reset role');
  assert.equal((await db.query('select count(*)::int as n from journal_briefing_receipts')).rows[0].n,1);
  assert.equal((await db.query('select count(*)::int as n from chantier_messages where briefing_document_id=$1',[id])).rows[0].n,1);
  assert.equal((await db.query("select count(*)::int as n from chantier_document_folders where name='Briefings'")).rows[0].n,1);
  // Force a feed failure: archive and folder changes must roll back with it.
  await db.exec(`create function reject_briefing_test() returns trigger language plpgsql as $$begin raise exception 'test feed failure'; end$$;
   create trigger reject_briefing_test before insert on chantier_messages for each row execute function reject_briefing_test();`);
  await login(2);
  const id2='cccccccc-0000-4000-8000-000000000002';
  await db.query('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)',['chantier-documents',`documents/${site}/${id2}/briefing-${user(2)}.pdf`,{size:20,mimetype:'application/pdf'}]);
  await assert.rejects(call(site,id2),/test feed failure/);
  await db.exec('reset role');
  assert.equal((await db.query('select count(*)::int as n from chantier_documents where id=$1',[id2])).rows[0].n,0);
  console.log('PASS: migration rejouable, droits membre/lecteur/inconnu, cloisonnement chantier, fichier requis, dédoublonnage et transaction fil + archive.');
 } finally {await db.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1});
