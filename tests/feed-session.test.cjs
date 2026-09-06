/* Regression tests against exact production functions in a Node VM.
 * DOM and Supabase are simulated; this is not a browser or live-cloud test.
 * Run: node --test tests/feed-session.test.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '..', 'app-v13.js'), 'utf8');

function extract(name) {
  const start = new RegExp('^  (?:async )?function ' + name + '\\(', 'm').exec(source);
  assert.ok(start, 'Production function exists: ' + name);
  const tail = source.slice(start.index + start[0].length);
  const next = /^  (?:async )?function /m.exec(tail);
  assert.ok(next, 'Production function has an identifiable boundary: ' + name);
  return source.slice(start.index, start.index + start[0].length + next.index);
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function setup(functions, overrides = {}) {
  const elements = new Map();
  const el = () => ({ value: '', checked: false, style: {}, hidden: false, innerHTML: '', scrollTop: 0,
    scrollHeight: 4000, clientHeight: 600, classList: { remove() {}, add() {}, toggle() {} }, setAttribute() {}, focus() {} });
  const $ = id => { if (!elements.has(id)) elements.set(id, el()); return elements.get(id); };
  const els = new Proxy({}, { get: (_, id) => $(id) });
  const app = { mode: 'cloud', user: { id: 'user-A' }, profile: { id: 'user-A', full_name: 'Alice Dupont' },
    chantiers: [{ id: 'A' }, { id: 'B' }], currentId: 'A', messages: [], actions: [], local: { messages: [] },
    pendingFiles: [], composerRetry: null, composerDrafts: new Map(), sendingMessage: false, replyTo: null,
    cloudRefreshSequence: 0, sessionVersion: 0, readStates: [], advancedFilters: {},
    attachmentUrlCache: new Map(), documentUrlCache: new Map(), coverUrlCache: new Map(),
    imageRecoveryInFlight: new Set(), imagePreviewRepairInFlight: new Set(), imagePreviewRepairTried: new Set(),
    access: {}, authDraft: {}, documentFolders: [], documentViewFolderId: null, feedAtBottom: true, activeTab: 'chat' };
  const audit = { toasts: [], revoked: [], rendered: 0, frames: [] };
  const ctx = { app, els, $, audit, console, Date, Math, Intl, Map, Set, Promise, Error,
    CONFIG: {}, MAX_LOCAL_FILE_BYTES: 3 * 1024 * 1024,
    URL: { revokeObjectURL: url => audit.revoked.push(url) },
    document: { visibilityState: 'visible' },
    nowIso: () => '2026-09-06T15:00:00.000Z', makeId: () => 'generated-id',
    ownId: () => app.user?.id || app.profile.id, ownName: () => app.profile.full_name,
    currentChantier: () => app.chantiers.find(item => item.id === app.currentId),
    isCloudReady: () => app.mode === 'cloud' && Boolean(app.user && app.db),
    toast: (message, variant) => audit.toasts.push({ message, variant }),
    renderAll: () => audit.rendered++, renderPendingFiles() {}, renderReplyPreview() {},
    setComposerToolTray() {}, closePhotoViewer() {}, closeModal() {}, markChantierRead: async () => {},
    saveLocalData() {}, subscribeCurrentChantier() {}, setActiveTab() {},
    requestAnimationFrame: callback => { audit.frames.push(callback); callback(); },
    clearTimeout() {}, refreshCloudCurrent: async () => {},
    signedCloudAttachmentUrl: async path => 'signed:' + path,
    ...overrides };
  vm.createContext(ctx);
  vm.runInContext(functions.map(extract).join('\n'), ctx, { filename: 'production-functions.js' });
  return ctx;
}

function queryMock(c, { messages = [], actions = [], attachments = [], cap = 500, waitFor = async () => {} } = {}) {
  const calls = [];
  c.app.db = {
    from(table) {
      const filters = {}, orders = []; let start = 0, end = Infinity;
      const q = {
        select() { return q; }, eq(k, v) { filters[k] = v; return q; }, lte(k, v) { filters['max:' + k] = v; return q; },
        in(k, v) { filters['in:' + k] = v; return q; },
        order(k, opts = {}) { orders.push({ k, asc: opts.ascending !== false }); return q; }, limit(n) { end = n - 1; return q; },
        range(a, b) { start = a; end = b; return q; },
        async then(resolve, reject) {
          try {
            calls.push({ table, filters: { ...filters }, orders, start, end });
            await waitFor({ table, filters, start });
            let rows = table === 'chantier_messages' ? messages : table === 'action_items' ? actions : table === 'chantier_attachments' ? attachments : [];
            rows = rows.filter(row => Object.entries(filters).every(([k, v]) => k.startsWith('max:') ? row[k.slice(4)] <= v : k.startsWith('in:') ? v.includes(row[k.slice(3)]) : row[k] === v));
            rows = [...rows].sort((a, b) => {
              for (const { k, asc } of orders) { if (a[k] !== b[k]) return (a[k] < b[k] ? -1 : 1) * (asc ? 1 : -1); }
              return 0;
            });
            resolve({ data: rows.slice(start, Math.min(end + 1, start + cap)), error: null });
          } catch (error) { reject(error); }
        }
      };
      return q;
    }, rpc: async () => ({ data: true, error: null })
  };
  return calls;
}

function sendMock(c, { failNames = new Set(), uploadWait = async () => {} } = {}) {
  const inserts = [], uploads = [], removed = [];
  c.app.db = {
    from(table) { let record; const q = {
      insert(data) { record = { ...data, id: 'row-' + (inserts.length + 1) }; inserts.push({ table, record }); return q; },
      select() { return q; }, async single() { return { data: record, error: null }; }
    }; return q; },
    storage: { from: () => ({
      async upload(storagePath, file) { uploads.push(file.name); await uploadWait(file); return { error: failNames.has(file.name) ? new Error('Simulated network interruption') : null }; },
      async remove(paths) { removed.push(...paths); return { error: null }; }
    }) }
  };
  return { inserts, uploads, removed };
}

const sendingFunctions = ['addMessage', 'uploadCloudAttachment', 'sendComposerMessage', 'setComposerSendingState',
  'clearComposer', 'clearPendingFiles', 'scrollMessagesToBottom'];

test('All records remain available past 1,500, including timestamps from a phone clock ahead', async () => {
  const c = setup(['loadCloudMessages']);
  const messages = Array.from({ length: 1701 }, (_, i) => ({ id: String(i).padStart(6, '0'), chantier_id: 'A',
    created_at: new Date(Date.UTC(2026, 8, 1, 0, 0, i)).toISOString() }));
  messages.push({ id: 'future', chantier_id: 'A', created_at: '2026-09-07T00:00:00.000Z' });
  const calls = queryMock(c, { messages, cap: 137 });
  const result = await c.loadCloudMessages('A');
  assert.equal(result.error, null);
  assert.deepEqual(Array.from(result.data, item => item.id), messages.map(item => item.id));
  assert.equal(result.data.at(-1).id, 'future');
  assert.ok(calls.length > 12);
});

test('All attachments load across pagination and message batches', async () => {
  const c = setup(['hydrateCloudAttachments']);
  const messages = Array.from({ length: 201 }, (_, i) => ({ id: 'm' + i }));
  const attachments = Array.from({ length: 1501 }, (_, i) => ({ id: String(i).padStart(6, '0'),
    message_id: messages[i % messages.length].id, storage_path: 'file-' + i, created_at: '2026-09-01T00:00:00Z' }));
  queryMock(c, { attachments, cap: 89 });
  const result = await c.hydrateCloudAttachments(messages);
  assert.equal(result.flatMap(row => row.attachments).length, attachments.length);
  assert.equal(new Set(result.flatMap(row => row.attachments.map(a => a.id))).size, attachments.length);
  assert.ok(result.every(row => row.attachments.every(a => a.message_id === row.id && a.signed_url === 'signed:' + a.storage_path)));
});

test('Actions linked from old messages remain available beyond the Supabase row cap', async () => {
  const c = setup(['loadCloudActions', 'activeActionsFor', 'actionLinksForMessage']);
  const actions = Array.from({ length: 1207 }, (_, index) => ({
    id: 'action-' + String(index).padStart(5, '0'), chantier_id: 'A',
    created_at: new Date(Date.UTC(2026, 8, 1, 0, 0, index)).toISOString()
  }));
  queryMock(c, { actions, cap: 137 });
  const result = await c.loadCloudActions('A');
  assert.equal(result.error, null);
  assert.equal(result.data.length, actions.length);
  c.app.actions = result.data;
  assert.equal(c.actionLinksForMessage({ chantier_id: 'A', action_id: actions[0].id })[0].id, actions[0].id);
});

test('A delayed refresh from chantier A cannot overwrite the selected chantier B', async () => {
  const gate = deferred();
  const c = setup(['loadCloudMessages', 'loadCloudActions', 'hydrateCloudAttachments', 'refreshCloudCurrent']);
  const messages = ['A', 'B'].map(id => ({ id: id + '-message', chantier_id: id, created_at: '2026-09-01T00:00:00Z' }));
  queryMock(c, { messages, waitFor: async ({ table, filters, start }) => {
    if (table === 'chantier_messages' && filters.chantier_id === 'A' && !start) await gate.promise;
  } });
  const first = c.refreshCloudCurrent();
  c.app.currentId = 'B';
  await c.refreshCloudCurrent();
  assert.equal(c.app.messages[0].chantier_id, 'B');
  gate.resolve(); await first;
  assert.equal(c.app.messages[0].chantier_id, 'B');
});

test('A photo can be sent with an empty text body', async () => {
  const c = setup(sendingFunctions);
  const records = sendMock(c);
  c.app.pendingFiles = [{ file: { name: 'photo.jpg', type: 'image/jpeg', size: 10 }, preview_url: 'blob:photo' }];
  await c.sendComposerMessage();
  const messages = records.inserts.filter(row => row.table === 'chantier_messages');
  assert.equal(messages.length, 1);
  assert.equal(messages[0].record.body, '');
  assert.equal(records.inserts.filter(row => row.table === 'chantier_attachments').length, 1);
  assert.equal(c.app.pendingFiles.length, 0);
  assert.ok(c.audit.toasts.some(row => row.variant === 'success'));
});

test('Failed files are retained; retry adds neither a second message nor duplicate successful attachments', async () => {
  const c = setup(sendingFunctions);
  const failNames = new Set(['retry.jpg']);
  const records = sendMock(c, { failNames });
  c.els.messageInput.value = 'Deux photos';
  c.app.pendingFiles = ['ok.jpg', 'retry.jpg'].map(name => ({ file: { name, type: 'image/jpeg', size: 10 }, preview_url: 'blob:' + name }));
  await c.sendComposerMessage();
  assert.equal(c.els.messageInput.value, 'Deux photos');
  assert.deepEqual(Array.from(c.app.pendingFiles, item => item.file.name), ['retry.jpg']);
  assert.equal(c.app.composerRetry.id, 'row-1');
  assert.equal(c.els.messageInput.readOnly, true);
  assert.equal(c.audit.toasts.filter(row => row.variant === 'success').length, 0);
  failNames.clear();
  await c.sendComposerMessage();
  assert.equal(records.inserts.filter(row => row.table === 'chantier_messages').length, 1);
  assert.equal(records.inserts.filter(row => row.table === 'chantier_attachments').length, 2);
  assert.deepEqual(records.uploads, ['ok.jpg', 'retry.jpg', 'retry.jpg']);
  assert.equal(c.app.pendingFiles.length, 0);
  assert.equal(c.app.composerRetry, null);
  assert.equal(c.els.messageInput.value, '');
});

test('Rapid simultaneous sends persist one message', async () => {
  const gate = deferred();
  const c = setup(sendingFunctions);
  const records = sendMock(c, { uploadWait: () => gate.promise });
  c.els.messageInput.value = 'Une consigne';
  c.app.pendingFiles = [{ file: { name: 'photo.jpg', type: 'image/jpeg', size: 10 } }];
  const first = c.sendComposerMessage();
  await c.sendComposerMessage();
  gate.resolve(); await first;
  assert.equal(records.inserts.filter(row => row.table === 'chantier_messages').length, 1);
  assert.deepEqual(records.uploads, ['photo.jpg']);
  assert.equal(c.app.sendingMessage, false);
});

test('A completed send stays completed if feed refresh fails', async () => {
  const c = setup(sendingFunctions, { refreshCloudCurrent: async () => { throw new Error('Feed unavailable'); } });
  const records = sendMock(c);
  c.els.messageInput.value = 'Consigne enregistrée';
  await c.sendComposerMessage();
  assert.equal(records.inserts.filter(row => row.table === 'chantier_messages').length, 1);
  assert.equal(c.els.messageInput.value, '');
  assert.equal(c.app.composerRetry, null);
  assert.ok(c.audit.toasts.some(row => row.variant === 'warning'));
});

test('Draft text, reply and pending photo return only to their original chantier', async () => {
  const c = setup(['rememberComposerDraft', 'restoreComposerDraft', 'setComposerSendingState', 'selectChantier']);
  sendMock(c);
  const photo = { file: { name: 'chantier-A.jpg' }, preview_url: 'blob:A' };
  c.els.messageInput.value = 'Brouillon A'; c.els.messageZone.value = 'PK 1';
  c.app.replyTo = { id: 'reply-A' }; c.app.pendingFiles = [photo];
  await c.selectChantier('B');
  assert.equal(c.els.messageInput.value, ''); assert.equal(c.app.pendingFiles.length, 0); assert.equal(c.app.replyTo, null);
  c.els.messageInput.value = 'Brouillon B';
  await c.selectChantier('A');
  assert.equal(c.els.messageInput.value, 'Brouillon A'); assert.equal(c.els.messageZone.value, 'PK 1');
  assert.equal(c.app.pendingFiles[0], photo); assert.equal(c.app.replyTo.id, 'reply-A');
  await c.selectChantier('B');
  assert.equal(c.els.messageInput.value, 'Brouillon B'); assert.equal(c.app.pendingFiles.length, 0);
});

test('Signing out purges passwords, drafts and private cached URLs', () => {
  const c = setup(['clearSessionPrivateState', 'clearComposer', 'clearPendingFiles', 'setComposerSendingState']);
  c.els.messageInput.value = 'Private text';
  c.app.authDraft = { password: 'private-password', confirmPassword: 'private-password', email: 'private@example.invalid' };
  c.app.composerDrafts.set('B', { body: 'Other private draft', files: [{ preview_url: 'blob:B' }] });
  c.app.pendingFiles = [{ preview_url: 'blob:A' }];
  c.app.attachmentUrlCache.set('private', 'signed-url');
  c.clearSessionPrivateState();
  assert.equal(c.app.authDraft.password, ''); assert.equal(c.app.authDraft.email, '');
  assert.equal(c.app.profile.full_name, ''); assert.equal(c.els.messageInput.value, '');
  assert.equal(c.app.composerDrafts.size, 0); assert.equal(c.app.pendingFiles.length, 0);
  assert.equal(c.app.attachmentUrlCache.size, 0); assert.equal(c.app.currentId, null);
  assert.ok(c.audit.revoked.includes('blob:A')); assert.ok(c.audit.revoked.includes('blob:B'));
});

test('An upload failure after logout cannot restore the former user’s private draft', async () => {
  const started = deferred(), gate = deferred();
  const c = setup([...sendingFunctions, 'clearSessionPrivateState']);
  sendMock(c, { failNames: new Set(['private.jpg']), uploadWait: async () => { started.resolve(); await gate.promise; } });
  c.els.messageInput.value = 'Private account A';
  c.app.pendingFiles = [{ file: { name: 'private.jpg', type: 'image/jpeg', size: 10 }, preview_url: 'blob:private' }];
  const sending = c.sendComposerMessage();
  await started.promise;
  c.clearSessionPrivateState();
  c.app.user = null; c.app.mode = 'cloud-guest';
  gate.resolve(); await sending;
  assert.equal(c.app.pendingFiles.length, 0);
  assert.equal(c.app.composerRetry, null);
  assert.equal(c.els.messageInput.value, '');
});

test('An old successful send cannot erase the next signed-in user’s draft', async () => {
  const started = deferred(), gate = deferred();
  const c = setup([...sendingFunctions, 'clearSessionPrivateState']);
  sendMock(c, { uploadWait: async () => { started.resolve(); await gate.promise; } });
  c.els.messageInput.value = 'Account A message';
  c.app.pendingFiles = [{ file: { name: 'photo.jpg', type: 'image/jpeg', size: 10 } }];
  const sending = c.sendComposerMessage();
  await started.promise;
  c.clearSessionPrivateState();
  c.app.user = { id: 'user-B' }; c.app.profile = { id: 'user-B', full_name: 'User B' }; c.app.currentId = 'A';
  c.els.messageInput.value = 'Account B new draft';
  gate.resolve(); await sending;
  assert.equal(c.els.messageInput.value, 'Account B new draft');
  assert.equal(c.app.composerRetry, null);
});

test('Reconnecting the same account and chantier does not let an old send erase the new draft', async () => {
  const started = deferred(), gate = deferred();
  const c = setup([...sendingFunctions, 'clearSessionPrivateState']);
  sendMock(c, { uploadWait: async () => { started.resolve(); await gate.promise; } });
  c.els.messageInput.value = 'Old session message';
  c.app.pendingFiles = [{ file: { name: 'photo.jpg', type: 'image/jpeg', size: 10 } }];
  const sending = c.sendComposerMessage();
  await started.promise;
  c.clearSessionPrivateState();
  c.app.user = { id: 'user-A' }; c.app.profile = { id: 'user-A', full_name: 'Alice Dupont' }; c.app.currentId = 'A';
  c.els.messageInput.value = 'Same account, new draft';
  gate.resolve(); await sending;
  assert.equal(c.els.messageInput.value, 'Same account, new draft');
  assert.equal(c.app.composerRetry, null);
});

test('An old send finishing cannot unlock a send still in progress in the new session', async () => {
  const firstStarted = deferred(), firstGate = deferred(), secondStarted = deferred(), secondGate = deferred();
  const c = setup([...sendingFunctions, 'clearSessionPrivateState']);
  sendMock(c, { uploadWait: async file => {
    if (file.name === 'old.jpg') { firstStarted.resolve(); await firstGate.promise; }
    else { secondStarted.resolve(); await secondGate.promise; }
  } });
  c.app.pendingFiles = [{ file: { name: 'old.jpg', type: 'image/jpeg', size: 10 } }];
  const first = c.sendComposerMessage(); await firstStarted.promise;
  c.clearSessionPrivateState();
  c.app.user = { id: 'user-A' }; c.app.profile = { id: 'user-A', full_name: 'Alice Dupont' }; c.app.currentId = 'A';
  c.app.pendingFiles = [{ file: { name: 'new.jpg', type: 'image/jpeg', size: 10 } }];
  const second = c.sendComposerMessage(); await secondStarted.promise;
  firstGate.resolve(); await first;
  assert.equal(c.app.sendingMessage, true);
  assert.equal(c.$('sendBtn').disabled, true);
  secondGate.resolve(); await second;
  assert.equal(c.app.sendingMessage, false);
  assert.equal(c.$('sendBtn').disabled, false);
});

test('Opening a chantier follows the latest message, while a reader browsing history keeps their position', () => {
  const c = setup(['renderMessages', 'scrollMessagesToBottom'], {
    filteredMessages: () => [{ id: 'latest', created_at: '2026-09-06T12:00:00Z' }],
    currentMessages: () => [{ id: 'latest' }], formatDay: () => 'Today',
    escapeHtml: value => value, renderMessage: () => '<article>Latest</article>'
  });
  c.app.renderedChantierId = 'B'; c.app.feedAtBottom = false; c.els.messageFeed.scrollTop = 75;
  c.renderMessages({ keepPosition: true });
  assert.equal(c.els.messageFeed.scrollTop, 4000);
  c.app.feedAtBottom = false; c.els.messageFeed.scrollTop = 125;
  c.renderMessages({ keepPosition: true });
  assert.equal(c.els.messageFeed.scrollTop, 125);
  c.app.feedAtBottom = true;
  c.renderMessages({ keepPosition: true });
  assert.equal(c.els.messageFeed.scrollTop, 4000);
});
