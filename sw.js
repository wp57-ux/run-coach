// Offline support: the whole app is cached on first visit so it works at the
// gym without signal. Bump VERSION whenever you publish changes.
// Fuel Coach shares this website (and its cache storage), so only caches with
// this app's own prefix are ever touched here. The test copy (run-coach-test)
// uses its own prefix, so the two never clear each other's caches.
const NS = self.location.pathname.includes('-test/') ? 'rctest' : 'run-coach';
const VERSION = `${NS}-v7`;
const FONT_CACHE = `${NS}-fonts`;
const CLIPS = ['warmup', 'run', 'run5k', 'walk', 'cooldown', 'halfway', 'oneminute', 'done', 'paused', 'resumed', 'test',
  'm5', 'm10', 'm15', 'm20', 'm25', 'm30', 'm35', 'm40', 'hold', 'relax', 'switch', 'next', 'restover',
  'bikewarm', 'bikecool', 'easy', 'steady', 'strong', 'hard'];
const SHELL = [
  './', 'index.html', 'css/app.css', 'manifest.webmanifest',
  'js/app.js', 'js/store.js', 'js/plan.js', 'js/calories.js', 'js/audio.js', 'js/workout.js',
  'js/lift.js', 'js/lift-data.js', 'js/guide.js', 'js/drawings.js', 'js/bike.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
  ...CLIPS.map(c => `audio/${c}.wav`),
];
const DEV = ['localhost', '127.0.0.1'].includes(self.location.hostname);

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith(NS) && k !== VERSION && k !== FONT_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin && url.href.startsWith(self.registration.scope)) {
    e.respondWith(DEV ? networkFirst(req) : staleWhileRevalidate(req, e));
  } else if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(cacheFirst(req));
  }
});

async function staleWhileRevalidate(req, e) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(req, { ignoreSearch: true });
  const net = fetch(req)
    .then(res => { if (res.ok) cache.put(req, res.clone()); return res; })
    .catch(() => null);
  if (hit) {
    e.waitUntil(net);
    return hit;
  }
  const res = await net;
  if (res) return res;
  if (req.mode === 'navigate') return (await cache.match('index.html')) || Response.error();
  return Response.error();
}

async function networkFirst(req) {
  const cache = await caches.open(VERSION);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    return (await cache.match(req, { ignoreSearch: true })) || Response.error();
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(FONT_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
  return res;
}
