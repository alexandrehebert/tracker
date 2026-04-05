const STATIC_CACHE = 'tracker-static-v3';
const RUNTIME_CACHE = 'tracker-runtime-v3';
const OFFLINE_URL = '/offline.html';

const PRECACHE_URLS = [
  OFFLINE_URL,
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== STATIC_CACHE && key !== RUNTIME_CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const responseClone = response.clone();

          event.waitUntil(
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, responseClone))
          );

          return response;
        })
        .catch(async () => {
          const cachedResponse = await caches.match(request);

          return cachedResponse || caches.match(OFFLINE_URL);
        })
    );

    return;
  }

  const requestUrl = new URL(request.url);

  if (requestUrl.origin !== self.location.origin) {
    return;
  }

  // Never cache Next internals/data requests to avoid stale JS/RSC payloads
  // being mixed with fresh HTML, which can trigger hydration mismatches.
  if (
    requestUrl.pathname.startsWith('/_next/')
    || requestUrl.pathname.startsWith('/api/')
    || requestUrl.pathname === '/sw.js'
    || requestUrl.searchParams.has('_rsc')
    || requestUrl.searchParams.has('__nextDataReq')
  ) {
    return;
  }

  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      const networkResponse = fetch(request)
        .then((response) => {
          if (response.ok) {
            const responseClone = response.clone();
            event.waitUntil(
              caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, responseClone))
            );
          }

          return response;
        })
        .catch(() => cachedResponse);

      return cachedResponse || networkResponse;
    })
  );
});