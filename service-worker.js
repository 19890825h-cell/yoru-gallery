const CACHE_NAME = 'nocturne-pwa-v5';
const APP_SHELL = [
  './',
  './index.html',
  './yoru3.html',
  './yoru-gallery3.html',
  './site-icon.png?v=20260504',
  './pwa-manifest.webmanifest?v=20260504',
  './fonts/FOT-RodinWanpaku-Pro-EB.otf?v=20260511',
  './icons/pwa-icon-192.png?v=20260504',
  './icons/pwa-icon-512.png?v=20260504',
  './icons/pwa-icon-maskable-512.png?v=20260504'
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

  if(event.request.mode === 'navigate' || isHtmlRequest(event.request)){
    event.respondWith(networkFirst(event.request));
    return;
  }

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

function networkFirst(request){
  return fetch(request).then(response => {
    const copy = response.clone();
    if(response.ok){
      caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
    }
    return response;
  }).catch(() => {
    return caches.match(request).then(cached => {
      if(cached) return cached;
      if(request.mode === 'navigate') return caches.match('./index.html').then(response => response || caches.match('./yoru-gallery3.html'));
      throw new Error('Network request failed and no cached response is available.');
    });
  });
}

function isHtmlRequest(request){
  return (request.headers.get('accept') || '').includes('text/html');
}

function shouldRuntimeCache(request, response){
  const url = new URL(request.url);
  const type = response.headers.get('content-type') || '';

  return url.origin === self.location.origin ||
    type.startsWith('image/') ||
    type.includes('font') ||
    url.hostname === 'fonts.googleapis.com' ||
    url.hostname === 'fonts.gstatic.com';
}
