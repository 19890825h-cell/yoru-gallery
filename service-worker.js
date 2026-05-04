const CACHE_NAME = 'nocturne-pwa-v1';
const APP_SHELL = [
  './',
  './index.html',
  './yoru3.html',
  './yoru-gallery3.html',
  './site-icon.png',
  './pwa-manifest.webmanifest',
  './icons/pwa-icon-192.png',
  './icons/pwa-icon-512.png',
  './icons/pwa-icon-maskable-512.png'
];

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
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if(event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      if(cached) return cached;

      return fetch(event.request).then(response => {
        const copy = response.clone();

        if(response.ok && shouldRuntimeCache(event.request, response)){
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        }

        return response;
      }).catch(() => {
        if(event.request.mode === 'navigate'){
          return caches.match('./index.html').then(response => response || caches.match('./yoru-gallery3.html'));
        }
        throw new Error('Network request failed and no cached response is available.');
      });
    })
  );
});

function shouldRuntimeCache(request, response){
  const url = new URL(request.url);
  const type = response.headers.get('content-type') || '';

  return url.origin === self.location.origin ||
    type.startsWith('image/') ||
    type.includes('font') ||
    url.hostname === 'fonts.googleapis.com' ||
    url.hostname === 'fonts.gstatic.com';
}
