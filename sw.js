// Network-first cache so the site works offline after the first visit
// and still picks up new bank versions as soon as it is back online.
const CACHE = 'cissp-diagnostic-v1';
const SHELL = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'lib/core.js',
  'lib/charts.js',
  'data/manifest.json',
  'data/taxonomy.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(SHELL);
      try {
        const manifest = await (await fetch('data/manifest.json', { cache: 'no-cache' })).json();
        await cache.addAll(manifest.batches.map((b) => `data/${b.file}`));
      } catch {
        // Batches are also cached on first use by the fetch handler.
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        const fresh = await fetch(req);
        if (fresh.ok) cache.put(req, fresh.clone());
        return fresh;
      } catch {
        const cached = await cache.match(req, { ignoreSearch: true });
        if (cached) return cached;
        if (req.mode === 'navigate') return (await cache.match('index.html')) || Response.error();
        return Response.error();
      }
    })(),
  );
});
