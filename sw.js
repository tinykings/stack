const CACHE_NAME = 'stack-v7.10';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './images/icon-192.png',
  './images/icon-512.png'
];

const SCOPE_PATH = new URL('./', self.location.href).pathname;
const APP_SHELL_PATHS = new Set([
  SCOPE_PATH,
  `${SCOPE_PATH}index.html`,
  `${SCOPE_PATH}style.css`,
  `${SCOPE_PATH}app.js`
]);

function isHtmlRequest(request) {
  if (request.mode === 'navigate') return true;
  if (request.destination === 'document') return true;
  return request.headers.get('accept')?.includes('text/html');
}

function isAppShellAsset(url) {
  return url.origin === self.location.origin && APP_SHELL_PATHS.has(url.pathname);
}

function networkFirst(request, fallbackToAppShell = false) {
  return fetch(request)
    .then(response => {
      if (response && response.ok) {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
      }
      return response;
    })
    .catch(() => (
      caches.match(request)
        .then(cached => {
          if (cached || !fallbackToAppShell) return cached;
          return caches.match('./index.html').then(appShell => appShell || caches.match('./'));
        })
    ));
}

// Install: pre-cache app shell
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activate: clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// Fetch: network-first for app shell, cache-first for durable assets
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Network-only for GitHub API (gist sync)
  if (url.hostname === 'api.github.com') return;

  // Network-first for navigations and HTML, with cached app shell fallback
  if (isHtmlRequest(event.request)) {
    event.respondWith(networkFirst(event.request, true));
    return;
  }

  // Network-first for unversioned app shell code so app deploys are fresh
  if (isAppShellAsset(url)) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // Network-first for Google Fonts (they have their own long cache headers)
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Cache-first for other durable static assets
  event.respondWith(
    caches.match(event.request)
      .then(cached => cached || fetch(event.request))
  );
});
