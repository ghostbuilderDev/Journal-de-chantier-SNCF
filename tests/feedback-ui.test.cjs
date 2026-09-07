/* V14.5 browser lifecycle and network races with a small DOM stub; no live-device claim. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { create, MAX_IMAGE } = require('../feedback.js');
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';
const T = '33333333-3333-4333-8333-333333333333', U = '44444444-4444-4444-8444-444444444444';
const NOW = '2026-09-07T12:00:00Z';
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = () => new Promise(resolve => setImmediate(resolve));
function tinyDOM() {
  const elements = new Map(), docEvents = {};
  class Element {
    constructor(tag = 'div') { this.tagName = tag; this.dataset = {}; this.events = {}; this.hidden = false; this.disabled = false; this.isConnected = true; this.value = ''; this.html = ''; this.children = []; }
    set id(value) { this._id = value; elements.set(value, this); }
    get id() { return this._id; }
    set innerHTML(html) {
      this.html = html;
      for (const child of this.children) { if (elements.get(child.id) === child) elements.delete(child.id); child.isConnected = false; }
      this.children = [];
      for (const match of html.matchAll(/<([a-z]+)\b([^>]*)>/g)) {
        const child = new Element(match[1]);
        for (const attr of match[2].matchAll(/([\w-]+)="([^"]*)"/g)) {
          if (attr[1] === 'id') child.id = attr[2];
          else if (attr[1].startsWith('data-')) child.dataset[attr[1].slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = attr[2];
          else child[attr[1]] = attr[2];
        }
        child.hidden = /\bhidden\b/.test(match[2]); this.children.push(child); child.parent = this;
      }
    }
    get innerHTML() { return this.html; }
    setAttribute(key, value) { this[key] = value; }
    removeAttribute(key) { delete this[key]; }
    appendChild(child) { this.children.push(child); child.parent = this; }
    replaceChildren() { this.innerHTML = ''; }
    addEventListener(name, handler) { this.events[name] = handler; }
    showModal() { this.open = true; }
    close() { this.open = false; this.events.close?.(); }
    focus() { doc.activeElement = this; this.focused = true; }
    querySelectorAll() { return []; }
  }
  const doc = { visibilityState: 'visible', activeElement: null, body: new Element('body'), getElementById: id => elements.get(id) || null, createElement: tag => new Element(tag), addEventListener: (name, handler) => docEvents[name] = handler };
  for (const id of ['feedbackBtn', 'sidebarFeedbackBtn']) { const button = new Element('button'); button.id = id; }
  doc.activeElement = doc.getElementById('feedbackBtn');
  return { doc, docEvents, elements, Element };
}
function harness(options = {}) {
  const dom = tinyDOM(), calls = [], storageCalls = [], toasts = [], events = [], timers = new Map(), winEvents = {};
  const context = { ready: true, userId: A, profileName: 'Alice', role: 'admin' };
  let sequence = 1, timerSequence = 0;
  const rows = new Map();
  function row(id = T, author = A, extra = {}) { return { id, author_id: author, author_name: author === A ? 'Alice' : 'Bob', title: `Retour ${id.slice(0, 3)}`, body: 'Description du problème.', category: 'bug', status: 'new', image_path: null, created_at: NOW, updated_at: NOW, reply_count: 0, can_edit: author === context.userId, can_delete: author === context.userId, ...extra }; }
  rows.set(T, row()); rows.set(U, row(U, B));
  const replyRows = new Map(), uploaded = new Set();
  const db = {
    async rpc(name, args) {
      calls.push({ name, args: structuredClone(args), user: context.userId });
      if (options.rpc) { const result = options.rpc(name, args, context.userId, { row, rows, replyRows }); if (result !== undefined) return result; }
      if (name === 'journal_feedback_context') return { data: { user_id: context.userId, can_manage: options.canManage || false } };
      if (name === 'journal_feedback_list') return { data: { items: [...rows.values()], next_cursor: null } };
      if (name === 'journal_feedback_get') return { data: rows.get(args.p_id) || null };
      if (name === 'journal_feedback_replies') return { data: { items: [...replyRows.values()].filter(r => r.thread_id === args.p_thread_id), next_cursor: null } };
      if (name === 'journal_feedback_create_thread') {
        let value = rows.get(args.p_id);
        if (!value) { value = row(args.p_id, context.userId, { title: args.p_title, body: args.p_body, category: args.p_category, image_path: args.p_image_path }); rows.set(value.id, value); }
        return { data: value };
      }
      if (name === 'journal_feedback_create_reply') {
        let value = replyRows.get(args.p_id);
        if (!value) { value = { id: args.p_id, thread_id: args.p_thread_id, author_id: context.userId, author_name: 'Alice', body: args.p_body, created_at: NOW, updated_at: NOW, can_edit: true, can_delete: true }; replyRows.set(value.id, value); }
        return { data: value };
      }
      if (name === 'journal_feedback_set_status') { const value = { ...rows.get(args.p_id), status: args.p_status, updated_at: '2026-09-07T12:01:00Z' }; rows.set(value.id, value); return { data: value }; }
      if (name === 'journal_feedback_update_thread') return { data: { ...rows.get(args.p_id), title: args.p_title, body: args.p_body, category: args.p_category } };
      if (name === 'journal_feedback_delete_thread') { rows.delete(args.p_id); return { data: { deleted: true, id: args.p_id } }; }
      if (name === 'journal_feedback_update_reply') return { data: { ...replyRows.get(args.p_id), body: args.p_body } };
      if (name === 'journal_feedback_delete_reply') { replyRows.delete(args.p_id); return { data: { deleted: true, id: args.p_id } }; }
      return { data: null };
    },
    storage: { from(bucket) { assert.equal(bucket, 'journal-feedback-images'); return {
      async upload(path, file, args) { storageCalls.push({ method: 'upload', path, file, args }); if (options.upload) return options.upload(path, file, args); if (uploaded.has(path)) return { error: { statusCode: '409' } }; uploaded.add(path); return { data: { path } }; },
      async remove(paths) { storageCalls.push({ method: 'remove', paths }); return options.remove ? options.remove(paths) : { data: [] }; },
      async createSignedUrl(path, seconds) { storageCalls.push({ method: 'signed', path, seconds }); if (options.signed) return options.signed(path); return { data: { signedUrl: `https://project.supabase.co/storage/v1/object/sign/${path}?token=public-test` } }; }
    }; } }
  };
  context.db = db;
  const navigator = { onLine: true };
  const window = { document: dom.doc, navigator, location: { href: 'https://example.com/app' }, history: { state: { original: true }, pushState(state) { this.state = state; events.push('push'); }, back() { this.state = { original: true }; events.push('back'); } }, confirm: () => true, addEventListener: (name, handler) => winEvents[name] = handler };
  const environment = { window, document: dom.doc, navigator, crypto: { randomUUID: () => `99999999-9999-4999-8999-${String(sequence++).padStart(12, '0')}` }, URL: { createObjectURL: () => 'blob:test-preview', revokeObjectURL: url => events.push(`revoke:${url}`) }, setInterval: callback => { const id = ++timerSequence; timers.set(id, callback); return id; }, clearInterval: id => timers.delete(id) };
  const feedback = create({ getContext: () => context, toast: (message, tone) => toasts.push({ message, tone }), onVisibilityChange: () => events.push(`visible:${feedback.isOpen()}`) }, environment);
  return { feedback, context, calls, storageCalls, toasts, events, timers, window, navigator, ...dom, row, rows, replyRows, winEvents,
    async open() { feedback.contextChanged(); await feedback.open(); },
    draft(title = 'Mon idée', body = 'Un bouton utile pour les équipes.') { feedback.compose(); feedback.setDraft('title', title); feedback.setDraft('body', body); },
    file: { name: 'capture.png', type: 'image/png', size: 1024 }
  };
}

test('global entry is available without a selected chantier; no request before opening', async () => {
  const h = harness(); h.feedback.contextChanged(); assert.equal(h.calls.length, 0); assert.equal(h.doc.getElementById('feedbackBtn').hidden, false);
  await h.open(); assert(h.feedback.isOpen()); assert.equal(h.feedback.state().list.length, 2); assert.deepEqual(h.events.filter(e => e.startsWith('visible')), ['visible:true']);
});
test('open/close changes visibility once and restores focus without touching app draft', async () => {
  const h = harness(), button = h.doc.activeElement; h.context.chantierDraft = 'PK 12,3'; await h.open(); h.feedback.close();
  assert.equal(h.context.chantierDraft, 'PK 12,3'); assert.equal(h.doc.activeElement, button); assert.equal(h.timers.size, 0); assert.deepEqual(h.events.filter(e => e.startsWith('visible')), ['visible:true', 'visible:false']);
});
test('Android browser back closes only the independent dialog', async () => { const h = harness(); await h.open(); h.window.history.state = { original: true }; h.winEvents.popstate(); assert.equal(h.feedback.isOpen(), false); assert.equal(h.events.filter(e => e === 'back').length, 0); });
test('polling exists only while dialog is open and page visible', async () => {
  const h = harness(); assert.equal(h.timers.size, 0); await h.open(); assert.equal(h.timers.size, 1);
  h.doc.visibilityState = 'hidden'; h.docEvents.visibilitychange(); assert.equal(h.timers.size, 0); const count = h.calls.length; await h.feedback.checkNew(); assert.equal(h.calls.length, count);
  h.doc.visibilityState = 'visible'; h.docEvents.visibilitychange(); assert.equal(h.timers.size, 1); await flush(); h.feedback.close(); await h.feedback.checkNew(); assert.equal(h.timers.size, 0);
});
test('poll sets a new-content button and does not replace list or a draft form', async () => {
  const h = harness(); await h.open(); const content = h.doc.getElementById('feedbackContent'), html = content.innerHTML;
  h.rows.set(T, h.row(T, A, { updated_at: '2026-09-07T13:00:00Z' })); await h.feedback.checkNew(); assert.equal(h.feedback.state().newContent, true); assert.equal(content.innerHTML, html);
  await h.feedback.refresh(); assert.equal(h.feedback.state().newContent, false); h.rows.set(T, { ...h.rows.get(T), reply_updated_at: '2026-09-07T14:00:00Z' }); await h.feedback.checkNew(); assert.equal(h.feedback.state().newContent, true);
  h.draft(); const field = h.doc.getElementById('feedbackDraftTitle'); await h.feedback.checkNew(); assert.equal(h.doc.getElementById('feedbackDraftTitle'), field); assert.equal(h.feedback.state().draft.title, 'Mon idée');
});
test('personal draft survives closing but is purged completely on account change', async () => {
  const h = harness(); await h.open(); h.draft(); await h.feedback.selectFile(h.file); h.feedback.close(); await h.feedback.open(); assert.equal(h.feedback.state().draft.title, 'Mon idée');
  h.context.userId = B; h.feedback.contextChanged(); assert.equal(h.feedback.state().draft.title, ''); assert.equal(h.feedback.state().draft.file, null); assert.equal(h.feedback.state().list.length, 0); assert(h.events.includes('revoke:blob:test-preview'));
});
test('sign-out hides entry and clears private dialog DOM', async () => { const h = harness(); await h.open(); h.draft(); h.context.userId = null; h.context.ready = false; h.feedback.clear(); assert.equal(h.feedback.isOpen(), false); assert.equal(h.doc.getElementById('feedbackBtn').hidden, true); assert.equal(h.doc.getElementById('feedbackContent').innerHTML, ''); });
test('late account A list cannot enter account B feed', async () => {
  const wait = deferred(); let hold = true; const h = harness({ rpc: (name, args, user) => name === 'journal_feedback_list' && user === A && hold ? wait.promise : undefined });
  const opening = h.feedback.open(); await flush(); h.context.userId = B; h.feedback.contextChanged(); await h.feedback.open(); hold = false; wait.resolve({ data: { items: [{ id: T, title: 'Secret de A' }], next_cursor: null } }); await opening;
  assert.equal(h.feedback.state().userId, B); assert(!h.feedback.state().list.some(row => row.title === 'Secret de A'));
});
test('late upload after account change never publishes with the new account', async () => {
  const wait = deferred(), h = harness({ upload: () => wait.promise }); await h.open(); h.draft(); await h.feedback.selectFile(h.file); const pending = h.feedback.submit(); await flush();
  h.context.userId = B; h.feedback.contextChanged(); wait.resolve({ data: { path: 'old-upload' } }); await pending;
  assert.equal(h.calls.filter(c => c.name === 'journal_feedback_create_thread').length, 0); assert.equal(h.feedback.state().draft.file, null); assert.equal(h.feedback.state().userId, B);
});
test('late create response after sign-out does not restore data or report success', async () => {
  const wait = deferred(), h = harness({ rpc: name => name === 'journal_feedback_create_thread' ? wait.promise : undefined }); await h.open(); h.draft(); const pending = h.feedback.submit(); await flush(); h.context.ready = false; h.context.userId = null; h.feedback.clear(); wait.resolve({ data: h.row() }); await pending;
  assert.equal(h.feedback.state().thread, null); assert.equal(h.feedback.state().draft.title, ''); assert(!h.toasts.some(t => t.tone === 'success'));
});
test('upload failure preserves both text and image and does not create empty publication', async () => {
  const h = harness({ upload: () => ({ error: { statusCode: '500' } }) }); await h.open(); h.draft(); await h.feedback.selectFile(h.file); await h.feedback.submit();
  assert.equal(h.feedback.state().draft.file, h.file); assert.equal(h.feedback.state().draft.title, 'Mon idée'); assert.equal(h.feedback.state().draft.pending, null); assert(!h.calls.some(c => c.name === 'journal_feedback_create_thread')); assert.match(h.feedback.state().error, /capture/);
});
test('ambiguous upload retry reuses exact object path and accepts its duplicate', async () => {
  let count = 0; const h = harness({ upload: () => ++count === 1 ? Promise.reject(Error('socket closed')) : { error: { statusCode: '409' } } }); await h.open(); h.draft(); await h.feedback.selectFile(h.file); await h.feedback.submit(); await h.feedback.submit();
  const uploads = h.storageCalls.filter(c => c.method === 'upload'); assert.equal(uploads.length, 2); assert.equal(uploads[0].path, uploads[1].path); assert(uploads[0].path.startsWith(`${A}/`)); assert.equal(uploads[0].args.upsert, false); assert(h.calls.some(c => c.name === 'journal_feedback_create_thread'));
});
test('ambiguous create retries the immutable payload and UUID instead of duplicating it', async () => {
  let calls = 0; const h = harness({ rpc: (name, args, user, { rows, row }) => {
    if (name !== 'journal_feedback_create_thread') return; if (++calls === 1) { rows.set(args.p_id, row(args.p_id, user, { title: args.p_title, body: args.p_body })); return Promise.reject(Error('response lost')); }
  } });
  await h.open(); h.draft(); await h.feedback.submit(); const pending = h.feedback.state().draft.pending; assert(pending); h.feedback.setDraft('title', 'Autre texte'); assert.equal(h.feedback.state().draft.title, 'Mon idée'); await h.feedback.submit();
  const sends = h.calls.filter(c => c.name === 'journal_feedback_create_thread'); assert.equal(sends.length, 2); assert.deepEqual(sends[0].args, sends[1].args); assert.equal(h.feedback.state().draft.pending, null); assert.equal([...h.rows.values()].filter(row => row.title === 'Mon idée').length, 1);
});
test('failed image publication keeps the upload and only retries the RPC', async () => {
  let count = 0; const h = harness({ rpc: name => name === 'journal_feedback_create_thread' && ++count === 1 ? Promise.reject(Error('lost')) : undefined }); await h.open(); h.draft(); await h.feedback.selectFile(h.file); await h.feedback.submit(); await h.feedback.submit(); assert.equal(h.storageCalls.filter(c => c.method === 'upload').length, 1); assert.equal(h.calls.filter(c => c.name === 'journal_feedback_create_thread').length, 2);
});
test('capture accepts only the three advertised formats and at most 5 MiB', async () => {
  const h = harness(); await h.open(); h.draft(); assert.equal(await h.feedback.selectFile({ ...h.file, size: MAX_IMAGE + 1 }), false); assert.equal(await h.feedback.selectFile({ ...h.file, type: 'image/svg+xml' }), false); assert.equal(await h.feedback.selectFile({ ...h.file, size: 0 }), false); assert.equal(await h.feedback.selectFile({ ...h.file, size: MAX_IMAGE }), true);
});
test('offline send retains draft and makes no upload or mutation request', async () => {
  const h = harness(); await h.open(); h.draft(); await h.feedback.selectFile(h.file); h.navigator.onLine = false; await h.feedback.submit(); assert.equal(h.feedback.state().draft.title, 'Mon idée'); assert.match(h.feedback.state().error, /hors connexion/); assert.equal(h.storageCalls.length, 0); assert(!h.calls.some(c => c.name === 'journal_feedback_create_thread'));
});
test('blank title or body is rejected before any write', async () => { const h = harness(); await h.open(); h.draft(' ', ' '); await h.feedback.submit(); assert(!h.calls.some(c => c.name === 'journal_feedback_create_thread')); assert.match(h.feedback.state().error, /titre/); });
test('client role label cannot enable status controls without server context capability', async () => { const h = harness(); await h.open(); await h.feedback.openThread(T); await h.feedback.setStatus('done'); assert.equal(h.feedback.state().canManage, false); assert(!h.calls.some(c => c.name === 'journal_feedback_set_status')); });
test('status mutation sends optimistic revision', async () => { const h = harness({ canManage: true }); await h.open(); await h.feedback.openThread(T); await h.feedback.setStatus('done'); const call = h.calls.find(c => c.name === 'journal_feedback_set_status'); assert.equal(call.args.p_expected_updated_at, NOW); assert.equal(h.feedback.state().thread.status, 'done'); });
test('late status success for A never replaces the reopened B detail', async () => {
  const wait = deferred(), h = harness({ canManage: true, rpc: name => name === 'journal_feedback_set_status' ? wait.promise : undefined }); await h.open(); await h.feedback.openThread(T); const pending = h.feedback.setStatus('done'); await flush(); h.feedback.close(); await h.feedback.open(); await h.feedback.openThread(U); wait.resolve({ data: h.row(T, A, { status: 'done' }) }); await pending; assert.equal(h.feedback.state().thread.id, U);
});
test('late edit success does not replace a different detail or force navigation', async () => {
  const wait = deferred(), h = harness({ rpc: name => name === 'journal_feedback_update_thread' ? wait.promise : undefined }); await h.open(); await h.feedback.openThread(T); h.feedback.beginEditThread(); const pending = h.feedback.saveThread(); await flush(); h.feedback.close(); await h.feedback.open(); await h.feedback.openThread(U); wait.resolve({ data: h.row(T) }); await pending; assert.equal(h.feedback.state().thread.id, U); assert.equal(h.feedback.state().view, 'detail');
});
test('late delete success does not clear a different detail', async () => {
  const wait = deferred(), h = harness({ rpc: name => name === 'journal_feedback_delete_thread' ? wait.promise : undefined }); await h.open(); await h.feedback.openThread(T); const pending = h.feedback.deleteThread(true); await flush(); h.feedback.close(); await h.feedback.open(); await h.feedback.openThread(U); wait.resolve({ data: { deleted: true, id: T } }); await pending; assert.equal(h.feedback.state().thread.id, U);
});
test('late create success does not jump out of a newly opened detail', async () => {
  const wait = deferred(), h = harness({ rpc: name => name === 'journal_feedback_create_thread' ? wait.promise : undefined }); await h.open(); h.draft(); const pending = h.feedback.submit(); await flush(); h.feedback.close(); await h.feedback.open(); await h.feedback.openThread(U); wait.resolve({ data: h.row('99999999-9999-4999-8999-999999999999') }); await pending; assert.equal(h.feedback.state().thread.id, U);
});
test('read access revocation purges content and stops background polling', async () => {
  let revoke = false; const h = harness({ rpc: name => name === 'journal_feedback_list' && revoke ? { error: { code: '42501', message: 'access denied' } } : undefined }); await h.open(); h.feedback.setDraft('title', 'Saisie privée'); revoke = true; await h.feedback.checkNew(); assert.equal(h.feedback.isOpen(), false); assert.equal(h.feedback.state().list.length, 0); assert.equal(h.feedback.state().draft.title, ''); assert.equal(h.timers.size, 0); assert(h.toasts.some(t => /retiré/.test(t.message)));
});
test('an author-only mutation rejection does not purge access to the common feed', async () => {
  const h = harness({ rpc: name => name === 'journal_feedback_update_thread' ? { error: { code: '42501', message: 'permission denied' } } : undefined }); await h.open(); await h.feedback.openThread(T); h.feedback.beginEditThread(); await h.feedback.saveThread(); assert(h.feedback.isOpen()); assert.equal(h.feedback.state().editDraft.title, h.row(T).title); assert.match(h.feedback.state().error, /droits/);
});
test('late detail load cannot show another thread after navigation', async () => {
  const wait = deferred(), h = harness({ rpc: (name, args) => name === 'journal_feedback_get' && args.p_id === T ? wait.promise : undefined }); await h.open(); const pending = h.feedback.openThread(T); await flush(); await h.feedback.openThread(U); wait.resolve({ data: h.row(T) }); await pending; assert.equal(h.feedback.state().thread.id, U);
});
test('late signed image from another detail never replaces current image', async () => {
  const wait = deferred(), h = harness({ signed: path => path.includes(T) ? wait.promise : { data: { signedUrl: 'https://project.supabase.co/current-B.png' } } }); h.rows.set(T, h.row(T, A, { image_path: `${A}/${T}/a.png` })); h.rows.set(U, h.row(U, B, { image_path: `${B}/${U}/b.png` })); await h.open(); const pending = h.feedback.openThread(T); await flush(); await h.feedback.openThread(U); wait.resolve({ data: { signedUrl: 'https://project.supabase.co/old-A.png' } }); await pending; assert.equal(h.feedback.state().thread.id, U); assert.match(h.doc.getElementById('feedbackImageHost').innerHTML, /current-B/); assert.doesNotMatch(h.doc.getElementById('feedbackImageHost').innerHTML, /old-A/);
});
test('published image uses a five-minute signed URL and no public bucket URL', async () => { const h = harness(); h.rows.set(T, h.row(T, A, { image_path: `${A}/${T}/image.png` })); await h.open(); await h.feedback.openThread(T); assert.equal(h.storageCalls.find(c => c.method === 'signed').seconds, 300); assert.match(h.doc.getElementById('feedbackImageHost').innerHTML, /object\/sign/); });
test('untrusted content and names render escaped, and signed javascript URL is rejected', async () => {
  const h = harness({ signed: () => ({ data: { signedUrl: 'javascript:alert(1)' } }) }); h.rows.set(T, h.row(T, A, { title: '<img src=x onerror=alert(1)>', body: '<script>bad()</script>', author_name: '<Alice>', image_path: `${A}/${T}/a.png` })); await h.open(); assert.doesNotMatch(h.doc.getElementById('feedbackContent').innerHTML, /<script>|<img src=x/); assert.match(h.doc.getElementById('feedbackContent').innerHTML, /&lt;Alice&gt;/); await h.feedback.openThread(T); assert.doesNotMatch(h.doc.getElementById('feedbackImageHost').innerHTML, /javascript:/);
});
test('keyset pagination sends both cursor components and deduplicates overlapping items', async () => {
  let page = 0; const h = harness({ rpc: (name, args, user, { row }) => name === 'journal_feedback_list' ? { data: ++page === 1 ? { items: [row()], next_cursor: { created_at: NOW, id: T } } : { items: [row(), row(U, B)], next_cursor: null } } : undefined }); await h.open(); await h.feedback.loadMore(); const call = h.calls.filter(c => c.name === 'journal_feedback_list').at(-1); assert.equal(call.args.p_before_id, T); assert.equal(call.args.p_before_created_at, NOW); assert.equal(h.feedback.state().list.length, 2);
});
test('reply drafts remain separate for each thread and are cleared on account change', async () => { const h = harness(); await h.open(); await h.feedback.openThread(T); h.feedback.setReplyDraft('Précision pour A'); await h.feedback.openThread(U); h.feedback.setReplyDraft('Précision pour B'); await h.feedback.openThread(T); assert.equal(h.feedback.state().replyDraft.body, 'Précision pour A'); h.context.userId = B; h.feedback.contextChanged(); assert.equal(h.feedback.state().replyDraft.body, ''); });
test('ambiguous reply retry retains UUID and body', async () => {
  let count = 0; const h = harness({ rpc: name => name === 'journal_feedback_create_reply' && ++count === 1 ? Promise.reject(Error('lost')) : undefined }); await h.open(); await h.feedback.openThread(T); h.feedback.setReplyDraft('Je confirme le problème.'); await h.feedback.sendReply(); h.feedback.setReplyDraft('Texte différent'); await h.feedback.sendReply(); const calls = h.calls.filter(c => c.name === 'journal_feedback_create_reply'); assert.deepEqual(calls[0].args, calls[1].args); assert.equal(h.feedback.state().replyDraft.body, '');
});
test('admin delete cleans private image after server has deleted the publication', async () => {
  const h = harness({ canManage: true }); h.rows.set(U, h.row(U, B, { can_delete: true, image_path: `${B}/${U}/image.png` })); await h.open(); await h.feedback.openThread(U); await h.feedback.deleteThread(true); assert(h.storageCalls.some(c => c.method === 'remove' && c.paths[0].startsWith(B))); assert.equal(h.feedback.state().view, 'list');
});
test('optimistic edit conflict leaves the form and typed value available', async () => {
  const h = harness({ rpc: name => name === 'journal_feedback_update_thread' ? { error: { code: 'P0001', message: 'Ce retour a été modifié. Rechargez-le avant de réessayer.' } } : undefined }); await h.open(); await h.feedback.openThread(T); h.feedback.beginEditThread(); await h.feedback.saveThread(); assert.equal(h.feedback.state().view, 'edit'); assert(h.feedback.state().editDraft); assert.match(h.feedback.state().error, /modifié par une autre/);
});
