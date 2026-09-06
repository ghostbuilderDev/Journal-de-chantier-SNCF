/* Run with: node --test tests/message-edit.test.cjs */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '..', 'app-v13.js'), 'utf8');
const editSource = source.slice(source.indexOf('  async function editMessage('), source.indexOf('  async function softDeleteMessage('));

function setup() {
  const handlers = new Map(), nodes = new Map();
  const app = { sessionVersion: 0 };
  const result = { writes: [], toasts: [], modal: null, response: { data: { id: 'message' } } };
  const form = { reportValidity: () => true, values: { body: '', message_type: 'Info', zone: '' } };
  nodes.set('editMessageForm', form);
  const ctx = { app, String, Object, Boolean, Error,
    $: id => {
      if (!nodes.has(id)) nodes.set(id, { disabled: false, addEventListener: (event, fn) => handlers.set(`${id}:${event}`, fn) });
      return nodes.get(id);
    },
    FormData: class { constructor(element) { this.values = element.values; } entries() { return Object.entries(this.values); } },
    isCloudReady: () => true, escapeHtml: value => value, nowIso: () => '2026-09-06T15:00:00.000Z',
    openModal: modal => { result.modal = modal; }, closeModal() {},
    toast: (...args) => result.toasts.push(args), friendlyError: error => error.message,
    refreshCloudCurrent: async () => {},
    saveLocalData() {}, renderAll() {}
  };
  app.db = { from: () => ({ update: values => {
    result.writes.push(values);
    return { eq: () => ({ select: () => ({ single: async () => result.response }) }) };
  } }) };
  vm.createContext(ctx); vm.runInContext(editSource, ctx);
  return { ctx, app, result, form, save: () => handlers.get('saveEditMessage:click')() };
}

test('A published photo can keep or remove its caption while remaining editable', async () => {
  const { ctx, result, form, save } = setup();
  await ctx.editMessage({ id: 'message', body: 'Légende à retirer', attachments: [{ id: 'photo' }] });
  assert.match(result.modal.body, /Commentaire \(facultatif\)/);
  assert.doesNotMatch(result.modal.body, /textarea name="body" required/);
  form.values.body = '   ';
  await save();
  assert.equal(result.writes[0].body, '');
  assert.ok(result.toasts.some(([, kind]) => kind === 'success'));
});

test('Editing a text-only message cannot replace its body with whitespace', async () => {
  const { ctx, result, form, save } = setup();
  await ctx.editMessage({ id: 'message', body: 'Consigne', attachments: [] });
  assert.match(result.modal.body, /textarea name="body" required/);
  form.values.body = '\n  ';
  await save();
  assert.equal(result.writes.length, 0);
  assert.ok(result.toasts.some(([, kind]) => kind === 'warning'));
});

test('An edit rejected by changed rights is never presented as saved', async () => {
  const { ctx, result, form, save } = setup();
  await ctx.editMessage({ id: 'message', body: 'Consigne', attachments: [] });
  form.values.body = 'Nouvelle consigne'; result.response = { data: null };
  await save();
  assert.equal(result.writes.length, 1);
  assert.equal(result.toasts.filter(([, kind]) => kind === 'success').length, 0);
  assert.match(result.toasts[0][0], /droits/);
});
