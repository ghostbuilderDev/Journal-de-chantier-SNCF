/* Run with: node --test tests/admin-ui.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app-v13.js'), 'utf8');
const helpers = source.slice(source.indexOf('  function directorySearchText('), source.indexOf('  async function verifyJournalOwnerPassword('));
const normalize = value => JSON.parse(JSON.stringify(value));
function sandbox(overrides = {}) {
  const context = {
    app: { chantiers: [] },
    isJournalOwner: () => true,
    roleLabel: role => ({ membre: 'Contributeur', lecture: 'Lecture seule', administrateur: 'Administrateur du chantier' })[role],
    escapeHtml: value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[c]),
    ...overrides
  };
  vm.createContext(context);
  vm.runInContext(helpers, context);
  return context;
}
function accessCard(globalRole, memberships) {
  const rows = memberships.map(({ id, role, checked = true }) => ({
    dataset: { dashboardMembership: id },
    querySelector: selector => selector === '[data-dashboard-enabled]' ? { checked } : { value: role }
  }));
  return { dataset: { dashboardUserId: 'user-a' }, querySelector: () => ({ value: globalRole }), querySelectorAll: () => rows };
}

test('save keeps several chantier grants and distinct roles, removes only unchecked grants', () => {
  const context = sandbox();
  assert.deepEqual(normalize(context.readDashboardAccess(accessCard('', [
    { id: 'chantier-a', role: 'administrateur' },
    { id: 'chantier-b', role: 'administrateur' },
    { id: 'chantier-c', role: 'lecture' },
    { id: 'chantier-d', role: 'membre', checked: false }
  ]))), {
    p_user_id: 'user-a', p_global_role: '', p_memberships: [
      { chantier_id: 'chantier-a', role: 'administrateur' },
      { chantier_id: 'chantier-b', role: 'administrateur' },
      { chantier_id: 'chantier-c', role: 'lecture' }
    ]
  });
});

test('global administrator does not need a chantier; empty local access requires explicit revoke', () => {
  const context = sandbox();
  assert.equal(context.readDashboardAccess(accessCard('administrateur_general', [])).p_global_role, 'administrateur_general');
  assert.throws(() => context.readDashboardAccess(accessCard('', [])), /Retirer tous les accès/);
  assert.throws(() => context.readDashboardAccess(accessCard('proprietaire', [])), /invalide/);
  assert.throws(() => context.readDashboardAccess(accessCard('', [{ id: 'a', role: 'proprietaire' }])), /invalide/);
});

test('existing memberships stay visible when chantier list is stale; labels are escaped', () => {
  const context = sandbox({ app: { chantiers: [{ id: 'a', name: 'Atelier <Nord>' }] } });
  const html = context.dashboardMembershipMarkup({ chantiers: [
    { id: 'a', role: 'lecture', name: 'Atelier <Nord>' },
    { chantier_id: 'b', role: 'administrateur', name: '<img src=x onerror=alert(1)>' }
  ] });
  assert.match(html, /data-dashboard-membership="a"/);
  assert.match(html, /data-dashboard-membership="b"/);
  assert.match(html, /value="lecture" selected/);
  assert.match(html, /value="administrateur" selected/);
  assert.equal((html.match(/data-dashboard-enabled checked/g) || []).length, 2);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
});

test('directory search supports accents, full name and company, without searching e-mail', () => {
  const context = sandbox();
  const people = [
    { id: 'a', full_name: 'Mickaël Petit', company: 'Équipe Nord', email: 'private@example.org' },
    { id: 'b', full_name: 'Élodie Martin', company: 'SNCF' }
  ];
  assert.deepEqual(normalize(context.filterDirectoryPeople(people, 'petit mickael equipe')).map(x => x.id), ['a']);
  assert.equal(context.filterDirectoryPeople(people, 'private@example.org').length, 0);
  assert.equal(context.filterDirectoryPeople(people, 'sncf')[0].full_name, 'Élodie Martin');
});

test('deletion requires owner and typed confirmation before any network mutation', async () => {
  let calls = 0;
  const app = { db: { functions: { invoke: async () => { calls++; return { data: { success: true } }; } } } };
  const context = sandbox({ app });
  await assert.rejects(context.invokeAccountDeletion('u', 'supprimer'), /SUPPRIMER/);
  assert.equal(calls, 0);
  context.isJournalOwner = () => false;
  await assert.rejects(context.invokeAccountDeletion('u', 'SUPPRIMER'), /propriétaire/);
  assert.equal(calls, 0);
  context.isJournalOwner = () => true;
  await context.invokeAccountDeletion('u', 'SUPPRIMER');
  assert.equal(calls, 1);
});

test('deletion never reports success for edge errors or incomplete response', async () => {
  let response = { error: { context: { json: async () => ({ error: 'Compte propriétaire protégé' }) } } };
  let args;
  const context = sandbox({ app: { db: { functions: { invoke: async (...values) => { args = values; return response; } } } } });
  await assert.rejects(context.invokeAccountDeletion('target-user', 'SUPPRIMER'), /Compte propriétaire protégé/);
  assert.deepEqual(normalize(args), ['journal-delete-user', { body: { user_id: 'target-user', confirmation: 'SUPPRIMER' } }]);
  response = { data: {} };
  await assert.rejects(context.invokeAccountDeletion('target-user', 'SUPPRIMER'), /pas été confirmée/);
});
