/* PDF conservé dans IndexedDB jusqu'à confirmation des deux destinations. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const config = window.JOURNAL_CONFIG;
  const client = window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY,
    { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
  const requested = new URL(location.href).searchParams.get('chantierId');
  let busy = false;
  let ready;
  const db = new Promise((resolve, reject) => {
    const request = indexedDB.open('ainm-journal-archive-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('jobs');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('La conservation locale du PDF est indisponible.'));
  });
  db.catch(() => {}); // L’erreur est affichée au prochain accès, sans rejet non traité.
  async function storage(value) {
    const database = await db;
    return new Promise((resolve, reject) => {
      const tx = database.transaction('jobs', value === undefined ? 'readonly' : 'readwrite');
      const store = tx.objectStore('jobs');
      const request = value === undefined ? store.get('pending') : store.put(value, 'pending');
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = tx.onabort = () => reject(new Error('Impossible de conserver le PDF sur ce téléphone.'));
    });
  }
  function status(message) { $('journalArchiveStatus').textContent = message; }
  function describe(job) {
    if (!job) return 'Choisissez le chantier destinataire. Le même PDF sera envoyé aux deux destinations.';
    return `${job.meta.reportNo} — ${job.chantierName} : journal ${job.journal ? 'archivé' : 'à envoyer'} ; SharePoint ${job.sharepoint === 'archived' ? 'archivé' : job.sharepoint === 'submitted' ? 'confirmation en attente' : 'à envoyer'}.`;
  }
  async function loadChantiers() {
    const { data: { session }, error } = await client.auth.getSession();
    if (error) throw error;
    const select = $('journalChantier');
    select.replaceChildren(new Option('Choisir le chantier…', ''));
    if (!session) {
      status('Ouvrez le journal de chantier et connectez-vous, puis cliquez sur Actualiser la connexion.');
      return;
    }
    const result = await client.from('chantiers').select('id,name').order('name');
    if (result.error) throw result.error;
    for (const chantier of result.data || []) select.add(new Option(chantier.name || chantier.id, chantier.id));
    const job = await storage();
    const pending = job && !job.done;
    const target = pending ? job.chantierId : requested;
    if (target && [...select.options].some(o => o.value === target)) select.value = target;
    select.disabled = !!pending;
    status(pending ? describe(job) + ' Reprendre conserve le PDF original, même si le formulaire a changé.' : describe(null));
    if (target && !select.value) status('Le chantier demandé est inaccessible avec ce compte. Vérifiez votre connexion dans le journal.');
    $('journalResumeButton').hidden = !pending;
    $('journalDownloadButton').hidden = !job;
  }
  async function identity(chantierId) {
    const { data: { user }, error } = await client.auth.getUser();
    if (error || !user) throw new Error('Connectez-vous au journal de chantier, puis actualisez la connexion.');
    const permission = await client.rpc('journal_can_archive_report', { p_chantier_id: chantierId });
    if (permission.error) throw new Error('Archivage journal indisponible : migration Supabase à installer ou connexion à vérifier.');
    if (!permission.data) throw new Error('Ce compte ne peut pas déposer de rapport dans ce chantier.');
    return user.id;
  }
  async function enqueue(createPdf, meta) {
    await ready;
    const existing = await storage();
    if (existing && !existing.done) return existing;
    const select = $('journalChantier');
    if (!select.value) throw new Error('Sélectionnez le chantier destinataire avant l’envoi.');
    const chantierId = select.value;
    const chantierName = select.selectedOptions[0].textContent;
    const userId = await identity(chantierId);
    const pdf = await createPdf();
    meta = typeof meta === "function" ? meta() : meta;
    const bytes = new Uint8Array(await pdf.blob.arrayBuffer());
    if (new TextDecoder().decode(bytes.slice(0,5)) !== '%PDF-' || bytes.length > 52428800) throw new Error('PDF invalide ou supérieur à 50 Mo.');
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2,'0')).join('');
    const job = { id: crypto.randomUUID(), chantierId, chantierName, userId, hash, blob: pdf.blob,
      filename: pdf.filename, meta, journal: false, sharepoint: 'new', done: false };
    await storage(job);
    select.disabled = true;
    $('journalDownloadButton').hidden = false;
    return job;
  }
  async function archiveJournal(job) {
    const numbered = !!job.meta.reportId || !!job.meta.imported;
    const reservation = await client.rpc(numbered ? 'journal_reserve_numbered_pdf' : 'reserve_journal_report', {
      p_chantier_id: job.chantierId, p_sha256: job.hash, p_file_name: job.filename, p_bytes: job.blob.size,
      ...(numbered ? {p_report_id: job.meta.reportId || null, p_imported: !!job.meta.imported} : {})
    });
    if (reservation.error) throw reservation.error;
    const r = reservation.data;
    // Une réponse perdue après le dépôt n'entraîne pas de second document.
    const existing = await client.from('chantier_documents').select('id').eq('id', r.id).maybeSingle();
    if (existing.error) throw existing.error;
    if (!existing.data) {
      const upload = await client.storage.from('chantier-documents').upload(r.storage_path, job.blob, { contentType: 'application/pdf', upsert: false });
      if (upload.error && !['409','400'].includes(String(upload.error.statusCode))) throw upload.error;
      // Même si un objet existe déjà, seul le serveur confirme le dépôt complet.
      const finalized = await client.rpc('finalize_journal_report', { p_upload_id: r.id });
      if (finalized.error) throw finalized.error;
    }
    job.documentId = r.id;
    job.journal = true;
    await storage(job);
  }
  async function run(job, sendSharePoint, readSharePoint) {
    if (busy) throw new Error('Un archivage est déjà en cours.');
    busy = true;
    const errors = [];
    try {
      const userId = await identity(job.chantierId);
      if (userId !== job.userId) throw new Error('Reconnectez le compte ayant préparé ce PDF pour reprendre son envoi.');
      status('Archivage en cours…');
      if (!job.journal) {
        try { await archiveJournal(job); } catch (error) { errors.push(`Journal : ${error.message}`); }
      }
      if (job.sharepoint !== 'archived') {
        try {
          if (job.sharepoint === 'new' || job.sharepoint === 'failed') {
            // Enregistrer avant POST : une réponse perdue ne doit pas provoquer un renvoi aveugle.
            job.sharepoint = 'submitted';
            await storage(job);
            await sendSharePoint(job);
          }
          let confirmation;
          for (let attempt = 0; attempt < 6; attempt++) {
            confirmation = await readSharePoint(`RJ-${job.id}`);
            if (['archived', 'failed'].includes(confirmation?.state)) break;
            status(describe(job) + ' Vérification SharePoint en cours…');
            if (attempt < 5) await new Promise(resolve => setTimeout(resolve, 3000));
          }
          if (confirmation?.state === 'archived') job.sharepoint = 'archived';
          else if (confirmation?.state === 'failed') {
            job.sharepoint = 'failed';
            errors.push(`SharePoint : ${confirmation.error || 'envoi refusé'}`);
          } else errors.push('SharePoint : confirmation en attente. Cliquez sur Reprendre dans quelques instants.');
          await storage(job);
        } catch (error) { errors.push(`SharePoint : ${error.message}`); }
      }
      job.done = job.journal && job.sharepoint === 'archived';
      await storage(job);
      status(describe(job) + (errors.length ? ' ' + errors.join(' ') : ''));
      $('journalResumeButton').hidden = job.done;
      $('journalChantier').disabled = !job.done;
      return job;
    } finally { busy = false; }
  }
  $('journalRefreshButton').addEventListener('click', () => {
    if (busy) return;
    ready = loadChantiers().catch(error => status(error.message));
  });
  $('journalDownloadButton').addEventListener('click', async () => {
    try {
      const job = await storage();
      if (!job) return;
      const url = URL.createObjectURL(job.blob);
      const link = document.createElement('a'); link.href = url; link.download = job.filename; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (error) { status(error.message); }
  });
  ready = loadChantiers().catch(error => status(error.message));
  window.JournalArchive = { enqueue, run };
})();
