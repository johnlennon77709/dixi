// Service worker único para os dois PWAs (painel do RH e app de ponto).
// - Telas e modelos de reconhecimento facial ficam em cache: o app abre sem internet.
// - Leituras da API do painel: rede primeiro, cópia em cache como reserva (painel em modo leitura offline).
// - Marcações de ponto offline ficam na fila do próprio app (ponto.html) e são enviadas depois.
const VERSAO = 'dixi-v3';
const TELAS = ['/', '/index.html', '/ponto.html', '/offline.html', '/estilo.css', '/face.js',
  '/manifest.webmanifest', '/painel.webmanifest', '/icone.svg', '/icone-192.png', '/icone-512.png', '/icone-maskable-512.png', '/apple-touch-icon.png'];
const FACIAL = ['/vendor/face-api/dist/face-api.js',
  '/vendor/face-api/model/tiny_face_detector_model-weights_manifest.json', '/vendor/face-api/model/tiny_face_detector_model.bin',
  '/vendor/face-api/model/face_landmark_68_model-weights_manifest.json', '/vendor/face-api/model/face_landmark_68_model.bin',
  '/vendor/face-api/model/face_recognition_model-weights_manifest.json', '/vendor/face-api/model/face_recognition_model.bin'];
const API_LEITURA = /^\/api\/(empresa|funcionarios|escalas|estabelecimentos|dispositivos|marcacoes|espelho\/\d+|ajustes|feriados|auditoria|rede|dispositivo\/sync)$/;

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSAO);
    await c.addAll(TELAS);
    await c.addAll(FACIAL).catch(() => {}); // ~13 MB; se falhar, baixa na primeira vez que usar
  })());
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSAO) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function redePrimeiro(req, chave) {
  const c = await caches.open(VERSAO);
  try {
    const r = await fetch(req);
    if (r.ok) c.put(chave || req, r.clone());
    return r;
  } catch (err) {
    const salvo = await c.match(chave || req, { ignoreSearch: !chave });
    if (salvo) {
      const h = new Headers(salvo.headers); h.set('x-offline', '1');
      return new Response(await salvo.blob(), { status: 200, headers: h });
    }
    throw err;
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request; const u = new URL(req.url);
  if (req.method !== 'GET' || u.origin !== location.origin) return;
  if (u.pathname.startsWith('/api/')) {
    // só leituras do painel; downloads (AFD, PDF, folha) e marcações nunca vêm do cache
    if (API_LEITURA.test(u.pathname)) e.respondWith(redePrimeiro(req, u.pathname + u.search));
    return;
  }
  if (u.pathname.startsWith('/vendor/')) { // modelos grandes: cache primeiro
    e.respondWith(caches.match(req).then((r) => r || fetch(req).then((resp) => { const c = resp.clone(); caches.open(VERSAO).then((x) => x.put(req, c)); return resp; })));
    return;
  }
  if (req.mode === 'navigate') {
    e.respondWith(redePrimeiro(req).catch(async () => (await caches.match(u.pathname === '/' ? '/index.html' : u.pathname, { ignoreSearch: true })) || caches.match('/offline.html')));
    return;
  }
  e.respondWith(redePrimeiro(req).catch(() => caches.match(req, { ignoreSearch: true })));
});
