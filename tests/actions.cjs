/* Scénarios fonctionnels avec les fonctions exactes du front, sans réseau. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(__dirname, '..', 'app-v13.js'), 'utf8');
const declarations = [...source.matchAll(/^  (?:async )?function ([A-Za-z0-9_]+)\(/gm)];
function install(context, names) {
  vm.createContext(context);
  for (const name of names) {
    const i = declarations.findIndex(match => match[1] === name);
    if (i < 0) throw new Error(`Fonction absente : ${name}`);
    vm.runInContext(source.slice(declarations[i].index, declarations[i+1]?.index ?? source.lastIndexOf('})();')), context);
  }
  return context;
}
const plain = value => JSON.parse(JSON.stringify(value));
const names = ['actionIsLate', 'actionStatusLabel', 'actionPriorityLabel', 'actionDeadlineLabel', 'canEditAction', 'actionLinksForMessage', 'renderMessageActionLinks', 'localActionDate', 'actionFormValues', 'addAction', 'updateActionDetails', 'setActionStatus', 'loadActionDirectory', 'openActionDetails', 'openActionCompletionDialog'];
async function main() {
  let tests = 0, userId = 'creator', admin = false, manager = false;
  const alerts = [];
  const app = { mode: 'cloud', currentId: 'site-A', access: {}, profile: {}, local: { actions: [] }, actions: [], db: {} };
  const action = { id: 'action-1', chantier_id: 'site-A', created_by: 'creator', assignee_user_id: 'pilot', assignee: 'Marie Dupont', title: 'Vérifier le plan', status: 'a_faire', created_at: new Date().toISOString() };
  app.actions.push(action);
  const ctx = install({ app, console: { warn() {} }, Date, ownId: () => userId, isCloudReady: () => app.mode === 'cloud', isJournalAdmin: () => admin, canManageDocuments: () => manager,
    activeActionsFor: site => app.actions.filter(a => a.chantier_id === site), formatSimpleDate: x => x, escapeHtml: x => String(x).replaceAll('<', '&lt;'),
    friendlyError: error => error.message, currentChantier: () => ({ id: app.currentId }), nowIso: () => new Date().toISOString(), makeId: () => 'new-local', toast: (...args) => alerts.push(args),
    refreshCloudCurrent: async () => {}, renderAll() {}, saveLocalData() {}, addMessage: async () => {}, openActionCompletionDialog() {}
  }, names);
  assert.equal(ctx.canEditAction(action), true);
  userId = 'pilot'; assert.equal(ctx.canEditAction(action), true);
  userId = 'other'; app.profile.full_name = 'Marie Dupont'; assert.equal(ctx.canEditAction(action), false, 'Same display name never grants rights');
  admin = true; assert.equal(ctx.canEditAction(action), true); admin = false;
  manager = true; assert.equal(ctx.canEditAction(action), true); manager = false;
  app.currentId = 'site-B'; assert.equal(ctx.canEditAction(action), false); app.currentId = 'site-A'; tests++;

  const directory = [{ id: 'pilot', full_name: 'Marie Dupont', can_assign: true }, { id: 'viewer', full_name: 'Paul Martin', can_assign: false }];
  const common = { title: ' Contrôler ', description: ' Texte ', pilot: 'pilot', priority: 'haute' };
  const today = ctx.localActionDate();
  for (const deadline of ['none','immediate','today','tomorrow','week','date']) {
    const value = ctx.actionFormValues({ ...common, deadline, due_date: today }, directory);
    assert.equal(value.assignee_user_id, 'pilot'); assert.equal(value.assignee, 'Marie Dupont');
    assert.equal(value.due_mode, deadline === 'none' ? 'none' : deadline === 'immediate' ? 'immediate' : 'date');
    if (['date','today'].includes(deadline)) assert.equal(value.due_date, today);
    if (deadline === 'immediate') assert.equal(value.due_date, null, 'Immediate edit preserves null date from Supabase');
    if (deadline === 'tomorrow') assert.equal(value.due_date, ctx.localActionDate(1));
    if (deadline === 'week') assert.equal(value.due_date, ctx.localActionDate(7));
  }
  const legacy = ctx.actionFormValues({ ...common, pilot: 'legacy', assignee: ' Société historique ', deadline: 'none' }, directory);
  assert.equal(legacy.assignee, 'Société historique'); assert.equal(legacy.assignee_user_id, null);
  const none = ctx.actionFormValues({ ...common, pilot: '', assignee: 'Old label' }, directory);
  assert.equal(none.assignee, ''); assert.equal(none.assignee_user_id, null);
  assert.throws(() => ctx.actionFormValues({ ...common, pilot: 'viewer' }, directory), /accès/);
  assert.throws(() => ctx.actionFormValues({ ...common, deadline: 'date', due_date: '' }, directory), /date/);
  tests++;

  assert.equal(ctx.actionIsLate({ ...action, due_date: today }), false, 'Today remains available until local midnight');
  assert.equal(ctx.actionIsLate({ ...action, due_date: '2020-01-01' }), true);
  assert.equal(ctx.actionIsLate({ ...action, due_mode: 'immediate', due_date: today }), true);
  assert.equal(ctx.actionIsLate({ ...action, status: 'terminee', due_mode: 'immediate' }), false);
  assert.equal(ctx.actionIsLate({ ...action, due_date: null, due_mode: 'none' }), false); tests++;

  let message = { id: 'message-1', chantier_id: 'site-A', action_id: action.id, body: 'Annonce', message_type: 'Action', created_at: action.created_at, author_id: action.created_by };
  assert.equal(ctx.actionLinksForMessage(message)[0].id, action.id);
  assert.match(ctx.renderMessageActionLinks(message), /data-action="open-action" data-action-id="action-1"/);
  action.message_id = 'source-message'; assert.equal(ctx.actionLinksForMessage({ ...message, id: 'source-message', action_id: null })[0].id, action.id);
  action.proof_message_id = 'proof-message'; assert.equal(ctx.actionLinksForMessage({ ...message, id: 'proof-message', action_id: null })[0].id, action.id);
  message = { ...message, action_id: null, body: 'Action créée : Vérifier le plan — attribuée à Marie Dupont · Priorité Normale' };
  assert.equal(ctx.actionLinksForMessage(message)[0].id, action.id);
  app.actions.push({ ...action, id: 'duplicate' }); assert.equal(ctx.actionLinksForMessage(message).length, 0, 'Ambiguous legacy announcements must not open wrong action'); app.actions.pop();
  assert.equal(ctx.actionLinksForMessage({ ...message, chantier_id: 'site-B' }).length, 0);
  assert.equal(ctx.actionLinksForMessage({ ...message, author_id: 'forged' }).length, 0); tests++;

  let rpcCall;
  app.db.rpc = (...args) => { rpcCall = args; return { range: async (start, end) => ({ data: directory.slice(start, end + 1) }) }; };
  assert.deepEqual(plain(await ctx.loadActionDirectory('site-A')), directory);
  assert.deepEqual(plain(rpcCall), ['list_journal_user_directory', { p_chantier_id: 'site-A' }]);
  const largeDirectory = Array.from({ length: 1237 }, (_, index) => ({ id: `person-${index}`, full_name: `Intervenant ${index}`, can_assign: true }));
  const ranges = [];
  app.db.rpc = () => ({ range: async (start, end) => { ranges.push([start, end]); return { data: largeDirectory.slice(start, Math.min(end + 1, start + 300)) }; } });
  assert.deepEqual(plain(await ctx.loadActionDirectory('site-A')), largeDirectory, 'Retrieve every pilot despite a server cap below the requested page size');
  assert.deepEqual(ranges.map(range => range[0]), [0, 300, 600, 900, 1200, 1237]);
  app.db.rpc = () => ({ range: async start => start ? { error: new Error('Second page unavailable') } : { data: directory } });
  await assert.rejects(ctx.loadActionDirectory('site-A'), /Second page unavailable/, 'Never show a silently truncated directory'); tests++;

  let writes = 0, updated, response = { data: { id: action.id } };
  app.db.from = () => ({ update: payload => { writes++; updated = payload; return { eq: () => ({ select: () => ({ single: async () => response }) }) }; } });
  userId = 'other'; await assert.rejects(ctx.updateActionDetails(action, { title: 'Interdit' }), /créateur/); assert.equal(writes, 0);
  assert.equal(await ctx.setActionStatus(action, 'en_cours'), false); assert.equal(writes, 0);
  userId = 'pilot'; await ctx.updateActionDetails(action, { title: 'Plan actualisé' }); assert.equal(updated.title, 'Plan actualisé');
  response = { data: null }; await assert.rejects(ctx.updateActionDetails(action, {}), /droits/);
  const count = alerts.length; assert.equal(await ctx.setActionStatus(action, 'en_cours'), false); assert.equal(alerts.slice(count).filter(row => row[1] === 'success').length, 0);
  response = { data: { id: action.id } }; await ctx.setActionStatus({ ...action, closed_at: '2026-01-01' }, 'a_faire'); assert.equal(updated.closed_at, null); tests++;

  let insertCount = 0, announcement;
  app.db.from = () => ({ insert: payload => { insertCount++; return { select: () => ({ single: async () => ({ data: { ...payload, id: 'saved-action' } }) }) }; } });
  ctx.addMessage = async payload => { announcement = payload; throw new Error('Publication interrompue'); };
  ctx.refreshCloudCurrent = async () => { throw new Error('Lecture interrompue'); };
  const saved = await ctx.addAction({ title: 'Action sauvegardée', description: '', assignee: '', due_date: null, due_mode: 'none', priority: 'normale' });
  assert.equal(insertCount, 1); assert.equal(saved.action.id, 'saved-action'); assert.equal(saved.announcementFailed, true); assert.equal(announcement.action_id, 'saved-action'); tests++;

  const nodes = new Map(), handlers = new Map(); let modal, closeCount = 0;
  ctx.$ = id => { if (!nodes.has(id)) nodes.set(id, { disabled: false, addEventListener: (event, callback) => handlers.set(`${id}:${event}`, callback) }); return nodes.get(id); };
  ctx.$$ = () => []; ctx.els = { modalBody: {} }; ctx.openModal = value => { modal = value; };
  ctx.closeModal = () => { closeCount++; };
  ctx.openActionDialog = () => {};
  userId = 'creator'; app.db.rpc = async () => ({ data: false });
  await ctx.openActionDetails(action); assert.doesNotMatch(modal.footer, /id="editActionDetails"/); assert.doesNotMatch(modal.body, /data-action-detail-status=/);
  app.db.rpc = async () => ({ data: true });
  await ctx.openActionDetails(action); assert.match(modal.footer, /id="editActionDetails"/);
  userId = 'other'; await ctx.openActionDetails(action); assert.doesNotMatch(modal.footer, /id="editActionDetails"/); tests++;

  userId = 'creator';
  const proofFile = { name: 'preuve.jpg' }, persistedMessage = { id: 'proof-saved', chantier_id: 'site-A', author_id: 'creator' };
  const form = { reportValidity: () => true, elements: { note: { value: 'Contrôle réalisé' }, proof: { files: [proofFile] } } };
  nodes.set('actionCompletionForm', form);
  let sendCalls = [], statusCalls = 0;
  ctx.addMessage = async (...args) => {
    sendCalls.push(args);
    if (sendCalls.length === 1) { const error = new Error('Photo interrompue'); error.sentMessage = persistedMessage; error.failedFiles = [{ file: proofFile }]; throw error; }
    return persistedMessage;
  };
  ctx.setActionStatus = async () => ++statusCalls > 1;
  ctx.openActionCompletionDialog(action);
  await handlers.get('saveActionCompletion:click')();
  assert.equal(form.elements.note.readOnly, true); assert.equal(form.elements.proof.disabled, true);
  await handlers.get('saveActionCompletion:click')();
  assert.equal(sendCalls[1][3].id, 'proof-saved', 'Retry must reuse the existing message');
  assert.equal(sendCalls[1][0].action_id, action.id);
  await handlers.get('saveActionCompletion:click')();
  assert.equal(sendCalls.length, 2, 'A status retry must reuse its already sent proof'); assert.equal(statusCalls, 2); assert.equal(closeCount, 1); tests++;

  assert.match(source, /action === "action-menu" \|\| action === "open-action"/);
  process.stdout.write(`Actions : ${tests} groupes de scénarios validés (droits, annuaire, échéances, liens du fil, erreurs serveur, absence de doublon).\n`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
