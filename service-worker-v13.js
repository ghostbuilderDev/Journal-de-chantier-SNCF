const CACHE_NAME = "journal-chantier-connecte-v13.3-docs";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles-v13.css?v=13.3-docs",
  "./app-v13.js?v=13.3-docs",
  "./supabase.js?v=13.3-docs",
  "./config.js?v=13.3-docs",
  "./manifest.webmanifest",
  "./journal-chantier.svg"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const request = event.request;
  event.respondWith(
    fetch(request)
      .then(response => {
        if (response && response.ok && new URL(request.url).origin === self.location.origin) {
          caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
        }
        return response;
      })
      .catch(() => caches.match(request))
      .then(response => response || new Response("Hors ligne", { status: 503, statusText: "Service Unavailable" }))
  );
});
