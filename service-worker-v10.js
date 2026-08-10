const CACHE_NAME = "journal-chantier-connecte-v10";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles-v10.css",
  "./app-v10.js",
  "./config.js",
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
