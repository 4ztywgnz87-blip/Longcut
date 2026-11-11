// LONGCUT service worker: makes the app start fast and work offline.
// - The page itself: network first (so a new version shows up right away), cached copy when offline.
// - App files (their names change with every version): cache first.
// - Map style, fonts and icons from OpenFreeMap: cached copy first, refreshed in the background.
// Route planning and address search always go to the network.
const VERSION = 'v1';
const APP = `longcut-app-${VERSION}`;
const MAP = `longcut-map-${VERSION}`;
// A file is the same file whatever headers it was asked with (servers add "Vary").
const ANY = { ignoreVary: true };

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(APP).then((c) => c.addAll(['./', './manifest.webmanifest', './favicon.svg'])));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== APP && k !== MAP).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(req) {
  const cache = await caches.open(APP);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    return (await cache.match(req, ANY)) || (await cache.match('./', ANY)) || Response.error();
  }
}

async function cacheFirst(req, name) {
  const cache = await caches.open(name);
  const hit = await cache.match(req, ANY);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(MAP);
  const hit = await cache.match(req, ANY);
  const fresh = fetch(req)
    .then((res) => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    })
    .catch(() => hit || Response.error());
  return hit || fresh;
}

// On the very first visit the app's files were loaded before this worker took over, so
// they are not in the cache yet. The page sends their addresses once it is running.
self.addEventListener('message', (e) => {
  const urls = e.data && e.data.type === 'keep' && Array.isArray(e.data.urls) ? e.data.urls : [];
  e.waitUntil(
    caches.open(APP).then(async (cache) => {
      for (const u of urls) {
        if (new URL(u).origin !== self.location.origin || (await cache.match(u, ANY))) continue;
        await cache.add(u).catch(() => {});
      }
    }),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (req.mode === 'navigate') return e.respondWith(networkFirst(req));
    if (url.pathname.includes('/assets/')) return e.respondWith(cacheFirst(req, APP));
    return e.respondWith(networkFirst(req));
  }
  // map style, sprites and fonts (not the map tiles themselves: too many)
  if (url.hostname === 'tiles.openfreemap.org' && !/\.pbf$/.test(url.pathname) && !/\/planet\//.test(url.pathname)) {
    return e.respondWith(staleWhileRevalidate(req));
  }
});
