// Apertura istantanea anche senza internet: l'app parte dalla copia salvata sul telefono
// e si aggiorna in background (la versione nuova arriva alla riapertura successiva).
const C = 'note-vocali-v26';
const F = ['./', 'index.html', 'theme.js', 'style.css', 'app.js', 'manifest.json', 'icon.svg', 'whisper-worker.js',
  'db.js', 'smart.js', 'insights.js', 'cloud.js', 'config.js', 'vendor/supabase.js', 'vendor/sortable.min.js'];
self.addEventListener('install', e => { e.waitUntil(caches.open(C).then(c => c.addAll(F))); self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== C).map(x => caches.delete(x)))));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || !req.url.startsWith(self.location.origin)) return;
  const key = req.mode === 'navigate' ? 'index.html' : req;
  e.respondWith(caches.open(C).then(async cache => {
    const hit = await cache.match(key, { ignoreSearch: true });
    const net = fetch(req).then(r => { if (r.ok) cache.put(key, r.clone()); return r; }).catch(() => hit);
    if (hit) { e.waitUntil(net); return hit; }   // subito dalla cache, aggiorna dopo
    return net;
  }));
});
