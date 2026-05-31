/* J.A.R.V.I.S. service worker — offline app shell, runtime caching. */
const VERSION = 'jarvis-v2';

/** Deploy folder (e.g. "/" or "/jarvis/") derived from sw.js location. */
const BASE = new URL('./', self.location.href).pathname;

const url = (path) => {
  const p = path.replace(/^\.\//, '');
  return BASE + p;
};

// App shell precache. Individual misses are tolerated.
const CORE = [
  BASE,
  url('index.html'),
  url('manifest.php'),
  url('manifest.webmanifest'),
  url('css/variables.css'),
  url('css/layout.css'),
  url('css/hud.css'),
  url('css/animations.css'),
  url('js/main.js'),
  url('assets/icons/icon-192.png'),
  url('assets/icons/icon-512.png'),
  url('assets/icons/apple-touch-icon.png'),
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await Promise.all(CORE.map((u) => cache.add(u).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Never cache dynamic endpoints or (large) media.
function bypass(pathname) {
  return pathname.includes('/server/') || pathname.includes('/music/');
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const u = new URL(req.url);
  if (u.origin !== self.location.origin) return;
  if (bypass(u.pathname)) return;

  // Navigations: network-first, fall back to cached shell when offline.
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        return await fetch(req);
      } catch {
        const cache = await caches.open(VERSION);
        return (await cache.match(url('index.html'))) || (await cache.match(req)) || Response.error();
      }
    })());
    return;
  }

  // Static assets: stale-while-revalidate.
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const cached = await cache.match(req);
    const network = fetch(req)
      .then((res) => {
        if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
        return res;
      })
      .catch(() => null);
    return cached || (await network) || Response.error();
  })());
});
