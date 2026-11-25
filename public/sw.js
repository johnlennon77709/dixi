// Service worker: o app de ponto abre e funciona sem internet (offline-first, seção 7.2 do REA).
const CACHE = 'dixi-ponto-v1';
const ARQUIVOS = ['/ponto.html', '/estilo.css', '/face.js', '/icone.svg', '/manifest.webmanifest',
  '/vendor/face-api/dist/face-api.js',
  '/vendor/face-api/model/tiny_face_detector_model-weights_manifest.json', '/vendor/face-api/model/tiny_face_detector_model.bin',
  '/vendor/face-api/model/face_landmark_68_model-weights_manifest.json', '/vendor/face-api/model/face_landmark_68_model.bin',
  '/vendor/face-api/model/face_recognition_model-weights_manifest.json', '/vendor/face-api/model/face_recognition_model.bin'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARQUIVOS)).catch(() => {})); self.skipWaiting(); });
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.pathname.startsWith('/api/')) return; // API nunca vem do cache
  e.respondWith(fetch(e.request).then((r) => { const c = r.clone(); caches.open(CACHE).then((x) => x.put(e.request, c)); return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true })));
});
