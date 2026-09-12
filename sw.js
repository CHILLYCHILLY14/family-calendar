// Cache only this app: other GitHub Pages projects share this origin.
const PREFIX = 'family-hub-';
const CACHE = PREFIX + 'v3';
const SCOPE = new URL('./', self.location.href);
const SHELL = ['./', './index.html', './styles.css?v=2', './app.js?v=2', './store.js', './lib.js', './meals.js', './import.js', './config.js', './manifest.webmanifest', './assets/icons/icon-192.png', './assets/icons/icon-512.png', './assets/icons/apple-touch-icon.png'];

self.addEventListener('install', event => {
  // A failed download must not replace an existing complete offline copy.
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith(PREFIX) && key !== CACHE).map(key => caches.delete(key))
  )).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== SCOPE.origin || !url.pathname.startsWith(SCOPE.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const response = await fetch(request, { cache: 'no-cache' });
      if (response.ok) event.waitUntil(cache.put(request, response.clone()).catch(() => {}));
      if (response.ok || response.status < 500) return response;
      return await cache.match(request, { ignoreSearch: true }) || response;
    } catch {
      const cached = await cache.match(request, { ignoreSearch: true });
      if (cached) return cached;
      if (request.mode === 'navigate') {
        const page = await cache.match(new URL('index.html', SCOPE).href);
        if (page) return page;
      }
      // Never return HTML to a missing JavaScript/image request.
      return Response.error();
    }
  })());
});

// Tapping a reminder pop-up opens (or focuses) the family calendar.
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || SCOPE.href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const open = list.find(c => c.url.startsWith(SCOPE.href));
    return open ? open.focus() : self.clients.openWindow(target);
  }));
});
