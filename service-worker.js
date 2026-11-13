const CACHE_NAME = 'filmimnerede-v100';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/style.css?v=55',
  '/js/runtime/config.js?v=1',
  '/js/runtime/security.js?v=3',
  '/js/runtime/state.js?v=1',
  '/js/runtime/router.js?v=5',
  '/js/runtime/shared-ui.js?v=8',
  '/js/runtime/providers.js?v=3',
  '/js/runtime/platform.js?v=8',
  '/js/runtime/search.js?v=3',
  '/js/runtime/movie.js?v=9',
  '/js/runtime/actor.js?v=9',
  '/js/runtime/home.js?v=9',
  '/js/runtime/profile.js?v=7',
  '/js/runtime/misc.js?v=10',
  '/app.js?v=74',
  '/assets/icons/icon-192.png',
  '/assets/icons/icon-512.png',
  '/assets/icons/icon-maskable-192.png',
  '/assets/icons/icon-maskable-512.png'
];

// Install event: cache assets
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
});

// Fetch event: network first, fallback to cache
self.addEventListener('fetch', event => {
  // Only handle GET requests for our origin
  if (event.request.method !== 'GET' || !event.request.url.startsWith(self.location.origin)) {
    return;
  }

  const requestUrl = new URL(event.request.url);

  // Server-side Netlify response'ları
  // application offline cache'ine alınmaz.
  if (requestUrl.pathname.startsWith('/.netlify/')) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response && response.status === 200 && response.type === 'basic') {
          const clonedResponse = response.clone();
          event.waitUntil(
            caches.open(CACHE_NAME)
              .then(cache => cache.put(event.request, clonedResponse))
              .catch(() => {})
          );
        }
        return response;
      })
      .catch(() => {
        return caches.match(event.request.mode === 'navigate' ? '/index.html' : event.request).then(cached => {
          if (cached) return cached;
          return new Response('Çevrimdışı: İçerik önbellekte bulunamadı.', {
            status: 503,
            statusText: 'Service Unavailable',
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
          });
        });
      })
  );
});

// Activate event: clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cache => {
          if (cache.startsWith('filmimnerede-') && cache !== CACHE_NAME) {
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});
