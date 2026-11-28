// Offline-first service worker: app shell is cached; bump VERSION on every release.
// Every app on this site shares one Cache Storage: each app only ever touches caches with its own prefix.
const PREFIX = 'seenzhin-', VERSION = PREFIX + 'v24', LEGACY = ['v12'];
const SHELL = [
  './', 'index.html', 'app.css', 'manifest.webmanifest',
  'js/app.js', 'js/model.js', 'js/analysis.js', 'js/invoice.js', 'js/db.js', 'js/format.js', 'js/sync.js', 'js/config.js', 'js/orders.js',
  'fonts/Vazirmatn.woff2', 'brand/logo-sun.png', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION && (k.startsWith(PREFIX) || LEGACY.includes(k))).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Live market prices (hesab-man's feed) must never come from this app's cache.
  if (url.pathname.endsWith('/data/prices.json')) return;
  e.respondWith(caches.open(VERSION).then(async cache => {
    const hit = await cache.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request).then(res => { if (res.ok) cache.put(e.request, res.clone()); return res; }).catch(() => hit);
    return hit || net;
  }));
});
