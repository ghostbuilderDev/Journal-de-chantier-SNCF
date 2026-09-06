const CACHE_NAME = "journal-chantier-connecte-v14.3-design";
const APP_SHELL = [
  "./", "./index.html", "./styles-v13.css?v=14.2-collaborateurs",
  "./styles-v14.3.css?v=14.3-design",
  "./app-v13.js?v=14.2-collaborateurs", "./supabase.js?v=14.2-collaborateurs",
  "./config.js?v=14.2-collaborateurs", "./manifest.webmanifest", "./journal-chantier-logo-v14.png"
];
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  // Activate at the next close/reopen, so an in-progress form is not replaced.
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith("journal-chantier-connecte-") && key !== CACHE_NAME)
    .map(key => caches.delete(key)))));
});
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const request = event.request, url = new URL(request.url);
  // Auth and Storage requests are handled directly by the browser, never cached.
  if (url.origin !== self.location.origin) return;
  event.respondWith(fetch(request).then(response => {
    if (response?.ok) {
      const clone = response.clone();
      event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.put(request, clone)));
    }
    return response;
  }).catch(async () => (await caches.match(request)) || new Response("Hors ligne", { status: 503 })));
});
