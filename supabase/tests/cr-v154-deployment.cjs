// Test the exact SQL envelope produced by the production installer, not just raw SQL.
const path=require('node:path'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const {setup153}=require('./cr-v153-backend.cjs');
const root=path.resolve(__dirname,'../..');
const sql=execFileSync(process.env.PYTHON||'python3',[path.join(root,'scripts/deploy-v154-release.py'),'--print-sql'],{encoding:'utf8'});
(async()=>{const db=new PGlite();try{
 await setup153(db);
 await db.exec('CREATE TABLE IF NOT EXISTS public.journal_sql_migrations(migration_name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());');
 const originalApi=(await db.query("select pg_get_functiondef('public.journal_cr_api(text,jsonb)'::regprocedure) body")).rows[0].body;
 const originalMessages=(await db.query('select count(*)::int n from public.chantier_messages')).rows[0].n;
 const failed=sql.replace('INSERT INTO public.journal_sql_migrations(migration_name)', 'SELECT journal_intentional_failure_for_rollback();\nINSERT INTO public.journal_sql_migrations(migration_name)');
 await assert.rejects(db.exec(failed), /journal_intentional_failure_for_rollback/);
 await db.exec('ROLLBACK;');
 assert.equal((await db.query("select to_regclass('journal_cr_private.production_sheets')::text name")).rows[0].name,null);
 assert.equal((await db.query('select count(*)::int n from public.journal_sql_migrations')).rows[0].n,0);
 assert.equal((await db.query("select pg_get_functiondef('public.journal_cr_api(text,jsonb)'::regprocedure) body")).rows[0].body,originalApi);
 await db.exec(sql);
 assert.equal((await db.query("select count(*)::int n from public.journal_sql_migrations where migration_name='20260909000200_v15_4_production_email.sql'")).rows[0].n,1);
 assert.ok((await db.query("select to_regclass('journal_cr_private.production_sheets')::text name")).rows[0].name);
 assert.equal((await db.query('select count(*)::int n from public.chantier_messages')).rows[0].n,originalMessages);
 console.log('PASS V15.4 installer: exact wrapped transaction executes, failure rolls back SQL and ledger, prior API retained on failure, successful migration registered once, messages retained.');
 }finally{await db.close();}})().catch(e=>{console.error(e.message,e.where||'');process.exitCode=1});
