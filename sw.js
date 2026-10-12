// Network-first cache so the site works offline after the first visit
// and still picks up new bank versions as soon as it is back online.
const CACHE = 'cissp-diagnostic-v9';
const SHELL = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'lib/core.js',
  'lib/charts.js',
  'lib/speech.js',
  'lib/speech-text.js',
  'lib/pronunciations.js',
  'lib/voice.js',
  'lib/voice-parse.js',
  'lib/voice-flow.js',
  'lib/voice-prefs.js',
  'lib/resume.js',
  'lib/review-deck.js',
  'lib/commute.js',
  'lib/media-keys.js',
  'silence.wav',
  'lib/tracks.js',
  'lib/rich-text.js',
  'data/manifest.json',
  'data/taxonomy.json',
  'data-python/manifest.json',
  'data-python/taxonomy.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(SHELL);
      for (const dir of ['data', 'data-python']) {
        try {
          const manifest = await (await fetch(`${dir}/manifest.json`, { cache: 'no-cache' })).json();
          await cache.addAll(manifest.batches.map((b) => `${dir}/${b.file}`));
        } catch {
          // Batches are also cached on first use by the fetch handler.
        }
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
