/*
 * Briefing au pied de l'opération — PWA finale
 *
 * Stratégie réseau d'abord : la version publiée est toujours privilégiée.
 * Le cache ne conserve que des réponses sûres du périmètre de l'application,
 * sans paramètres d'URL, afin d'éviter les entrées de cache non maîtrisées.
 */
const CACHE_PREFIX = 'briefing-pwa-pages-';
const CACHE_NAME = 'briefing-pwa-pages-v15102-presence';
const APP_SHELL = [
  './presence-matching.js?v=15.10.2', './presence-review.js?v=15.10.2', './presence-review.css?v=15.10.2',
  './afficher-qr.html', './afficher-qr.js?v=15.9', './briefing-qr-share.js?v=15.9', './briefing-v159.css?v=15.9',
  './',
  './index.html',
  './manifest.json',
  './signer.html', './signer.js?v=15.10.1', './signature-pad.js?v=15.10.1', './signer-v15101.css?v=15.10.1', './briefing-v158.css?v=15.8',
  './journal-bridge.js?v=15.8', './briefing-preparation.js?v=15.8', './briefing-attendance.js?v=15.10.2', './vendor/qrcodegen.js?v=15.8',
  './icon-192-v19b.png',
  './icon-512-v19b.png',
  './vendor/html2canvas.min.js',
  './vendor/jspdf.umd.min.js'
];

const SCOPE_URL = new URL(self.registration.scope);
const APP_SHELL_URLS = new Set(
  APP_SHELL.map(path => new URL(path, SCOPE_URL).href)
);

function isInAppScope(url) {
  return url.origin === self.location.origin &&
    url.pathname.startsWith(SCOPE_URL.pathname);
}

function isSafeAppRequest(request, url) {
  if (request.method !== 'GET') return false;
  if (!isInAppScope(url)) return false;
  return ['','document','script','style','image','font','manifest'].includes(request.destination);
}

function canCache(request, url, response) {
  if (!response || !response.ok || response.type !== 'basic') return false;
  if (url.search) return false;
  if (!isSafeAppRequest(request, url)) return false;

  const cacheControl = response.headers.get('Cache-Control') || '';
  return !/no-store/i.test(cacheControl);
}

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);

  if (!isSafeAppRequest(request, url)) return;

  event.respondWith((async () => {
    try {
      const fresh = await fetch(request, { cache: 'no-store' });

      if (canCache(request, url, fresh)) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, fresh.clone());
      }

      return fresh;
    } catch (error) {
      const cache = await caches.open(CACHE_NAME);
      const saved = await cache.match(request);
      if (saved) return saved;

      if (request.mode === 'navigate') {
        const shell = await cache.match(url.pathname.endsWith('/signer.html') ? './signer.html' : url.pathname.endsWith('/afficher-qr.html') ? './afficher-qr.html' : './index.html');
        if (shell) return shell;
      }

      return new Response('Application indisponible hors connexion.', {
        status: 503,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store'
        }
      });
    }
  })());
});
