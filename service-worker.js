const CACHE_NAME = 'filmimnerede-v77';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/style.css?v=50',
  '/js/runtime/config.js?v=1',
  '/js/runtime/state.js?v=1',
  '/js/runtime/router.js?v=1',
  '/js/runtime/shared-ui.js?v=2',
  '/js/runtime/providers.js?v=1',
  '/js/runtime/platform.js?v=4',
  '/js/runtime/search.js?v=2',
  '/js/runtime/movie.js?v=3',
  '/js/runtime/actor.js?v=4',
  '/js/runtime/home.js?v=3',
  '/js/runtime/profile.js?v=2',
  '/js/runtime/misc.js?v=6',
  '/app.js?v=72'
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

  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Cache the fresh response
        const clonedResponse = response.clone();
        caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, clonedResponse);
        });
        return response;
      })
      .catch(() => {
        // If network fails, try the cache
        return caches.match(event.request);
      })
  );
});

// Activate event: clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cache => {
          if (cache !== CACHE_NAME) {
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});
