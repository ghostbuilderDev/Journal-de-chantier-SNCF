// Optional local runner: Node 24 + @electric-sql/pglite@0.5.8.
// PostgreSQL runs only in memory; this script cannot connect to a Supabase project.
// CI still executes the SQL fixture/assertions against PostgreSQL 16.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8').replace(/^\\set ON_ERROR_STOP on\s*$/gm, '');
const fixture = read('tests/backend-fixture.sql');
const migration = read('migrations/20260906000200_v14_2_schema_production.sql');
const assertions = read('tests/backend-assertions.sql');

async function run() {
  const db = new PGlite();
  try {
    console.log((await db.query('select version() as version')).rows[0].version);
    await db.exec(fixture);
    await db.exec(migration);
    const results = await db.exec(assertions);
    const assertionCount = results.filter(result => result.fields?.some(field => ['test_require','test_denied'].includes(field.name))).length;
    assert.ok(assertionCount >= 50, 'All SQL security/functional assertions must run.');
    console.log(`PASS: ${assertionCount} SQL security/functional assertions.`);
  } finally { await db.close(); }

  const incompatibilities = [
    ['missing historical column', 'alter table profiles rename column company to legacy_company', /colonne attendue/],
    ['wrong access-request identity', 'alter table journal_access_requests rename column requester_id to legacy_requester_id', /colonne attendue/],
    ['one-site-only unique index', 'create unique index test_single_site on chantier_members(user_id)', /UNIQUE\(user_id\)/],
    ['custom Auth deletion trigger', `
      create function public.test_delete_hook() returns trigger language plpgsql as $$begin return old; end$$;
      create trigger test_delete_hook before delete on auth.users for each row execute function public.test_delete_hook();`, /trigger DELETE personnalisé/],
    ['unknown cascading identity FK', 'create table public.test_business_rows(id uuid primary key,owner uuid references auth.users(id) on delete cascade)', /FK inconnue/],
    ['multi-column message constraint', "alter table chantier_messages add constraint test_multicolumn_body check(body <> '' or author_id is not null)", /contrainte multi-colonnes/],
    ['custom membership deletion trigger', `
      create function public.test_delete_hook() returns trigger language plpgsql as $$begin return old; end$$;
      create trigger test_delete_hook before delete on public.chantier_members for each row execute function public.test_delete_hook();`, /trigger DELETE personnalisé/],
    ['business cascade through memberships', `create table public.test_business_rows(
      chantier_id uuid,user_id uuid,foreign key(chantier_id,user_id) references public.chantier_members(chantier_id,user_id) on delete cascade)`, /cascade indirecte/],
  ];
  for (const [label, setup, expected] of incompatibilities) {
    const isolated = new PGlite();
    try {
      await isolated.exec(fixture);
      await isolated.exec(setup);
      await assert.rejects(isolated.exec(migration), expected, label);
      await isolated.exec('rollback');
      const result = await isolated.query(`select
        to_regclass('public.journal_user_access_blocks') is null as no_extension_table,
        not exists(select 1 from information_schema.columns where table_schema='public' and table_name='action_items' and column_name='assignee_user_id') as no_extension_column,
        (select count(*)=2 from public.action_items) as actions_preserved,
        (select count(*)=8 from public.journal_access_requests) as requests_preserved,
        exists(select 1 from pg_constraint where conrelid='public.chantiers'::regclass and confrelid='auth.users'::regclass and confdeltype='c') as original_fk_preserved`);
      assert.deepEqual(result.rows[0], {
        no_extension_table: true, no_extension_column: true,
        actions_preserved: true, requests_preserved: true, original_fk_preserved: true,
      }, `Atomic rollback: ${label}`);
      console.log(`PASS: migration rejects ${label}; original schema/data preserved.`);
    } finally { await isolated.close(); }
  }
  console.log(`PASS: ${incompatibilities.length} incompatible schemas rejected with transaction rollback. No production access.`);
}
run().catch(error => { console.error(error); process.exitCode = 1; });
