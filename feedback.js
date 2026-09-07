/* Améliorer l’application · V14.5. Independent feed; no push and no persistent drafts. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.JournalFeedback = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const BUCKET = 'journal-feedback-images', PAGE = 30, MAX_IMAGE = 5 * 1024 * 1024;
  const CATEGORIES = { bug: 'Problème rencontré', improvement: 'Idée d’amélioration' };
  const STATUSES = { new: 'À étudier', planned: 'Prévue', in_progress: 'En cours', done: 'Réalisée' };
  const MIME = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const safeURL = value => { try { const u = new URL(value); return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : ''; } catch { return ''; } };
  const date = value => { try { return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value)); } catch { return ''; } };
  function create(adapter, environment = {}) {
    const win = environment.window ?? (typeof window !== 'undefined' ? window : null);
    const doc = environment.document ?? win?.document, nav = environment.navigator ?? win?.navigator;
    const every = environment.setInterval || setInterval, stop = environment.clearInterval || clearInterval;
    const crypto = environment.crypto || win?.crypto;
    const ctx = () => adapter.getContext() || {};
    const toast = (message, tone = 'warning') => adapter.toast?.(message, tone);
    let owner = null, epoch = 0, opened = false, canManage = false, busy = false;
    let listSerial = 0, detailSerial = 0, fileSerial = 0, checking = false, interval = null;
    let list = [], cursor = null, thread = null, replies = [], replyCursor = null;
    let view = 'list', error = '', loading = false, newContent = false, returnFocus = null, historyToken = null;
    let filters = { status: '', category: '' }, draft = freshDraft(), replyDraft = freshReply(), editDraft = null;
    const replyDrafts = new Map();
    let dialog = null, content = null, notice = null, freshButton = null, urls = new Map(), preview = null;
    const bindings = new WeakSet();
    function id() {
      if (crypto?.randomUUID) return crypto.randomUUID();
      if (!crypto?.getRandomValues) throw new Error('Ouvrez l’application dans un navigateur récent avec son adresse HTTPS.');
      const b = crypto.getRandomValues(new Uint8Array(16)); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
      const h = Array.from(b, n => n.toString(16).padStart(2, '0')).join('');
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
    }
    function freshDraft() { return { id: null, title: '', body: '', category: 'bug', file: null, imagePath: null, uploaded: false, pending: null }; }
    function freshReply() { return { id: null, body: '', pending: null, threadId: null }; }
    function valid(ticket) { return ticket === epoch && owner && ctx().ready && ctx().userId === owner; }
    function online() { return nav?.onLine !== false; }
    function requireOnline() { if (!online()) throw new Error('Vous êtes hors connexion. Votre brouillon reste disponible ici ; reconnectez-vous pour l’envoyer.'); }
    function state() { return { userId: owner, opened, canManage, busy, view, error, loading, newContent, list: [...list], cursor, thread, replies: [...replies], replyCursor, draft: { ...draft }, replyDraft: { ...replyDraft }, editDraft: editDraft && { ...editDraft }, filters: { ...filters } }; }
    async function rpc(name, args = {}, ticket = epoch) {
      if (!valid(ticket)) return null;
      const db = ctx().db;
      if (!db?.rpc) throw new Error('La connexion à l’application n’est pas disponible.');
      const response = await db.rpc(`journal_feedback_${name}`, args);
      if (!valid(ticket)) return null;
      if (response.error) {
        if (String(response.error.code) === '42501' && ['context', 'list', 'get', 'replies'].includes(name)) { clear(); toast('Votre accès à l’espace améliorations a été retiré.', 'warning'); }
        throw response.error;
      }
      return response.data;
    }
    function friendly(err, fallback = 'La demande n’a pas abouti. Réessayez dans un instant.') {
      if (!online()) return 'Vous êtes hors connexion. Votre brouillon reste disponible ici ; reconnectez-vous pour l’envoyer.';
      const message = String(err?.message || '');
      if (/modifi[ée].*Rechargez|avant de réessayer/i.test(message)) return 'Ce retour a été modifié par une autre personne. Revenez à sa fiche puis rouvrez la modification ; votre saisie actuelle reste affichée.';
      if (/not found|introuvable|supprim[ée]/i.test(message)) return 'Cette publication n’est plus disponible. Actualisez la liste.';
      if (/permission|accès|not allowed|forbidden|JWT/i.test(message)) return 'Vos droits ne permettent plus cette opération. Actualisez ou reconnectez-vous.';
      return /hors connexion|HTTPS|capture|image|caractères|publication|titre|description|réponse/i.test(message) && message.length < 260 ? message : fallback;
    }
    function setError(value) { error = value; renderNotice(); }
    function renderNotice() { if (notice) { notice.textContent = error; notice.hidden = !error; } }
    function offlineNotice() { const e = doc?.getElementById('feedbackOffline'); if (e) e.hidden = online(); }
    function renderFresh() { if (freshButton) { freshButton.hidden = !newContent; freshButton.textContent = view === 'detail' ? 'Des nouveautés — actualiser' : 'Nouveaux retours — actualiser'; } }
    function revokePreview() { if (preview) { (environment.URL || win?.URL)?.revokeObjectURL?.(preview); preview = null; } }
    function bindButtons() {
      for (const name of ['feedbackBtn', 'sidebarFeedbackBtn']) {
        const button = doc?.getElementById(name);
        if (!button) continue;
        button.hidden = !ctx().ready || !ctx().userId;
        if (!bindings.has(button)) { button.addEventListener('click', () => void open()); bindings.add(button); }
      }
    }
    function clear() {
      ++epoch; ++listSerial; ++detailSerial; ++fileSerial;
      close(); owner = null; canManage = false; busy = false; checking = false;
      list = []; cursor = null; thread = null; replies = []; replyCursor = null;
      draft = freshDraft(); replyDraft = freshReply(); replyDrafts.clear(); editDraft = null; filters = { status: '', category: '' };
      error = ''; loading = false; newContent = false; urls.clear(); revokePreview();
      if (content) content.replaceChildren();
      bindButtons();
    }
    function contextChanged() {
      const c = ctx(), next = c.ready && c.userId ? c.userId : null;
      if (next !== owner) { clear(); owner = next; }
      bindButtons();
    }
    function ensureDialog() {
      if (dialog || !doc?.createElement) return;
      dialog = doc.createElement('dialog'); dialog.id = 'feedbackDialog'; dialog.className = 'feedback-dialog';
      dialog.setAttribute('aria-labelledby', 'feedbackTitle');
      dialog.innerHTML = `<div class="feedback-shell"><header class="feedback-header"><div><span class="feedback-eyebrow">ESPACE COMMUN</span><h1 id="feedbackTitle">Améliorer l’application</h1></div><button type="button" class="feedback-close" data-feedback-action="close" aria-label="Fermer l’espace améliorations">Fermer <span aria-hidden="true">×</span></button></header><p class="feedback-intro">Un problème ou une idée par publication. Cet espace est commun à tous les utilisateurs.</p><div class="feedback-offline" id="feedbackOffline" role="status" hidden>Hors connexion. L’envoi sera possible une fois la connexion rétablie.</div><p class="feedback-notice" id="feedbackNotice" role="alert" hidden></p><button type="button" id="feedbackFresh" class="feedback-fresh" data-feedback-action="refresh" hidden>Nouveaux retours — actualiser</button><main class="feedback-content" id="feedbackContent"></main></div>`;
      doc.body.appendChild(dialog);
      content = doc.getElementById('feedbackContent'); notice = doc.getElementById('feedbackNotice'); freshButton = doc.getElementById('feedbackFresh');
      dialog.addEventListener('click', event => { const button = event.target.closest?.('[data-feedback-action]'); if (button && !button.disabled) void action(button.dataset.feedbackAction, button.dataset.id, button); });
      dialog.addEventListener('submit', event => { event.preventDefault(); if (event.target.id === 'feedbackCompose') void submit(); else if (event.target.id === 'feedbackReplyForm') void sendReply(); else if (event.target.id === 'feedbackEditForm') void saveThread(); else if (event.target.id === 'feedbackEditReplyForm') void saveReply(editDraft?.id, editDraft?.body); });
      dialog.addEventListener('input', event => {
        const target = event.target;
        if (target.dataset?.draft) setDraft(target.dataset.draft, target.value);
        else if (target.id === 'feedbackReplyBody') setReplyDraft(target.value);
        else if (target.dataset?.edit && editDraft) editDraft[target.dataset.edit] = target.value;
      });
      dialog.addEventListener('change', event => {
        const target = event.target;
        if (target.id === 'feedbackFile') void selectFile(target.files?.[0] || null);
        else if (target.dataset?.filter) { filters[target.dataset.filter] = target.value; void refresh(); }
        else if (target.dataset?.draft) setDraft(target.dataset.draft, target.value);
        else if (target.dataset?.edit && editDraft) editDraft[target.dataset.edit] = target.value;
        else if (target.id === 'feedbackStatus') void setStatus(target.value);
      });
      dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
      dialog.addEventListener('close', () => { if (opened) close(); });
    }
    function startPolling() {
      if (interval || !opened || doc?.visibilityState === 'hidden') return;
      interval = every(() => void checkNew(), 30000);
    }
    function stopPolling() { if (interval !== null) { stop(interval); interval = null; } }
    async function open() {
      contextChanged();
      if (!owner) { toast('Connectez-vous pour accéder aux améliorations de l’application.'); return false; }
      if (opened) return true;
      ensureDialog(); returnFocus = doc?.activeElement; opened = true; view = 'list'; error = ''; newContent = false;
      adapter.onVisibilityChange?.();
      if (dialog) { if (typeof dialog.showModal === 'function') dialog.showModal(); else { dialog.setAttribute('open', ''); dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); } }
      try { historyToken = id(); win?.history?.pushState?.({ ...(win.history.state || {}), journalFeedback: historyToken }, ''); } catch { historyToken = null; }
      startPolling(); render();
      const ticket = epoch;
      try {
        requireOnline();
        const permissions = await rpc('context', {}, ticket);
        if (!valid(ticket) || !opened) return false;
        canManage = permissions?.user_id === owner && permissions?.can_manage === true;
        await refresh();
      } catch (err) { if (valid(ticket) && opened) { setError(friendly(err, 'L’espace améliorations n’est pas disponible. Vérifiez la fin de la mise à jour puis actualisez.')); render(); } }
      return valid(ticket) && opened;
    }
    function close(fromHistory = false) {
      if (!opened) return;
      opened = false; stopPolling(); ++listSerial; ++detailSerial; loading = false; checking = false;
      adapter.onVisibilityChange?.();
      if (dialog) { if (typeof dialog.close === 'function') dialog.close(); else dialog.removeAttribute('open'); }
      if (!fromHistory && historyToken && win?.history?.state?.journalFeedback === historyToken) win.history.back?.();
      historyToken = null;
      if (returnFocus?.isConnected !== false) returnFocus?.focus?.();
      returnFocus = null;
    }
    function signature(items) { return items.map(item => `${item.id}:${item.updated_at}:${item.reply_count ?? ''}:${item.reply_updated_at ?? ''}`).join('|'); }
    async function refresh() {
      if (!opened || !valid(epoch)) return;
      if (view === 'detail' && thread) return loadThread(thread.id, true);
      if (view !== 'list') return;
      const ticket = epoch, serial = ++listSerial; loading = true; setError(''); renderList();
      try {
        requireOnline();
        const response = await rpc('list', { p_before_created_at: null, p_before_id: null, p_status: filters.status || null, p_category: filters.category || null, p_limit: PAGE }, ticket);
        if (!valid(ticket) || !opened || serial !== listSerial || view !== 'list') return;
        list = response?.items || []; cursor = response?.next_cursor || null; newContent = false;
      } catch (err) { if (valid(ticket) && opened && serial === listSerial) setError(friendly(err)); }
      finally { if (valid(ticket) && opened && serial === listSerial) { loading = false; renderList(); renderFresh(); } }
    }
    async function loadMore() {
      if (!opened || view !== 'list' || loading || !cursor) return;
      const ticket = epoch, serial = listSerial, next = { ...cursor }; loading = true; renderList();
      try {
        requireOnline();
        const response = await rpc('list', { p_before_created_at: next.created_at, p_before_id: next.id, p_status: filters.status || null, p_category: filters.category || null, p_limit: PAGE }, ticket);
        if (!valid(ticket) || !opened || serial !== listSerial || view !== 'list') return;
        const seen = new Set(list.map(row => row.id)); list.push(...(response?.items || []).filter(row => !seen.has(row.id))); cursor = response?.next_cursor || null;
      } catch (err) { if (valid(ticket) && opened && serial === listSerial) setError(friendly(err)); }
      finally { if (valid(ticket) && opened && serial === listSerial) { loading = false; renderList(); } }
    }
    async function checkNew() {
      if (!opened || doc?.visibilityState === 'hidden' || checking || loading || busy || !online() || !valid(epoch)) return;
      const ticket = epoch, serial = detailSerial, listVersion = listSerial, target = thread?.id, currentView = view;
      checking = true;
      try {
        if (currentView === 'detail' && target) {
          const result = await rpc('get', { p_id: target }, ticket);
          if (valid(ticket) && opened && serial === detailSerial && view === currentView && thread?.id === target && signature([result]) !== signature([thread])) newContent = true;
        } else if (currentView === 'list') {
          const result = await rpc('list', { p_before_created_at: null, p_before_id: null, p_status: filters.status || null, p_category: filters.category || null, p_limit: PAGE }, ticket);
          if (valid(ticket) && opened && listVersion === listSerial && view === currentView && signature(result?.items || []) !== signature(list.slice(0, PAGE))) newContent = true;
        }
        if (valid(ticket) && opened) renderFresh();
      } catch { /* Manual refresh surfaces network or access errors; no repeated alerts. */ }
      finally { if (valid(ticket)) checking = false; }
    }
    async function signedImage(item, ticket = epoch) {
      if (!item?.image_path || !valid(ticket)) return '';
      const cached = urls.get(item.image_path);
      if (cached && cached.expires > Date.now()) return cached.url;
      try {
        const result = await ctx().db.storage.from(BUCKET).createSignedUrl(item.image_path, 300);
        if (!valid(ticket) || result.error) return '';
        const url = safeURL(result.data?.signedUrl);
        if (url) urls.set(item.image_path, { url, expires: Date.now() + 240000 });
        return url;
      } catch { return ''; }
    }
    async function loadThread(threadId, preserveReply = false) {
      if (!uuidPattern.test(threadId || '') || !opened || !valid(epoch)) return;
      replyDraft = replyDrafts.get(threadId) || freshReply();
      replyDraft.threadId = threadId; replyDrafts.set(threadId, replyDraft);
      const ticket = epoch, serial = ++detailSerial; ++listSerial; view = 'detail'; loading = true; newContent = false; setError('');
      if (thread?.id !== threadId) { thread = null; replies = []; replyCursor = null; }
      render();
      try {
        requireOnline();
        const result = await Promise.all([rpc('get', { p_id: threadId }, ticket), rpc('replies', { p_thread_id: threadId, p_before_created_at: null, p_before_id: null, p_limit: PAGE }, ticket)]);
        if (!valid(ticket) || !opened || serial !== detailSerial || view !== 'detail') return;
        if (!result[0]) throw new Error('Publication introuvable.');
        thread = result[0]; replies = [...(result[1]?.items || [])].reverse(); replyCursor = result[1]?.next_cursor || null;
        loading = false; renderDetail();
        if (thread.image_path) {
          const url = await signedImage(thread, ticket);
          if (valid(ticket) && opened && serial === detailSerial && view === 'detail') renderImage(url);
        }
      } catch (err) { if (valid(ticket) && opened && serial === detailSerial) setError(friendly(err)); }
      finally { if (valid(ticket) && opened && serial === detailSerial) { loading = false; if (!thread) renderDetail(); renderFresh(); } }
    }
    async function loadOlderReplies() {
      if (!thread || !replyCursor || loading || view !== 'detail') return;
      const ticket = epoch, serial = detailSerial, threadId = thread.id, next = { ...replyCursor }; loading = true;
      try {
        requireOnline();
        const response = await rpc('replies', { p_thread_id: threadId, p_before_created_at: next.created_at, p_before_id: next.id, p_limit: PAGE }, ticket);
        if (!valid(ticket) || !opened || serial !== detailSerial || thread?.id !== threadId) return;
        const seen = new Set(replies.map(row => row.id)); replies.unshift(...[...(response?.items || [])].reverse().filter(row => !seen.has(row.id))); replyCursor = response?.next_cursor || null;
        renderReplies();
      } catch (err) { if (valid(ticket) && opened && serial === detailSerial) setError(friendly(err)); }
      finally { if (valid(ticket) && serial === detailSerial) loading = false; }
    }
    function setDraft(key, value) { if (!draft.pending && ['title', 'body', 'category'].includes(key)) draft[key] = value; }
    function setReplyDraft(body) { if (!replyDraft.pending) replyDraft.body = body; }
    function compose() { if (busy) return; view = 'compose'; ++detailSerial; ++listSerial; loading = false; setError(''); render(); doc?.getElementById('feedbackDraftTitle')?.focus?.(); }
    async function selectFile(file) {
      if (draft.pending || busy) return false;
      const selection = ++fileSerial;
      if (file && (!MIME[file.type] || file.size <= 0 || file.size > MAX_IMAGE)) { setError('Choisissez une capture JPEG, PNG ou WebP de 5 Mo maximum.'); const input = doc?.getElementById('feedbackFile'); if (input) input.value = ''; return false; }
      const previousPath = draft.imagePath, db = ctx().db, ticket = epoch, thisDraft = draft;
      if (previousPath && draft.uploaded) { try { await db.storage.from(BUCKET).remove([previousPath]); } catch { /* Unpublished capture cleanup is best effort. */ } }
      if (!valid(ticket) || draft !== thisDraft || selection !== fileSerial || draft.pending || busy) return false;
      revokePreview();
      draft.file = file; draft.imagePath = null; draft.uploaded = false;
      if (file) preview = (environment.URL || win?.URL)?.createObjectURL?.(file) || null;
      setError(''); renderFile(); return true;
    }
    function validateText(title, body, category) {
      if (!title.trim() || title.trim().length > 100) throw new Error('Indiquez un titre de 1 à 100 caractères.');
      if (!body.trim() || body.trim().length > 4000) throw new Error('Décrivez votre retour en 1 à 4 000 caractères.');
      if (!CATEGORIES[category]) throw new Error('Choisissez le type de votre publication.');
    }
    function definite(err) { return Boolean(err?.code && /^(?:P0001|22\w{3}|23\w{3}|42501)$/.test(String(err.code))); }
    async function submit() {
      if (busy || !valid(epoch)) return;
      const ticket = epoch, thisDraft = draft, userId = owner, db = ctx().db, serial = detailSerial; busy = true; setError(''); renderBusy();
      try {
        requireOnline();
        validateText(thisDraft.title, thisDraft.body, thisDraft.category);
        thisDraft.id ||= id();
        if (thisDraft.file && !thisDraft.uploaded) {
          thisDraft.imagePath ||= `${userId}/${thisDraft.id}/${id()}.${MIME[thisDraft.file.type]}`;
          const result = await db.storage.from(BUCKET).upload(thisDraft.imagePath, thisDraft.file, { cacheControl: '3600', upsert: false, contentType: thisDraft.file.type });
          if (!valid(ticket) || draft !== thisDraft) return;
          if (result.error && !['409', 'Duplicate', '409 Conflict'].includes(String(result.error.statusCode || result.error.status || result.error.code))) throw new Error('La capture n’a pas été envoyée. Votre texte et votre fichier sont conservés ; réessayez.');
          thisDraft.uploaded = true;
        }
        if (!valid(ticket) || draft !== thisDraft) return;
        thisDraft.pending ||= { p_id: thisDraft.id, p_title: thisDraft.title.trim(), p_body: thisDraft.body.trim(), p_category: thisDraft.category, p_image_path: thisDraft.imagePath };
        renderBusy();
        const result = await rpc('create_thread', thisDraft.pending, ticket);
        if (!valid(ticket) || draft !== thisDraft) return;
        if (!result?.id) throw new Error('Publication non confirmée. Réessayez avec le même brouillon.');
        draft = freshDraft(); revokePreview(); toast('Votre retour a été publié dans l’espace améliorations.', 'success');
        if (opened && view === 'compose' && detailSerial === serial) await loadThread(result.id);
      } catch (err) {
        if (valid(ticket) && draft === thisDraft) {
          if (definite(err)) thisDraft.pending = null;
          setError(thisDraft.pending ? 'Publication non confirmée. Réessayez : le même retour ne sera pas créé deux fois. Votre saisie reste conservée.' : friendly(err));
        }
      } finally { if (valid(ticket)) { busy = false; renderBusy(); } }
    }
    function beginEditThread() { if (!thread?.can_edit || busy) return; editDraft = { kind: 'thread', id: thread.id, title: thread.title, body: thread.body, category: thread.category, updatedAt: thread.updated_at }; view = 'edit'; setError(''); render(); }
    async function mutation(task, success) {
      if (busy || !valid(epoch)) return;
      const ticket = epoch; busy = true; setError(''); renderBusy();
      try { requireOnline(); const result = await task(ticket); if (valid(ticket)) await success?.(result, ticket); }
      catch (err) { if (valid(ticket)) setError(friendly(err)); }
      finally { if (valid(ticket)) { busy = false; renderBusy(); } }
    }
    async function saveThread() {
      if (!editDraft || editDraft.kind !== 'thread' || !thread?.can_edit) return;
      const saved = { ...editDraft }, editing = editDraft, serial = detailSerial;
      return mutation(async ticket => { validateText(saved.title, saved.body, saved.category); return rpc('update_thread', { p_id: saved.id, p_title: saved.title.trim(), p_body: saved.body.trim(), p_category: saved.category, p_expected_updated_at: saved.updatedAt }, ticket); }, async result => { if (!result) return; toast('Publication mise à jour.', 'success'); if (opened && view === 'edit' && editDraft === editing && detailSerial === serial) { editDraft = null; await loadThread(result.id, true); } });
    }
    async function setStatus(status) {
      if (!canManage || !thread || !STATUSES[status]) return;
      const target = thread, serial = detailSerial;
      return mutation(ticket => rpc('set_status', { p_id: target.id, p_status: status, p_expected_updated_at: target.updated_at }, ticket), result => { if (!result) return; if (opened && view === 'detail' && detailSerial === serial && thread?.id === target.id) { thread = result; renderStatus(); } toast('Statut mis à jour.', 'success'); });
    }
    async function deleteThread(confirmed = false) {
      if (!thread?.can_delete || busy) return;
      if (!confirmed && win?.confirm && !win.confirm('Supprimer cette publication et toutes ses réponses ? Cette suppression est définitive.')) return;
      const target = thread, db = ctx().db, serial = detailSerial, cleanupAllowed = target.author_id === owner || canManage;
      return mutation(ticket => rpc('delete_thread', { p_id: target.id, p_expected_updated_at: target.updated_at }, ticket), async (result, ticket) => {
        if (!result?.deleted) return;
        if (target.image_path && cleanupAllowed) { try { await db.storage.from(BUCKET).remove([target.image_path]); } catch { /* Content is already removed; storage access is independently protected. */ } }
        if (!valid(ticket)) return;
        list = list.filter(item => item.id !== target.id); replyDrafts.delete(target.id); toast('Publication supprimée.', 'success');
        if (opened && thread?.id === target.id && detailSerial === serial) { thread = null; replies = []; replyDraft = freshReply(); view = 'list'; await refresh(); }
      });
    }
    async function sendReply() {
      if (!thread || busy || !valid(epoch)) return;
      const target = thread, thisDraft = replyDraft, ticket = epoch, serial = detailSerial; busy = true; setError(''); renderBusy();
      try {
        requireOnline();
        if (!thisDraft.body.trim() || thisDraft.body.trim().length > 2000) throw new Error('Écrivez une réponse de 1 à 2 000 caractères.');
        thisDraft.id ||= id(); thisDraft.threadId = target.id;
        thisDraft.pending ||= { p_id: thisDraft.id, p_thread_id: target.id, p_body: thisDraft.body.trim() }; renderBusy();
        const result = await rpc('create_reply', thisDraft.pending, ticket);
        if (!valid(ticket) || replyDrafts.get(target.id) !== thisDraft) return;
        if (!result?.id) throw new Error('Réponse non confirmée.');
        const empty = freshReply(); empty.threadId = target.id; replyDrafts.set(target.id, empty); if (replyDraft === thisDraft) replyDraft = empty;
        if (opened && view === 'detail' && thread?.id === target.id && detailSerial === serial) await loadThread(target.id, true);
        toast('Réponse publiée.', 'success');
      } catch (err) { if (valid(ticket) && replyDraft === thisDraft) { if (definite(err)) thisDraft.pending = null; setError(thisDraft.pending ? 'Réponse non confirmée. Réessayez : elle ne sera pas créée deux fois.' : friendly(err)); } }
      finally { if (valid(ticket)) { busy = false; renderBusy(); } }
    }
    function beginEditReply(replyId) {
      const reply = replies.find(item => item.id === replyId);
      if (!reply?.can_edit || busy) return;
      editDraft = { kind: 'reply', id: reply.id, body: reply.body, updatedAt: reply.updated_at }; view = 'editReply'; setError(''); render();
    }
    async function saveReply(replyId, body) {
      const reply = replies.find(item => item.id === replyId);
      if (!reply?.can_edit || !editDraft || editDraft.id !== replyId) return;
      const updatedAt = editDraft.updatedAt, target = thread.id, serial = detailSerial, editing = editDraft;
      return mutation(ticket => { if (!body.trim() || body.trim().length > 2000) throw new Error('Écrivez une réponse de 1 à 2 000 caractères.'); return rpc('update_reply', { p_id: replyId, p_body: body.trim(), p_expected_updated_at: updatedAt }, ticket); }, async () => { if (opened && detailSerial === serial && editDraft === editing && view === 'editReply') { editDraft = null; await loadThread(target, true); } });
    }
    async function deleteReply(replyId, confirmed = false) {
      const reply = replies.find(item => item.id === replyId);
      if (!reply?.can_delete || busy) return;
      if (!confirmed && win?.confirm && !win.confirm('Supprimer cette réponse ?')) return;
      const target = thread.id, serial = detailSerial;
      return mutation(ticket => rpc('delete_reply', { p_id: replyId, p_expected_updated_at: reply.updated_at }, ticket), async result => { if (result?.deleted && opened && detailSerial === serial && thread?.id === target && view === 'detail') await loadThread(target, true); });
    }
    function back() {
      if (busy) { close(); return; }
      editDraft = null; setError('');
      if ((view === 'edit' || view === 'editReply') && thread) { view = 'detail'; render(); }
      else { view = 'list'; ++detailSerial; loading = false; render(); void refresh(); }
    }
    async function action(name, target, element) {
      if (name === 'close') return close();
      if (name === 'back') return back();
      if (name === 'compose') return compose();
      if (name === 'refresh') return refresh();
      if (name === 'more') return loadMore();
      if (name === 'open') return loadThread(target);
      if (name === 'remove-file') return selectFile(null);
      if (name === 'edit') return beginEditThread();
      if (name === 'delete') return deleteThread();
      if (name === 'older-replies') return loadOlderReplies();
      if (name === 'edit-reply') return beginEditReply(target);
      if (name === 'delete-reply') return deleteReply(target);
      if (name === 'image-retry' && thread) { const target = thread, serial = detailSerial, ticket = epoch; const url = await signedImage(target, ticket); if (valid(ticket) && opened && view === 'detail' && detailSerial === serial && thread?.id === target.id) renderImage(url); }
    }
    function options(values, selected, all = '') { return `${all ? `<option value="">${escape(all)}</option>` : ''}${Object.entries(values).map(([value, label]) => `<option value="${value}"${value === selected ? ' selected' : ''}>${escape(label)}</option>`).join('')}`; }
    function navBack(label = 'Tous les retours') { return `<button type="button" class="feedback-back" data-feedback-action="back"><span aria-hidden="true">←</span> ${label}</button>`; }
    function render() { if (!opened || !content) return; offlineNotice(); renderNotice(); renderFresh(); if (view === 'list') renderList(); else if (view === 'compose') renderCompose(); else if (view === 'detail') renderDetail(); else renderEdit(); }
    function renderList() {
      if (!opened || !content || view !== 'list') return;
      content.innerHTML = `<div class="feedback-toolbar"><div><h2>Les retours de l’équipe</h2><p>Pour améliorer l’outil, ensemble.</p></div><button type="button" class="feedback-primary" data-feedback-action="compose">Partager un retour</button></div><div class="feedback-filters"><label>Type<select data-filter="category" aria-label="Filtrer par type">${options(CATEGORIES, filters.category, 'Tous les types')}</select></label><label>Suivi<select data-filter="status" aria-label="Filtrer par statut">${options(STATUSES, filters.status, 'Tous les statuts')}</select></label><button type="button" class="feedback-secondary" data-feedback-action="refresh"${loading ? ' disabled' : ''}>${loading ? 'Chargement…' : 'Actualiser'}</button></div><div class="feedback-list">${list.map(item => `<button type="button" class="feedback-card" data-feedback-action="open" data-id="${escape(item.id)}"><div class="feedback-card-meta"><span class="feedback-category feedback-category-${item.category === 'bug' ? 'bug' : 'improvement'}">${escape(CATEGORIES[item.category] || 'Retour')}</span><span class="feedback-status feedback-status-${Object.hasOwn(STATUSES, item.status) ? item.status : 'new'}">${escape(STATUSES[item.status] || 'À étudier')}</span></div><h3>${escape(item.title)}</h3><p>${escape(item.body)}</p><div class="feedback-card-footer"><span>${escape(item.author_name || 'Collaborateur')} · ${escape(date(item.created_at))}</span><span>${Number(item.reply_count) || 0} réponse${Number(item.reply_count) === 1 ? '' : 's'}${item.image_path ? ' · Capture jointe' : ''}</span></div></button>`).join('') || `<div class="feedback-empty"><span class="feedback-empty-mark" aria-hidden="true">+</span><h3>${loading ? 'Chargement des retours…' : 'Votre expérience fait avancer l’application'}</h3><p>${loading ? 'Le fil commun se prépare.' : 'Signalez un problème rencontré ou proposez une amélioration utile sur le terrain.'}</p>${loading ? '' : '<button type="button" class="feedback-secondary" data-feedback-action="compose">Écrire le premier retour</button>'}</div>`}</div>${cursor ? `<button type="button" class="feedback-more" data-feedback-action="more"${loading ? ' disabled' : ''}>${loading ? 'Chargement…' : 'Afficher les retours précédents'}</button>` : ''}`;
    }
    function renderCompose() {
      if (!content) return;
      content.innerHTML = `${navBack()}<div class="feedback-form-heading"><h2>Partager un retour</h2><p>Indiquez ce qui s’est passé, ou ce qui vous aiderait.</p></div><form id="feedbackCompose" class="feedback-form"><label>Type de retour<select data-draft="category">${options(CATEGORIES, draft.category)}</select></label><label>Un titre clair<input id="feedbackDraftTitle" data-draft="title" value="${escape(draft.title)}" maxlength="100" required placeholder="Ex. La photo ne s’affiche pas après l’envoi"></label><label>Description<textarea data-draft="body" rows="6" maxlength="4000" required placeholder="Décrivez les étapes, le résultat obtenu et ce que vous attendiez.">${escape(draft.body)}</textarea><small>4 000 caractères maximum. Évitez les informations confidentielles du chantier.</small></label><div class="feedback-upload"><label for="feedbackFile">Capture d’écran <span>facultative</span></label><input id="feedbackFile" type="file" accept="image/jpeg,image/png,image/webp"><small>JPEG, PNG ou WebP · 5 Mo maximum · une image</small><div id="feedbackFilePreview"></div></div><p class="feedback-pending" id="feedbackPending" hidden>Envoi non confirmé. Réessayez avec ce même retour pour éviter un doublon.</p><div class="feedback-form-actions"><span>Visible par tous les utilisateurs de l’application.</span><button type="submit" class="feedback-primary" id="feedbackSubmit">Publier mon retour</button></div></form>`;
      renderFile(); renderBusy();
    }
    function renderFile() {
      const host = doc?.getElementById('feedbackFilePreview'); if (!host) return;
      host.innerHTML = draft.file ? `${preview ? `<img class="feedback-upload-preview" src="${escape(preview)}" alt="Aperçu de votre capture">` : ''}<div class="feedback-file-name"><span>${escape(draft.file.name || 'Capture d’écran')}</span><button type="button" class="feedback-text-button" data-feedback-action="remove-file"${busy || draft.pending ? ' disabled' : ''}>Retirer</button></div>` : '';
    }
    function renderDetail() {
      if (!content || !opened || view !== 'detail') return;
      if (!thread) { content.innerHTML = `${navBack()}<p class="feedback-empty">${loading ? 'Chargement de la publication…' : 'La publication n’est plus disponible.'}</p>`; return; }
      const item = thread;
      content.innerHTML = `${navBack()}<article class="feedback-thread"><div class="feedback-thread-meta"><span class="feedback-category feedback-category-${item.category === 'bug' ? 'bug' : 'improvement'}">${escape(CATEGORIES[item.category] || 'Retour')}</span><div id="feedbackStatusHost"></div></div><h2>${escape(item.title)}</h2><p class="feedback-byline">${escape(item.author_name || 'Collaborateur')} · ${escape(date(item.created_at))}${item.updated_at !== item.created_at ? ' · modifié' : ''}</p><div class="feedback-body">${escape(item.body)}</div>${item.image_path ? '<div class="feedback-image-host" id="feedbackImageHost"><p>Chargement de la capture…</p></div>' : ''}<div class="feedback-thread-actions">${item.can_edit ? '<button type="button" class="feedback-text-button" data-feedback-action="edit">Modifier</button>' : ''}${item.can_delete ? '<button type="button" class="feedback-text-button feedback-danger" data-feedback-action="delete">Supprimer</button>' : ''}</div></article><section class="feedback-replies"><h3>La discussion</h3><div id="feedbackRepliesHost"></div><form id="feedbackReplyForm" class="feedback-form feedback-reply-form"><label for="feedbackReplyBody">Votre réponse</label><textarea id="feedbackReplyBody" rows="3" maxlength="2000" required placeholder="Ajoutez une précision ou une piste d’amélioration…">${escape(replyDraft.body)}</textarea><small>2 000 caractères maximum.</small><div class="feedback-form-actions"><span id="feedbackReplyPending"></span><button type="submit" class="feedback-primary" id="feedbackReplySubmit">Répondre</button></div></form></section>`;
      renderStatus(); renderReplies(); renderBusy();
      const cached = item.image_path && urls.get(item.image_path); if (cached && cached.expires > Date.now()) renderImage(cached.url);
    }
    function renderStatus() { const host = doc?.getElementById('feedbackStatusHost'); if (!host || !thread) return; host.innerHTML = canManage ? `<label class="feedback-status-label">Suivi<select id="feedbackStatus"${busy ? ' disabled' : ''}>${options(STATUSES, thread.status)}</select></label>` : `<span class="feedback-status feedback-status-${Object.hasOwn(STATUSES, thread.status) ? thread.status : 'new'}">${escape(STATUSES[thread.status] || 'À étudier')}</span>`; }
    function renderImage(url) {
      const host = doc?.getElementById('feedbackImageHost'); if (!host) return;
      host.innerHTML = url ? `<a href="${escape(safeURL(url))}" target="_blank" rel="noopener noreferrer" aria-label="Ouvrir la capture en grand"><img src="${escape(safeURL(url))}" alt="Capture jointe à la publication" loading="lazy"></a>` : '<p>La capture n’a pas pu être chargée.</p><button type="button" class="feedback-text-button" data-feedback-action="image-retry">Réessayer</button>';
    }
    function renderReplies() {
      const host = doc?.getElementById('feedbackRepliesHost'); if (!host) return;
      host.innerHTML = `${replyCursor ? '<button type="button" class="feedback-more" data-feedback-action="older-replies">Afficher les réponses précédentes</button>' : ''}${replies.map(reply => `<article class="feedback-reply"><div class="feedback-reply-meta"><strong>${escape(reply.author_name || 'Collaborateur')}</strong><time>${escape(date(reply.created_at))}${reply.created_at !== reply.updated_at ? ' · modifiée' : ''}</time></div><div class="feedback-body">${escape(reply.body)}</div><div class="feedback-thread-actions">${reply.can_edit ? `<button type="button" class="feedback-text-button" data-feedback-action="edit-reply" data-id="${escape(reply.id)}">Modifier</button>` : ''}${reply.can_delete ? `<button type="button" class="feedback-text-button feedback-danger" data-feedback-action="delete-reply" data-id="${escape(reply.id)}">Supprimer</button>` : ''}</div></article>`).join('') || '<p class="feedback-no-replies">Une précision à apporter ? Lancez la discussion.</p>'}`;
    }
    function renderEdit() {
      if (!content || !editDraft) return;
      const reply = editDraft.kind === 'reply';
      content.innerHTML = `${navBack('Revenir à la publication')}<div class="feedback-form-heading"><h2>${reply ? 'Modifier votre réponse' : 'Modifier votre retour'}</h2></div><form id="${reply ? 'feedbackEditReplyForm' : 'feedbackEditForm'}" class="feedback-form">${reply ? '' : `<label>Type<select data-edit="category">${options(CATEGORIES, editDraft.category)}</select></label><label>Titre<input data-edit="title" value="${escape(editDraft.title)}" maxlength="100" required></label>`}<label>${reply ? 'Réponse' : 'Description'}<textarea data-edit="body" rows="7" maxlength="${reply ? '2000' : '4000'}" required>${escape(editDraft.body)}</textarea></label>${!reply && thread?.image_path ? '<p class="feedback-help">La capture jointe est conservée.</p>' : ''}<div class="feedback-form-actions"><button type="button" class="feedback-secondary" data-feedback-action="back">Annuler</button><button type="submit" class="feedback-primary" id="feedbackSave">Enregistrer</button></div></form>`;
      renderBusy();
    }
    function renderBusy() {
      if (!dialog) return;
      const composeForm = doc?.getElementById('feedbackCompose');
      composeForm?.querySelectorAll?.('input,textarea,select,[data-feedback-action="remove-file"]').forEach(e => e.disabled = busy || Boolean(draft.pending));
      const submitButton = doc?.getElementById('feedbackSubmit'); if (submitButton) { submitButton.disabled = busy; submitButton.textContent = busy ? 'Envoi en cours…' : draft.pending ? 'Réessayer la publication' : 'Publier mon retour'; }
      const pending = doc?.getElementById('feedbackPending'); if (pending) pending.hidden = !draft.pending || busy;
      const replyBody = doc?.getElementById('feedbackReplyBody'); if (replyBody) replyBody.disabled = busy || Boolean(replyDraft.pending);
      const replyButton = doc?.getElementById('feedbackReplySubmit'); if (replyButton) { replyButton.disabled = busy; replyButton.textContent = busy ? 'Envoi…' : replyDraft.pending ? 'Réessayer la réponse' : 'Répondre'; }
      const replyPending = doc?.getElementById('feedbackReplyPending'); if (replyPending) replyPending.textContent = replyDraft.pending && !busy ? 'Votre réponse reste conservée.' : '';
      dialog.querySelectorAll?.('#feedbackEditForm input,#feedbackEditForm textarea,#feedbackEditForm select,#feedbackEditReplyForm textarea,#feedbackSave,[data-feedback-action="edit"],[data-feedback-action="delete"],[data-feedback-action="edit-reply"],[data-feedback-action="delete-reply"],#feedbackStatus').forEach(e => e.disabled = busy);
    }
    doc?.addEventListener?.('visibilitychange', () => { if (doc.visibilityState === 'hidden') stopPolling(); else if (opened) { startPolling(); void checkNew(); } });
    win?.addEventListener?.('online', () => { offlineNotice(); if (opened) void checkNew(); });
    win?.addEventListener?.('offline', offlineNotice);
    win?.addEventListener?.('popstate', () => { if (opened && historyToken && win.history.state?.journalFeedback !== historyToken) close(true); });
    bindButtons();
    return { contextChanged, clear, open, close, isOpen: () => opened, state, refresh, loadMore, checkNew, openThread: loadThread, loadOlderReplies, compose, setDraft, selectFile, submit, setReplyDraft, sendReply, beginEditThread, saveThread, beginEditReply, saveReply, deleteReply, deleteThread, setStatus };
  }
  return { create, CATEGORIES, STATUSES, MAX_IMAGE };
});
