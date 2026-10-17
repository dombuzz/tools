// Offline-Hilfe für tools.dombuzz.ch: Seiten werden beim Besuch gemerkt und laufen danach auch ohne Netz.
// Strategie: zuerst Netz (damit Änderungen sofort da sind), bei Fehler oder langsamem Netz die gemerkte Version.
// Nur Seiten und Dateien von tools.dombuzz.ch; Anfragen an den Worker (Likes, Statistik) laufen nie darüber.
const CACHE = 'dbz-v1';
const CORE = ['/', '/theme.js', '/like.js', '/apple-touch-icon.png', '/audio-recorder', '/Resizer2000', '/srt2ttml'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(CORE.map(u => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin || u.pathname === '/sw.js') return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE), hit = await cache.match(r, { ignoreSearch: true });
    try {
      const ctl = new AbortController(), t = hit ? setTimeout(() => ctl.abort(), 4000) : 0;
      const res = await fetch(r, { signal: ctl.signal }); clearTimeout(t);
      if (res.ok && res.type === 'basic') cache.put(r, res.clone());
      return res;
    } catch (err) {
      if (hit) return hit;
      if (r.mode === 'navigate') { const home = await cache.match('/'); if (home) return home; }
      throw err;
    }
  })());
});
