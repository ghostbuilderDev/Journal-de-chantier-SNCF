(() => {
  "use strict";
  const DB_NAME = "journal-chantier-v16";
  const DB_VERSION = 1;
  const MAX_MEDIA = 120;
  const objectUrls = new Map();

  function openDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("feeds")) db.createObjectStore("feeds");
        if (!db.objectStoreNames.contains("media")) db.createObjectStore("media", { keyPath: "path" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Cache local indisponible"));
    });
  }
  async function transact(storeName, mode, operation) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const request = operation(tx.objectStore(storeName));
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => db.close();
      tx.onabort = () => { db.close(); reject(tx.error); };
    });
  }
  const feedKey = (userId, chantierId) => `${userId || "anonymous"}:${chantierId}`;
  async function readFeed(userId, chantierId) {
    return transact("feeds", "readonly", store => store.get(feedKey(userId, chantierId))).catch(() => null);
  }
  async function writeFeed(userId, chantierId, messages) {
    const clean = JSON.parse(JSON.stringify(messages || [], (key, value) => /signed_url|data_url/.test(key) ? undefined : value));
    return transact("feeds", "readwrite", store => store.put({ savedAt: Date.now(), messages: clean.slice(-500) }, feedKey(userId, chantierId))).catch(() => null);
  }
  async function mediaUrl(path) {
    if (!path) return "";
    if (objectUrls.has(path)) return objectUrls.get(path);
    const row = await transact("media", "readonly", store => store.get(path)).catch(() => null);
    if (!row?.blob) return "";
    const url = URL.createObjectURL(row.blob);
    objectUrls.set(path, url);
    void transact("media", "readwrite", store => store.put({ ...row, touchedAt: Date.now() })).catch(() => null);
    return url;
  }
  async function remember(path, url) {
    if (!path || !url || String(url).startsWith("blob:")) return false;
    const response = await fetch(url, { cache: "force-cache" });
    if (!response.ok) return false;
    const blob = await response.blob();
    await transact("media", "readwrite", store => store.put({ path, blob, touchedAt: Date.now(), bytes: blob.size }));
    void trim();
    return true;
  }
  async function trim() {
    const db = await openDb();
    const tx = db.transaction("media", "readwrite");
    const store = tx.objectStore("media");
    const rows = await new Promise(resolve => { const r = store.getAll(); r.onsuccess = () => resolve(r.result || []); r.onerror = () => resolve([]); });
    rows.sort((a, b) => (b.touchedAt || 0) - (a.touchedAt || 0)).slice(MAX_MEDIA).forEach(row => store.delete(row.path));
    db.close();
  }
  async function clearUser(userId) {
    const db = await openDb();
    const tx = db.transaction("feeds", "readwrite");
    const store = tx.objectStore("feeds");
    const keys = await new Promise(resolve => { const r = store.getAllKeys(); r.onsuccess = () => resolve(r.result || []); r.onerror = () => resolve([]); });
    keys.filter(key => String(key).startsWith(`${userId}:`)).forEach(key => store.delete(key));
    db.close();
  }
  window.JournalMediaCache = { readFeed, writeFeed, mediaUrl, remember, clearUser };
})();
