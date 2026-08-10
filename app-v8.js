(() => {
  "use strict";

  const BASE_CONFIG = window.JOURNAL_CONFIG || {};
  const LOCAL_KEY = "journal_chantier_connecte_v1";
  const RUNTIME_CONFIG_KEY = "journal_chantier_supabase_runtime_v1";
  const MAX_LOCAL_FILE_BYTES = 3 * 1024 * 1024;
  const MAX_CLOUD_FILE_BYTES = 48 * 1024 * 1024;
  const $ = id => document.getElementById(id);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const nowIso = () => new Date().toISOString();
  const makeId = () => crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  function runtimeConfig() {
    try {
      const value = JSON.parse(localStorage.getItem(RUNTIME_CONFIG_KEY) || "{}");
      return value && typeof value === "object" ? value : {};
    } catch { return {}; }
  }
  function normaliseConfig(value = {}) {
    const merged = { ...value, ...BASE_CONFIG };
    return {
      ...merged,
      SUPABASE_URL: String(BASE_CONFIG.SUPABASE_URL || value.SUPABASE_URL || "").trim().replace(/\/+$/, ""),
      SUPABASE_ANON_KEY: String(BASE_CONFIG.SUPABASE_ANON_KEY || value.SUPABASE_ANON_KEY || "").trim(),
      STORAGE_BUCKET: String(merged.STORAGE_BUCKET || "chantier-files").trim() || "chantier-files",
      APP_URL: String(BASE_CONFIG.APP_URL || value.APP_URL || "").trim()
    };
  }
  let CONFIG = normaliseConfig(runtimeConfig());

  const app = {
    mode: "local", db: null, user: null,
    profile: { id: "", full_name: "", company: "", email: "" },
    access: { platformRole: "", requestStatus: "", pendingRequests: 0 },
    chantiers: [], currentId: null, messages: [], actions: [], members: [], local: null,
    pendingFiles: [], replyTo: null, typeFilter: "", search: "", onlyImportant: false,
    planFilter: "", realtimeChannel: null, activeTab: "chat", printScope: null, refreshTimer: null
  };

  const els = {
    appShell: $("appShell"), chantierList: $("chantierList"), chantierSearch: $("chantierSearch"),
    newChantierBtn: $("newChantierBtn"), inviteBtn: $("inviteBtn"), notificationBtn: $("notificationBtn"),
    chantierCount: $("chantierCount"), profileName: $("profileName"), profileCompany: $("profileCompany"),
    profileAvatar: $("profileAvatar"), connectionLine: $("connectionLine"), connectionText: $("connectionText"),
    siteName: $("siteName"), siteMeta: $("siteMeta"), siteAvatar: $("siteAvatar"),
    connectionBanner: $("connectionBanner"), openSetupBtn: $("openSetupBtn"), messageCount: $("messageCount"),
    planCount: $("planCount"), actionCount: $("actionCount"), messageFeed: $("messageFeed"),
    messageSearch: $("messageSearch"), typeFilter: $("typeFilter"), importantFilterBtn: $("importantFilterBtn"),
    jumpBottomBtn: $("jumpBottomBtn"), composerShell: $("composerShell"), composerMeta: $("composerMeta"),
    composerMetaBtn: $("composerMetaBtn"), messageType: $("messageType"), messageZone: $("messageZone"),
    messageImportant: $("messageImportant"), replyPreview: $("replyPreview"), attachmentPreview: $("attachmentPreview"),
    fileInput: $("fileInput"), messageInput: $("messageInput"), planGrid: $("planGrid"),
    actionSummary: $("actionSummary"), actionBoard: $("actionBoard"), printCover: $("printCover"),
    modalBackdrop: $("modalBackdrop"), modal: document.querySelector(".modal"), modalTitle: $("modalTitle"),
    modalSubtitle: $("modalSubtitle"), modalBody: $("modalBody"), modalFoot: $("modalFoot"), toastStack: $("toastStack")
  };

  function defaultLocalData() {
    return { profile: { id: `local-${makeId()}`, full_name: "", company: "", email: "" }, chantiers: [], messages: [], actions: [], members: [], currentId: null };
  }

  function loadLocalData() {
    try {
      const loaded = JSON.parse(localStorage.getItem(LOCAL_KEY) || "null");
      if (loaded && typeof loaded === "object") {
        const defaults = defaultLocalData();
        return { ...defaults, ...loaded, profile: { ...defaults.profile, ...(loaded.profile || {}) },
          chantiers: Array.isArray(loaded.chantiers) ? loaded.chantiers : [],
          messages: Array.isArray(loaded.messages) ? loaded.messages : [],
          actions: Array.isArray(loaded.actions) ? loaded.actions : [],
          members: Array.isArray(loaded.members) ? loaded.members : [] };
      }
    } catch (error) { console.warn("Journal local illisible", error); }
    return defaultLocalData();
  }

  function saveLocalData() {
    if (!app.local) return;
    app.local.profile = { ...app.profile };
    app.local.currentId = app.currentId;
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify(app.local)); }
    catch { toast("Le stockage local est plein. Passe en mode collaboratif pour les gros fichiers.", "error"); }
  }

  function cloudConfigured(config = CONFIG) {
    return Boolean(config.SUPABASE_URL && config.SUPABASE_ANON_KEY && window.supabase);
  }
  function appUrl() {
    const configured = String(CONFIG.APP_URL || "").trim();
    if (configured) return configured;
    if (!/^https?:$/.test(location.protocol)) return "";
    const url = new URL(location.href);
    url.hash = "";
    url.search = "";
    return url.toString();
  }
  function validateSupabaseConfig(value) {
    const config = normaliseConfig(value);
    let parsedUrl;
    try { parsedUrl = new URL(config.SUPABASE_URL); }
    catch { throw new Error("L’URL Supabase est invalide."); }
    if (parsedUrl.protocol !== "https:") throw new Error("L’URL Supabase doit commencer par https://.");
    if (config.SUPABASE_ANON_KEY.length < 20) throw new Error("La clé publishable / anon semble incomplète.");
    if (config.APP_URL) {
      let parsedAppUrl;
      try { parsedAppUrl = new URL(config.APP_URL); }
      catch { throw new Error("L’adresse GitHub Pages est invalide."); }
      if (parsedAppUrl.protocol !== "https:") throw new Error("L’adresse GitHub Pages doit commencer par https://.");
    }
    return config;
  }
  function friendlyError(error) {
    const message = String(error?.message || error || "Erreur inconnue");
    if (/invalid api key|invalid jwt|jwt malformed/i.test(message)) return "La clé publishable / anon Supabase est incorrecte.";
    if (/relation .* does not exist|schema cache/i.test(message)) return "Le schéma Supabase n’est pas installé : exécute supabase-schema.sql dans l’éditeur SQL.";
    if (/row-level security|permission denied|not allowed/i.test(message)) return "Accès refusé : vérifie que le compte est invité au chantier et que le schéma a été exécuté.";
    if (/redirect|redirect_to/i.test(message)) return "L’URL GitHub Pages doit être ajoutée dans les Redirect URLs de Supabase Auth.";
    if (/invalid login credentials/i.test(message)) return "Adresse e-mail ou mot de passe incorrect.";
    if (/email not confirmed|email verification/i.test(message)) return "La confirmation d’e-mail est encore activée dans Supabase. Désactive-la dans Authentication → Sign In / Providers → Email.";
    if (/user already registered|already been registered/i.test(message)) return "Cette adresse possède déjà un compte. Connecte-toi avec son mot de passe.";
    if (/password.*(least|character)|weak password/i.test(message)) return "Choisis un mot de passe d’au moins 8 caractères.";
    if (/rate limit|too many requests/i.test(message)) return "Trop de tentatives rapprochées. Attends une minute puis réessaie.";
    return message;
  }
  function configFileText(config) {
    const publicConfig = {
      SUPABASE_URL: config.SUPABASE_URL,
      SUPABASE_ANON_KEY: config.SUPABASE_ANON_KEY,
      APP_NAME: config.APP_NAME || "Journal Chantier Connecté",
      STORAGE_BUCKET: config.STORAGE_BUCKET || "chantier-files",
      APP_URL: config.APP_URL || appUrl()
    };
    return `/* Configuration publique du Journal Chantier Connecté. Ne mets jamais ici une clé service_role. */\nwindow.JOURNAL_CONFIG = ${JSON.stringify(publicConfig, null, 2)};\n`;
  }
  function downloadConfigFile(config) {
    const blob = new Blob([configFileText(config)], { type: "application/javascript;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "config.js";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function isCloudReady() { return app.mode === "cloud" && Boolean(app.user && app.db); }
  function isJournalAdmin() { return isCloudReady() && ["proprietaire", "administrateur_general"].includes(app.access.platformRole); }
  function isJournalOwner() { return isCloudReady() && app.access.platformRole === "proprietaire"; }
  function roleLabel(role) {
    return ({
      proprietaire: "Propriétaire principal",
      administrateur_general: "Administrateur général",
      administrateur: "Administrateur du chantier",
      membre: "Contributeur",
      lecture: "Lecture seule"
    })[role] || "";
  }
  function requestStatusLabel(status) {
    return ({ en_attente: "En attente de validation", acceptee: "Accès validé", refusee: "Demande refusée" })[status] || "";
  }
  function currentChantier() { return app.chantiers.find(item => String(item.id) === String(app.currentId)) || null; }
  function ownId() { return isCloudReady() ? app.user.id : app.profile.id; }
  function ownName() { return app.profile.full_name.trim() || (isCloudReady() ? app.user.email?.split("@")[0] || "Intervenant" : "Intervenant"); }
  function initial(value = "?") { return String(value || "?").trim().split(/\s+/).slice(0, 2).map(word => word[0]).join("").toUpperCase() || "?"; }
  function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char])); }
  function truncate(value, length = 100) { const text = String(value || ""); return text.length > length ? `${text.slice(0, length - 1)}…` : text; }
  function formatDateTime(value) { return value ? new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : ""; }
  function formatTime(value) { return value ? new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : ""; }
  function formatDay(value) {
    const date = new Date(value), today = new Date(), yesterday = new Date(Date.now() - 86400000);
    if (date.toDateString() === today.toDateString()) return "Aujourd’hui";
    if (date.toDateString() === yesterday.toDateString()) return "Hier";
    return new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" }).format(date);
  }
  function formatBytes(bytes = 0) {
    if (!bytes) return "";
    const units = ["o", "Ko", "Mo", "Go"], index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / 1024 ** index).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} ${units[index]}`;
  }
  function fileIsImage(file) { return Boolean((file.type || "").startsWith("image/") || /\.(jpe?g|png|gif|webp|bmp|heic|heif)$/i.test(file.name || "")); }
  function fileIcon(file) {
    const name = (file.file_name || file.name || "").toLowerCase();
    if (fileIsImage(file)) return "▧";
    if (/\.pdf$/.test(name) || /pdf/.test(file.mime_type || file.type || "")) return "PDF";
    if (/\.(xls|xlsx|csv)$/.test(name)) return "XLS";
    if (/\.(dwg|dxf)$/.test(name)) return "CAD";
    if (/\.(doc|docx)$/.test(name)) return "DOC";
    return "FIC";
  }
  function typeClass(type) { return `tag-${String(type || "Info").replace(/\s/g, "")}`; }

  function toast(message, variant = "") {
    const item = document.createElement("div");
    item.className = `toast ${variant}`.trim();
    item.textContent = message;
    els.toastStack.appendChild(item);
    setTimeout(() => { item.style.opacity = "0"; item.style.transform = "translateY(8px)"; setTimeout(() => item.remove(), 200); }, 4200);
  }

  function openModal({ title, subtitle = "", body = "", footer = "", wide = false }) {
    els.modalTitle.textContent = title;
    els.modalSubtitle.textContent = subtitle;
    els.modalSubtitle.hidden = !subtitle;
    els.modalBody.innerHTML = body;
    els.modalFoot.innerHTML = footer;
    els.modal.classList.toggle("wide", wide);
    els.modalBackdrop.hidden = false;
    els.modalBackdrop.classList.remove("is-hidden");
    setTimeout(() => els.modal.querySelector("input, textarea, select, button")?.focus(), 20);
  }
  function closeModal() {
    els.modalBackdrop.hidden = true;
    els.modalBackdrop.classList.add("is-hidden");
    els.modalBody.innerHTML = "";
    els.modalFoot.innerHTML = "";
    els.modal.classList.remove("wide");
  }
  function takeAuthCallbackError() {
    const parameters = new URLSearchParams(String(location.hash || "").replace(/^#/, ""));
    const code = parameters.get("error_code");
    if (!code) return "";
    const message = "Ancien lien de connexion ignoré. Utilise désormais ton e-mail et ton mot de passe dans l’application.";
    history.replaceState(null, document.title, `${location.pathname}${location.search}`);
    return message;
  }
  function showEmpty(target, title, text, icon = "▱") {
    target.innerHTML = `<div class="empty-state"><div class="empty-icon">${icon}</div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(text)}</p></div>`;
  }

  function activeMessagesFor(chantierId) {
    const list = isCloudReady() ? app.messages : app.local.messages;
    return list.filter(message => String(message.chantier_id) === String(chantierId));
  }
  function activeActionsFor(chantierId) {
    const list = isCloudReady() ? app.actions : app.local.actions;
    return list.filter(item => String(item.chantier_id) === String(chantierId));
  }
  function currentMessages() { return activeMessagesFor(app.currentId).sort((a, b) => new Date(a.created_at) - new Date(b.created_at)); }

  function syncFromLocal() {
    app.mode = "local";
    app.local = loadLocalData();
    app.profile = { ...app.local.profile };
    app.chantiers = app.local.chantiers;
    app.currentId = app.local.currentId || app.chantiers[0]?.id || null;
    app.messages = app.local.messages;
    app.actions = app.local.actions;
    app.members = app.local.members;
    saveLocalData();
  }

  async function ensureCloudProfile(user) {
    const profile = { id: user.id, email: user.email || "", full_name: app.profile.full_name || user.user_metadata?.full_name || user.email?.split("@")[0] || "", company: app.profile.company || user.user_metadata?.company || "", updated_at: nowIso() };
    const { error } = await app.db.from("profiles").upsert(profile);
    if (error) throw error;
    const { data, error: readError } = await app.db.from("profiles").select("*").eq("id", user.id).single();
    if (readError) throw readError;
    app.profile = data || profile;
  }

  async function hydrateCloudAttachments(messages) {
    const ids = messages.map(message => message.id);
    if (!ids.length) return messages.map(message => ({ ...message, attachments: [] }));
    const { data, error } = await app.db.from("chantier_attachments").select("*").in("message_id", ids).order("created_at");
    if (error) throw error;
    const rows = await Promise.all((data || []).map(async attachment => {
      const { data: signed, error: signedError } = await app.db.storage.from(CONFIG.STORAGE_BUCKET || "chantier-files").createSignedUrl(attachment.storage_path, 3600);
      return { ...attachment, signed_url: signedError ? "" : signed?.signedUrl || "" };
    }));
    const byMessage = new Map();
    rows.forEach(attachment => { const list = byMessage.get(attachment.message_id) || []; list.push(attachment); byMessage.set(attachment.message_id, list); });
    return messages.map(message => ({ ...message, attachments: byMessage.get(message.id) || [] }));
  }

  async function refreshCloudCurrent() {
    if (!isCloudReady() || !app.currentId) { app.messages = []; app.actions = []; renderAll({ keepPosition: true }); return; }
    const [messageResponse, actionResponse] = await Promise.all([
      app.db.from("chantier_messages").select("*").eq("chantier_id", app.currentId).order("created_at").limit(1500),
      app.db.from("action_items").select("*").eq("chantier_id", app.currentId).order("created_at", { ascending: false })
    ]);
    if (messageResponse.error) throw messageResponse.error;
    if (actionResponse.error) throw actionResponse.error;
    app.messages = await hydrateCloudAttachments(messageResponse.data || []);
    app.actions = actionResponse.data || [];
    renderAll({ keepPosition: true });
  }
  function scheduleCloudRefresh() {
    clearTimeout(app.refreshTimer);
    app.refreshTimer = setTimeout(() => refreshCloudCurrent().catch(error => console.warn(error)), 300);
  }
  function subscribeCurrentChantier() {
    if (!isCloudReady()) return;
    if (app.realtimeChannel) app.db.removeChannel(app.realtimeChannel);
    if (!app.currentId) return;
    app.realtimeChannel = app.db.channel(`chantier-${app.currentId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "chantier_messages", filter: `chantier_id=eq.${app.currentId}` }, scheduleCloudRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "chantier_attachments", filter: `chantier_id=eq.${app.currentId}` }, scheduleCloudRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "action_items", filter: `chantier_id=eq.${app.currentId}` }, scheduleCloudRefresh)
      .subscribe();
  }
  async function refreshCloudChantiers() {
    const { data, error } = await app.db.from("chantiers").select("*").order("updated_at", { ascending: false });
    if (error) throw error;
    app.chantiers = data || [];
    if (!app.currentId || !app.chantiers.some(item => String(item.id) === String(app.currentId))) app.currentId = app.chantiers[0]?.id || null;
    await refreshCloudCurrent();
    subscribeCurrentChantier();
  }
  async function refreshAccessContext() {
    if (!isCloudReady()) {
      app.access = { platformRole: "", requestStatus: "", pendingRequests: 0 };
      return;
    }
    const { data, error } = await app.db.rpc("get_my_journal_access_context");
    if (error) {
      // L’application reste lisible pendant la mise à jour ; le schéma v7
      // apportera ensuite les droits et les demandes d’accès.
      console.warn("Contexte des accès indisponible", error.message);
      app.access = { platformRole: "", requestStatus: "", pendingRequests: 0 };
      return;
    }
    app.access = {
      platformRole: String(data?.platform_role || ""),
      requestStatus: String(data?.request_status || ""),
      pendingRequests: Number(data?.pending_requests || 0)
    };
  }
  async function initializeCloud() {
    app.db = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    const { data, error } = await app.db.auth.getSession();
    if (error) throw error;
    if (data.session?.user) {
      app.mode = "cloud"; app.user = data.session.user;
      await ensureCloudProfile(app.user);
      await refreshAccessContext();
      await refreshCloudChantiers();
    } else {
      app.mode = "cloud-guest"; app.user = null; app.chantiers = []; app.messages = []; app.actions = [];
    }
    app.db.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session?.user) setTimeout(async () => {
        try {
          app.mode = "cloud"; app.user = session.user;
          await ensureCloudProfile(session.user);
          await refreshAccessContext();
          await refreshCloudChantiers();
          closeModal();
          toast("Connexion réussie. Les chantiers se synchronisent.", "success");
        } catch (error) { toast(`Connexion impossible : ${error.message}`, "error"); }
      }, 0);
      if (event === "SIGNED_OUT") {
        if (app.realtimeChannel) app.db.removeChannel(app.realtimeChannel);
        app.mode = "cloud-guest"; app.user = null; app.chantiers = []; app.messages = []; app.actions = [];
        app.access = { platformRole: "", requestStatus: "", pendingRequests: 0 };
        renderAll();
      }
    });
  }

  function renderProfile() {
    els.profileName.textContent = app.profile.full_name || (isCloudReady() ? "Profil connecté" : "Votre identité");
    els.profileCompany.textContent = app.profile.company || (isCloudReady() ? app.profile.email || "Compte sécurisé" : "À renseigner");
    els.profileAvatar.textContent = initial(app.profile.full_name || app.profile.email);
  }
  function renderConnection() {
    const dot = els.connectionLine.querySelector(".status-dot");
    dot.className = `status-dot ${isCloudReady() ? "online" : "offline"}`;
    if (isCloudReady()) {
      const waiting = !isJournalAdmin() && !app.chantiers.length && app.access.requestStatus === "en_attente";
      const refused = !isJournalAdmin() && !app.chantiers.length && app.access.requestStatus === "refusee";
      if (waiting) {
        els.connectionText.textContent = "Validation en attente";
        els.connectionBanner.hidden = false;
        els.connectionBanner.innerHTML = `<div><b>Demande envoyée</b><span>Ton compte est créé. Le propriétaire du journal doit maintenant t’attribuer un rôle et un chantier.</span></div><button class="secondary-button" id="bannerAccessBtn">Voir le statut</button>`;
        $("bannerAccessBtn").addEventListener("click", openAccessStatusDialog);
      } else if (refused) {
        els.connectionText.textContent = "Accès non attribué";
        els.connectionBanner.hidden = false;
        els.connectionBanner.innerHTML = `<div><b>Demande non validée</b><span>Contacte le propriétaire du journal si cet accès doit être réexaminé.</span></div><button class="secondary-button" id="bannerAccessBtn">Voir le statut</button>`;
        $("bannerAccessBtn").addEventListener("click", openAccessStatusDialog);
      } else {
        els.connectionText.textContent = isJournalAdmin() ? roleLabel(app.access.platformRole) : "Synchronisé en direct";
        els.connectionBanner.hidden = true;
      }
    } else if (app.mode === "cloud-guest") {
      els.connectionText.textContent = "Connexion requise";
      els.connectionBanner.hidden = false;
      els.connectionBanner.innerHTML = `<div><b>Connexion requise</b><span>Connecte-toi avec ton e-mail et ton mot de passe pour accéder aux chantiers partagés.</span></div><button class="secondary-button" id="bannerAuthBtn">Se connecter</button>`;
      $("bannerAuthBtn").addEventListener("click", openProfileDialog);
    } else {
      els.connectionText.textContent = "Mode local";
      els.connectionBanner.hidden = false;
      els.connectionBanner.innerHTML = `<div><b>Mode local sur cet appareil</b><span>Configure la connexion collaborative pour discuter et partager des fichiers à plusieurs.</span></div><button class="secondary-button" id="bannerSetupBtn">Configurer</button>`;
      $("bannerSetupBtn").addEventListener("click", openSetupDialog);
    }
  }
  function renderSidebar() {
    const query = els.chantierSearch.value.trim().toLowerCase();
    const html = app.chantiers.filter(item => !query || `${item.name} ${item.code} ${item.location || ""}`.toLowerCase().includes(query)).map(chantier => {
      const activity = activeMessagesFor(chantier.id).sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
      const active = String(chantier.id) === String(app.currentId);
      return `<button class="chantier-card ${active ? "active" : ""}" data-chantier-id="${chantier.id}"><span class="chantier-code">${escapeHtml(initial(chantier.code || chantier.name))}</span><span><strong>${escapeHtml(chantier.name || "Chantier sans nom")}</strong><small>${escapeHtml(activity ? truncate(activity.body || `${activity.message_type || "Information"} partagée`, 37) : chantier.location || "Aucune activité")}</small></span>${activity && !active ? `<span class="unread-badge">•</span>` : ""}</button>`;
    }).join("");
    const empty = isCloudReady() && !isJournalAdmin()
      ? app.access.requestStatus === "en_attente"
        ? `<div class="empty-state"><div class="empty-icon">⌛</div><h3>Accès en attente</h3><p>Ta demande a été transmise au propriétaire. Aucun chantier n’est visible avant validation.</p></div>`
        : app.access.requestStatus === "refusee"
          ? `<div class="empty-state"><div class="empty-icon">!</div><h3>Accès non attribué</h3><p>Le propriétaire peut réexaminer ta demande depuis la gestion des accès.</p></div>`
          : `<div class="empty-state"><div class="empty-icon">⌛</div><h3>Aucun chantier attribué</h3><p>Attends qu’un administrateur t’accorde l’accès à un chantier.</p></div>`
      : `<div class="empty-state"><div class="empty-icon">＋</div><h3>Aucun chantier</h3><p>Crée ton premier espace de discussion.</p></div>`;
    els.chantierList.innerHTML = html || empty;
    els.chantierCount.textContent = app.chantiers.length;
  }
  function renderHeader() {
    const chantier = currentChantier();
    if (!chantier) {
      els.siteName.textContent = "Aucun chantier sélectionné";
      els.siteMeta.textContent = isCloudReady()
        ? isJournalAdmin() ? "Crée un chantier pour commencer" : requestStatusLabel(app.access.requestStatus) || "Aucun chantier attribué"
        : "Configure ou crée un journal local";
      els.siteAvatar.textContent = "JC";
    } else {
      els.siteName.textContent = chantier.name || "Chantier sans nom";
      els.siteMeta.textContent = [chantier.code, chantier.location].filter(Boolean).join(" · ") || "Journal partagé";
      els.siteAvatar.textContent = initial(chantier.code || chantier.name);
    }
  }

  function attachmentUrl(attachment) { return attachment.signed_url || attachment.data_url || attachment.url || ""; }
  function messageById(id) { return currentMessages().find(message => String(message.id) === String(id)); }
  function filteredMessages() {
    const query = app.search.trim().toLowerCase();
    const scope = app.printScope || {};
    return currentMessages().filter(message => {
      if (app.typeFilter && message.message_type !== app.typeFilter) return false;
      if (app.onlyImportant && !message.is_important) return false;
      if (scope.from && new Date(message.created_at) < new Date(`${scope.from}T00:00:00`)) return false;
      if (scope.to && new Date(message.created_at) > new Date(`${scope.to}T23:59:59.999`)) return false;
      if (!query) return true;
      return [message.body, message.author_name, message.zone, message.message_type, ...(message.attachments || []).flatMap(file => [file.file_name, file.name, file.revision, file.plan_status])].join(" ").toLowerCase().includes(query);
    });
  }
  function renderAttachment(attachment) {
    const url = attachmentUrl(attachment), name = attachment.file_name || attachment.name || "Pièce jointe";
    if (fileIsImage(attachment) && url) return `<button class="image-attachment" data-action="open-image" data-attachment-id="${attachment.id}"><img loading="lazy" src="${escapeHtml(url)}" alt="${escapeHtml(name)}"></button>`;
    const detail = [attachment.revision && `Indice ${attachment.revision}`, attachment.plan_status, formatBytes(attachment.bytes || attachment.size)].filter(Boolean).join(" · ") || "Ouvrir / télécharger";
    return `<button class="file-attachment" data-action="open-attachment" data-attachment-id="${attachment.id}"><span class="file-icon">${escapeHtml(fileIcon(attachment))}</span><span class="file-info"><b>${escapeHtml(name)}</b><small>${escapeHtml(detail)}</small></span></button>`;
  }
  function renderMessage(message) {
    const mine = String(message.author_id) === String(ownId()), deleted = Boolean(message.deleted_at);
    const parent = message.reply_to ? messageById(message.reply_to) : null;
    const attachments = deleted ? [] : (message.attachments || []);
    const images = attachments.filter(fileIsImage), documents = attachments.filter(item => !fileIsImage(item));
    if (message.message_type === "Système") return `<article class="message-row system"><div class="message-bubble">${escapeHtml(message.body || "")}</div></article>`;
    return `<article class="message-row ${mine ? "mine" : ""}" data-message-row="${message.id}"><span class="message-avatar">${escapeHtml(initial(message.author_name))}</span><div class="message-bubble ${deleted ? "deleted" : ""}"><button class="message-menu" data-action="message-menu" data-message-id="${message.id}" aria-label="Options">⋮</button><div class="message-head"><span class="author-name">${escapeHtml(message.author_name || "Intervenant")}</span>${message.message_type ? `<span class="message-tag ${typeClass(message.message_type)}">${escapeHtml(message.message_type)}</span>` : ""}${message.zone ? `<span class="zone-tag">${escapeHtml(message.zone)}</span>` : ""}${message.is_important ? `<span class="important-star">★</span>` : ""}</div>${parent ? `<button class="reply-quote" data-action="jump-message" data-message-id="${parent.id}"><b>${escapeHtml(parent.author_name || "Intervenant")}</b>${escapeHtml(truncate(parent.body || "Pièce jointe", 90))}</button>` : ""}${deleted ? `<div class="message-text">Message supprimé.</div>` : ""}${!deleted && images.length ? `<div class="attachment-grid ${images.length === 1 ? "one" : ""}">${images.map(renderAttachment).join("")}</div>` : ""}${!deleted ? documents.map(renderAttachment).join("") : ""}${!deleted && message.body ? `<div class="message-text">${escapeHtml(message.body)}</div>` : ""}<div class="message-footer"><span>${formatTime(message.created_at)}</span>${mine ? `<span class="message-status">✓</span>` : ""}</div>${!deleted ? `<div class="message-actions"><button data-action="reply" data-message-id="${message.id}">↩ Répondre</button><button data-action="make-action" data-message-id="${message.id}">✓ Action</button>${mine ? `<button data-action="toggle-important" data-message-id="${message.id}">${message.is_important ? "★ Retirer" : "☆ Important"}</button>` : ""}</div>` : ""}</div></article>`;
  }
  function scrollMessagesToBottom() { els.messageFeed.scrollTop = els.messageFeed.scrollHeight; els.jumpBottomBtn.hidden = true; }
  function renderMessages({ keepPosition = false } = {}) {
    const chantier = currentChantier();
    if (!chantier) {
      showEmpty(els.messageFeed, "Crée ton premier chantier", "Un chantier regroupe son chat, ses plans et ses actions.", "＋");
      els.composerShell.hidden = true;
      els.messageCount.textContent = "0";
      return;
    }
    els.composerShell.hidden = false;
    const oldPosition = els.messageFeed.scrollTop, list = filteredMessages();
    els.messageCount.textContent = currentMessages().filter(message => !message.deleted_at).length;
    if (!list.length) {
      showEmpty(els.messageFeed, "Aucun message trouvé", app.search || app.typeFilter ? "Modifie les filtres pour retrouver la discussion." : "Écris le premier message du chantier.", "▰");
      return;
    }
    let previousDay = "", html = "";
    list.forEach(message => {
      const day = formatDay(message.created_at);
      if (day !== previousDay) { html += `<div class="day-divider">${escapeHtml(day)}</div>`; previousDay = day; }
      html += renderMessage(message);
    });
    els.messageFeed.innerHTML = html;
    if (keepPosition) els.messageFeed.scrollTop = oldPosition;
    else requestAnimationFrame(scrollMessagesToBottom);
  }
  function allCurrentAttachments() { return currentMessages().flatMap(message => (message.attachments || []).map(file => ({ ...file, message }))); }
  function renderPlans() {
    const chantier = currentChantier();
    if (!chantier) {
      showEmpty(els.planGrid, "Aucun chantier sélectionné", "Crée un chantier avant de classer des plans.", "▱");
      els.planCount.textContent = "0";
      return;
    }
    const all = allCurrentAttachments(), plans = all.filter(file => file.category === "plan" || file.category === "document").filter(file => !app.planFilter || file.plan_status === app.planFilter || file.plan_category === app.planFilter).sort((a, b) => new Date(b.created_at || b.message.created_at) - new Date(a.created_at || a.message.created_at));
    els.planCount.textContent = all.filter(file => file.category === "plan" || file.category === "document").length;
    if (!plans.length) { showEmpty(els.planGrid, "Aucun plan ou document", "Ajoute le premier plan diffusé pour le retrouver facilement ici.", "▱"); return; }
    els.planGrid.innerHTML = plans.map(file => {
      const name = file.file_name || file.name || "Document", url = attachmentUrl(file);
      return `<article class="plan-card"><div class="plan-thumb">${fileIsImage(file) && url ? `<img src="${escapeHtml(url)}" alt="">` : escapeHtml(fileIcon(file))}<span class="plan-status">${escapeHtml(file.plan_status || file.plan_category || "Document")}</span></div><div class="plan-body"><h3 title="${escapeHtml(name)}">${escapeHtml(name)}</h3><p>${escapeHtml([file.revision && `Indice ${file.revision}`, file.zone || file.message.zone, file.message.author_name].filter(Boolean).join(" · ") || "Ajouté au journal")}</p><p>${escapeHtml(formatDateTime(file.created_at || file.message.created_at))}</p></div><div class="plan-card-foot"><span>${escapeHtml(formatBytes(file.bytes || file.size))}</span><button class="text-link" data-action="open-attachment" data-attachment-id="${file.id}">Ouvrir</button></div></article>`;
    }).join("");
  }
  function actionIsLate(action) { return action.due_date && action.status !== "terminee" && new Date(`${action.due_date}T23:59:59`) < new Date(); }
  function actionStatusLabel(status) { return ({ a_faire: "À faire", en_cours: "En cours", terminee: "Terminée" })[status] || "À faire"; }
  function renderActions() {
    const chantier = currentChantier();
    if (!chantier) { showEmpty(els.actionBoard, "Aucune action à suivre", "Crée un chantier et ajoute les premières actions.", "✓"); els.actionSummary.innerHTML = ""; els.actionCount.textContent = "0"; return; }
    const actions = activeActionsFor(chantier.id), outstanding = actions.filter(action => action.status !== "terminee"), late = outstanding.filter(actionIsLate);
    els.actionCount.textContent = outstanding.length;
    els.actionSummary.innerHTML = [["À traiter", outstanding.length], ["En retard", late.length], ["Terminées", actions.filter(action => action.status === "terminee").length]].map(([label, count]) => `<div class="summary-card"><b>${count}</b><span>${label}</span></div>`).join("");
    const columns = [["a_faire", "À faire"], ["en_cours", "En cours"], ["terminee", "Terminées"]];
    els.actionBoard.innerHTML = columns.map(([status, title]) => {
      const items = actions.filter(action => action.status === status).sort((a, b) => String(a.due_date || "9999").localeCompare(String(b.due_date || "9999")));
      return `<section class="action-column"><h3>${title}<span>${items.length}</span></h3>${items.map(action => `<article class="action-card"><button class="action-menu" data-action="action-menu" data-action-id="${action.id}" aria-label="Gérer">⋮</button><h4>${escapeHtml(action.title)}</h4>${action.description ? `<p>${escapeHtml(action.description)}</p>` : ""}<div class="action-card-foot"><span>${escapeHtml(action.assignee || "Non attribuée")}</span><span class="${actionIsLate(action) ? "due-late" : ""}">${action.due_date ? `Échéance ${new Intl.DateTimeFormat("fr-FR").format(new Date(`${action.due_date}T12:00:00`))}` : "Sans échéance"}</span></div></article>`).join("") || `<p style="margin:16px 3px;color:#687982;font-size:11px">Aucune action</p>`}</section>`;
    }).join("");
  }
  function renderPrintCover() {
    const chantier = currentChantier();
    if (!chantier) return;
    const scope = app.printScope || {};
    const period = scope.from || scope.to ? `Période : ${scope.from ? new Intl.DateTimeFormat("fr-FR").format(new Date(`${scope.from}T12:00:00`)) : "Début"} – ${scope.to ? new Intl.DateTimeFormat("fr-FR").format(new Date(`${scope.to}T12:00:00`)) : "Aujourd’hui"}` : "Période : intégralité du journal";
    els.printCover.innerHTML = `<h1>Journal de chantier – ${escapeHtml(chantier.name)}</h1><p>${escapeHtml([chantier.code && `Code : ${chantier.code}`, chantier.location && `Localisation : ${chantier.location}`, period, `Édité le ${formatDateTime(nowIso())}`].filter(Boolean).join(" · "))}</p><p class="print-note">Historique chronologique des discussions, photos et documents du chantier.</p>`;
  }
  function renderAccessControls() {
    const hasGlobalRights = !isCloudReady() || isJournalAdmin();
    els.newChantierBtn.hidden = !hasGlobalRights;
    els.inviteBtn.hidden = !hasGlobalRights;
    if (isCloudReady() && isJournalAdmin()) {
      els.inviteBtn.title = "Gérer les demandes d’accès";
      els.inviteBtn.innerHTML = `♙ <span>Demandes${app.access.pendingRequests ? ` (${app.access.pendingRequests})` : ""}</span>`;
    } else {
      els.inviteBtn.title = "Inviter un interlocuteur";
      els.inviteBtn.innerHTML = "♙ <span>Inviter</span>";
    }
  }
  function renderAll(options) { renderProfile(); renderConnection(); renderAccessControls(); renderSidebar(); renderHeader(); renderMessages(options); renderPlans(); renderActions(); renderPrintCover(); }
  function setActiveTab(tab) {
    app.activeTab = tab;
    $$(".tab").forEach(button => button.classList.toggle("active", button.dataset.tab === tab));
    $$(".view").forEach(view => view.classList.toggle("active", view.dataset.view === tab));
    if (tab === "chat") setTimeout(scrollMessagesToBottom, 30);
  }

  function readAsDataUrl(file) {
    return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error(`Impossible de lire ${file.name}`)); reader.readAsDataURL(file); });
  }
  async function selectChantier(id) {
    if (String(id) === String(app.currentId)) { els.appShell.classList.remove("sidebar-open"); return; }
    app.currentId = id;
    if (isCloudReady()) { await refreshCloudCurrent(); subscribeCurrentChantier(); }
    else { saveLocalData(); renderAll(); }
    els.appShell.classList.remove("sidebar-open");
    setActiveTab("chat");
  }
  async function createChantier(values) {
    const payload = { code: values.code.trim().toUpperCase(), name: values.name.trim(), location: values.location.trim(), description: values.description.trim() };
    if (!payload.name) throw new Error("Le nom du chantier est obligatoire.");
    if (isCloudReady()) {
      const { data, error } = await app.db.from("chantiers").insert(payload).select().single();
      if (error) throw error;
      app.currentId = data.id;
      await refreshCloudChantiers();
      toast("Chantier créé et prêt à être partagé.", "success");
    } else {
      const chantier = { id: makeId(), ...payload, created_at: nowIso(), updated_at: nowIso(), created_by: ownId() };
      app.local.chantiers.unshift(chantier);
      app.local.members.push({ id: makeId(), chantier_id: chantier.id, email: app.profile.email, full_name: ownName(), role: "administrateur" });
      app.chantiers = app.local.chantiers;
      app.currentId = chantier.id;
      saveLocalData();
      renderAll();
      toast("Chantier créé en mode local.", "success");
    }
  }
  async function updateCurrentChantier(values) {
    const chantier = currentChantier();
    const payload = { code: values.code.trim().toUpperCase(), name: values.name.trim(), location: values.location.trim(), description: values.description.trim(), updated_at: nowIso() };
    if (!payload.name) throw new Error("Le nom du chantier est obligatoire.");
    if (isCloudReady()) {
      const { error } = await app.db.from("chantiers").update(payload).eq("id", chantier.id);
      if (error) throw error;
      await refreshCloudChantiers();
    } else { Object.assign(chantier, payload); saveLocalData(); renderAll(); }
    toast("Informations du chantier enregistrées.", "success");
  }

  async function uploadCloudAttachment(file, message, metadata = {}) {
    const cleanName = String(file.name || "fichier").replace(/[^\w.\-]+/g, "_");
    const path = `${message.chantier_id}/${message.id}/${Date.now()}-${makeId()}-${cleanName}`;
    const { error: storageError } = await app.db.storage.from(CONFIG.STORAGE_BUCKET || "chantier-files").upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
    if (storageError) throw storageError;
    const attachment = {
      chantier_id: message.chantier_id, message_id: message.id, storage_path: path, file_name: file.name,
      mime_type: file.type || "application/octet-stream", bytes: file.size || 0, category: metadata.category || "message",
      plan_category: metadata.plan_category || null, plan_status: metadata.plan_status || null, revision: metadata.revision || null, zone: metadata.zone || null
    };
    const { data, error } = await app.db.from("chantier_attachments").insert(attachment).select().single();
    if (error) throw error;
    return data;
  }
  async function addMessage(payload, files = [], attachmentMetadata = {}) {
    const chantier = currentChantier();
    if (!chantier) throw new Error("Crée ou sélectionne un chantier avant d’écrire.");
    if (!isCloudReady() && !app.profile.full_name.trim()) {
      openProfileDialog();
      throw new Error("Renseigne d’abord ton identité pour signer les messages.");
    }
    const base = {
      chantier_id: chantier.id, author_id: ownId(), author_name: ownName(), body: payload.body?.trim() || "",
      message_type: payload.message_type || "Info", zone: payload.zone?.trim() || "", reply_to: payload.reply_to || null,
      is_important: Boolean(payload.is_important), created_at: nowIso()
    };
    if (!base.body && !files.length) throw new Error("Ajoute un message ou au moins un fichier.");
    if (isCloudReady()) {
      const { data: message, error } = await app.db.from("chantier_messages").insert(base).select().single();
      if (error) throw error;
      const attachments = [];
      for (const item of files) {
        try { attachments.push(await uploadCloudAttachment(item.file || item, message, attachmentMetadata)); }
        catch (error) { toast(`Fichier non envoyé : ${item.file?.name || item.name} (${error.message})`, "error"); }
      }
      await refreshCloudCurrent();
      return { ...message, attachments };
    }
    const attachments = [];
    for (const item of files) {
      const file = item.file || item;
      if (file.size > MAX_LOCAL_FILE_BYTES) throw new Error(`${file.name} dépasse 3 Mo. Configure le mode collaboratif pour envoyer ce fichier.`);
      attachments.push({
        id: makeId(), file_name: file.name, mime_type: file.type || "application/octet-stream", bytes: file.size || 0,
        data_url: await readAsDataUrl(file), category: attachmentMetadata.category || "message",
        plan_category: attachmentMetadata.plan_category || null, plan_status: attachmentMetadata.plan_status || null,
        revision: attachmentMetadata.revision || null, zone: attachmentMetadata.zone || null, created_at: nowIso()
      });
    }
    const message = { id: makeId(), ...base, attachments };
    app.local.messages.push(message);
    app.messages = app.local.messages;
    chantier.updated_at = nowIso();
    saveLocalData();
    renderAll();
    return message;
  }
  async function sendComposerMessage() {
    const files = [...app.pendingFiles];
    try {
      await addMessage({
        body: els.messageInput.value, message_type: els.messageType.value, zone: els.messageZone.value,
        reply_to: app.replyTo?.id || null, is_important: els.messageImportant.checked
      }, files);
      clearComposer();
      toast(files.length ? "Message et pièces jointes envoyés." : "Message envoyé.", "success");
    } catch (error) { toast(error.message, "error"); }
  }
  function clearPendingFiles() {
    app.pendingFiles.forEach(item => item.preview_url && URL.revokeObjectURL(item.preview_url));
    app.pendingFiles = [];
    renderPendingFiles();
  }
  function clearComposer() {
    els.messageInput.value = "";
    els.messageInput.style.height = "";
    els.messageZone.value = "";
    els.messageType.value = "Info";
    els.messageImportant.checked = false;
    app.replyTo = null;
    clearPendingFiles();
    renderReplyPreview();
    els.composerMeta.hidden = true;
  }
  function renderPendingFiles() {
    if (!app.pendingFiles.length) { els.attachmentPreview.hidden = true; els.attachmentPreview.innerHTML = ""; return; }
    els.attachmentPreview.hidden = false;
    els.attachmentPreview.innerHTML = app.pendingFiles.map((item, index) => `<div class="pending-file">${fileIsImage(item.file) ? `<img src="${escapeHtml(item.preview_url)}" alt="">` : `<div class="pending-doc">${escapeHtml(fileIcon(item.file))}<br>${escapeHtml(truncate(item.file.name, 14))}</div>`}<button data-action="remove-pending" data-index="${index}" aria-label="Retirer">×</button></div>`).join("");
  }
  function queueFiles(files) {
    const limit = isCloudReady() ? MAX_CLOUD_FILE_BYTES : MAX_LOCAL_FILE_BYTES;
    files.forEach(file => {
      if (file.size > limit) toast(`${file.name} dépasse ${formatBytes(limit)}.`, "error");
      else app.pendingFiles.push({ file, preview_url: fileIsImage(file) ? URL.createObjectURL(file) : "" });
    });
    renderPendingFiles();
  }
  function renderReplyPreview() {
    if (!app.replyTo) { els.replyPreview.hidden = true; els.replyPreview.innerHTML = ""; return; }
    els.replyPreview.hidden = false;
    els.replyPreview.innerHTML = `<span><b>Réponse à ${escapeHtml(app.replyTo.author_name || "Intervenant")}</b> · ${escapeHtml(truncate(app.replyTo.body || "Pièce jointe", 100))}</span><button data-action="cancel-reply" aria-label="Annuler">×</button>`;
  }
  async function toggleImportant(message) {
    try {
      const value = !message.is_important;
      if (isCloudReady()) {
        const { error } = await app.db.from("chantier_messages").update({ is_important: value }).eq("id", message.id);
        if (error) throw error;
        await refreshCloudCurrent();
      } else { message.is_important = value; saveLocalData(); renderAll({ keepPosition: true }); }
    } catch (error) { toast(`Mise à jour impossible : ${error.message}`, "error"); }
  }
  async function editMessage(message) {
    openModal({
      title: "Modifier le message", subtitle: "La modification est visible dans le journal.",
      body: `<form id="editMessageForm" class="form-grid one"><label class="form-field">Message<textarea name="body" required>${escapeHtml(message.body || "")}</textarea></label><label class="form-field">Type<select name="message_type">${["Info", "Sécurité", "Avancement", "Aléa", "Coactivité", "Décision", "Document", "Action"].map(type => `<option ${message.message_type === type ? "selected" : ""}>${type}</option>`).join("")}</select></label><label class="form-field">Zone / PK<input name="zone" value="${escapeHtml(message.zone || "")}"></label></form>`,
      footer: `<button class="secondary-button" id="cancelEditMessage">Annuler</button><button class="primary-button" id="saveEditMessage">Enregistrer</button>`
    });
    $("cancelEditMessage").addEventListener("click", closeModal);
    $("saveEditMessage").addEventListener("click", async () => {
      const form = $("editMessageForm");
      if (!form.reportValidity()) return;
      const values = Object.fromEntries(new FormData(form).entries());
      try {
        if (isCloudReady()) {
          const { error } = await app.db.from("chantier_messages").update({ ...values, edited_at: nowIso() }).eq("id", message.id);
          if (error) throw error;
          await refreshCloudCurrent();
        } else { Object.assign(message, values, { edited_at: nowIso() }); saveLocalData(); renderAll({ keepPosition: true }); }
        closeModal();
        toast("Message modifié.", "success");
      } catch (error) { toast(`Modification impossible : ${error.message}`, "error"); }
    });
  }
  async function softDeleteMessage(message) {
    if (!window.confirm("Supprimer ce message pour tous les membres du chantier ?")) return;
    try {
      if (isCloudReady()) {
        const { error } = await app.db.from("chantier_messages").update({ body: null, deleted_at: nowIso() }).eq("id", message.id);
        if (error) throw error;
        await refreshCloudCurrent();
      } else { message.body = null; message.deleted_at = nowIso(); message.attachments = []; saveLocalData(); renderAll({ keepPosition: true }); }
      toast("Message supprimé.", "success");
    } catch (error) { toast(`Suppression impossible : ${error.message}`, "error"); }
  }
  async function addAction(values, sourceMessage = null) {
    const chantier = currentChantier();
    const action = { chantier_id: chantier.id, message_id: sourceMessage?.id || null, title: values.title.trim(), description: values.description.trim(), assignee: values.assignee.trim(), due_date: values.due_date || null, status: values.status || "a_faire", created_by: ownId(), created_at: nowIso() };
    if (!action.title) throw new Error("Le libellé de l’action est obligatoire.");
    if (isCloudReady()) {
      const { error } = await app.db.from("action_items").insert(action);
      if (error) throw error;
      await refreshCloudCurrent();
    } else { action.id = makeId(); app.local.actions.push(action); app.actions = app.local.actions; saveLocalData(); renderAll(); }
    await addMessage({ body: `Action créée : ${action.title}${action.assignee ? ` — attribuée à ${action.assignee}` : ""}`, message_type: "Action", zone: sourceMessage?.zone || "", reply_to: sourceMessage?.id || null });
  }
  async function setActionStatus(action, status) {
    try {
      if (isCloudReady()) {
        const { error } = await app.db.from("action_items").update({ status, updated_at: nowIso() }).eq("id", action.id);
        if (error) throw error;
        await refreshCloudCurrent();
      } else { action.status = status; action.updated_at = nowIso(); saveLocalData(); renderAll(); }
      toast(`Action déplacée dans « ${actionStatusLabel(status)} ».`, "success");
    } catch (error) { toast(`Mise à jour impossible : ${error.message}`, "error"); }
  }

  function openNewChantierDialog() {
    if (app.mode === "cloud-guest") return openProfileDialog();
    if (isCloudReady() && !isJournalAdmin()) return openAccessStatusDialog();
    openModal({
      title: "Nouveau chantier",
      subtitle: isCloudReady() ? "Le créateur devient administrateur du chantier." : "Ce chantier restera d’abord sur cet appareil.",
      body: `<form id="chantierForm" class="form-grid"><label class="form-field"><span>Nom du chantier *</span><input name="name" required placeholder="Ex. TSV Montereau – RCT"></label><label class="form-field"><span>Code chantier</span><input name="code" placeholder="Ex. MONTEREAU-2026"></label><label class="form-field span-2"><span>Localisation / ligne / PK</span><input name="location" placeholder="Ex. ML 750000 · V2M · PK 80,050 à 80,340"></label><label class="form-field span-2"><span>Objet ou contexte</span><textarea name="description" placeholder="Travaux prévus, entreprises, contraintes…"></textarea></label></form>`,
      footer: `<button class="secondary-button" id="cancelChantier">Annuler</button><button class="primary-button" id="saveChantier">Créer le chantier</button>`
    });
    $("cancelChantier").addEventListener("click", closeModal);
    $("saveChantier").addEventListener("click", async () => {
      const form = $("chantierForm");
      if (!form.reportValidity()) return;
      try { await createChantier(Object.fromEntries(new FormData(form).entries())); closeModal(); }
      catch (error) { toast(`Création impossible : ${error.message}`, "error"); }
    });
  }
  function openSiteInfoDialog() {
    const chantier = currentChantier();
    if (!chantier) return openNewChantierDialog();
    openModal({
      title: "Informations du chantier", subtitle: "Ces informations figurent en en-tête et dans le PDF.",
      body: `<form id="siteInfoForm" class="form-grid"><label class="form-field"><span>Nom du chantier *</span><input name="name" required value="${escapeHtml(chantier.name || "")}"></label><label class="form-field"><span>Code chantier</span><input name="code" value="${escapeHtml(chantier.code || "")}"></label><label class="form-field span-2"><span>Localisation / ligne / PK</span><input name="location" value="${escapeHtml(chantier.location || "")}"></label><label class="form-field span-2"><span>Objet ou contexte</span><textarea name="description">${escapeHtml(chantier.description || "")}</textarea></label></form>`,
      footer: `<button class="secondary-button" id="cancelSiteInfo">Fermer</button><button class="primary-button" id="saveSiteInfo">Enregistrer</button>`
    });
    $("cancelSiteInfo").addEventListener("click", closeModal);
    $("saveSiteInfo").addEventListener("click", async () => {
      const form = $("siteInfoForm");
      if (!form.reportValidity()) return;
      try { await updateCurrentChantier(Object.fromEntries(new FormData(form).entries())); closeModal(); }
      catch (error) { toast(`Enregistrement impossible : ${error.message}`, "error"); }
    });
  }
  function openPasswordAuthDialog() {
    openModal({
      title: "Connexion au journal",
      subtitle: "Aucun lien et aucun code ne sont envoyés par e-mail.",
      body: `<form id="authForm" class="form-grid one"><p class="form-note">Pour le premier accès, crée ton compte puis le propriétaire du journal validera ta demande et ton niveau de droit. Les connexions suivantes se font uniquement avec le même e-mail et le même mot de passe.</p><label class="form-field">Adresse e-mail<input name="email" type="email" required autocomplete="email" placeholder="prenom.nom@entreprise.fr"></label><label class="form-field">Mot de passe<input name="password" type="password" required minlength="8" autocomplete="current-password" placeholder="8 caractères minimum"></label><label class="form-field">Nom et prénom <small>(requis lors de la création)</small><input name="full_name" autocomplete="name" placeholder="Ex. Yoann PETIT"></label><label class="form-field">Entreprise / équipe <small>(facultatif)</small><input name="company" autocomplete="organization" placeholder="Ex. UO Travaux – SNCF Réseau"></label><p class="form-note">Aucun lien ni code n’est envoyé par e-mail. Utilise un mot de passe unique et conserve-le.</p></form><div class="setup-result" id="passwordAuthResult" aria-live="polite"></div>`,
      footer: `<button class="secondary-button" id="closeProfileBtn">Annuler</button><button class="secondary-button" id="createPasswordAccountBtn">Créer mon accès</button><button class="primary-button" id="passwordSignInBtn">Se connecter</button>`
    });

    const form = $("authForm");
    const result = $("passwordAuthResult");
    const readCredentials = (requireIdentity = false) => {
      if (!form.reportValidity()) return null;
      const values = new FormData(form);
      const credentials = {
        email: String(values.get("email") || "").trim().toLowerCase(),
        password: String(values.get("password") || ""),
        fullName: String(values.get("full_name") || "").trim(),
        company: String(values.get("company") || "").trim()
      };
      if (requireIdentity && !credentials.fullName) {
        showResult("Indique ton nom et prénom pour que le propriétaire puisse identifier ta demande.");
        return null;
      }
      return credentials;
    };
    const showResult = (message, variant = "error") => {
      result.textContent = message;
      result.className = `setup-result ${variant}`;
    };
    const run = async (button, pendingText, action, requireIdentity = false) => {
      const credentials = readCredentials(requireIdentity);
      if (!credentials) return;
      try {
        button.disabled = true;
        button.textContent = pendingText;
        await action(credentials);
      } catch (error) {
        showResult(friendlyError(error));
      } finally {
        button.disabled = false;
        button.textContent = button.id === "createPasswordAccountBtn" ? "Créer mon accès" : "Se connecter";
      }
    };

    $("closeProfileBtn").addEventListener("click", closeModal);
    $("passwordSignInBtn").addEventListener("click", () => run($("passwordSignInBtn"), "Connexion…", async credentials => {
      const { data, error } = await app.db.auth.signInWithPassword(credentials);
      if (error) throw error;
      if (!data.session?.user) throw new Error("Aucune session n’a été créée.");
    }));
    $("createPasswordAccountBtn").addEventListener("click", () => run($("createPasswordAccountBtn"), "Création…", async credentials => {
      const { data, error } = await app.db.auth.signUp({
        email: credentials.email,
        password: credentials.password,
        options: { data: { full_name: credentials.fullName, company: credentials.company } }
      });
      if (error) throw error;
      if (!data.session?.user) {
        showResult("Cette adresse existe déjà ou la confirmation d’e-mail est encore active. Désactive Confirm email dans Supabase ; si cette adresse venait des anciens liens, supprime son compte temporaire dans Authentication → Users avant de le recréer.");
      }
    }, true));
    form.addEventListener("submit", event => { event.preventDefault(); $("passwordSignInBtn").click(); });
  }
  function openProfileDialog() {
    const signedIn = isCloudReady(), guest = app.mode === "cloud-guest";
    if (guest) return openPasswordAuthDialog();
    openModal({
      title: signedIn ? "Mon identité" : "Votre identité",
      subtitle: signedIn ? "Elle signe vos messages dans tous vos chantiers." : "Elle apparaît sur les messages enregistrés sur cet appareil.",
      body: `<form id="profileForm" class="form-grid one"><label class="form-field">Nom et prénom<input name="full_name" required value="${escapeHtml(app.profile.full_name || "")}" placeholder="Ex. Yoann PETIT"></label><label class="form-field">Entreprise / équipe<input name="company" value="${escapeHtml(app.profile.company || "")}" placeholder="Ex. UO Travaux – SNCF Réseau"></label>${signedIn ? `<label class="form-field">E-mail<input disabled value="${escapeHtml(app.profile.email || app.user.email || "")}"></label>` : ""}</form>`,
      footer: signedIn ? `<button class="secondary-button" id="signOutBtn">Se déconnecter</button><button class="primary-button" id="saveProfileBtn">Enregistrer</button>` : `<button class="secondary-button" id="closeProfileBtn">Fermer</button><button class="primary-button" id="saveProfileBtn">Enregistrer</button>`
    });
    $("saveProfileBtn").addEventListener("click", async () => {
      const form = $("profileForm");
      if (!form.reportValidity()) return;
      const values = Object.fromEntries(new FormData(form).entries());
      try {
        if (signedIn) {
          const { error } = await app.db.from("profiles").update({ ...values, updated_at: nowIso() }).eq("id", app.user.id);
          if (error) throw error;
        }
        app.profile = { ...app.profile, ...values };
        if (!signedIn) saveLocalData();
        renderAll({ keepPosition: true });
        closeModal();
        toast("Identité enregistrée.", "success");
      } catch (error) { toast(`Enregistrement impossible : ${error.message}`, "error"); }
    });
    if (signedIn) $("signOutBtn").addEventListener("click", async () => { await app.db.auth.signOut(); closeModal(); });
    else $("closeProfileBtn").addEventListener("click", closeModal);
  }
  function setupConfigFromForm(form) {
    const values = Object.fromEntries(new FormData(form).entries());
    return validateSupabaseConfig({
      ...CONFIG,
      SUPABASE_URL: values.SUPABASE_URL,
      SUPABASE_ANON_KEY: values.SUPABASE_ANON_KEY,
      APP_URL: values.APP_URL,
      STORAGE_BUCKET: values.STORAGE_BUCKET || "chantier-files"
    });
  }
  async function testSupabaseConnection(config) {
    if (!window.supabase) throw new Error("La bibliothèque Supabase n’a pas été chargée. Vérifie la connexion Internet puis réessaie.");
    const client = window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error: sessionError } = await client.auth.getSession();
    if (sessionError) throw sessionError;
    const { error: tableError } = await client.from("chantiers").select("id").limit(1);
    if (tableError && /relation .* does not exist|schema cache/i.test(tableError.message || "")) throw tableError;
    if (tableError && !/row-level security|permission denied/i.test(tableError.message || "")) throw tableError;
    return true;
  }
  function openSetupDialog() {
    const currentAppUrl = appUrl();
    openModal({
      title: "Connexion Supabase",
      subtitle: "Configure une fois, teste, puis publie le même config.js pour tous les intervenants.",
      body: `<div class="form-note"><b>Ne colle jamais une clé service_role.</b><br>Utilise uniquement l’URL du projet et la clé <b>Publishable</b> (ou <b>anon</b>) dans Supabase.</div><form id="setupForm" class="form-grid one"><label class="form-field"><span>URL du projet Supabase *</span><input name="SUPABASE_URL" required inputmode="url" autocomplete="off" placeholder="https://xxxx.supabase.co" value="${escapeHtml(CONFIG.SUPABASE_URL || "")}"></label><label class="form-field"><span>Clé Publishable / anon *</span><textarea name="SUPABASE_ANON_KEY" required autocomplete="off" spellcheck="false" placeholder="sb_publishable_… ou eyJ…">${escapeHtml(CONFIG.SUPABASE_ANON_KEY || "")}</textarea></label><label class="form-field"><span>Adresse GitHub Pages *</span><input name="APP_URL" required inputmode="url" autocomplete="url" placeholder="https://ton-compte.github.io/ton-depot/" value="${escapeHtml(CONFIG.APP_URL || currentAppUrl || "")}"><small>À ajouter aussi dans Supabase : Authentication → URL Configuration → Site URL et Redirect URLs.</small></label><label class="form-field"><span>Bucket des fichiers</span><input name="STORAGE_BUCKET" required value="${escapeHtml(CONFIG.STORAGE_BUCKET || "chantier-files")}"></label></form><div class="setup-result" id="setupResult" aria-live="polite"></div><div class="dialog-list"><div class="dialog-item"><span class="mini-avatar">1</span><span><b>Schéma sécurisé</b><small>Exécute une fois supabase-schema.sql dans l’éditeur SQL du projet.</small></span></div><div class="dialog-item"><span class="mini-avatar">2</span><span><b>Test puis publication</b><small>Teste ici, télécharge config.js, puis remplace ce fichier à la racine du dépôt GitHub.</small></span></div></div>`,
      footer: `<button class="secondary-button" id="testSupabaseBtn">Tester</button><button class="secondary-button" id="downloadConfigBtn">Télécharger config.js</button><button class="primary-button" id="saveRuntimeConfigBtn">Utiliser sur cet appareil</button>`
    });
    const result = $("setupResult");
    $("testSupabaseBtn").addEventListener("click", async () => {
      const button = $("testSupabaseBtn");
      try {
        const config = setupConfigFromForm($("setupForm"));
        button.disabled = true;
        button.textContent = "Test…";
        await testSupabaseConnection(config);
        result.textContent = "Connexion au projet Supabase validée. Connecte-toi ensuite avec ton e-mail et ton mot de passe pour vérifier le schéma et créer le premier chantier.";
        result.className = "setup-result success";
      } catch (error) {
        result.textContent = `Test impossible : ${friendlyError(error)}`;
        result.className = "setup-result error";
      } finally {
        button.disabled = false;
        button.textContent = "Tester";
      }
    });
    $("downloadConfigBtn").addEventListener("click", () => {
      try {
        const config = setupConfigFromForm($("setupForm"));
        downloadConfigFile(config);
        result.textContent = "config.js téléchargé. Remplace le fichier config.js du dépôt GitHub avec celui-ci : tous les téléphones seront alors reliés au même projet.";
        result.className = "setup-result success";
      } catch (error) {
        result.textContent = `Configuration invalide : ${friendlyError(error)}`;
        result.className = "setup-result error";
      }
    });
    $("saveRuntimeConfigBtn").addEventListener("click", () => {
      try {
        const config = setupConfigFromForm($("setupForm"));
        localStorage.setItem(RUNTIME_CONFIG_KEY, JSON.stringify(config));
        CONFIG = config;
        location.reload();
      } catch (error) {
        result.textContent = `Configuration invalide : ${friendlyError(error)}`;
        result.className = "setup-result error";
      }
    });
  }
  function openAccessStatusDialog() {
    const status = app.access.requestStatus || "en_attente";
    const isPending = status === "en_attente";
    const isRefused = status === "refusee";
    openModal({
      title: isPending ? "Demande d’accès envoyée" : isRefused ? "Demande non validée" : "Accès au journal",
      subtitle: isPending
        ? "Le propriétaire du journal doit choisir ton chantier et ton niveau de droit."
        : isRefused
          ? "Contacte le propriétaire si cette demande doit être réexaminée."
          : "Aucun chantier ne t’est encore attribué.",
      body: `<div class="form-note"><b>${escapeHtml(requestStatusLabel(status) || "Compte créé")}</b><br>${isPending ? "Tu n’as accès à aucun journal, document ou plan tant que la demande n’est pas validée." : "Les droits sont gérés par le propriétaire principal de l’application."}</div>`,
      footer: `<button class="primary-button" id="closeAccessStatus">Fermer</button>`
    });
    $("closeAccessStatus").addEventListener("click", closeModal);
  }

  async function openAccessManagementDialog() {
    if (!isJournalAdmin()) return openAccessStatusDialog();
    const { data, error } = await app.db.from("journal_access_requests").select("*").eq("status", "en_attente").order("requested_at", { ascending: true });
    if (error) throw error;
    const requests = data || [];
    const chantierOptions = `<option value="">Choisir un chantier…</option>${app.chantiers.map(chantier => `<option value="${escapeHtml(chantier.id)}">${escapeHtml(chantier.name)}${chantier.code ? ` — ${escapeHtml(chantier.code)}` : ""}</option>`).join("")}`;
    const globalOption = isJournalOwner() ? `<option value="administrateur_general">Administrateur général — tous les chantiers</option>` : "";
    const requestCards = requests.length
      ? requests.map(request => `<section class="dialog-item access-request" data-request-id="${escapeHtml(request.id)}" style="display:block"><div style="display:flex;gap:10px;align-items:center"><span class="mini-avatar">${escapeHtml(initial(request.full_name || request.email))}</span><span><b>${escapeHtml(request.full_name || "Nom non renseigné")}</b><small>${escapeHtml(request.email)}${request.company ? ` · ${escapeHtml(request.company)}` : ""}</small></span></div><div class="form-grid" style="margin-top:12px"><label class="form-field">Niveau de droit<select data-access-role><option value="membre">Contributeur — lire, écrire, ajouter des documents</option><option value="lecture">Lecture seule — consulter et exporter</option><option value="administrateur">Administrateur du chantier</option>${globalOption}</select></label><label class="form-field">Chantier<select data-access-chantier>${chantierOptions}</select></label></div><div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px"><button class="secondary-button" data-refuse-access>Refuser</button><button class="primary-button" data-approve-access>Valider l’accès</button></div></section>`).join("")
      : `<div class="empty-state"><div class="empty-icon">✓</div><h3>Aucune demande en attente</h3><p>Les nouveaux comptes apparaîtront ici avant d’accéder aux chantiers.</p></div>`;

    openModal({
      title: "Demandes d’accès",
      subtitle: isJournalOwner() ? "Tu es propriétaire principal : tu peux aussi nommer un administrateur général." : "Attribue un chantier et un niveau de droit à chaque nouveau compte.",
      body: `<div class="form-note"><b>Règle de sécurité :</b> un compte validé ne voit que les chantiers qui lui sont attribués. « Lecture seule » ne peut ni écrire ni modifier de document.</div><div class="dialog-list" style="margin-top:14px">${requestCards}</div>`,
      footer: `<button class="primary-button" id="closeAccessManagement">Fermer</button>`,
      wide: true
    });
    $("closeAccessManagement").addEventListener("click", closeModal);

    const refreshAfterReview = async () => {
      await refreshAccessContext();
      await refreshCloudChantiers();
      closeModal();
      await openAccessManagementDialog();
    };
    $$('[data-approve-access]').forEach(button => button.addEventListener("click", async () => {
      const card = button.closest("[data-request-id]");
      const role = card.querySelector("[data-access-role]").value;
      const chantierId = card.querySelector("[data-access-chantier]").value || null;
      if (role !== "administrateur_general" && !chantierId) {
        toast("Choisis le chantier auquel cet interlocuteur doit accéder.", "warning");
        return;
      }
      try {
        button.disabled = true;
        button.textContent = "Validation…";
        const { error: rpcError } = await app.db.rpc("approve_journal_access_request", {
          p_request_id: card.dataset.requestId,
          p_role: role,
          p_chantier_id: chantierId,
          p_note: ""
        });
        if (rpcError) throw rpcError;
        toast("Accès validé.", "success");
        await refreshAfterReview();
      } catch (error) {
        button.disabled = false;
        button.textContent = "Valider l’accès";
        toast(`Validation impossible : ${friendlyError(error)}`, "error");
      }
    }));
    $$('[data-refuse-access]').forEach(button => button.addEventListener("click", async () => {
      const card = button.closest("[data-request-id]");
      if (!window.confirm("Refuser cette demande d’accès ?")) return;
      try {
        button.disabled = true;
        const { error: rpcError } = await app.db.rpc("refuse_journal_access_request", { p_request_id: card.dataset.requestId, p_note: "" });
        if (rpcError) throw rpcError;
        toast("Demande refusée.", "success");
        await refreshAfterReview();
      } catch (error) {
        button.disabled = false;
        toast(`Refus impossible : ${friendlyError(error)}`, "error");
      }
    }));
  }

  function openInviteDialog() {
    if (app.mode === "cloud-guest") return openProfileDialog();
    if (isCloudReady()) return openAccessManagementDialog().catch(error => toast(`Gestion des accès indisponible : ${friendlyError(error)}`, "error"));

    const chantier = currentChantier();
    if (!chantier) return openNewChantierDialog();
    const localInvites = app.local.members.filter(member => String(member.chantier_id) === String(chantier.id));
    openModal({
      title: "Inviter un interlocuteur",
      subtitle: "En mode local, l’invitation sert de liste de diffusion.",
      body: `<form id="inviteForm" class="form-grid"><label class="form-field span-2">E-mail de l’interlocuteur<input name="email" type="email" required placeholder="prenom.nom@entreprise.fr"></label><label class="form-field">Rôle<select name="role"><option value="membre">Contributeur</option><option value="lecture">Lecture seule</option><option value="administrateur">Administrateur</option></select></label><label class="form-field">Nom (facultatif)<input name="full_name" placeholder="Ex. Akim GANA"></label></form>${localInvites.length ? `<h3 style="margin:20px 0 8px;font-size:12px">Liste locale</h3><div class="dialog-list">${localInvites.map(member => `<div class="dialog-item"><span class="mini-avatar">${escapeHtml(initial(member.full_name || member.email))}</span><span><b>${escapeHtml(member.full_name || member.email || "Intervenant")}</b><small>${escapeHtml(roleLabel(member.role) || member.role || "membre")}</small></span></div>`).join("")}</div>` : ""}`,
      footer: `<button class="secondary-button" id="cancelInvite">Annuler</button><button class="primary-button" id="sendInvite">Ajouter</button>`
    });
    $("cancelInvite").addEventListener("click", closeModal);
    $("sendInvite").addEventListener("click", async () => {
      const form = $("inviteForm");
      if (!form.reportValidity()) return;
      const values = Object.fromEntries(new FormData(form).entries());
      app.local.members.push({ id: makeId(), chantier_id: chantier.id, email: values.email.trim().toLowerCase(), full_name: values.full_name.trim(), role: values.role, created_at: nowIso() });
      saveLocalData();
      closeModal();
      toast("Interlocuteur ajouté à la liste locale.", "success");
    });
  }

  function openPlanDialog() {
    if (!currentChantier()) return openNewChantierDialog();
    if (app.mode === "cloud-guest") return openProfileDialog();
    openModal({
      title: "Ajouter un plan ou document",
      subtitle: "Le fichier sera classé dans la bibliothèque et signalé dans le fil.",
      body: `<form id="planForm" class="form-grid"><label class="form-field span-2">Fichier *<input name="file" type="file" required accept="image/*,application/pdf,.pdf,.doc,.docx,.xls,.xlsx,.dwg,.dxf"></label><label class="form-field">Catégorie<select name="plan_category"><option>Plan validé</option><option>À diffuser</option><option>Étude</option><option>Schéma</option><option>Document</option></select></label><label class="form-field">Indice / version<input name="revision" placeholder="Ex. Indice B"></label><label class="form-field">Zone / PK<input name="zone" placeholder="Ex. V2M – PK 80,050"></label><label class="form-field">Statut<select name="plan_status"><option>À diffuser</option><option>Validé</option><option>Pour information</option><option>Obsolète</option></select></label><label class="form-field span-2">Commentaire dans le journal<textarea name="comment" placeholder="Ex. Plan de principe à utiliser pour la préparation de nuit."></textarea></label></form>`,
      footer: `<button class="secondary-button" id="cancelPlan">Annuler</button><button class="primary-button" id="savePlan">Ajouter au journal</button>`
    });
    $("cancelPlan").addEventListener("click", closeModal);
    $("savePlan").addEventListener("click", async () => {
      const form = $("planForm");
      if (!form.reportValidity()) return;
      const values = Object.fromEntries(new FormData(form).entries()), file = form.elements.file.files[0];
      if (!file) return;
      try {
        await addMessage({
          body: values.comment || `Plan / document diffusé : ${file.name}`, message_type: "Plan", zone: values.zone,
          is_important: values.plan_status === "Validé"
        }, [{ file }], {
          category: "plan", plan_category: values.plan_status === "Validé" ? "Plan validé" : values.plan_category,
          plan_status: values.plan_status, revision: values.revision, zone: values.zone
        });
        closeModal();
        setActiveTab("plans");
        toast("Plan ajouté à la bibliothèque et au journal.", "success");
      } catch (error) { toast(`Ajout impossible : ${error.message}`, "error"); }
    });
  }
  function openActionDialog(sourceMessage = null) {
    if (!currentChantier()) return openNewChantierDialog();
    if (app.mode === "cloud-guest") return openProfileDialog();
    openModal({
      title: sourceMessage ? "Créer une action depuis le message" : "Nouvelle action",
      subtitle: "L’action sera visible dans le suivi et tracée dans le journal.",
      body: `<form id="actionForm" class="form-grid"><label class="form-field span-2">Action à réaliser *<input name="title" required value="${escapeHtml(sourceMessage ? truncate(sourceMessage.body || "", 150) : "")}" placeholder="Ex. Faire valider le plan d’exécution"></label><label class="form-field span-2">Détail / contexte<textarea name="description">${escapeHtml(sourceMessage ? `Issue du message de ${sourceMessage.author_name} du ${formatDateTime(sourceMessage.created_at)}.` : "")}</textarea></label><label class="form-field">Attribuée à<input name="assignee" placeholder="Nom / entreprise"></label><label class="form-field">Échéance<input name="due_date" type="date"></label></form>`,
      footer: `<button class="secondary-button" id="cancelAction">Annuler</button><button class="primary-button" id="saveAction">Créer l’action</button>`
    });
    $("cancelAction").addEventListener("click", closeModal);
    $("saveAction").addEventListener("click", async () => {
      const form = $("actionForm");
      if (!form.reportValidity()) return;
      try { await addAction(Object.fromEntries(new FormData(form).entries()), sourceMessage); closeModal(); setActiveTab("actions"); toast("Action créée.", "success"); }
      catch (error) { toast(`Création impossible : ${error.message}`, "error"); }
    });
  }
  function openExportDialog() {
    if (!currentChantier()) return openNewChantierDialog();
    openModal({
      title: "Exporter le journal",
      subtitle: "Le PDF reprend les messages, photos et la liste des documents dans l’ordre chronologique.",
      body: `<form id="exportForm" class="form-grid"><p class="form-note span-2">Par défaut, l’impression contient <b>toute la discussion du chantier</b>. À l’étape suivante, sélectionne « Enregistrer au format PDF » dans l’écran d’impression du téléphone ou du navigateur.</p><label class="form-field">Du<input name="from" type="date"></label><label class="form-field">Au<input name="to" type="date"></label><label class="form-field span-2">Contenu<select name="scope"><option value="all">Tous les messages</option><option value="important">Messages importants uniquement</option></select></label></form>`,
      footer: `<button class="secondary-button" id="cancelExport">Annuler</button><button class="primary-button" id="runExport">Imprimer / PDF</button>`
    });
    $("cancelExport").addEventListener("click", closeModal);
    $("runExport").addEventListener("click", () => {
      const values = Object.fromEntries(new FormData($("exportForm")).entries()), before = { search: app.search, type: app.typeFilter, important: app.onlyImportant };
      app.printScope = values;
      app.search = "";
      app.typeFilter = "";
      app.onlyImportant = values.scope === "important";
      setActiveTab("chat");
      renderMessages();
      renderPrintCover();
      closeModal();
      setTimeout(() => {
        window.print();
        app.search = before.search;
        app.typeFilter = before.type;
        app.onlyImportant = before.important;
        app.printScope = null;
        els.messageSearch.value = before.search;
        els.typeFilter.value = before.type;
        els.importantFilterBtn.setAttribute("aria-pressed", String(before.important));
        renderMessages();
      }, 120);
    });
  }
  function findAttachment(id) { return allCurrentAttachments().find(item => String(item.id) === String(id)) || null; }
  function openAttachment(attachment) {
    const url = attachmentUrl(attachment), name = attachment.file_name || attachment.name || "Pièce jointe";
    if (fileIsImage(attachment) && url) {
      openModal({
        title: name, subtitle: "Photo jointe au journal",
        body: `<img class="lightbox-image" src="${escapeHtml(url)}" alt="${escapeHtml(name)}">`,
        footer: `<button class="secondary-button" id="closeImage">Fermer</button><button class="primary-button" id="downloadAttachment">Ouvrir / télécharger</button>`, wide: true
      });
      $("closeImage").addEventListener("click", closeModal);
      $("downloadAttachment").addEventListener("click", () => window.open(url, "_blank", "noopener"));
      return;
    }
    const detail = [formatBytes(attachment.bytes || attachment.size), attachment.revision && `Indice ${attachment.revision}`, attachment.plan_status].filter(Boolean).join(" · ") || "Document joint";
    openModal({
      title: "Pièce jointe", subtitle: "Le lien est temporaire et réservé aux membres du chantier.",
      body: `<div class="file-preview-dialog"><span class="file-icon">${escapeHtml(fileIcon(attachment))}</span><div><b>${escapeHtml(name)}</b><small>${escapeHtml(detail)}</small></div></div>`,
      footer: `<button class="secondary-button" id="closeAttachment">Fermer</button><button class="primary-button" id="openAttachmentFile">Ouvrir / télécharger</button>`
    });
    $("closeAttachment").addEventListener("click", closeModal);
    $("openAttachmentFile").addEventListener("click", () => url ? window.open(url, "_blank", "noopener") : toast("Ce fichier n’est plus disponible.", "error"));
  }
  function openMessageMenu(message) {
    const mine = String(message.author_id) === String(ownId());
    openModal({
      title: "Options du message",
      body: `<div class="menu-list"><button id="menuReply">↩ Répondre</button><button id="menuAction">✓ Créer une action</button>${mine && !message.deleted_at ? `<button id="menuImportant">${message.is_important ? "★ Retirer des importants" : "☆ Marquer comme important"}</button><button id="menuEdit">✎ Modifier</button><button class="danger" id="menuDelete">⌫ Supprimer pour tous</button>` : ""}</div>`,
      footer: `<button class="secondary-button" id="closeMessageMenu">Fermer</button>`
    });
    $("closeMessageMenu").addEventListener("click", closeModal);
    $("menuReply").addEventListener("click", () => { closeModal(); app.replyTo = message; renderReplyPreview(); els.messageInput.focus(); });
    $("menuAction").addEventListener("click", () => { closeModal(); openActionDialog(message); });
    $("menuImportant")?.addEventListener("click", async () => { closeModal(); await toggleImportant(message); });
    $("menuEdit")?.addEventListener("click", () => { closeModal(); editMessage(message); });
    $("menuDelete")?.addEventListener("click", () => { closeModal(); softDeleteMessage(message); });
  }
  function openActionMenu(action) {
    openModal({
      title: "Gérer l’action", subtitle: action.title,
      body: `<div class="menu-list"><button data-status="a_faire">◷ À faire</button><button data-status="en_cours">◔ En cours</button><button data-status="terminee">✓ Terminée</button></div>`,
      footer: `<button class="secondary-button" id="closeActionMenu">Fermer</button>`
    });
    $("closeActionMenu").addEventListener("click", closeModal);
    $$("[data-status]", els.modalBody).forEach(button => button.addEventListener("click", async () => { closeModal(); await setActionStatus(action, button.dataset.status); }));
  }

  function jumpToMessage(id) {
    const node = document.querySelector(`[data-message-row="${String(id)}"]`);
    if (!node) return;
    node.scrollIntoView({ behavior: "smooth", block: "center" });
    node.querySelector(".message-bubble")?.animate([
      { boxShadow: "0 0 0 0 rgba(130,0,90,0)" },
      { boxShadow: "0 0 0 5px rgba(130,0,90,.34)" },
      { boxShadow: "0 0 0 0 rgba(130,0,90,0)" }
    ], { duration: 1100 });
  }
  function ensureNotificationPermission() {
    if (!("Notification" in window)) { toast("Les notifications ne sont pas disponibles dans ce navigateur.", "warning"); return; }
    Notification.requestPermission().then(permission => toast(permission === "granted" ? "Alertes activées pour cette application." : "Les alertes n’ont pas été autorisées.", permission === "granted" ? "success" : "warning"));
  }
  async function handleDynamicClick(event) {
    const element = event.target.closest("[data-action]");
    if (!element) return;
    const action = element.dataset.action;
    if (action === "remove-pending") {
      const [removed] = app.pendingFiles.splice(Number(element.dataset.index), 1);
      if (removed?.preview_url) URL.revokeObjectURL(removed.preview_url);
      renderPendingFiles();
    } else if (action === "cancel-reply") {
      app.replyTo = null; renderReplyPreview();
    } else if (action === "reply") {
      const message = messageById(element.dataset.messageId);
      if (message) { app.replyTo = message; renderReplyPreview(); els.messageInput.focus(); }
    } else if (action === "make-action") {
      const message = messageById(element.dataset.messageId);
      if (message) openActionDialog(message);
    } else if (action === "toggle-important") {
      const message = messageById(element.dataset.messageId);
      if (message) await toggleImportant(message);
    } else if (action === "message-menu") {
      const message = messageById(element.dataset.messageId);
      if (message) openMessageMenu(message);
    } else if (action === "jump-message") {
      jumpToMessage(element.dataset.messageId);
    } else if (action === "open-image" || action === "open-attachment") {
      const attachment = findAttachment(element.dataset.attachmentId);
      if (attachment) openAttachment(attachment);
    } else if (action === "action-menu") {
      const item = activeActionsFor(app.currentId).find(actionItem => String(actionItem.id) === String(element.dataset.actionId));
      if (item) openActionMenu(item);
    }
  }
  function wireEvents() {
    $("newChantierBtn").addEventListener("click", openNewChantierDialog);
    $("profileBtn").addEventListener("click", openProfileDialog);
    $("siteInfoBtn").addEventListener("click", openSiteInfoDialog);
    $("inviteBtn").addEventListener("click", openInviteDialog);
    $("notificationBtn").addEventListener("click", ensureNotificationPermission);
    $("exportBtn").addEventListener("click", openExportDialog);
    $("siteMenuBtn").addEventListener("click", openSiteInfoDialog);
    $("addPlanBtn").addEventListener("click", openPlanDialog);
    $("addActionBtn").addEventListener("click", () => openActionDialog());
    els.openSetupBtn.addEventListener("click", openSetupDialog);
    $("openSidebarBtn").addEventListener("click", () => els.appShell.classList.add("sidebar-open"));
    $("closeSidebarBtn").addEventListener("click", () => els.appShell.classList.remove("sidebar-open"));
    $$(".tab").forEach(button => button.addEventListener("click", () => setActiveTab(button.dataset.tab)));
    els.chantierSearch.addEventListener("input", renderSidebar);
    els.chantierList.addEventListener("click", event => {
      const item = event.target.closest("[data-chantier-id]");
      if (item) selectChantier(item.dataset.chantierId).catch(error => toast(error.message, "error"));
    });
    els.messageSearch.addEventListener("input", () => { app.search = els.messageSearch.value; renderMessages({ keepPosition: true }); });
    els.typeFilter.addEventListener("change", () => { app.typeFilter = els.typeFilter.value; renderMessages({ keepPosition: true }); });
    els.importantFilterBtn.addEventListener("click", () => {
      app.onlyImportant = !app.onlyImportant;
      els.importantFilterBtn.setAttribute("aria-pressed", String(app.onlyImportant));
      renderMessages({ keepPosition: true });
    });
    els.composerMetaBtn.addEventListener("click", () => { els.composerMeta.hidden = !els.composerMeta.hidden; });
    $("attachBtn").addEventListener("click", () => app.mode === "cloud-guest" ? openProfileDialog() : els.fileInput.click());
    els.fileInput.addEventListener("change", () => { queueFiles([...els.fileInput.files]); els.fileInput.value = ""; });
    $("sendBtn").addEventListener("click", sendComposerMessage);
    els.messageInput.addEventListener("input", () => {
      els.messageInput.style.height = "auto";
      els.messageInput.style.height = `${Math.min(els.messageInput.scrollHeight, 108)}px`;
    });
    els.messageInput.addEventListener("keydown", event => {
      if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendComposerMessage(); }
    });
    [els.messageFeed, els.attachmentPreview, els.replyPreview, els.planGrid, els.actionBoard].forEach(target => target.addEventListener("click", handleDynamicClick));
    els.messageFeed.addEventListener("scroll", () => {
      els.jumpBottomBtn.hidden = els.messageFeed.scrollHeight - els.messageFeed.scrollTop - els.messageFeed.clientHeight < 100;
    });
    els.jumpBottomBtn.addEventListener("click", scrollMessagesToBottom);
    $$(".filter-pill").forEach(button => button.addEventListener("click", () => {
      app.planFilter = button.dataset.planFilter;
      $$(".filter-pill").forEach(pill => pill.classList.toggle("active", pill === button));
      renderPlans();
    }));
    $("modalCloseBtn").addEventListener("click", closeModal);
    els.modalBackdrop.addEventListener("click", event => { if (event.target === els.modalBackdrop) closeModal(); });
    document.addEventListener("keydown", event => { if (event.key === "Escape" && !els.modalBackdrop.hidden) closeModal(); });
    window.addEventListener("online", () => toast("Connexion réseau rétablie.", "success"));
    window.addEventListener("offline", () => toast("Hors ligne : les données locales restent consultables.", "warning"));
  }
  async function initialize() {
    wireEvents();
    const callbackError = takeAuthCallbackError();
    if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("./service-worker-v8.js").catch(error => console.warn("Service worker", error));
    syncFromLocal();
    if (cloudConfigured()) {
      try { await initializeCloud(); }
      catch (error) { console.error(error); syncFromLocal(); toast(`Connexion collaborative indisponible : ${friendlyError(error)}`, "warning"); }
    }
    renderAll();
    if (callbackError) toast(callbackError, "warning");
    if (app.currentId) setTimeout(scrollMessagesToBottom, 50);
  }
  initialize().catch(error => { console.error(error); toast(`Le journal n’a pas pu démarrer : ${error.message}`, "error"); });
})();
