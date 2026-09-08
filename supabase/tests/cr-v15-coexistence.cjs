const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..'),read=f=>fs.readFileSync(path.join(root,f),'utf8').replace(/^\\set ON_ERROR_STOP on\s*$/gm,'');
(async()=>{const db=new PGlite();try{
 for(const f of ['supabase/tests/backend-fixture.sql','supabase/tests/backend-production-shape.sql','supabase/migrations/20260906000300_v14_2_contraintes_reelles.sql','supabase/migrations/20260906000400_v14_4_mode_chantier.sql','supabase/tests/feedback-backend-fixture.sql'])await db.exec(read(f));
 await db.exec(`alter table storage.objects add unique(bucket_id,name);alter table chantier_documents add column description text;alter table chantier_documents add unique(storage_path);
 create function public.journal_document_path_chantier_id(p_path text) returns uuid language sql immutable as $$select split_part(p_path,'/',2)::uuid$$;`);
 for(const f of ['supabase/migrations/20260907000500_v14_5_retours_application.sql','supabase/migrations/20260907000600_briefing_archive.sql','supabase/migrations/20260907000700_archive_rapports_journaliers.sql','supabase/migrations/20260908000100_v15_cr_encadrement.sql'])await db.exec(read(f));
 await db.exec("set request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';select journal_v142_assert_account_cleanup_safe();");
 console.log('PASS coexistence : mode chantier, retours application, briefing, rapports AINM, CR V15 et suppression sûre des comptes.');
}finally{await db.close()}})().catch(e=>{console.error(e.message,e.where||'');process.exitCode=1});
