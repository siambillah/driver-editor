const CACHE_NAME = 'sb-editor-text-v5';
const APP_SHELL = [
  './',
  './index.html',
  './favicon.ico',
  './css/style.css',
  './js/main.js',
  './js/drive.js',
  './js/tools.js',
  './js/suggestions.js',
  './js/modals.js',
  './js/explorer.js',
  './manifest.json',
  './assets/icon.svg',
  './assets/favicon-32x32.png',
  './assets/apple-touch-icon.png',
  './assets/icon-192.png',
  './assets/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never cache Google Auth / Google Drive API calls or non-GET requests
  if (
    event.request.method !== 'GET' ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('accounts.google.com')
  ) {
    return;
  }

  // Network-first for same-origin app files so updates arrive quickly, fallback to cache offline
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return res;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Cache-first for CDN libraries (CodeMirror, Marked, Highlight.js, js-beautify, etc.)
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((res) => {
          if (res && (res.status === 200 || res.type === 'opaque')) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return res;
        })
        .catch(() => cached);
    })
  );
});
