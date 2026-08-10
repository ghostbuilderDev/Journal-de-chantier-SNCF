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
    chantiers: [], currentId: null, messages: [], actions: [], dailyLogs: [], risks: [], members: [], reactions: [], readStates: [], local: null,
    pendingFiles: [], replyTo: null, typeFilter: "", search: "", onlyImportant: false, isDictating: false,
    advancedFilters: { from: "", to: "", zone: "", author: "", attachment: false }, lastOperationalAlertSignature: "",
    imageRecoveryInFlight: new Set(), imagePreviewRepairInFlight: new Set(), imagePreviewRepairTried: new Set(),
    planFilter: "", realtimeChannel: null, activeTab: "chat", printScope: null, refreshTimer: null,
    authDraft: { email: "", password: "", confirmPassword: "", fullName: "", company: "" },
    modalLocked: false, modalHistoryActive: false, closingModal: false, recoveryPending: false, recoveryHandled: false
  };

  const els = {
    appShell: $("appShell"), chantierList: $("chantierList"), chantierSearch: $("chantierSearch"),
    newChantierBtn: $("newChantierBtn"), inviteBtn: $("inviteBtn"), adminDashboardBtn: $("adminDashboardBtn"), mobileAdminDashboardBtn: $("mobileAdminDashboardBtn"), notificationBtn: $("notificationBtn"),
    chantierCount: $("chantierCount"), profileName: $("profileName"), profileCompany: $("profileCompany"),
    profileAvatar: $("profileAvatar"), connectionLine: $("connectionLine"), connectionText: $("connectionText"),
    siteName: $("siteName"), siteMeta: $("siteMeta"), siteAvatar: $("siteAvatar"),
    connectionBanner: $("connectionBanner"), openSetupBtn: $("openSetupBtn"), messageCount: $("messageCount"),
    planCount: $("planCount"), actionCount: $("actionCount"), pilotageCount: $("pilotageCount"), messageFeed: $("messageFeed"),
    messageSearch: $("messageSearch"), typeFilter: $("typeFilter"), importantFilterBtn: $("importantFilterBtn"), advancedSearchBtn: $("advancedSearchBtn"),
    jumpBottomBtn: $("jumpBottomBtn"), composerShell: $("composerShell"), composerMeta: $("composerMeta"),
    composerMetaBtn: $("composerMetaBtn"), composerToolsBtn: $("composerToolsBtn"), composerToolTray: $("composerToolTray"), messageType: $("messageType"), messageZone: $("messageZone"),
    messageImportant: $("messageImportant"), replyPreview: $("replyPreview"), attachmentPreview: $("attachmentPreview"),
    fileInput: $("fileInput"), cameraInput: $("cameraInput"), messageInput: $("messageInput"), planGrid: $("planGrid"), pinnedMessages: $("pinnedMessages"),
    actionSummary: $("actionSummary"), actionBoard: $("actionBoard"), printCover: $("printCover"),
    pilotageSummary: $("pilotageSummary"), pilotageAlerts: $("pilotageAlerts"), dailyLogList: $("dailyLogList"), riskList: $("riskList"),
    modalBackdrop: $("modalBackdrop"), modal: document.querySelector(".modal"), modalTitle: $("modalTitle"),
    modalSubtitle: $("modalSubtitle"), modalBody: $("modalBody"), modalFoot: $("modalFoot"), modalCloseBtn: $("modalCloseBtn"), toastStack: $("toastStack")
  };

  function defaultLocalData() {
    return { profile: { id: `local-${makeId()}`, full_name: "", company: "", email: "" }, chantiers: [], messages: [], actions: [], dailyLogs: [], risks: [], members: [], reactions: [], readStates: [], currentId: null };
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
          dailyLogs: Array.isArray(loaded.dailyLogs) ? loaded.dailyLogs : [],
          risks: Array.isArray(loaded.risks) ? loaded.risks : [],
          members: Array.isArray(loaded.members) ? loaded.members : [],
          reactions: Array.isArray(loaded.reactions) ? loaded.reactions : [],
          readStates: Array.isArray(loaded.readStates) ? loaded.readStates : [] };
      }
    } catch (error) { console.warn("Journal local illisible", error); }
    return defaultLocalData();
  }

  function saveLocalData() {
    if (!app.local || app.mode === "demo") return;
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
    if (/chantier_daily_logs|chantier_risks|daily_logs|chantier.*risks/i.test(message)) return "Le pilotage V13 n’est pas encore installé dans Supabase. Exécute le fichier supabase-v13-pilotage.sql dans l’éditeur SQL.";
    if (/relation .* does not exist|schema cache/i.test(message)) return "Le schéma Supabase n’est pas installé : exécute supabase-schema.sql dans l’éditeur SQL.";
    if (/get_journal_administration_dashboard|set_journal_user_access|revoke_journal_user_access/i.test(message)) return "La mise à jour d’administration n’est pas encore installée dans Supabase. Exécute le fichier supabase-administration-v11.sql.";
    if (/reset_journal_chantier_feed|delete_journal_chantier|list_journal_chantier_storage_paths/i.test(message)) return "La maintenance propriétaire n’est pas encore installée dans Supabase. Exécute le fichier supabase-v12.1-owner-maintenance.sql.";
    if (/preview_storage_path|attachments_author_or_admin_update/i.test(message)) return "L’optimisation des photos n’est pas encore installée dans Supabase. Exécute le fichier supabase-v12.2-photo-previews.sql.";
    if (/row-level security|permission denied|not allowed/i.test(message)) return "Accès refusé : vérifie que le compte est invité au chantier et que le schéma a été exécuté.";
    if (/redirect|redirect_to/i.test(message)) return "L’URL GitHub Pages doit être ajoutée dans les Redirect URLs de Supabase Auth.";
    if (/invalid login credentials/i.test(message)) return "Adresse e-mail ou mot de passe incorrect.";
    if (/expired|invalid.*token|otp.*expired|token.*invalid/i.test(message)) return "Ce lien est expiré ou a déjà été utilisé. Demande un nouveau lien de réinitialisation.";
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
  // Les pièces venant de Supabase portent les champs mime_type et file_name.
  // Sans cela, une photo distante était affichée comme un simple fichier à ouvrir.
  function fileIsImage(file = {}) {
    const mime = String(file.type || file.mime_type || "");
    const name = String(file.file_name || file.name || "");
    return Boolean(mime.startsWith("image/") || /\.(jpe?g|png|gif|webp|bmp|heic|heif)$/i.test(name));
  }
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
  function renderRichText(value) {
    return escapeHtml(value || "").replace(/(^|\s)(@[\p{L}\p{N}_.-]+)/gu, "$1<span class=\"mention\">$2</span>");
  }

  function toast(message, variant = "") {
    const item = document.createElement("div");
    item.className = `toast ${variant}`.trim();
    item.textContent = message;
    els.toastStack.appendChild(item);
    setTimeout(() => { item.style.opacity = "0"; item.style.transform = "translateY(8px)"; setTimeout(() => item.remove(), 200); }, 4200);
  }

  function openModal({ title, subtitle = "", body = "", footer = "", wide = false, locked = false }) {
    if (!app.modalHistoryActive && history?.pushState) {
      history.pushState({ ...(history.state || {}), journalModal: true }, document.title, location.href);
      app.modalHistoryActive = true;
    }
    app.modalLocked = locked;
    els.modalTitle.textContent = title;
    els.modalSubtitle.textContent = subtitle;
    els.modalSubtitle.hidden = !subtitle;
    els.modalBody.innerHTML = body;
    els.modalFoot.innerHTML = footer;
    els.modal.classList.toggle("wide", wide);
    els.modalCloseBtn.hidden = locked;
    els.modalBackdrop.hidden = false;
    els.modalBackdrop.classList.remove("is-hidden");
    setTimeout(() => els.modal.querySelector("input, textarea, select, button")?.focus(), 20);
  }
  function closeModal(force = false) {
    if (app.modalLocked && !force) return;
    app.modalLocked = false;
    els.modalBackdrop.hidden = true;
    els.modalBackdrop.classList.add("is-hidden");
    els.modalBody.innerHTML = "";
    els.modalFoot.innerHTML = "";
    els.modal.classList.remove("wide");
    els.modalCloseBtn.hidden = false;
    // On conserve l’état de la page : le bouton Retour du navigateur ne doit
    // jamais quitter le journal pendant une saisie dans une fenêtre.
    app.modalHistoryActive = false;
    app.closingModal = false;
  }
  function hasRecoveryLink() {
    const fromHash = new URLSearchParams(String(location.hash || "").replace(/^#/, ""));
    const fromQuery = new URLSearchParams(location.search);
    return fromHash.get("type") === "recovery" || fromQuery.get("type") === "recovery";
  }
  function clearRecoveryUrl() {
    const url = new URL(location.href);
    ["type", "code", "token_hash", "error", "error_code", "error_description"].forEach(key => url.searchParams.delete(key));
    url.hash = "";
    history.replaceState(null, document.title, `${url.pathname}${url.search}`);
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
  function activeDailyLogsFor(chantierId) {
    const list = isCloudReady() ? app.dailyLogs : app.local.dailyLogs;
    return list.filter(item => String(item.chantier_id) === String(chantierId));
  }
  function activeRisksFor(chantierId) {
    const list = isCloudReady() ? app.risks : app.local.risks;
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
    app.dailyLogs = app.local.dailyLogs || [];
    app.risks = app.local.risks || [];
    app.members = app.local.members;
    app.reactions = app.local.reactions || [];
    app.readStates = app.local.readStates || [];
    saveLocalData();
  }

  function demoLocalData() {
    const chantierId = "demo-chantier", now = nowIso();
    const demoDocument = {
      id: "demo-document-1", message_id: "demo-message-2", file_name: "Plan-de-principe-demo.txt",
      mime_type: "text/plain", bytes: 4096, category: "plan", plan_category: "Plan validé",
      plan_status: "Validé", revision: "Indice A", zone: "Chantier Test", created_at: now,
      data_url: "data:text/plain;charset=utf-8,Document%20de%20demonstration%20-%20aucune%20donnee%20de%20chantier%20reelle."
    };
    return {
      profile: { id: "demo-user", full_name: "Mode démonstration", company: "Données fictives", email: "" },
      chantiers: [{ id: chantierId, code: "CHANTIER-TEST", name: "Chantier Test", location: "Données de démonstration", description: "Exemple local sans donnée réelle.", created_at: now, updated_at: now }],
      messages: [
        { id: "demo-message-1", chantier_id: chantierId, author_id: "system", author_name: "Système", body: "Mode démo actif — aucune donnée Supabase n’est affichée.", message_type: "Système", zone: "", is_important: false, created_at: now, attachments: [] },
        { id: "demo-message-2", chantier_id: chantierId, author_id: "demo-rlt", author_name: "Responsable travaux", body: "Briefing de démarrage réalisé. Les accès et le balisage sont contrôlés avant intervention.", message_type: "Sécurité", zone: "Chantier Test", is_important: true, created_at: now, attachments: [demoDocument] },
        { id: "demo-message-3", chantier_id: chantierId, author_id: "demo-entreprise", author_name: "Entreprise exemple", body: "Plan de principe déposé dans l’onglet Plans & documents.", message_type: "Document", zone: "Chantier Test", is_important: false, created_at: now, attachments: [] }
      ],
      actions: [
        { id: "demo-action-1", chantier_id: chantierId, title: "Contrôler le balisage", description: "Vérification avant démarrage des travaux.", assignee: "Responsable travaux", due_date: "", status: "a_faire", created_by: "demo-user", created_at: now },
        { id: "demo-action-2", chantier_id: chantierId, title: "Diffuser le plan validé", description: "Exemple de suivi d’action.", assignee: "Entreprise exemple", due_date: "", status: "en_cours", created_by: "demo-user", created_at: now }
      ],
      dailyLogs: [{ id: "demo-daily-log-1", chantier_id: chantierId, log_date: now.slice(0, 10), shift: "Nuit", zone: "Chantier Test", weather: "Sec", workforce: "2 agents", work_summary: "Préparation et contrôle du balisage avant intervention.", constraints: "Aucune contrainte notable.", safety_summary: "Briefing réalisé avant prise de poste.", decisions: "Plan de principe diffusé aux équipes.", next_steps: "Contrôle final avant démarrage.", author_id: "demo-rlt", author_name: "Responsable travaux", created_at: now }],
      risks: [{ id: "demo-risk-1", chantier_id: chantierId, category: "Point de vigilance", severity: "moderee", status: "ouvert", zone: "Chantier Test", description: "Maintenir une vigilance sur la séparation des circulations et de la zone travaux.", immediate_measures: "Balisage vérifié et rappel au briefing.", author_id: "demo-rlt", author_name: "Responsable travaux", created_at: now }],
      members: [], reactions: [], readStates: [], currentId: chantierId
    };
  }

  function startDemoMode() {
    if (app.realtimeChannel && app.db) app.db.removeChannel(app.realtimeChannel);
    const demo = demoLocalData();
    app.mode = "demo";
    app.user = null;
    app.access = { platformRole: "", requestStatus: "", pendingRequests: 0 };
    app.local = demo;
    app.profile = { ...demo.profile };
    app.chantiers = demo.chantiers;
    app.currentId = demo.currentId;
    app.messages = demo.messages;
    app.actions = demo.actions;
    app.dailyLogs = demo.dailyLogs;
    app.risks = demo.risks;
    app.members = demo.members;
    app.reactions = demo.reactions;
    app.readStates = demo.readStates;
    app.activeTab = "chat";
    closeModal();
    renderAll();
    setTimeout(scrollMessagesToBottom, 50);
    toast("Mode démo activé : les données affichées sont fictives.", "success");
  }

  function exitDemoMode() {
    syncFromLocal();
    if (app.db) {
      app.mode = "cloud-guest";
      app.user = null;
      app.chantiers = [];
      app.currentId = null;
      app.messages = [];
      app.actions = [];
      app.dailyLogs = [];
      app.risks = [];
      app.members = [];
    }
    renderAll();
  }

  async function ensureCloudProfile(user) {
    const profile = { id: user.id, email: user.email || "", full_name: app.profile.full_name || user.user_metadata?.full_name || user.email?.split("@")[0] || "", company: app.profile.company || user.user_metadata?.company || "", updated_at: nowIso() };
    const { error } = await app.db.from("profiles").upsert(profile);
    if (error) throw error;
    const { data, error: readError } = await app.db.from("profiles").select("*").eq("id", user.id).single();
    if (readError) throw readError;
    app.profile = data || profile;
  }

  async function signedCloudAttachmentUrl(storagePath) {
    if (!storagePath) return "";
    try {
      const { data, error } = await app.db.storage
        .from(CONFIG.STORAGE_BUCKET || "chantier-files")
        .createSignedUrl(storagePath, 3600);
      return error ? "" : data?.signedUrl || "";
    } catch (error) {
      console.warn("Lien temporaire de pièce jointe indisponible", error);
      return "";
    }
  }

  async function hydrateCloudAttachments(messages) {
    const ids = messages.map(message => message.id);
    if (!ids.length) return messages.map(message => ({ ...message, attachments: [] }));
    const { data, error } = await app.db.from("chantier_attachments").select("*").in("message_id", ids).order("created_at");
    if (error) throw error;
    // Même parcours que la version qui fonctionnait : un seul lien signé vers
    // le fichier original. Les miniatures restent éventuellement stockées, mais
    // elles ne participent plus au chargement du fil sur Android.
    const rows = await Promise.all((data || []).map(async attachment => {
      const originalUrl = await signedCloudAttachmentUrl(attachment.storage_path);
      return { ...attachment, signed_url: originalUrl, full_signed_url: originalUrl };
    }));
    const byMessage = new Map();
    rows.forEach(attachment => { const list = byMessage.get(attachment.message_id) || []; list.push(attachment); byMessage.set(attachment.message_id, list); });
    return messages.map(message => ({ ...message, attachments: byMessage.get(message.id) || [] }));
  }

  async function refreshCloudCurrent() {
    if (!isCloudReady() || !app.currentId) { app.messages = []; app.actions = []; app.dailyLogs = []; app.risks = []; app.reactions = []; app.readStates = []; renderAll({ keepPosition: true }); return; }
    const [messageResponse, actionResponse, dailyLogResponse, riskResponse, reactionResponse, readResponse] = await Promise.all([
      app.db.from("chantier_messages").select("*").eq("chantier_id", app.currentId).order("created_at").limit(1500),
      app.db.from("action_items").select("*").eq("chantier_id", app.currentId).order("created_at", { ascending: false }),
      app.db.from("chantier_daily_logs").select("*").eq("chantier_id", app.currentId).order("log_date", { ascending: false }).order("created_at", { ascending: false }).limit(180),
      app.db.from("chantier_risks").select("*").eq("chantier_id", app.currentId).order("status").order("created_at", { ascending: false }).limit(300),
      app.db.from("chantier_message_reactions").select("*").eq("chantier_id", app.currentId).order("created_at"),
      app.db.from("chantier_read_states").select("*").eq("chantier_id", app.currentId)
    ]);
    if (messageResponse.error) throw messageResponse.error;
    if (actionResponse.error) throw actionResponse.error;
    app.messages = await hydrateCloudAttachments(messageResponse.data || []);
    app.actions = actionResponse.data || [];
    // Les tables V13 sont optionnelles tant que la migration n'est pas installée :
    // le fil, les plans et les actions restent pleinement utilisables.
    app.dailyLogs = dailyLogResponse.error ? [] : (dailyLogResponse.data || []);
    app.risks = riskResponse.error ? [] : (riskResponse.data || []);
    // Les réactions et accusés de lecture restent optionnels tant que la
    // migration V12 n’a pas encore été exécutée.
    app.reactions = reactionResponse.error ? [] : (reactionResponse.data || []);
    app.readStates = readResponse.error ? [] : (readResponse.data || []);
    if (reactionResponse.error || readResponse.error) console.info("Fonctions V12 en attente de la migration Supabase.");
    if (dailyLogResponse.error || riskResponse.error) console.info("Fonctions de pilotage V13 en attente de la migration Supabase.");
    markChantierRead().catch(error => console.warn("Lecture non enregistrée", error));
    renderAll({ keepPosition: true });
  }
  async function markChantierRead() {
    if (!isCloudReady() || !app.currentId) return;
    const { error } = await app.db.from("chantier_read_states").upsert({
      chantier_id: app.currentId, user_id: ownId(), last_read_at: nowIso(), updated_at: nowIso()
    }, { onConflict: "chantier_id,user_id" });
    if (error) throw error;
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
      .on("postgres_changes", { event: "*", schema: "public", table: "chantier_daily_logs", filter: `chantier_id=eq.${app.currentId}` }, scheduleCloudRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "chantier_risks", filter: `chantier_id=eq.${app.currentId}` }, scheduleCloudRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "chantier_message_reactions", filter: `chantier_id=eq.${app.currentId}` }, scheduleCloudRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "chantier_read_states", filter: `chantier_id=eq.${app.currentId}` }, scheduleCloudRefresh)
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
    app.db.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" && session?.user) {
        setTimeout(() => beginPasswordRecovery(session.user), 0);
        return;
      }
      if (event === "SIGNED_IN" && session?.user) setTimeout(async () => {
        if (hasRecoveryLink() && !app.recoveryHandled) return beginPasswordRecovery(session.user);
        try {
          app.mode = "cloud"; app.user = session.user;
          await ensureCloudProfile(session.user);
          await refreshAccessContext();
          await refreshCloudChantiers();
          closeModal();
          toast("Connexion réussie. Les chantiers se synchronisent.", "success");
        } catch (error) { toast(`Connexion impossible : ${friendlyError(error)}`, "error"); }
      }, 0);
      if (event === "SIGNED_OUT") {
        if (app.realtimeChannel) app.db.removeChannel(app.realtimeChannel);
        app.mode = "cloud-guest"; app.user = null; app.chantiers = []; app.messages = []; app.actions = []; app.dailyLogs = []; app.risks = [];
        app.access = { platformRole: "", requestStatus: "", pendingRequests: 0 };
        renderAll();
      }
    });
    const { data, error } = await app.db.auth.getSession();
    if (error) throw error;
    if (data.session?.user) {
      if (hasRecoveryLink() && !app.recoveryHandled) {
        beginPasswordRecovery(data.session.user);
        return;
      }
      app.mode = "cloud"; app.user = data.session.user;
      await ensureCloudProfile(app.user);
      await refreshAccessContext();
      await refreshCloudChantiers();
    } else {
      app.mode = "cloud-guest"; app.user = null; app.chantiers = []; app.messages = []; app.actions = []; app.dailyLogs = []; app.risks = [];
    }
  }

  function renderProfile() {
    els.profileName.textContent = app.profile.full_name || (isCloudReady() ? "Profil connecté" : "Votre identité");
    els.profileCompany.textContent = app.profile.company || (isCloudReady() ? app.profile.email || "Compte sécurisé" : "À renseigner");
    els.profileAvatar.textContent = initial(app.profile.full_name || app.profile.email);
  }
  function renderConnection() {
    const dot = els.connectionLine.querySelector(".status-dot");
    if (app.mode === "recovery") {
      dot.className = "status-dot online";
      els.connectionText.textContent = "Réinitialisation en cours";
      els.connectionBanner.hidden = true;
      return;
    }
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
    } else if (app.mode === "demo") {
      els.connectionText.textContent = "Mode démo";
      els.connectionBanner.hidden = false;
      els.connectionBanner.innerHTML = `<div><b>Mode démonstration</b><span>Tu consultes des données fictives. Aucun chantier, document ou message Supabase n’est affiché.</span></div><button class="secondary-button" id="bannerDemoLoginBtn">Se connecter</button><button class="secondary-button" id="bannerDemoExitBtn">Quitter</button>`;
      $("bannerDemoLoginBtn").addEventListener("click", openPasswordAuthDialog);
      $("bannerDemoExitBtn").addEventListener("click", exitDemoMode);
    } else if (app.mode === "cloud-guest") {
      els.connectionText.textContent = "Connexion requise";
      els.connectionBanner.hidden = false;
      els.connectionBanner.innerHTML = `<div><b>Connexion requise</b><span>Connecte-toi avec ton e-mail et ton mot de passe pour accéder aux chantiers partagés.</span></div><button class="secondary-button" id="bannerAuthBtn">Se connecter</button>`;
      $("bannerAuthBtn").addEventListener("click", openProfileDialog);
    } else {
      els.connectionText.textContent = "Connexion indisponible";
      els.connectionBanner.hidden = false;
      els.connectionBanner.innerHTML = `<div><b>Connexion au journal indisponible</b><span>La configuration est déjà intégrée à l’application. Vérifie le réseau puis recharge la page.</span></div><button class="secondary-button" id="bannerReloadBtn">Recharger</button>`;
      $("bannerReloadBtn").addEventListener("click", () => location.reload());
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
        : "Connexion au journal requise";
      els.siteAvatar.textContent = "JC";
    } else {
      els.siteName.textContent = chantier.name || "Chantier sans nom";
      els.siteMeta.textContent = [chantier.code, chantier.location].filter(Boolean).join(" · ") || "Journal partagé";
      els.siteAvatar.textContent = initial(chantier.code || chantier.name);
    }
  }

  function attachmentUrl(attachment) {
    // Fiabilité avant optimisation : certaines miniatures générées sur mobile
    // peuvent être absentes ou non décodables alors que l'original privé est
    // parfaitement lisible. Le fil utilise donc d'abord l'original signé.
    // Les aperçus restent éventuellement stockés, mais ne sont jamais utilisés
    // dans la discussion : on évite ainsi toute régression Android.
    if (fileIsImage(attachment)) return attachment.full_signed_url || attachment.signed_url || attachment.data_url || attachment.url || "";
    return attachment.signed_url || attachment.data_url || attachment.url || "";
  }
  function fullAttachmentUrl(attachment) { return attachment.full_signed_url || attachment.signed_url || attachment.data_url || attachment.url || ""; }
  function rememberAttachmentUrl(attachmentId, url, usePreview = false) {
    app.messages.forEach(message => (message.attachments || []).forEach(attachment => {
      if (String(attachment.id) !== String(attachmentId)) return;
      if (usePreview && attachment.preview_storage_path) attachment.preview_signed_url = url;
      else if (fileIsImage(attachment) && attachment.preview_storage_path) attachment.full_signed_url = url;
      else attachment.signed_url = url;
    }));
  }
  async function refreshAttachmentUrl(attachment, usePreview = false) {
    const currentUrl = usePreview ? attachmentUrl(attachment) : fullAttachmentUrl(attachment);
    const storagePath = usePreview && attachment?.preview_storage_path ? attachment.preview_storage_path : attachment?.storage_path;
    if (!isCloudReady() || !storagePath) return currentUrl;
    const { data, error } = await app.db.storage
      .from(CONFIG.STORAGE_BUCKET || "chantier-files")
      .createSignedUrl(storagePath, 3600);
    if (error || !data?.signedUrl) throw error || new Error("Impossible de renouveler le lien de la photo.");
    rememberAttachmentUrl(attachment.id, data.signedUrl, usePreview);
    return data.signedUrl;
  }
  function rememberAttachmentPreview(attachmentId, storagePath, signedUrl = "") {
    app.messages.forEach(message => (message.attachments || []).forEach(attachment => {
      if (String(attachment.id) !== String(attachmentId)) return;
      attachment.preview_storage_path = storagePath;
      if (signedUrl) attachment.preview_signed_url = signedUrl;
    }));
  }
  async function repairAttachmentPreview(attachment, { force = false } = {}) {
    const attachmentId = String(attachment?.id || "");
    if (!isJournalOwner() || !attachmentId || !fileIsImage(attachment) || !attachment.storage_path || attachment.preview_storage_path) return false;
    if (app.imagePreviewRepairInFlight.has(attachmentId) || (!force && app.imagePreviewRepairTried.has(attachmentId))) return false;
    app.imagePreviewRepairTried.add(attachmentId);
    app.imagePreviewRepairInFlight.add(attachmentId);
    let previewPath = "";
    const bucket = app.db.storage.from(CONFIG.STORAGE_BUCKET || "chantier-files");
    try {
      const originalUrl = await refreshAttachmentUrl(attachment, false);
      const response = await fetch(originalUrl);
      if (!response.ok) throw new Error(`Téléchargement de la photo impossible (${response.status}).`);
      const blob = await response.blob();
      const original = new File([blob], attachment.file_name || "photo", { type: attachment.mime_type || blob.type || "image/jpeg", lastModified: Date.now() });
      const previewFile = await createPhotoPreviewFile(original);
      if (!previewFile) throw new Error("Aperçu photo non générable sur cet appareil.");
      previewPath = `${attachment.storage_path}.preview-${Date.now()}-${makeId()}.jpg`;
      const { error: storageError } = await bucket.upload(previewPath, previewFile, { contentType: "image/jpeg", upsert: false });
      if (storageError) throw storageError;
      const { error: updateError } = await app.db
        .from("chantier_attachments")
        .update({ preview_storage_path: previewPath })
        .eq("id", attachment.id);
      if (updateError) throw updateError;
      const previewUrl = await signedCloudAttachmentUrl(previewPath);
      rememberAttachmentPreview(attachment.id, previewPath, previewUrl);
      return true;
    } catch (error) {
      console.info("Aperçu photo existant non réparé", error);
      if (previewPath) await bucket.remove([previewPath]).catch(() => null);
      return false;
    } finally {
      app.imagePreviewRepairInFlight.delete(attachmentId);
    }
  }
  function messageById(id) { return currentMessages().find(message => String(message.id) === String(id)); }
  function filteredMessages() {
    const query = app.search.trim().toLowerCase();
    const scope = { ...app.advancedFilters, ...(app.printScope || {}) };
    return currentMessages().filter(message => {
      if (app.typeFilter && message.message_type !== app.typeFilter) return false;
      if (app.onlyImportant && !message.is_important) return false;
      if (scope.from && new Date(message.created_at) < new Date(`${scope.from}T00:00:00`)) return false;
      if (scope.to && new Date(message.created_at) > new Date(`${scope.to}T23:59:59.999`)) return false;
      if (scope.zone && !String(message.zone || "").toLocaleLowerCase("fr").includes(String(scope.zone).toLocaleLowerCase("fr"))) return false;
      if (scope.author && !String(message.author_name || "").toLocaleLowerCase("fr").includes(String(scope.author).toLocaleLowerCase("fr"))) return false;
      if (scope.attachment && !(message.attachments || []).length) return false;
      if (!query) return true;
      return [message.body, message.author_name, message.zone, message.message_type, ...(message.attachments || []).flatMap(file => [file.file_name, file.name, file.revision, file.plan_status])].join(" ").toLowerCase().includes(query);
    });
  }
  function renderAttachment(attachment) {
    const url = attachmentUrl(attachment), name = attachment.file_name || attachment.name || "Pièce jointe";
    if (fileIsImage(attachment) && url) return `<button class="image-attachment" data-action="open-image" data-attachment-id="${attachment.id}" title="Agrandir la photo"><img loading="lazy" src="${escapeHtml(url)}" alt="${escapeHtml(name)}"></button>`;
    const detail = [attachment.revision && `Indice ${attachment.revision}`, attachment.plan_status, formatBytes(attachment.bytes || attachment.size)].filter(Boolean).join(" · ") || "Ouvrir / télécharger";
    return `<button class="file-attachment" data-action="open-attachment" data-attachment-id="${attachment.id}"><span class="file-icon">${escapeHtml(fileIcon(attachment))}</span><span class="file-info"><b>${escapeHtml(name)}</b><small>${escapeHtml(detail)}</small></span></button>`;
  }
  function reactionsForMessage(messageId) {
    return (app.reactions || []).filter(item => String(item.message_id) === String(messageId));
  }
  function messageReadBySomeoneElse(message) {
    if (!String(message.author_id || "") || String(message.author_id) !== String(ownId())) return false;
    const created = new Date(message.created_at || 0).getTime();
    return (app.readStates || []).some(state => String(state.user_id) !== String(ownId()) && new Date(state.last_read_at || 0).getTime() >= created);
  }
  function renderReactionBar(message) {
    const grouped = new Map();
    reactionsForMessage(message.id).forEach(reaction => {
      const group = grouped.get(reaction.emoji) || { emoji: reaction.emoji, count: 0, mine: false };
      group.count += 1;
      group.mine = group.mine || String(reaction.user_id) === String(ownId());
      grouped.set(reaction.emoji, group);
    });
    const buttons = [...grouped.values()].map(group => `<button class="reaction-chip ${group.mine ? "mine" : ""}" data-action="toggle-reaction" data-message-id="${message.id}" data-emoji="${escapeHtml(group.emoji)}" title="Réagir ${escapeHtml(group.emoji)}">${escapeHtml(group.emoji)} <b>${group.count}</b></button>`).join("");
    return `<div class="reaction-bar">${buttons}<button class="reaction-add" data-action="open-reactions" data-message-id="${message.id}" title="Ajouter une réaction">☺</button></div>`;
  }
  function renderPinnedMessages() {
    const pinned = currentMessages().filter(message => !message.deleted_at && message.is_important).slice(-3).reverse();
    if (!currentChantier() || !pinned.length) { els.pinnedMessages.hidden = true; els.pinnedMessages.innerHTML = ""; return; }
    els.pinnedMessages.hidden = false;
    els.pinnedMessages.innerHTML = `<div class="pinned-title">★ Informations épinglées</div>${pinned.map(message => `<button class="pinned-item" data-action="jump-message" data-message-id="${message.id}"><b>${escapeHtml(message.author_name || "Intervenant")}</b><span>${escapeHtml(truncate(message.body || "Pièce jointe", 120))}</span></button>`).join("")}`;
  }
  function renderMessage(message) {
    const mine = String(message.author_id) === String(ownId()), deleted = Boolean(message.deleted_at);
    const parent = message.reply_to ? messageById(message.reply_to) : null;
    const attachments = deleted ? [] : (message.attachments || []);
    const images = attachments.filter(fileIsImage), documents = attachments.filter(item => !fileIsImage(item));
    if (message.message_type === "Système") return `<article class="message-row system"><div class="message-bubble">${escapeHtml(message.body || "")}</div></article>`;
    return `<article class="message-row ${mine ? "mine" : ""}" data-message-row="${message.id}"><span class="message-avatar">${escapeHtml(initial(message.author_name))}</span><div class="message-bubble ${deleted ? "deleted" : ""}"><button class="message-menu" data-action="message-menu" data-message-id="${message.id}" aria-label="Options">⋮</button><div class="message-head"><span class="author-name">${escapeHtml(message.author_name || "Intervenant")}</span>${message.message_type ? `<span class="message-tag ${typeClass(message.message_type)}">${escapeHtml(message.message_type)}</span>` : ""}${message.zone ? `<span class="zone-tag">${escapeHtml(message.zone)}</span>` : ""}${message.is_important ? `<span class="important-star">★</span>` : ""}</div>${parent ? `<button class="reply-quote" data-action="jump-message" data-message-id="${parent.id}"><b>${escapeHtml(parent.author_name || "Intervenant")}</b>${escapeHtml(truncate(parent.body || "Pièce jointe", 90))}</button>` : ""}${deleted ? `<div class="message-text">Message supprimé.</div>` : ""}${!deleted && images.length ? `<div class="attachment-grid ${images.length === 1 ? "one" : ""}">${images.map(renderAttachment).join("")}</div>` : ""}${!deleted ? documents.map(renderAttachment).join("") : ""}${!deleted && message.body ? `<div class="message-text">${renderRichText(message.body)}</div>` : ""}${!deleted ? renderReactionBar(message) : ""}<div class="message-footer"><span>${formatTime(message.created_at)}</span>${mine ? `<span class="message-status" title="${messageReadBySomeoneElse(message) ? "Lu par un interlocuteur" : "Envoyé"}">${messageReadBySomeoneElse(message) ? "✓✓" : "✓"}</span>` : ""}</div>${!deleted ? `<div class="message-actions"><button data-action="reply" data-message-id="${message.id}">↩ Répondre</button><button data-action="open-reactions" data-message-id="${message.id}">☺ Réagir</button><button data-action="make-action" data-message-id="${message.id}">✓ Action</button>${mine ? `<button data-action="toggle-important" data-message-id="${message.id}">${message.is_important ? "★ Désépingler" : "☆ Épingler"}</button>` : ""}</div>` : ""}</div></article>`;
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
    const hasAdvancedFilters = Object.values(app.advancedFilters).some(value => Boolean(value));
    els.advancedSearchBtn.classList.toggle("is-active", hasAdvancedFilters);
    els.advancedSearchBtn.title = hasAdvancedFilters ? "Recherche avancée active" : "Recherche avancée";
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
  function actionPriorityLabel(priority) { return ({ basse: "Basse", normale: "Normale", haute: "Haute", critique: "Critique" })[priority] || "Normale"; }
  function renderActions() {
    const chantier = currentChantier();
    if (!chantier) { showEmpty(els.actionBoard, "Aucune action à suivre", "Crée un chantier et ajoute les premières actions.", "✓"); els.actionSummary.innerHTML = ""; els.actionCount.textContent = "0"; return; }
    const actions = activeActionsFor(chantier.id), outstanding = actions.filter(action => action.status !== "terminee"), late = outstanding.filter(actionIsLate);
    els.actionCount.textContent = outstanding.length;
    els.actionSummary.innerHTML = [["À traiter", outstanding.length], ["En retard", late.length], ["Terminées", actions.filter(action => action.status === "terminee").length]].map(([label, count]) => `<div class="summary-card"><b>${count}</b><span>${label}</span></div>`).join("");
    const columns = [["a_faire", "À faire"], ["en_cours", "En cours"], ["terminee", "Terminées"]];
    els.actionBoard.innerHTML = columns.map(([status, title]) => {
      const items = actions.filter(action => action.status === status).sort((a, b) => String(a.due_date || "9999").localeCompare(String(b.due_date || "9999")));
      return `<section class="action-column"><h3>${title}<span>${items.length}</span></h3>${items.map(action => `<article class="action-card"><button class="action-menu" data-action="action-menu" data-action-id="${action.id}" aria-label="Gérer">⋮</button><span class="action-priority priority-${escapeHtml(action.priority || "normale")}">${escapeHtml(actionPriorityLabel(action.priority))}</span><h4>${escapeHtml(action.title)}</h4>${action.description ? `<p>${escapeHtml(action.description)}</p>` : ""}${action.close_note ? `<p class="action-proof">✓ ${escapeHtml(truncate(action.close_note, 100))}</p>` : ""}<div class="action-card-foot"><span>${escapeHtml(action.assignee || "Non attribuée")}</span><span class="${actionIsLate(action) ? "due-late" : ""}">${action.due_date ? `Échéance ${new Intl.DateTimeFormat("fr-FR").format(new Date(`${action.due_date}T12:00:00`))}` : "Sans échéance"}</span></div></article>`).join("") || `<p style="margin:16px 3px;color:#687982;font-size:11px">Aucune action</p>`}</section>`;
    }).join("");
  }
  function riskSeverityLabel(value) { return ({ faible: "Faible", moderee: "Modérée", elevee: "Élevée", critique: "Critique" })[value] || "Modérée"; }
  function riskStatusLabel(value) { return ({ ouvert: "Ouvert", en_suivi: "En suivi", traite: "Traité" })[value] || "Ouvert"; }
  function formatSimpleDate(value) { return value ? new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${String(value).slice(0, 10)}T12:00:00`)) : ""; }
  function renderPilotage() {
    const chantier = currentChantier();
    if (!chantier) {
      els.pilotageCount.textContent = "0";
      els.pilotageSummary.innerHTML = "";
      els.pilotageAlerts.hidden = true;
      showEmpty(els.dailyLogList, "Aucun chantier sélectionné", "Crée ou sélectionne un chantier pour suivre les journées de travail.", "◈");
      showEmpty(els.riskList, "Aucun chantier sélectionné", "Les incidents et points de vigilance apparaîtront ici.", "⚠");
      return;
    }
    const actions = activeActionsFor(chantier.id);
    const lateActions = actions.filter(action => action.status !== "terminee" && actionIsLate(action));
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(23, 59, 59, 999);
    const dueSoon = actions.filter(action => action.status !== "terminee" && action.due_date && !actionIsLate(action) && new Date(`${action.due_date}T23:59:59`) <= tomorrow);
    const logs = activeDailyLogsFor(chantier.id).sort((a, b) => String(b.log_date || b.created_at).localeCompare(String(a.log_date || a.created_at)) || new Date(b.created_at) - new Date(a.created_at));
    const riskOrder = { ouvert: 0, en_suivi: 1, traite: 2 };
    const risks = activeRisksFor(chantier.id).sort((a, b) => {
      const statusOrder = (riskOrder[a.status] ?? 3) - (riskOrder[b.status] ?? 3);
      return statusOrder || new Date(b.created_at) - new Date(a.created_at);
    });
    const activeRisks = risks.filter(item => item.status !== "traite");
    const criticalRisks = activeRisks.filter(item => ["elevee", "critique"].includes(item.severity));
    const alerts = lateActions.length + criticalRisks.length;
    els.pilotageCount.textContent = alerts;
    els.pilotageSummary.innerHTML = [
      ["Journées consignées", logs.length, "◈"],
      ["Actions en retard", lateActions.length, "◷"],
      ["Vigilances ouvertes", activeRisks.length, "⚠"],
      ["Échéances proches", dueSoon.length, "⌛"]
    ].map(([label, count, icon]) => `<div class="pilotage-card"><span>${icon}</span><b>${count}</b><small>${label}</small></div>`).join("");
    const alertParts = [];
    if (lateActions.length) alertParts.push(`${lateActions.length} action${lateActions.length > 1 ? "s" : ""} en retard`);
    if (criticalRisks.length) alertParts.push(`${criticalRisks.length} point${criticalRisks.length > 1 ? "s" : ""} de vigilance élevé${criticalRisks.length > 1 ? "s" : ""}`);
    if (dueSoon.length) alertParts.push(`${dueSoon.length} échéance${dueSoon.length > 1 ? "s" : ""} sous 24 h`);
    els.pilotageAlerts.hidden = !alertParts.length;
    els.pilotageAlerts.innerHTML = alertParts.length ? `<span>⚠</span><div><b>À traiter</b><p>${escapeHtml(alertParts.join(" · "))}.</p></div><button class="secondary-button" data-action="open-alert-center">Voir les alertes</button>` : "";
    if (!logs.length) showEmpty(els.dailyLogList, "Aucune journée consignée", "Ajoute un journal quotidien pour garder les faits et décisions de chaque poste.", "◈");
    else els.dailyLogList.innerHTML = logs.slice(0, 8).map(log => `<button class="pilotage-item" data-action="open-daily-log" data-daily-log-id="${escapeHtml(log.id)}"><span class="pilotage-date">${escapeHtml(formatSimpleDate(log.log_date || log.created_at))}</span><span class="pilotage-item-copy"><b>${escapeHtml(log.shift || "Journée")} · ${escapeHtml(log.zone || "Sans zone")}</b><small>${escapeHtml(truncate(log.work_summary || "Compte rendu de poste", 120))}</small></span><span aria-hidden="true">›</span></button>`).join("");
    if (!risks.length) showEmpty(els.riskList, "Aucun point de vigilance", "Déclare les incidents, presque-accidents et risques pour les traiter et les tracer.", "⚠");
    else els.riskList.innerHTML = risks.slice(0, 10).map(risk => `<button class="pilotage-item risk-item" data-action="open-risk" data-risk-id="${escapeHtml(risk.id)}"><span class="risk-severity severity-${escapeHtml(risk.severity || "moderee")}">${escapeHtml(riskSeverityLabel(risk.severity))}</span><span class="pilotage-item-copy"><b>${escapeHtml(risk.category || "Point de vigilance")} · ${escapeHtml(riskStatusLabel(risk.status))}</b><small>${escapeHtml(truncate(risk.description || "", 120))}${risk.zone ? ` · ${escapeHtml(risk.zone)}` : ""}</small></span><span aria-hidden="true">›</span></button>`).join("");
    const signature = `${chantier.id}:${lateActions.length}:${dueSoon.length}:${criticalRisks.length}`;
    if (isCloudReady() && (lateActions.length || dueSoon.length || criticalRisks.length) && signature !== app.lastOperationalAlertSignature) {
      app.lastOperationalAlertSignature = signature;
      const text = `${lateActions.length + dueSoon.length} action(s) à suivre · ${criticalRisks.length} vigilance(s) élevée(s)`;
      setTimeout(() => toast(`Pilotage : ${text}.`, "warning"), 120);
      try {
        if ("Notification" in window && Notification.permission === "granted") new Notification("Journal chantier — alertes", { body: text });
      } catch (error) { console.info("Notification non affichée", error); }
    }
  }
  function renderPrintCover() {
    const chantier = currentChantier();
    if (!chantier) return;
    const scope = app.printScope || {};
    const period = scope.from || scope.to ? `Période : ${scope.from ? new Intl.DateTimeFormat("fr-FR").format(new Date(`${scope.from}T12:00:00`)) : "Début"} – ${scope.to ? new Intl.DateTimeFormat("fr-FR").format(new Date(`${scope.to}T12:00:00`)) : "Aujourd’hui"}` : "Période : intégralité du journal";
    const inPeriod = value => {
      const date = new Date(value || 0);
      if (scope.from && date < new Date(`${scope.from}T00:00:00`)) return false;
      if (scope.to && date > new Date(`${scope.to}T23:59:59.999`)) return false;
      return true;
    };
    const actions = activeActionsFor(chantier.id);
    const dailyLogs = activeDailyLogsFor(chantier.id).filter(log => inPeriod(log.log_date ? `${log.log_date}T12:00:00` : log.created_at));
    const activeRisks = activeRisksFor(chantier.id).filter(risk => risk.status !== "traite");
    const pilotage = scope.include_pilotage ? `<dl class="print-pilotage-summary"><div><dt>Journées consignées</dt><dd>${dailyLogs.length}</dd></div><div><dt>Actions ouvertes</dt><dd>${actions.filter(action => action.status !== "terminee").length}</dd></div><div><dt>Actions en retard</dt><dd>${actions.filter(actionIsLate).length}</dd></div><div><dt>Vigilances ouvertes</dt><dd>${activeRisks.length}</dd></div></dl>` : "";
    els.printCover.innerHTML = `<h1>Journal de chantier – ${escapeHtml(chantier.name)}</h1><p>${escapeHtml([chantier.code && `Code : ${chantier.code}`, chantier.location && `Localisation : ${chantier.location}`, period, `Édité le ${formatDateTime(nowIso())}`].filter(Boolean).join(" · "))}</p><p class="print-note">Historique chronologique des discussions, photos et documents du chantier.</p>${pilotage}`;
  }
  function renderAccessControls() {
    const hasGlobalRights = !isCloudReady() || isJournalAdmin();
    els.newChantierBtn.hidden = !hasGlobalRights;
    els.inviteBtn.hidden = !hasGlobalRights;
    els.adminDashboardBtn.hidden = !isJournalOwner();
    // Sur écran réduit, le bouton du haut est masqué pour préserver la place.
    // Le même accès reste alors disponible dans le panneau latéral.
    els.mobileAdminDashboardBtn.hidden = !isJournalOwner();
    if (isCloudReady() && isJournalAdmin()) {
      els.inviteBtn.title = "Gérer les demandes d’accès";
      els.inviteBtn.innerHTML = `♙ <span>Demandes${app.access.pendingRequests ? ` (${app.access.pendingRequests})` : ""}</span>`;
    } else {
      els.inviteBtn.title = "Inviter un interlocuteur";
      els.inviteBtn.innerHTML = "♙ <span>Inviter</span>";
    }
  }
  function renderAll(options) { renderProfile(); renderConnection(); renderAccessControls(); renderSidebar(); renderHeader(); renderPinnedMessages(); renderMessages(options); renderPlans(); renderActions(); renderPilotage(); renderPrintCover(); }
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

  async function createPhotoPreviewFile(file) {
    if (!fileIsImage(file) || !file?.size || typeof URL.createObjectURL !== "function") return null;
    const objectUrl = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.decoding = "async";
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error("Photo non lisible pour créer son aperçu."));
        image.src = objectUrl;
      });
      const longestSide = Math.max(image.naturalWidth || 0, image.naturalHeight || 0);
      if (!longestSide) return null;
      const ratio = Math.min(1, 960 / longestSide);
      const width = Math.max(1, Math.round((image.naturalWidth || 1) * ratio));
      const height = Math.max(1, Math.round((image.naturalHeight || 1) * ratio));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) return null;
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.78));
      if (!blob) return null;
      const baseName = String(file.name || "photo").replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "_") || "photo";
      return new File([blob], `${baseName}-apercu.jpg`, { type: "image/jpeg", lastModified: Date.now() });
    } catch (error) {
      console.info("Aperçu photo non généré", error);
      return null;
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }
  function previewColumnUnavailable(error) {
    return /preview_storage_path|column .*preview|schema cache/i.test(String(error?.message || error || ""));
  }

  async function uploadCloudAttachment(file, message, metadata = {}) {
    const cleanName = String(file.name || "fichier").replace(/[^\w.\-]+/g, "_");
    const path = `${message.chantier_id}/${message.id}/${Date.now()}-${makeId()}-${cleanName}`;
    const bucket = app.db.storage.from(CONFIG.STORAGE_BUCKET || "chantier-files");
    const { error: storageError } = await bucket.upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
    if (storageError) throw storageError;
    // Les miniatures automatiques ont introduit un défaut de lecture sur
    // certains téléphones Android. On conserve le parcours V12 éprouvé :
    // l'original est envoyé puis affiché directement dans la discussion.
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
      if (files.length && !els.messageInput.value.trim()) throw new Error("Ajoute un descriptif avec la photo ou le fichier avant l’envoi.");
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
    setComposerToolTray(false);
  }
  function renderPendingFiles() {
    if (!app.pendingFiles.length) { els.attachmentPreview.hidden = true; els.attachmentPreview.innerHTML = ""; return; }
    els.attachmentPreview.hidden = false;
    els.attachmentPreview.innerHTML = app.pendingFiles.map((item, index) => `<div class="pending-file">${fileIsImage(item.file) ? `<img src="${escapeHtml(item.preview_url)}" alt=""><button class="annotate-pending" data-action="annotate-pending" data-index="${index}" title="Annoter la photo" aria-label="Annoter la photo">✎</button>` : `<div class="pending-doc">${escapeHtml(fileIcon(item.file))}<br>${escapeHtml(truncate(item.file.name, 14))}</div>`}<button data-action="remove-pending" data-index="${index}" aria-label="Retirer">×</button></div>`).join("");
  }
  function queueFiles(files) {
    const limit = isCloudReady() ? MAX_CLOUD_FILE_BYTES : MAX_LOCAL_FILE_BYTES;
    files.forEach(file => {
      if (file.size > limit) toast(`${file.name} dépasse ${formatBytes(limit)}.`, "error");
      else app.pendingFiles.push({ file, preview_url: fileIsImage(file) ? URL.createObjectURL(file) : "" });
    });
    renderPendingFiles();
  }
  function openImageAnnotationDialog(index) {
    const item = app.pendingFiles[Number(index)];
    if (!item || !fileIsImage(item.file)) return;
    openModal({
      title: "Annoter la photo",
      subtitle: "Trace, entoure ou souligne avant l’envoi. L’original reste uniquement sur cet appareil tant que tu n’envoies pas.",
      body: `<div class="annotation-tools"><label>Couleur <input id="annotationColor" type="color" value="#d10073"></label><label>Épaisseur <input id="annotationWidth" type="range" min="2" max="18" value="5"></label></div><canvas id="annotationCanvas" class="annotation-canvas" aria-label="Zone d’annotation de la photo"></canvas><p class="form-note" id="annotationHint">Chargement de la photo…</p>`,
      footer: `<button class="secondary-button" id="cancelAnnotation">Annuler</button><button class="primary-button" id="saveAnnotation" disabled>Utiliser la photo annotée</button>`, wide: true
    });
    const canvas = $("annotationCanvas"), context = canvas.getContext("2d"), color = $("annotationColor"), width = $("annotationWidth"), hint = $("annotationHint"), save = $("saveAnnotation");
    let drawing = false, previous = null;
    const image = new Image();
    image.onload = () => {
      const max = 1500, ratio = Math.min(1, max / Math.max(image.naturalWidth, image.naturalHeight));
      canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      hint.textContent = "Dessine directement sur la photo. Tu peux annuler puis recommencer si nécessaire.";
      save.disabled = false;
    };
    image.onerror = () => { hint.textContent = "Cette photo ne peut pas être annotée par ce navigateur. Tu peux tout de même l’envoyer."; };
    image.src = item.preview_url;
    const point = event => {
      const bounds = canvas.getBoundingClientRect();
      return { x: (event.clientX - bounds.left) * (canvas.width / bounds.width), y: (event.clientY - bounds.top) * (canvas.height / bounds.height) };
    };
    const start = event => { if (!canvas.width) return; drawing = true; previous = point(event); canvas.setPointerCapture?.(event.pointerId); event.preventDefault(); };
    const move = event => {
      if (!drawing) return;
      const next = point(event);
      context.strokeStyle = color.value;
      context.lineWidth = Number(width.value);
      context.lineCap = "round";
      context.lineJoin = "round";
      context.beginPath(); context.moveTo(previous.x, previous.y); context.lineTo(next.x, next.y); context.stroke();
      previous = next; event.preventDefault();
    };
    const end = event => { drawing = false; previous = null; canvas.releasePointerCapture?.(event.pointerId); };
    canvas.addEventListener("pointerdown", start); canvas.addEventListener("pointermove", move); canvas.addEventListener("pointerup", end); canvas.addEventListener("pointercancel", end);
    $("cancelAnnotation").addEventListener("click", closeModal);
    save.addEventListener("click", () => canvas.toBlob(blob => {
      if (!blob) return toast("Annotation impossible.", "error");
      const base = String(item.file.name || "photo").replace(/\.[^.]+$/, "");
      const replacement = new File([blob], `${base}-annotee.png`, { type: "image/png", lastModified: Date.now() });
      if (item.preview_url) URL.revokeObjectURL(item.preview_url);
      app.pendingFiles[Number(index)] = { file: replacement, preview_url: URL.createObjectURL(replacement) };
      closeModal(); renderPendingFiles(); toast("Photo annotée prête à être envoyée.", "success");
    }, "image/png"));
  }
  function renderReplyPreview() {
    if (!app.replyTo) { els.replyPreview.hidden = true; els.replyPreview.innerHTML = ""; return; }
    els.replyPreview.hidden = false;
    els.replyPreview.innerHTML = `<span><b>Réponse à ${escapeHtml(app.replyTo.author_name || "Intervenant")}</b> · ${escapeHtml(truncate(app.replyTo.body || "Pièce jointe", 100))}</span><button data-action="cancel-reply" aria-label="Annuler">×</button>`;
  }
  function insertInComposer(value) {
    const field = els.messageInput;
    const start = Number.isInteger(field.selectionStart) ? field.selectionStart : field.value.length;
    const end = Number.isInteger(field.selectionEnd) ? field.selectionEnd : field.value.length;
    const before = field.value.slice(0, start), after = field.value.slice(end);
    const spacer = before && !/\s$/.test(before) && !/^\s/.test(value) ? " " : "";
    field.value = `${before}${spacer}${value}${after}`;
    const position = (before + spacer + value).length;
    field.focus(); field.setSelectionRange(position, position);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  }
  function knownMentions() {
    const entries = new Map();
    currentMessages().forEach(message => {
      const label = String(message.author_name || "").trim();
      if (label && String(message.author_id) !== String(ownId())) entries.set(label.toLocaleLowerCase("fr"), label);
    });
    return ["équipe", ...[...entries.values()].sort((a, b) => a.localeCompare(b, "fr"))];
  }
  function openEmojiPicker() {
    const emojis = ["👍", "✅", "⚠️", "📌", "👀", "👏", "🚧", "📷", "🛠️", "❗", "💬", "🙂"];
    openModal({ title: "Ajouter un émoji", subtitle: "Inséré dans ton message, avant l’envoi.", body: `<div class="emoji-picker">${emojis.map(emoji => `<button data-emoji-insert="${emoji}" aria-label="${emoji}">${emoji}</button>`).join("")}</div>`, footer: `<button class="secondary-button" id="closeEmojiPicker">Fermer</button>` });
    $("closeEmojiPicker").addEventListener("click", closeModal);
    $$('[data-emoji-insert]', els.modalBody).forEach(button => button.addEventListener("click", () => { insertInComposer(button.dataset.emojiInsert); closeModal(); }));
  }
  function openMentionPicker() {
    const mentions = knownMentions();
    openModal({ title: "Mentionner", subtitle: "La mention est visible par tous les membres du chantier.", body: `<div class="menu-list">${mentions.map(name => `<button data-mention="${escapeHtml(name)}">@${escapeHtml(name)}</button>`).join("")}</div>`, footer: `<button class="secondary-button" id="closeMentionPicker">Fermer</button>` });
    $("closeMentionPicker").addEventListener("click", closeModal);
    $$('[data-mention]', els.modalBody).forEach(button => button.addEventListener("click", () => { insertInComposer(`@${button.dataset.mention}`); closeModal(); }));
  }
  function polishComposerText() {
    const source = els.messageInput.value.trim();
    if (!source) return toast("Écris ou dicte d’abord un message.", "warning");
    let result = source.replace(/\s+/g, " ").replace(/\s+([,.;:!?])/g, "$1").replace(/([,.;:!?])(?=[^\s])/g, "$1 ");
    result = result.replace(/(^|[.!?]\s+)([a-zà-ÿ])/gu, (_, prefix, letter) => `${prefix}${letter.toLocaleUpperCase("fr-FR")}`);
    if (result.length > 18 && !/[.!?]$/.test(result)) result += ".";
    els.messageInput.value = result;
    els.messageInput.dispatchEvent(new Event("input", { bubbles: true }));
    toast("Formulation améliorée localement.", "success");
  }
  function setComposerToolTray(open) {
    const visible = Boolean(open);
    els.composerToolTray.hidden = !visible;
    els.composerToolsBtn.setAttribute("aria-expanded", String(visible));
    els.composerToolsBtn.classList.toggle("is-active", visible);
  }
  async function toggleDictation() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) { toast("La dictée n’est pas prise en charge par ce navigateur. Utilise Chrome ou Edge à jour.", "warning"); return; }
    if (app.isDictating && app.recognition) { app.recognition.stop(); return; }
    try {
      if (navigator.mediaDevices?.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(track => track.stop());
      }
    } catch (error) {
      toast("Le microphone est bloqué. Autorise-le pour ce site dans les réglages du navigateur, puis réessaie.", "warning");
      return;
    }
    const recognition = new Recognition();
    app.recognition = recognition;
    recognition.lang = "fr-FR";
    recognition.continuous = false;
    recognition.interimResults = true;
    let finalText = "";
    recognition.onstart = () => { app.isDictating = true; $("dictationBtn").classList.add("is-recording"); toast("Dictée en cours…", "success"); };
    recognition.onresult = event => {
      let interim = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        if (event.results[index].isFinal) finalText += event.results[index][0].transcript;
        else interim += event.results[index][0].transcript;
      }
      if (finalText) insertInComposer(finalText);
      if (interim) $("dictationBtn").title = `Dictée : ${interim}`;
    };
    recognition.onerror = event => {
      if (event.error === "aborted") return;
      const messages = {
        "not-allowed": "Le microphone est refusé. Autorise-le pour ce site dans le navigateur.",
        "service-not-allowed": "La dictée n’est pas autorisée par ce navigateur.",
        "network": "La dictée a besoin d’une connexion internet stable.",
        "no-speech": "Aucune parole détectée. Réessaie en parlant après le signal."
      };
      toast(messages[event.error] || `Dictée interrompue : ${event.error}.`, "warning");
    };
    recognition.onend = () => { app.isDictating = false; $("dictationBtn").classList.remove("is-recording"); $("dictationBtn").title = "Dicter le message"; };
    recognition.start();
  }
  async function toggleReaction(message, emoji) {
    const existing = reactionsForMessage(message.id).find(item => String(item.user_id) === String(ownId()) && item.emoji === emoji);
    try {
      if (isCloudReady()) {
        const query = existing
          ? app.db.from("chantier_message_reactions").delete().eq("id", existing.id)
          : app.db.from("chantier_message_reactions").insert({ chantier_id: message.chantier_id, message_id: message.id, user_id: ownId(), emoji }).select();
        const { error } = await query;
        if (error) throw error;
        await refreshCloudCurrent();
      } else {
        if (existing) app.local.reactions = app.local.reactions.filter(item => String(item.id) !== String(existing.id));
        else app.local.reactions.push({ id: makeId(), chantier_id: message.chantier_id, message_id: message.id, user_id: ownId(), emoji, created_at: nowIso() });
        app.reactions = app.local.reactions;
        saveLocalData(); renderAll({ keepPosition: true });
      }
    } catch (error) { toast(`Réaction indisponible : ${friendlyError(error)}`, "warning"); }
  }
  function openReactionPicker(message) {
    const emojis = ["👍", "✅", "⚠️", "📌", "👀", "👏", "🚧", "❗"];
    openModal({ title: "Réagir au message", subtitle: "La réaction est visible par les membres du chantier.", body: `<div class="emoji-picker">${emojis.map(emoji => `<button data-reaction-emoji="${emoji}" aria-label="Réagir ${emoji}">${emoji}</button>`).join("")}</div>`, footer: `<button class="secondary-button" id="closeReactionPicker">Fermer</button>` });
    $("closeReactionPicker").addEventListener("click", closeModal);
    $$('[data-reaction-emoji]', els.modalBody).forEach(button => button.addEventListener("click", async () => { closeModal(); await toggleReaction(message, button.dataset.reactionEmoji); }));
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
      body: `<form id="editMessageForm" class="form-grid one"><label class="form-field">Message<textarea name="body" required>${escapeHtml(message.body || "")}</textarea></label><label class="form-field">Type<select name="message_type">${["Info", "Journal", "Sécurité", "Incident", "Avancement", "Aléa", "Coactivité", "Décision", "Document", "Action"].map(type => `<option ${message.message_type === type ? "selected" : ""}>${type}</option>`).join("")}</select></label><label class="form-field">Zone / PK<input name="zone" value="${escapeHtml(message.zone || "")}"></label></form>`,
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
    const action = { chantier_id: chantier.id, message_id: sourceMessage?.id || null, title: values.title.trim(), description: values.description.trim(), assignee: values.assignee.trim(), due_date: values.due_date || null, priority: values.priority || "normale", status: values.status || "a_faire", created_by: ownId(), created_at: nowIso() };
    if (!action.title) throw new Error("Le libellé de l’action est obligatoire.");
    if (isCloudReady()) {
      const { error } = await app.db.from("action_items").insert(action);
      if (error) throw error;
      await refreshCloudCurrent();
    } else { action.id = makeId(); app.local.actions.push(action); app.actions = app.local.actions; saveLocalData(); renderAll(); }
    await addMessage({ body: `Action créée : ${action.title}${action.assignee ? ` — attribuée à ${action.assignee}` : ""} · Priorité ${actionPriorityLabel(action.priority)}`, message_type: "Action", zone: sourceMessage?.zone || "", reply_to: sourceMessage?.id || null });
  }
  async function setActionStatus(action, status, completion = null) {
    if (status === "terminee" && !completion && !action.closed_at) {
      openActionCompletionDialog(action);
      return;
    }
    try {
      const update = { status, updated_at: nowIso() };
      if (completion) Object.assign(update, { close_note: completion.note, proof_message_id: completion.messageId || null, closed_at: nowIso(), closed_by: ownId() });
      if (isCloudReady()) {
        const { error } = await app.db.from("action_items").update(update).eq("id", action.id);
        if (error) throw error;
        await refreshCloudCurrent();
      } else { Object.assign(action, update); saveLocalData(); renderAll(); }
      toast(`Action déplacée dans « ${actionStatusLabel(status)} ».`, "success");
    } catch (error) { toast(`Mise à jour impossible : ${error.message}`, "error"); }
  }

  function dailyLogById(id) { return activeDailyLogsFor(app.currentId).find(item => String(item.id) === String(id)); }
  function riskById(id) { return activeRisksFor(app.currentId).find(item => String(item.id) === String(id)); }
  function dailyLogMessage(record) {
    const lines = [`Journal quotidien — ${formatSimpleDate(record.log_date)} · ${record.shift || "Poste"}`, record.work_summary];
    if (record.workforce) lines.push(`Effectifs : ${record.workforce}`);
    if (record.constraints) lines.push(`Contraintes : ${record.constraints}`);
    if (record.safety_summary) lines.push(`Sécurité : ${record.safety_summary}`);
    if (record.decisions) lines.push(`Décisions : ${record.decisions}`);
    if (record.next_steps) lines.push(`Suite : ${record.next_steps}`);
    return lines.filter(Boolean).join("\n");
  }
  async function addDailyLog(values) {
    const chantier = currentChantier();
    if (!chantier) throw new Error("Crée ou sélectionne un chantier avant de consigner une journée.");
    const record = {
      chantier_id: chantier.id, log_date: values.log_date || new Date().toISOString().slice(0, 10), shift: values.shift || "Journée",
      zone: values.zone?.trim() || "", weather: values.weather?.trim() || "", workforce: values.workforce?.trim() || "",
      work_summary: values.work_summary?.trim() || "", constraints: values.constraints?.trim() || "", safety_summary: values.safety_summary?.trim() || "",
      decisions: values.decisions?.trim() || "", next_steps: values.next_steps?.trim() || "", author_id: ownId(), author_name: ownName(), created_at: nowIso(), updated_at: nowIso()
    };
    if (!record.work_summary) throw new Error("Le résumé des travaux réalisés est obligatoire.");
    if (isCloudReady()) {
      const { data, error } = await app.db.from("chantier_daily_logs").insert(record).select().single();
      if (error) throw error;
      Object.assign(record, data || {});
    } else {
      record.id = makeId();
      app.local.dailyLogs.push(record);
      app.dailyLogs = app.local.dailyLogs;
      saveLocalData();
    }
    const message = await addMessage({ body: dailyLogMessage(record), message_type: "Journal", zone: record.zone, is_important: Boolean(record.decisions || record.constraints) });
    record.message_id = message?.id || null;
    if (isCloudReady() && record.message_id) {
      const { error } = await app.db.from("chantier_daily_logs").update({ message_id: record.message_id, updated_at: nowIso() }).eq("id", record.id);
      if (error) console.warn("Lien journal quotidien non enregistré", error);
      await refreshCloudCurrent();
    } else { saveLocalData(); renderAll(); }
  }
  function openDailyLogDialog() {
    if (!currentChantier()) return openNewChantierDialog();
    const today = new Date().toISOString().slice(0, 10);
    openModal({
      title: "Journal quotidien", subtitle: "Un compte rendu structuré est ajouté au pilotage et tracé dans la discussion.", wide: true,
      body: `<form id="dailyLogForm" class="form-grid"><label class="form-field">Date<input name="log_date" type="date" value="${today}" required></label><label class="form-field">Poste<select name="shift"><option>Journée</option><option>Nuit</option><option>Préparation</option><option>Week-end</option></select></label><label class="form-field">Zone / voies / PK<input name="zone" placeholder="Ex. V2M – PK 80,050 à 80,340"></label><label class="form-field">Météo / conditions<input name="weather" placeholder="Ex. Sec, 14 °C"></label><label class="form-field span-2">Effectifs / entreprises<input name="workforce" placeholder="Ex. 4 ETF, 2 HPLX, RLT présent"></label><label class="form-field span-2">Travaux réalisés *<textarea name="work_summary" required placeholder="Décris les travaux réalisés, les contrôles et les principaux faits."></textarea></label><label class="form-field">Contraintes / aléas<textarea name="constraints" placeholder="Retard, coactivité, accès, matériel…"></textarea></label><label class="form-field">Sécurité / briefing<textarea name="safety_summary" placeholder="Briefing, contrôles, mesures mises en œuvre…"></textarea></label><label class="form-field">Décisions prises<textarea name="decisions" placeholder="Décision, validation, arbitrage…"></textarea></label><label class="form-field">Suite à donner<textarea name="next_steps" placeholder="Actions ou préparations pour le prochain poste."></textarea></label></form>`,
      footer: `<button class="secondary-button" id="cancelDailyLog">Annuler</button><button class="primary-button" id="saveDailyLog">Consigner la journée</button>`
    });
    $("cancelDailyLog").addEventListener("click", closeModal);
    $("saveDailyLog").addEventListener("click", async () => {
      const form = $("dailyLogForm");
      if (!form.reportValidity()) return;
      try { await addDailyLog(Object.fromEntries(new FormData(form).entries())); closeModal(); setActiveTab("pilotage"); toast("Journal quotidien consigné et publié dans le fil.", "success"); }
      catch (error) { toast(`Journal quotidien impossible : ${friendlyError(error)}`, "error"); }
    });
  }
  function openDailyLogDetails(record) {
    if (!record) return;
    const sections = [["Travaux réalisés", record.work_summary], ["Effectifs / entreprises", record.workforce], ["Météo / conditions", record.weather], ["Contraintes / aléas", record.constraints], ["Sécurité / briefing", record.safety_summary], ["Décisions", record.decisions], ["Suite à donner", record.next_steps]].filter(([, value]) => value);
    openModal({
      title: `Journal du ${formatSimpleDate(record.log_date || record.created_at)}`,
      subtitle: [record.shift, record.zone].filter(Boolean).join(" · ") || "Compte rendu de poste",
      body: `<div class="record-detail">${sections.map(([label, value]) => `<section><h3>${escapeHtml(label)}</h3><p>${escapeHtml(value)}</p></section>`).join("")}</div>`,
      footer: `${record.message_id ? `<button class="secondary-button" id="openDailyMessage">Voir dans le fil</button>` : ""}<button class="primary-button" id="closeDailyDetail">Fermer</button>`
    });
    $("closeDailyDetail").addEventListener("click", closeModal);
    $("openDailyMessage")?.addEventListener("click", () => { closeModal(); setActiveTab("chat"); setTimeout(() => jumpToMessage(record.message_id), 80); });
  }
  function riskMessage(record) {
    const lines = [`${record.category || "Point de vigilance"} — Gravité ${riskSeverityLabel(record.severity)}`, record.description];
    if (record.immediate_measures) lines.push(`Mesures immédiates : ${record.immediate_measures}`);
    if (record.follow_up) lines.push(`Suivi attendu : ${record.follow_up}`);
    return lines.filter(Boolean).join("\n");
  }
  async function addRisk(values) {
    const chantier = currentChantier();
    if (!chantier) throw new Error("Crée ou sélectionne un chantier avant de signaler un risque.");
    const record = {
      chantier_id: chantier.id, category: values.category || "Point de vigilance", severity: values.severity || "moderee", status: "ouvert",
      zone: values.zone?.trim() || "", description: values.description?.trim() || "", immediate_measures: values.immediate_measures?.trim() || "", follow_up: values.follow_up?.trim() || "",
      author_id: ownId(), author_name: ownName(), created_at: nowIso(), updated_at: nowIso()
    };
    if (!record.description) throw new Error("La description du risque ou de l’incident est obligatoire.");
    if (isCloudReady()) {
      const { data, error } = await app.db.from("chantier_risks").insert(record).select().single();
      if (error) throw error;
      Object.assign(record, data || {});
    } else {
      record.id = makeId(); app.local.risks.push(record); app.risks = app.local.risks; saveLocalData();
    }
    const message = await addMessage({ body: riskMessage(record), message_type: "Incident", zone: record.zone, is_important: ["elevee", "critique"].includes(record.severity) });
    record.message_id = message?.id || null;
    if (isCloudReady() && record.message_id) {
      const { error } = await app.db.from("chantier_risks").update({ message_id: record.message_id, updated_at: nowIso() }).eq("id", record.id);
      if (error) console.warn("Lien risque non enregistré", error);
      await refreshCloudCurrent();
    } else { saveLocalData(); renderAll(); }
  }
  function openRiskDialog() {
    if (!currentChantier()) return openNewChantierDialog();
    openModal({
      title: "Signaler un risque", subtitle: "Le signalement est tracé, visible par les membres et suivi jusqu’à sa clôture.", wide: true,
      body: `<form id="riskForm" class="form-grid"><label class="form-field">Nature<select name="category"><option>Point de vigilance</option><option>Incident</option><option>Presque-accident</option><option>Non-conformité</option><option>Coactivité</option><option>Environnement</option></select></label><label class="form-field">Gravité<select name="severity"><option value="faible">Faible</option><option value="moderee" selected>Modérée</option><option value="elevee">Élevée</option><option value="critique">Critique</option></select></label><label class="form-field span-2">Zone / voie / PK<input name="zone" placeholder="Ex. V2M – PK 80,190"></label><label class="form-field span-2">Fait constaté *<textarea name="description" required placeholder="Décris le fait, le danger ou l’écart constaté de façon factuelle."></textarea></label><label class="form-field">Mesures immédiates<textarea name="immediate_measures" placeholder="Balisage, arrêt, information, protection…"></textarea></label><label class="form-field">Suivi attendu<textarea name="follow_up" placeholder="Responsable, contrôle ou action à programmer."></textarea></label></form>`,
      footer: `<button class="secondary-button" id="cancelRisk">Annuler</button><button class="primary-button" id="saveRisk">Enregistrer le signalement</button>`
    });
    $("cancelRisk").addEventListener("click", closeModal);
    $("saveRisk").addEventListener("click", async () => {
      const form = $("riskForm");
      if (!form.reportValidity()) return;
      try { await addRisk(Object.fromEntries(new FormData(form).entries())); closeModal(); setActiveTab("pilotage"); toast("Signalement enregistré et diffusé dans le journal.", "success"); }
      catch (error) { toast(`Signalement impossible : ${friendlyError(error)}`, "error"); }
    });
  }
  function openRiskDetails(record) {
    if (!record) return;
    openModal({
      title: record.category || "Point de vigilance", subtitle: `${riskSeverityLabel(record.severity)} · ${record.zone || "Sans zone"}`,
      body: `<form id="riskUpdateForm" class="form-grid one"><label class="form-field">Constat<textarea disabled>${escapeHtml(record.description || "")}</textarea></label><label class="form-field">Mesures immédiates<textarea name="immediate_measures">${escapeHtml(record.immediate_measures || "")}</textarea></label><label class="form-field">Suivi attendu<textarea name="follow_up">${escapeHtml(record.follow_up || "")}</textarea></label><label class="form-field">État<select name="status">${[["ouvert", "Ouvert"], ["en_suivi", "En suivi"], ["traite", "Traité"]].map(([value, label]) => `<option value="${value}" ${record.status === value ? "selected" : ""}>${label}</option>`).join("")}</select></label></form>`,
      footer: `${record.message_id ? `<button class="secondary-button" id="openRiskMessage">Voir dans le fil</button>` : ""}<button class="secondary-button" id="closeRiskDetail">Fermer</button><button class="primary-button" id="saveRiskUpdate">Mettre à jour</button>`
    });
    $("closeRiskDetail").addEventListener("click", closeModal);
    $("openRiskMessage")?.addEventListener("click", () => { closeModal(); setActiveTab("chat"); setTimeout(() => jumpToMessage(record.message_id), 80); });
    $("saveRiskUpdate").addEventListener("click", async () => {
      const values = Object.fromEntries(new FormData($("riskUpdateForm")).entries());
      const update = { ...values, updated_at: nowIso() };
      try {
        if (isCloudReady()) {
          const { error } = await app.db.from("chantier_risks").update(update).eq("id", record.id);
          if (error) throw error;
          await refreshCloudCurrent();
        } else { Object.assign(record, update); saveLocalData(); renderAll(); }
        closeModal(); toast("Point de vigilance mis à jour.", "success");
      } catch (error) { toast(`Mise à jour impossible : ${friendlyError(error)}`, "error"); }
    });
  }
  function openAdvancedSearchDialog() {
    const filters = app.advancedFilters;
    openModal({
      title: "Recherche avancée", subtitle: "Affiner le fil par période, zone, auteur ou présence de pièces jointes.",
      body: `<form id="advancedSearchForm" class="form-grid"><label class="form-field">Du<input name="from" type="date" value="${escapeHtml(filters.from)}"></label><label class="form-field">Au<input name="to" type="date" value="${escapeHtml(filters.to)}"></label><label class="form-field">Zone / PK<input name="zone" value="${escapeHtml(filters.zone)}" placeholder="Ex. V2M, PK 80"></label><label class="form-field">Auteur / entreprise<input name="author" value="${escapeHtml(filters.author)}" placeholder="Ex. ETF, Yoann"></label><label class="form-field span-2"><span><input name="attachment" type="checkbox" ${filters.attachment ? "checked" : ""}> Avec photo ou fichier uniquement</span></label></form>`,
      footer: `<button class="secondary-button" id="resetAdvancedSearch">Réinitialiser</button><button class="primary-button" id="applyAdvancedSearch">Appliquer</button>`
    });
    $("resetAdvancedSearch").addEventListener("click", () => { app.advancedFilters = { from: "", to: "", zone: "", author: "", attachment: false }; closeModal(); renderMessages({ keepPosition: true }); });
    $("applyAdvancedSearch").addEventListener("click", () => {
      const form = $("advancedSearchForm"), values = Object.fromEntries(new FormData(form).entries());
      app.advancedFilters = { from: values.from || "", to: values.to || "", zone: values.zone || "", author: values.author || "", attachment: form.elements.attachment.checked };
      closeModal(); renderMessages({ keepPosition: true });
    });
  }
  function operationalAlertItems() {
    const chantier = currentChantier();
    if (!chantier) return { late: [], dueSoon: [], risks: [] };
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(23, 59, 59, 999);
    const actions = activeActionsFor(chantier.id);
    return {
      late: actions.filter(action => action.status !== "terminee" && actionIsLate(action)),
      dueSoon: actions.filter(action => action.status !== "terminee" && action.due_date && !actionIsLate(action) && new Date(`${action.due_date}T23:59:59`) <= tomorrow),
      risks: activeRisksFor(chantier.id).filter(risk => risk.status !== "traite" && ["elevee", "critique"].includes(risk.severity))
    };
  }
  function openAlertCenter() {
    const alerts = operationalAlertItems();
    const blocks = [
      ...alerts.late.map(action => `<button class="dialog-item" data-action="open-alert-action" data-action-id="${escapeHtml(action.id)}"><span class="mini-avatar">◷</span><span><b>Action en retard</b><small>${escapeHtml(action.title)}${action.assignee ? ` · ${escapeHtml(action.assignee)}` : ""}</small></span><span>›</span></button>`),
      ...alerts.dueSoon.map(action => `<button class="dialog-item" data-action="open-alert-action" data-action-id="${escapeHtml(action.id)}"><span class="mini-avatar">⌛</span><span><b>Échéance proche</b><small>${escapeHtml(action.title)} · ${escapeHtml(formatSimpleDate(action.due_date))}</small></span><span>›</span></button>`),
      ...alerts.risks.map(risk => `<button class="dialog-item" data-action="open-risk" data-risk-id="${escapeHtml(risk.id)}"><span class="mini-avatar">⚠</span><span><b>${escapeHtml(risk.category || "Point de vigilance")}</b><small>${escapeHtml(truncate(risk.description || "", 100))}</small></span><span>›</span></button>`)
    ];
    openModal({
      title: "Alertes opérationnelles", subtitle: "Les relances sont recalculées à chaque ouverture du journal.",
      body: blocks.length ? `<div class="dialog-list">${blocks.join("")}</div>` : `<div class="form-note">Aucune action en retard, échéance sous 24 h ou vigilance élevée pour ce chantier.</div>`,
      footer: `<button class="secondary-button" id="enableNotificationsBtn">Activer les alertes navigateur</button><button class="primary-button" id="closeAlertCenter">Fermer</button>`
    });
    $("closeAlertCenter").addEventListener("click", closeModal);
    $("enableNotificationsBtn").addEventListener("click", ensureNotificationPermission);
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
  function beginPasswordRecovery(user) {
    if (!user || app.recoveryPending || app.recoveryHandled) return;
    app.recoveryPending = true;
    app.mode = "recovery";
    app.user = user;
    app.chantiers = []; app.currentId = null; app.messages = []; app.actions = []; app.dailyLogs = []; app.risks = []; app.members = [];
    renderAll();
    history.replaceState({ journalRecovery: true }, document.title, location.href);
    history.pushState({ journalRecovery: true }, document.title, location.href);
    openPasswordRecoveryDialog();
  }
  function openPasswordRecoveryDialog() {
    openModal({
      title: "Choisir un nouveau mot de passe",
      subtitle: "Ton lien e-mail est validé. Termine cette étape pour accéder au journal.",
      locked: true,
      body: `<form id="passwordRecoveryForm" class="form-grid one" novalidate><div class="form-note"><b>Étape finale.</b><br>Le retour et la fermeture sont désactivés pendant l’enregistrement afin de ne pas perdre la validation du lien.</div><label class="form-field">Nouveau mot de passe <small>8 caractères minimum</small><input name="password" type="password" required minlength="8" autocomplete="new-password" placeholder="8 caractères minimum"></label><label class="form-field">Confirmer le nouveau mot de passe<input name="confirm_password" type="password" required minlength="8" autocomplete="new-password" placeholder="Ressaisis le mot de passe"></label></form><div class="setup-result" id="passwordRecoveryResult" aria-live="polite"></div>`,
      footer: `<button class="primary-button" id="saveRecoveredPasswordBtn">Enregistrer le nouveau mot de passe</button>`
    });
    const form = $("passwordRecoveryForm"), result = $("passwordRecoveryResult"), submit = $("saveRecoveredPasswordBtn");
    const showResult = message => { result.textContent = message; result.className = "setup-result error"; };
    const run = async () => {
      const values = Object.fromEntries(new FormData(form).entries());
      const password = String(values.password || ""), confirmation = String(values.confirm_password || "");
      if (password.length < 8) return showResult("Le mot de passe doit contenir au moins 8 caractères.");
      if (password !== confirmation) return showResult("Les deux mots de passe ne sont pas identiques.");
      try {
        submit.disabled = true;
        submit.textContent = "Enregistrement…";
        const { data, error } = await app.db.auth.updateUser({ password });
        if (error) throw error;
        app.user = data?.user || app.user;
        app.recoveryPending = false;
        app.recoveryHandled = true;
        clearRecoveryUrl();
        app.mode = "cloud";
        await ensureCloudProfile(app.user);
        await refreshAccessContext();
        await refreshCloudChantiers();
        closeModal(true);
        renderAll();
        toast("Mot de passe modifié. Tu es maintenant connecté au journal.", "success");
      } catch (error) {
        showResult(friendlyError(error));
        submit.disabled = false;
        submit.textContent = "Enregistrer le nouveau mot de passe";
      }
    };
    submit.addEventListener("click", run);
    form.addEventListener("submit", event => { event.preventDefault(); run(); });
  }
  function openPasswordResetRequestDialog() {
    const email = app.authDraft.email || "";
    openModal({
      title: "Mot de passe oublié",
      subtitle: "Un lien sécurisé sera envoyé à cette adresse e-mail.",
      body: `<form id="passwordResetRequestForm" class="form-grid one" novalidate><div class="form-note">Le lien ouvre directement l’étape de choix du nouveau mot de passe. Aucun code n’est demandé.</div><label class="form-field">Adresse e-mail<input name="email" type="email" required inputmode="email" autocapitalize="none" spellcheck="false" autocomplete="username" value="${escapeHtml(email)}" placeholder="prenom.nom@exemple.fr"></label></form><div class="setup-result" id="passwordResetRequestResult" aria-live="polite"></div>`,
      footer: `<button class="secondary-button" id="cancelResetRequestBtn">Annuler</button><button class="primary-button" id="sendResetRequestBtn">Envoyer le lien</button>`
    });
    const form = $("passwordResetRequestForm"), result = $("passwordResetRequestResult"), submit = $("sendResetRequestBtn");
    const showResult = message => { result.textContent = message; result.className = "setup-result error"; };
    const run = async () => {
      const emailValue = String(new FormData(form).get("email") || "").trim().toLowerCase();
      if (!/^\S+@\S+\.\S+$/.test(emailValue)) return showResult("Saisis une adresse e-mail complète, par exemple nom@domaine.fr.");
      try {
        submit.disabled = true;
        submit.textContent = "Envoi…";
        app.authDraft.email = emailValue;
        const { error } = await app.db.auth.resetPasswordForEmail(emailValue, { redirectTo: appUrl() });
        if (error) throw error;
        openPasswordResetSentDialog(emailValue);
      } catch (error) {
        showResult(friendlyError(error));
        submit.disabled = false;
        submit.textContent = "Envoyer le lien";
      }
    };
    $("cancelResetRequestBtn").addEventListener("click", () => openPasswordAuthDialog("signin"));
    submit.addEventListener("click", run);
    form.addEventListener("submit", event => { event.preventDefault(); run(); });
  }
  function openPasswordResetSentDialog(email) {
    openModal({
      title: "Lien de réinitialisation envoyé",
      subtitle: "Ouvre maintenant le message reçu pour terminer la modification.",
      locked: true,
      body: `<div class="form-note"><b>Vérifie la boîte de ${escapeHtml(email)}.</b><br>Le lien ouvre cette application sur l’écran « Choisir un nouveau mot de passe ». Cette fenêtre reste volontairement ouverte pour éviter tout retour involontaire au formulaire de connexion.</div>`,
      footer: ""
    });
  }
  function openChangePasswordDialog() {
    if (!isCloudReady()) return openPasswordAuthDialog("signin");
    openModal({
      title: "Changer mon mot de passe",
      subtitle: "Choisis un nouveau mot de passe pour ce compte.",
      body: `<form id="changePasswordForm" class="form-grid one" novalidate><label class="form-field">Nouveau mot de passe <small>8 caractères minimum</small><input name="password" type="password" required minlength="8" autocomplete="new-password" placeholder="8 caractères minimum"></label><label class="form-field">Confirmer le nouveau mot de passe<input name="confirm_password" type="password" required minlength="8" autocomplete="new-password" placeholder="Ressaisis le mot de passe"></label></form><div class="setup-result" id="changePasswordResult" aria-live="polite"></div>`,
      footer: `<button class="secondary-button" id="cancelChangePasswordBtn">Annuler</button><button class="primary-button" id="saveChangedPasswordBtn">Enregistrer</button>`
    });
    const form = $("changePasswordForm"), result = $("changePasswordResult"), submit = $("saveChangedPasswordBtn");
    const showResult = message => { result.textContent = message; result.className = "setup-result error"; };
    const run = async () => {
      const values = Object.fromEntries(new FormData(form).entries());
      const password = String(values.password || ""), confirmation = String(values.confirm_password || "");
      if (password.length < 8) return showResult("Le mot de passe doit contenir au moins 8 caractères.");
      if (password !== confirmation) return showResult("Les deux mots de passe ne sont pas identiques.");
      try {
        submit.disabled = true;
        submit.textContent = "Enregistrement…";
        const { error } = await app.db.auth.updateUser({ password });
        if (error) throw error;
        closeModal();
        toast("Mot de passe modifié.", "success");
      } catch (error) {
        showResult(friendlyError(error));
        submit.disabled = false;
        submit.textContent = "Enregistrer";
      }
    };
    $("cancelChangePasswordBtn").addEventListener("click", openProfileDialog);
    submit.addEventListener("click", run);
    form.addEventListener("submit", event => { event.preventDefault(); run(); });
  }
  function openPasswordAuthDialog(view = "choice") {
    const draft = app.authDraft;
    if (view === "choice") {
      openModal({
        title: "Accès au journal",
        subtitle: "Aucun lien et aucun code ne sont envoyés par e-mail.",
        body: `<div class="form-note"><b>Choisis une seule action.</b><br>Crée ton accès si c’est ton premier compte avec mot de passe. Utilise « Se connecter » uniquement si ce mot de passe existe déjà.</div><div class="dialog-list"><div class="dialog-item"><span class="mini-avatar">1</span><span><b>Créer mon accès</b><small>Compte, demande de rôle et validation par le propriétaire.</small></span></div><div class="dialog-item"><span class="mini-avatar">2</span><span><b>Voir la démo</b><small>Découvre toute l’application sans accéder aux vraies données.</small></span></div></div>`,
        footer: `<button class="secondary-button" id="authDemoBtn">Voir la démo</button><button class="secondary-button" id="authCreateChoiceBtn">Créer mon accès</button><button class="primary-button" id="authSignInChoiceBtn">Se connecter</button>`
      });
      $("authDemoBtn").addEventListener("click", startDemoMode);
      $("authCreateChoiceBtn").addEventListener("click", () => openPasswordAuthDialog("create"));
      $("authSignInChoiceBtn").addEventListener("click", () => openPasswordAuthDialog("signin"));
      return;
    }

    const creating = view === "create";
    const formFields = creating
      ? `<label class="form-field">Adresse e-mail<input name="email" type="email" required inputmode="email" autocapitalize="none" spellcheck="false" autocomplete="username" value="${escapeHtml(draft.email)}" placeholder="prenom.nom@exemple.fr"></label><label class="form-field">Mot de passe <small>8 caractères minimum</small><input name="password" type="password" required minlength="8" autocomplete="new-password" value="${escapeHtml(draft.password)}" placeholder="8 caractères minimum"></label><label class="form-field">Confirmer le mot de passe<input name="confirm_password" type="password" required minlength="8" autocomplete="new-password" value="${escapeHtml(draft.confirmPassword)}" placeholder="Ressaisis le mot de passe"></label><label class="form-field">Nom et prénom<input name="full_name" required autocomplete="name" value="${escapeHtml(draft.fullName)}" placeholder="Ex. Yoann PETIT"></label><label class="form-field">Entreprise / équipe <small>(facultatif)</small><input name="company" autocomplete="organization" value="${escapeHtml(draft.company)}" placeholder="Ex. UO Travaux – SNCF Réseau"></label>`
      : `<label class="form-field">Adresse e-mail<input name="email" type="email" required inputmode="email" autocapitalize="none" spellcheck="false" autocomplete="username" value="${escapeHtml(draft.email)}" placeholder="prenom.nom@exemple.fr"></label><label class="form-field">Mot de passe<input name="password" type="password" required minlength="8" autocomplete="current-password" value="${escapeHtml(draft.password)}" placeholder="Ton mot de passe"></label>`;
    openModal({
      title: creating ? "Créer mon accès" : "Se connecter",
      subtitle: "Aucun code e-mail n’est demandé.",
      body: `<form id="authForm" class="form-grid one" novalidate><p class="form-note">${creating ? "Utilise une adresse à laquelle tu as accès. Si elle était utilisée par l’ancien système à code, prends une autre adresse personnelle ou supprime plus tard le compte de test dans Supabase." : "Saisis l’adresse e-mail et le mot de passe créés dans cette version de l’application."}</p>${formFields}</form><div class="setup-result" id="passwordAuthResult" aria-live="polite"></div>`,
      footer: creating ? `<button class="secondary-button" id="authBackBtn">Retour</button><button class="secondary-button" id="authDemoBtn">Voir la démo</button><button class="primary-button" id="authSubmitBtn">Créer mon accès</button>` : `<button class="secondary-button" id="authBackBtn">Retour</button><button class="secondary-button" id="authForgotBtn">Mot de passe oublié ?</button><button class="secondary-button" id="authDemoBtn">Voir la démo</button><button class="primary-button" id="authSubmitBtn">Se connecter</button>`
    });

    const form = $("authForm"), result = $("passwordAuthResult"), submit = $("authSubmitBtn");
    const showResult = (message, variant = "error") => { result.textContent = message; result.className = `setup-result ${variant}`; };
    const rememberDraft = () => {
      const values = new FormData(form);
      app.authDraft = {
        email: String(values.get("email") || "").trim(), password: String(values.get("password") || ""),
        confirmPassword: String(values.get("confirm_password") || ""), fullName: String(values.get("full_name") || "").trim(), company: String(values.get("company") || "").trim()
      };
      return app.authDraft;
    };
    const credentials = () => {
      const values = rememberDraft();
      if (!/^\S+@\S+\.\S+$/.test(values.email)) { showResult("Saisis une adresse e-mail complète, par exemple nom@domaine.fr."); return null; }
      if (values.password.length < 8) { showResult("Le mot de passe doit contenir au moins 8 caractères."); return null; }
      if (creating && values.password !== values.confirmPassword) { showResult("Les deux mots de passe ne sont pas identiques."); return null; }
      if (creating && !values.fullName) { showResult("Indique ton nom et prénom pour identifier ta demande."); return null; }
      return { email: values.email.toLowerCase(), password: values.password, fullName: values.fullName, company: values.company };
    };
    const run = async () => {
      const values = credentials();
      if (!values) return;
      try {
        submit.disabled = true;
        submit.textContent = creating ? "Création…" : "Connexion…";
        if (creating) {
          const { data, error } = await app.db.auth.signUp({ email: values.email, password: values.password, options: { data: { full_name: values.fullName, company: values.company } } });
          if (error) throw error;
          if (!data.session?.user) showResult("Cette adresse possède déjà un ancien compte ou la confirmation e-mail est encore active. Pour voir l’application tout de suite, clique sur « Voir la démo ».");
        } else {
          const { data, error } = await app.db.auth.signInWithPassword({ email: values.email, password: values.password });
          if (error) throw error;
          if (!data.session?.user) throw new Error("Aucune session n’a été créée.");
        }
      } catch (error) {
        showResult(friendlyError(error));
      } finally {
        submit.disabled = false;
        submit.textContent = creating ? "Créer mon accès" : "Se connecter";
      }
    };
    $$("input", form).forEach(input => input.addEventListener("input", rememberDraft));
    $("authBackBtn").addEventListener("click", () => { rememberDraft(); openPasswordAuthDialog("choice"); });
    $("authDemoBtn").addEventListener("click", startDemoMode);
    $("authForgotBtn")?.addEventListener("click", () => { rememberDraft(); openPasswordResetRequestDialog(); });
    submit.addEventListener("click", run);
    form.addEventListener("submit", event => { event.preventDefault(); run(); });
  }
  function openProfileDialog() {
    const signedIn = isCloudReady(), guest = app.mode === "cloud-guest";
    if (guest || app.mode === "demo") return openPasswordAuthDialog();
    openModal({
      title: signedIn ? "Mon identité" : "Votre identité",
      subtitle: signedIn ? "Elle signe vos messages dans tous vos chantiers." : "Elle apparaît sur les messages enregistrés sur cet appareil.",
      body: `<form id="profileForm" class="form-grid one"><label class="form-field">Nom et prénom<input name="full_name" required value="${escapeHtml(app.profile.full_name || "")}" placeholder="Ex. Yoann PETIT"></label><label class="form-field">Entreprise / équipe<input name="company" value="${escapeHtml(app.profile.company || "")}" placeholder="Ex. UO Travaux – SNCF Réseau"></label>${signedIn ? `<label class="form-field">E-mail<input disabled value="${escapeHtml(app.profile.email || app.user.email || "")}"></label>` : ""}</form>`,
      footer: signedIn ? `<button class="secondary-button" id="changePasswordBtn">Mot de passe</button><button class="secondary-button" id="signOutBtn">Se déconnecter</button><button class="primary-button" id="saveProfileBtn">Enregistrer</button>` : `<button class="secondary-button" id="closeProfileBtn">Fermer</button><button class="primary-button" id="saveProfileBtn">Enregistrer</button>`
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
    if (signedIn) {
      $("changePasswordBtn").addEventListener("click", openChangePasswordDialog);
      $("signOutBtn").addEventListener("click", async () => { await app.db.auth.signOut(); closeModal(); });
    }
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

  function dashboardStatusLabel(account) {
    if (account.global_role === "proprietaire") return "Propriétaire principal";
    if (account.global_role === "administrateur_general") return "Administrateur général";
    if (account.request_status === "en_attente") return "En attente de validation";
    if (account.request_status === "refusee") return "Accès refusé";
    return requestStatusLabel(account.request_status) || "Accès validé";
  }
  function dashboardChantiers(account) {
    const list = Array.isArray(account.chantiers) ? account.chantiers : [];
    if (account.global_role === "administrateur_general") return "Tous les chantiers";
    if (!list.length) return account.granted_chantier_name || "Aucun chantier attribué";
    return list.map(item => `${item.name || "Chantier"} — ${roleLabel(item.role) || item.role || "membre"}`).join(" · ");
  }
  async function verifyJournalOwnerPassword(password) {
    if (!isJournalOwner()) throw new Error("Cette opération est réservée au propriétaire principal.");
    if (!String(password || "").trim()) throw new Error("Saisis ton mot de passe pour confirmer.");
    const ownerId = app.user?.id;
    const { data, error } = await app.db.auth.signInWithPassword({
      email: app.user?.email || app.profile.email,
      password: String(password)
    });
    if (error) throw error;
    if (!data?.user || String(data.user.id) !== String(ownerId)) throw new Error("La confirmation ne correspond pas au compte propriétaire.");
    app.user = data.user;
  }
  async function ownerChantierStoragePaths(chantierId) {
    const { data, error } = await app.db.rpc("list_journal_chantier_storage_paths", { p_chantier_id: chantierId });
    if (error) throw error;
    return (data || []).map(row => typeof row === "string" ? row : row.storage_path).filter(Boolean);
  }
  async function removeOwnerChantierFiles(paths) {
    const bucket = app.db.storage.from(CONFIG.STORAGE_BUCKET || "chantier-files");
    for (let start = 0; start < paths.length; start += 100) {
      const { error } = await bucket.remove(paths.slice(start, start + 100));
      if (error) throw error;
    }
  }
  async function repairOwnerChantierPhotoPreviews(chantier, updateProgress = () => {}) {
    if (!isJournalOwner()) throw new Error("Cette réparation est réservée au propriétaire principal.");
    if (!chantier?.id) throw new Error("Choisis un chantier.");
    if (String(app.currentId) !== String(chantier.id)) await selectChantier(chantier.id);
    const photos = allCurrentAttachments().filter(attachment => fileIsImage(attachment) && attachment.storage_path && !attachment.preview_storage_path);
    if (!photos.length) return { total: 0, repaired: 0 };
    let repaired = 0;
    for (let index = 0; index < photos.length; index += 1) {
      updateProgress(`Optimisation de l’aperçu ${index + 1}/${photos.length}…`);
      if (await repairAttachmentPreview(photos[index], { force: true })) repaired += 1;
    }
    await refreshCloudCurrent();
    return { total: photos.length, repaired };
  }
  function openOwnerDestructiveConfirmation(chantier, operation) {
    const deleting = operation === "delete";
    const confirmationWord = deleting ? "SUPPRIMER" : "RÉINITIALISER";
    const title = deleting ? "Supprimer définitivement le chantier" : "Réinitialiser le fil du chantier";
    const consequences = deleting
      ? "Cette opération efface le chantier, tous ses membres, messages, photos, documents et actions. Elle est définitive."
      : "Cette opération efface tous les messages, photos, documents, réactions et accusés de lecture. Le chantier et ses actions restent en place ; les éventuelles preuves liées aux messages sont retirées.";
    openModal({
      title,
      subtitle: `Chantier concerné : ${chantier.name || "Chantier sans nom"}`,
      body: `<form id="ownerDestructiveForm" class="form-grid one" novalidate><p class="form-note"><b>Action irréversible.</b><br>${escapeHtml(consequences)}</p><label class="form-field">Pour confirmer, écris <b>${confirmationWord}</b><input name="confirmation" required autocapitalize="characters" autocomplete="off" placeholder="${confirmationWord}"></label><label class="form-field">Ton mot de passe propriétaire<input name="password" type="password" required autocomplete="current-password" placeholder="Mot de passe du compte propriétaire"></label></form><div class="setup-result" id="ownerDestructiveResult" aria-live="polite"></div>`,
      footer: `<button class="secondary-button" id="cancelOwnerDestructive">Annuler</button><button class="danger-button" id="confirmOwnerDestructive">${deleting ? "Supprimer définitivement" : "Réinitialiser le fil"}</button>`,
      wide: false
    });
    $("cancelOwnerDestructive").addEventListener("click", openOwnerChantierMaintenanceDialog);
    $("confirmOwnerDestructive").addEventListener("click", async () => {
      const form = $("ownerDestructiveForm");
      const result = $("ownerDestructiveResult");
      const button = $("confirmOwnerDestructive");
      if (!form.reportValidity()) return;
      if (String(form.elements.confirmation.value || "").trim().toLocaleUpperCase("fr-FR") !== confirmationWord) {
        result.className = "setup-result error";
        result.textContent = `Écris exactement « ${confirmationWord} » pour poursuivre.`;
        return;
      }
      try {
        button.disabled = true;
        button.textContent = "Confirmation…";
        await verifyJournalOwnerPassword(form.elements.password.value);
        result.className = "setup-result success";
        result.textContent = "Mot de passe confirmé. Suppression des fichiers sécurisés…";
        const paths = await ownerChantierStoragePaths(chantier.id);
        await removeOwnerChantierFiles(paths);
        result.textContent = deleting ? "Suppression du chantier…" : "Réinitialisation du fil…";
        const { error } = await app.db.rpc(deleting ? "delete_journal_chantier" : "reset_journal_chantier_feed", { p_chantier_id: chantier.id });
        if (error) throw error;
        closeModal(true);
        await refreshCloudChantiers();
        toast(deleting ? "Chantier supprimé définitivement." : "Fil du chantier réinitialisé.", "success");
      } catch (error) {
        button.disabled = false;
        button.textContent = deleting ? "Supprimer définitivement" : "Réinitialiser le fil";
        result.className = "setup-result error";
        result.textContent = friendlyError(error);
      }
    });
  }
  function openOwnerChantierMaintenanceDialog() {
    if (!isJournalOwner()) return toast("Cette maintenance est réservée au propriétaire principal.", "warning");
    if (!app.chantiers.length) return toast("Aucun chantier à gérer.", "warning");
    const selectedId = currentChantier()?.id || app.chantiers[0].id;
    const options = app.chantiers.map(chantier => `<option value="${escapeHtml(chantier.id)}" ${String(chantier.id) === String(selectedId) ? "selected" : ""}>${escapeHtml(chantier.name || "Chantier sans nom")}${chantier.code ? ` — ${escapeHtml(chantier.code)}` : ""}</option>`).join("");
    openModal({
      title: "Maintenance d’un chantier",
      subtitle: "Réservée à ton compte propriétaire et protégée par ton mot de passe.",
      body: `<div class="form-note"><b>À utiliser avec prudence.</b><br>Tu peux optimiser les aperçus des photos déjà publiées, effacer le fil sans supprimer le chantier, ou supprimer définitivement tout le chantier. Les fichiers stockés sont également supprimés.</div><label class="form-field">Chantier concerné<select id="ownerMaintenanceChantier">${options}</select></label><div class="setup-result" id="ownerPhotoRepairResult" aria-live="polite"></div>`,
      footer: `<button class="secondary-button" id="closeOwnerMaintenance">Fermer</button><button class="secondary-button" id="repairOwnerPhotoPreviews">Optimiser les photos</button><button class="secondary-button" id="resetOwnerChantier">Réinitialiser le fil</button><button class="danger-button" id="deleteOwnerChantier">Supprimer le chantier</button>`,
      wide: false
    });
    $("closeOwnerMaintenance").addEventListener("click", closeModal);
    const selectedChantier = () => app.chantiers.find(chantier => String(chantier.id) === String($("ownerMaintenanceChantier").value));
    $("repairOwnerPhotoPreviews").addEventListener("click", async () => {
      const chantier = selectedChantier();
      const button = $("repairOwnerPhotoPreviews"), result = $("ownerPhotoRepairResult");
      if (!chantier) return;
      try {
        button.disabled = true;
        result.className = "setup-result";
        result.textContent = "Recherche des photos à optimiser…";
        const summary = await repairOwnerChantierPhotoPreviews(chantier, text => { result.textContent = text; });
        result.className = "setup-result success";
        result.textContent = summary.total ? `${summary.repaired}/${summary.total} aperçu(s) optimisé(s).` : "Toutes les photos ont déjà un aperçu rapide.";
      } catch (error) {
        result.className = "setup-result error";
        result.textContent = friendlyError(error);
      } finally {
        button.disabled = false;
      }
    });
    $("resetOwnerChantier").addEventListener("click", () => {
      const chantier = selectedChantier();
      if (chantier) openOwnerDestructiveConfirmation(chantier, "reset");
    });
    $("deleteOwnerChantier").addEventListener("click", () => {
      const chantier = selectedChantier();
      if (chantier) openOwnerDestructiveConfirmation(chantier, "delete");
    });
  }
  async function openAdminDashboardDialog() {
    if (!isJournalOwner()) {
      toast("Ce tableau de bord est réservé au propriétaire principal.", "warning");
      return;
    }
    const { data, error } = await app.db.rpc("get_journal_administration_dashboard");
    if (error) throw error;
    const accounts = data || [];
    const counts = {
      pending: accounts.filter(item => item.request_status === "en_attente").length,
      accepted: accounts.filter(item => item.request_status === "acceptee").length,
      refused: accounts.filter(item => item.request_status === "refusee").length
    };
    const chantierOptions = `<option value="">Choisir un chantier…</option>${app.chantiers.map(chantier => `<option value="${escapeHtml(chantier.id)}">${escapeHtml(chantier.name)}${chantier.code ? ` — ${escapeHtml(chantier.code)}` : ""}</option>`).join("")}`;
    const cards = accounts.map(account => {
      const isOwner = account.global_role === "proprietaire";
      const selectedRole = account.global_role || account.granted_role || "membre";
      const selectedChantier = account.granted_chantier_id || "";
      const identity = account.full_name || account.email || "Compte sans nom";
      if (isOwner) return `<section class="dialog-item access-request" style="display:block"><div style="display:flex;gap:10px;align-items:center"><span class="mini-avatar">${escapeHtml(initial(identity))}</span><span><b>${escapeHtml(identity)}</b><small>${escapeHtml(account.email || "")} · ${escapeHtml(dashboardStatusLabel(account))}</small></span></div><p style="margin:12px 0 0;font-size:13px;color:var(--muted)">Compte protégé : propriétaire principal de l’application.</p></section>`;
      return `<section class="dialog-item access-request" data-dashboard-user-id="${escapeHtml(account.user_id)}" style="display:block"><div style="display:flex;gap:10px;align-items:center"><span class="mini-avatar">${escapeHtml(initial(identity))}</span><span><b>${escapeHtml(identity)}</b><small>${escapeHtml(account.email || "")} · ${escapeHtml(dashboardStatusLabel(account))}</small></span></div><p style="margin:10px 0 0;font-size:12px;color:var(--muted)">Accès actuel : ${escapeHtml(dashboardChantiers(account))}</p><div class="form-grid" style="margin-top:12px"><label class="form-field">Niveau de droit<select data-dashboard-role><option value="membre" ${selectedRole === "membre" ? "selected" : ""}>Contributeur — lire, écrire, ajouter des documents</option><option value="lecture" ${selectedRole === "lecture" ? "selected" : ""}>Lecture seule — consulter et exporter</option><option value="administrateur" ${selectedRole === "administrateur" ? "selected" : ""}>Administrateur du chantier</option><option value="administrateur_general" ${selectedRole === "administrateur_general" ? "selected" : ""}>Administrateur général — tous les chantiers</option></select></label><label class="form-field">Chantier<select data-dashboard-chantier ${selectedRole === "administrateur_general" ? "disabled" : ""}>${chantierOptions.replace(`value="${escapeHtml(selectedChantier)}"`, `value="${escapeHtml(selectedChantier)}" selected`)}</select></label></div><div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px"><button class="secondary-button" data-dashboard-revoke>Retirer l’accès</button><button class="primary-button" data-dashboard-save>Enregistrer les droits</button></div></section>`;
    }).join("") || `<div class="empty-state"><div class="empty-icon">♙</div><h3>Aucun compte recensé</h3><p>Les comptes apparaîtront ici après leur première connexion.</p></div>`;
    openModal({
      title: "Administration du journal",
      subtitle: "Tableau de bord du propriétaire principal : comptes, statuts et niveaux de droit.",
      body: `<div class="form-note"><b>${accounts.length} compte(s)</b> · ${counts.pending} en attente · ${counts.accepted} validé(s) · ${counts.refused} refusé(s).<br>Les droits enregistrés ici sont appliqués immédiatement dans Supabase.</div><div class="dialog-list" style="margin-top:14px">${cards}</div>`,
      footer: `<button class="secondary-button" id="dashboardPendingBtn">Demandes en attente</button>${app.chantiers.length ? `<button class="secondary-button" id="dashboardMaintenanceBtn">Maintenance chantier</button>` : ""}<button class="primary-button" id="closeAdminDashboard">Fermer</button>`,
      wide: true
    });
    $("closeAdminDashboard").addEventListener("click", closeModal);
    $("dashboardPendingBtn").addEventListener("click", () => { closeModal(); openAccessManagementDialog().catch(error => toast(friendlyError(error), "error")); });
    $("dashboardMaintenanceBtn")?.addEventListener("click", openOwnerChantierMaintenanceDialog);
    $$('[data-dashboard-role]').forEach(select => select.addEventListener("change", () => {
      const card = select.closest("[data-dashboard-user-id]");
      const chantier = card.querySelector("[data-dashboard-chantier]");
      chantier.disabled = select.value === "administrateur_general";
    }));
    $$('[data-dashboard-save]').forEach(button => button.addEventListener("click", async () => {
      const card = button.closest("[data-dashboard-user-id]");
      const role = card.querySelector("[data-dashboard-role]").value;
      const chantierId = card.querySelector("[data-dashboard-chantier]").value || null;
      if (role !== "administrateur_general" && !chantierId) {
        toast("Choisis un chantier pour cet utilisateur.", "warning");
        return;
      }
      try {
        button.disabled = true;
        button.textContent = "Enregistrement…";
        const { error: saveError } = await app.db.rpc("set_journal_user_access", { p_user_id: card.dataset.dashboardUserId, p_role: role, p_chantier_id: chantierId });
        if (saveError) throw saveError;
        toast("Droits mis à jour.", "success");
        await refreshAccessContext();
        await refreshCloudChantiers();
        closeModal();
        await openAdminDashboardDialog();
      } catch (error) {
        button.disabled = false;
        button.textContent = "Enregistrer les droits";
        toast(`Mise à jour impossible : ${friendlyError(error)}`, "error");
      }
    }));
    $$('[data-dashboard-revoke]').forEach(button => button.addEventListener("click", async () => {
      const card = button.closest("[data-dashboard-user-id]");
      if (!window.confirm("Retirer tous les accès de ce compte ?")) return;
      try {
        button.disabled = true;
        const { error: revokeError } = await app.db.rpc("revoke_journal_user_access", { p_user_id: card.dataset.dashboardUserId });
        if (revokeError) throw revokeError;
        toast("Accès retiré.", "success");
        closeModal();
        await openAdminDashboardDialog();
      } catch (error) {
        button.disabled = false;
        toast(`Retrait impossible : ${friendlyError(error)}`, "error");
      }
    }));
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
      body: `<form id="planForm" class="form-grid"><label class="form-field span-2">Fichier *<input name="file" type="file" required accept="image/*,application/pdf,.pdf,.doc,.docx,.xls,.xlsx,.dwg,.dxf"></label><label class="form-field">Catégorie<select name="plan_category"><option>Plan validé</option><option>À diffuser</option><option>Étude</option><option>Schéma</option><option>Document</option></select></label><label class="form-field">Indice / version<input name="revision" placeholder="Ex. Indice B"></label><label class="form-field">Zone / PK<input name="zone" placeholder="Ex. V2M – PK 80,050"></label><label class="form-field">Statut<select name="plan_status"><option>À diffuser</option><option>Validé</option><option>Pour information</option><option>Obsolète</option></select></label><label class="form-field span-2">Commentaire dans le journal *<textarea name="comment" required placeholder="Ex. Plan de principe à utiliser pour la préparation de nuit."></textarea></label></form>`,
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
          body: values.comment, message_type: "Plan", zone: values.zone,
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
      body: `<form id="actionForm" class="form-grid"><label class="form-field span-2">Action à réaliser *<input name="title" required value="${escapeHtml(sourceMessage ? truncate(sourceMessage.body || "", 150) : "")}" placeholder="Ex. Faire valider le plan d’exécution"></label><label class="form-field span-2">Détail / contexte<textarea name="description">${escapeHtml(sourceMessage ? `Issue du message de ${sourceMessage.author_name} du ${formatDateTime(sourceMessage.created_at)}.` : "")}</textarea></label><label class="form-field">Attribuée à<input name="assignee" placeholder="Nom / entreprise"></label><label class="form-field">Échéance<input name="due_date" type="date"></label><label class="form-field">Priorité<select name="priority"><option value="normale">Normale</option><option value="haute">Haute</option><option value="critique">Critique</option><option value="basse">Basse</option></select></label></form>`,
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
  function openActionCompletionDialog(action) {
    openModal({
      title: "Clôturer l’action",
      subtitle: "Une preuve ou un commentaire de clôture reste tracé dans le journal.",
      body: `<form id="actionCompletionForm" class="form-grid"><label class="form-field span-2">Commentaire de clôture *<textarea name="note" required placeholder="Ex. Contrôle réalisé sur site, conforme au plan Indice B."></textarea></label><label class="form-field span-2">Photo ou fichier de preuve (facultatif)<input name="proof" type="file" accept="image/*,application/pdf,.pdf,.doc,.docx,.xls,.xlsx"></label></form>`,
      footer: `<button class="secondary-button" id="cancelActionCompletion">Annuler</button><button class="primary-button" id="saveActionCompletion">Clôturer l’action</button>`
    });
    $("cancelActionCompletion").addEventListener("click", closeModal);
    $("saveActionCompletion").addEventListener("click", async () => {
      const form = $("actionCompletionForm");
      if (!form.reportValidity()) return;
      const note = String(form.elements.note.value || "").trim();
      const proof = form.elements.proof.files[0];
      try {
        let proofMessage = null;
        if (proof) proofMessage = await addMessage({ body: `Preuve de clôture — ${action.title}\n${note}`, message_type: "Action", zone: "", reply_to: action.message_id || null, is_important: true }, [{ file: proof }], { category: "action_proof" });
        else proofMessage = await addMessage({ body: `Clôture d’action — ${action.title}\n${note}`, message_type: "Action", zone: "", reply_to: action.message_id || null, is_important: true });
        closeModal();
        await setActionStatus(action, "terminee", { note, messageId: proofMessage?.id || null });
      } catch (error) { toast(`Clôture impossible : ${error.message}`, "error"); }
    });
  }
  function openQuickAddDialog() {
    if (app.mode === "cloud-guest") return openProfileDialog();
    if (!currentChantier()) return openNewChantierDialog();
    openModal({
      title: "Ajout rapide terrain",
      subtitle: "Consigne une information, une alerte ou une photo sans quitter le chantier.",
      body: `<form id="quickAddForm" class="form-grid"><label class="form-field">Type<select name="message_type"><option value="Info">Information</option><option value="Journal">Journal / poste</option><option value="Sécurité">Sécurité</option><option value="Incident">Incident / vigilance</option><option value="Avancement">Avancement</option><option value="Aléa">Aléa</option><option value="Coactivité">Coactivité</option><option value="Décision">Décision</option></select></label><label class="form-field">Zone / voie / PK<input name="zone" placeholder="Ex. V2M – PK 80,190"></label><label class="form-field span-2">Information *<textarea name="body" required placeholder="Décris le fait constaté, l’action menée ou la consigne."></textarea></label><label class="form-field span-2">Photo / fichier (facultatif)<input name="file" type="file" accept="image/*,application/pdf,.pdf,.doc,.docx" capture="environment"><small>Une photo prise depuis le téléphone s’ouvre directement ici.</small></label><label class="form-field span-2"><span><input name="is_important" type="checkbox"> Épingler comme information permanente</span></label></form>`,
      footer: `<button class="secondary-button" id="cancelQuickAdd">Annuler</button><button class="primary-button" id="saveQuickAdd">Ajouter au journal</button>`
    });
    $("cancelQuickAdd").addEventListener("click", closeModal);
    $("saveQuickAdd").addEventListener("click", async () => {
      const form = $("quickAddForm");
      if (!form.reportValidity()) return;
      const values = Object.fromEntries(new FormData(form).entries());
      const file = form.elements.file.files[0];
      try {
        await addMessage({ body: values.body, message_type: values.message_type, zone: values.zone, is_important: form.elements.is_important.checked }, file ? [{ file }] : []);
        closeModal(); setActiveTab("chat"); toast("Information terrain ajoutée au journal.", "success");
      } catch (error) { toast(`Ajout impossible : ${error.message}`, "error"); }
    });
  }
  function openExportDialog() {
    if (!currentChantier()) return openNewChantierDialog();
    openModal({
      title: "Exporter le journal",
      subtitle: "Le PDF reprend les messages, photos et la liste des documents dans l’ordre chronologique.",
      body: `<form id="exportForm" class="form-grid"><p class="form-note span-2">Par défaut, l’impression contient <b>toute la discussion du chantier</b>. À l’étape suivante, sélectionne « Enregistrer au format PDF » dans l’écran d’impression du téléphone ou du navigateur.</p><label class="form-field">Du<input name="from" type="date"></label><label class="form-field">Au<input name="to" type="date"></label><label class="form-field span-2">Contenu<select name="scope"><option value="all">Tous les messages</option><option value="important">Messages importants uniquement</option></select></label><label class="form-field span-2"><span><input name="include_pilotage" type="checkbox" checked> Ajouter une synthèse de pilotage en première page</span></label></form>`,
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
  async function openAttachment(attachment) {
    let url = fullAttachmentUrl(attachment);
    const name = attachment.file_name || attachment.name || "Pièce jointe";
    if (fileIsImage(attachment) && isCloudReady() && attachment.storage_path) {
      try { url = await refreshAttachmentUrl(attachment, false); }
      catch (error) { console.warn("Lien photo non renouvelé", error); }
    }
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
    } else if (action === "annotate-pending") {
      openImageAnnotationDialog(element.dataset.index);
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
    } else if (action === "open-reactions") {
      const message = messageById(element.dataset.messageId);
      if (message) openReactionPicker(message);
    } else if (action === "toggle-reaction") {
      const message = messageById(element.dataset.messageId);
      if (message) await toggleReaction(message, element.dataset.emoji);
    } else if (action === "message-menu") {
      const message = messageById(element.dataset.messageId);
      if (message) openMessageMenu(message);
    } else if (action === "jump-message") {
      jumpToMessage(element.dataset.messageId);
    } else if (action === "open-image" || action === "open-attachment") {
      const attachment = findAttachment(element.dataset.attachmentId);
      if (attachment) await openAttachment(attachment);
    } else if (action === "action-menu") {
      const item = activeActionsFor(app.currentId).find(actionItem => String(actionItem.id) === String(element.dataset.actionId));
      if (item) openActionMenu(item);
    } else if (action === "open-daily-log") {
      const item = dailyLogById(element.dataset.dailyLogId);
      if (item) openDailyLogDetails(item);
    } else if (action === "open-risk") {
      const item = riskById(element.dataset.riskId);
      if (item) openRiskDetails(item);
    } else if (action === "open-alert-center") {
      openAlertCenter();
    } else if (action === "open-alert-action") {
      const item = activeActionsFor(app.currentId).find(actionItem => String(actionItem.id) === String(element.dataset.actionId));
      if (item) { closeModal(); setActiveTab("actions"); setTimeout(() => openActionMenu(item), 60); }
    }
  }
  function wireEvents() {
    $("newChantierBtn").addEventListener("click", openNewChantierDialog);
    $("profileBtn").addEventListener("click", openProfileDialog);
    els.adminDashboardBtn.addEventListener("click", () => openAdminDashboardDialog().catch(error => toast(`Administration indisponible : ${friendlyError(error)}`, "error")));
    els.mobileAdminDashboardBtn.addEventListener("click", () => {
      els.appShell.classList.remove("sidebar-open");
      openAdminDashboardDialog().catch(error => toast(`Administration indisponible : ${friendlyError(error)}`, "error"));
    });
    $("siteInfoBtn").addEventListener("click", openSiteInfoDialog);
    $("inviteBtn").addEventListener("click", openInviteDialog);
    $("notificationBtn").addEventListener("click", openAlertCenter);
    $("quickAddBtn").addEventListener("click", openQuickAddDialog);
    $("exportBtn").addEventListener("click", openExportDialog);
    $("siteMenuBtn").addEventListener("click", openSiteInfoDialog);
    $("addPlanBtn").addEventListener("click", openPlanDialog);
    $("addActionBtn").addEventListener("click", () => openActionDialog());
    $("addDailyLogBtn").addEventListener("click", openDailyLogDialog);
    $("openDailyLogBtn").addEventListener("click", openDailyLogDialog);
    $("addRiskBtn").addEventListener("click", openRiskDialog);
    $("openRiskBtn").addEventListener("click", openRiskDialog);
    els.advancedSearchBtn.addEventListener("click", openAdvancedSearchDialog);
    els.openSetupBtn.addEventListener("click", () => location.reload());
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
    els.composerMetaBtn.addEventListener("click", () => { setComposerToolTray(false); els.composerMeta.hidden = !els.composerMeta.hidden; });
    els.composerToolsBtn.addEventListener("click", () => { els.composerMeta.hidden = true; setComposerToolTray(els.composerToolTray.hidden); });
    $("emojiBtn").addEventListener("click", () => { setComposerToolTray(false); return app.mode === "cloud-guest" ? openProfileDialog() : openEmojiPicker(); });
    $("mentionBtn").addEventListener("click", () => { setComposerToolTray(false); return app.mode === "cloud-guest" ? openProfileDialog() : openMentionPicker(); });
    $("dictationBtn").addEventListener("click", () => { setComposerToolTray(false); return app.mode === "cloud-guest" ? openProfileDialog() : toggleDictation(); });
    $("polishBtn").addEventListener("click", polishComposerText);
    $("attachBtn").addEventListener("click", () => { setComposerToolTray(false); return app.mode === "cloud-guest" ? openProfileDialog() : els.fileInput.click(); });
    $("cameraBtn").addEventListener("click", () => { setComposerToolTray(false); return app.mode === "cloud-guest" ? openProfileDialog() : els.cameraInput.click(); });
    els.fileInput.addEventListener("change", () => { queueFiles([...els.fileInput.files]); els.fileInput.value = ""; });
    els.cameraInput.addEventListener("change", () => { queueFiles([...els.cameraInput.files]); els.cameraInput.value = ""; });
    $("sendBtn").addEventListener("click", sendComposerMessage);
    els.messageInput.addEventListener("input", () => {
      els.messageInput.style.height = "auto";
      els.messageInput.style.height = `${Math.min(els.messageInput.scrollHeight, 108)}px`;
    });
    els.messageInput.addEventListener("keydown", event => {
      if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendComposerMessage(); }
    });
    [els.messageFeed, els.attachmentPreview, els.replyPreview, els.planGrid, els.actionBoard, els.pinnedMessages, els.pilotageAlerts, els.dailyLogList, els.riskList, els.modalBody].forEach(target => target.addEventListener("click", handleDynamicClick));
    els.messageFeed.addEventListener("scroll", () => {
      els.jumpBottomBtn.hidden = els.messageFeed.scrollHeight - els.messageFeed.scrollTop - els.messageFeed.clientHeight < 100;
    });
    els.jumpBottomBtn.addEventListener("click", scrollMessagesToBottom);
    $$(".filter-pill").forEach(button => button.addEventListener("click", () => {
      app.planFilter = button.dataset.planFilter;
      $$(".filter-pill").forEach(pill => pill.classList.toggle("active", pill === button));
      renderPlans();
    }));
    els.modalCloseBtn.addEventListener("click", closeModal);
    els.modalBackdrop.addEventListener("click", event => { if (event.target === els.modalBackdrop) closeModal(); });
    document.addEventListener("keydown", event => {
      if (els.modalBackdrop.hidden) return;
      const field = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
      const atBeginning = field && event.target.selectionStart === 0 && event.target.selectionEnd === 0;
      if (event.key === "Backspace" && atBeginning && !event.target.value) {
        // Empêche le navigateur de traiter Retour arrière comme un retour de page
        // quand le champ est vide ou que le curseur est déjà au début.
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (event.key === "BrowserBack" || (event.altKey && event.key === "ArrowLeft")) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (event.key === "Escape") closeModal();
    }, true);
    window.addEventListener("popstate", () => {
      if (app.closingModal) { app.closingModal = false; return; }
      if (!els.modalBackdrop.hidden) {
        history.pushState({ ...(history.state || {}), journalModal: true }, document.title, location.href);
        app.modalHistoryActive = true;
        return;
      }
      if (app.recoveryPending && !app.recoveryHandled) {
        history.pushState({ journalRecovery: true }, document.title, location.href);
        openPasswordRecoveryDialog();
      }
    });
    window.addEventListener("online", () => toast("Connexion réseau rétablie.", "success"));
    window.addEventListener("offline", () => toast("Hors ligne : les données locales restent consultables.", "warning"));
  }
  async function initialize() {
    wireEvents();
    const callbackError = takeAuthCallbackError();
    if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("./service-worker-v13.js?v=13.2").catch(error => console.warn("Service worker", error));
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
