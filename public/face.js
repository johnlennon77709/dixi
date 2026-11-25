// Reconhecimento facial no navegador (detecção + embedding 128-d + prova de vida por piscada).
// Modelos servidos pelo próprio servidor em /vendor/face-api/model (funciona offline após o 1º acesso).
window.Face = (() => {
  let carregado = null;
  const MODELOS = '/vendor/face-api/model';
  function carregar() {
    if (!carregado) carregado = (async () => {
      if (!window.faceapi) await new Promise((ok, erro) => { const s = document.createElement('script'); s.src = '/vendor/face-api/dist/face-api.js'; s.onload = ok; s.onerror = erro; document.head.appendChild(s); });
      await faceapi.nets.tinyFaceDetector.loadFromUri(MODELOS);
      await faceapi.nets.faceLandmark68Net.loadFromUri(MODELOS);
      await faceapi.nets.faceRecognitionNet.loadFromUri(MODELOS);
    })();
    return carregado;
  }
  async function abrirCamera(video) {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 }, audio: false });
    video.srcObject = stream; await video.play(); return stream;
  }
  const opts = () => new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 });
  const dist = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
  function ear(pts) { // eye aspect ratio
    const d = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
    return (d(pts[1], pts[5]) + d(pts[2], pts[4])) / (2 * d(pts[0], pts[3]));
  }
  // Captura com prova de vida: o usuário precisa piscar em até `prazo` ms (bloqueia foto impressa/tela parada).
  async function capturar(video, { prazo = 6000, aoStatus = () => {} } = {}) {
    await carregar();
    const fim = Date.now() + prazo; let olhosAbertos = false; let piscou = false; let melhor = null;
    while (Date.now() < fim) {
      const r = await faceapi.detectSingleFace(video, opts()).withFaceLandmarks().withFaceDescriptor();
      if (!r) { aoStatus('Posicione o rosto na câmera'); await new Promise((x) => setTimeout(x, 120)); continue; }
      const lm = r.landmarks; const e = (ear(lm.getLeftEye()) + ear(lm.getRightEye())) / 2;
      if (e > 0.27) { olhosAbertos = true; melhor = r; }
      if (olhosAbertos && e < 0.21) piscou = true;
      if (piscou && melhor && e > 0.25) return { descritor: Array.from(melhor.descriptor), vivo: true };
      aoStatus(olhosAbertos ? 'Agora pisque os olhos' : 'Abra bem os olhos');
    }
    throw new Error('Prova de vida não confirmada (pisque os olhos olhando para a câmera)');
  }
  function identificar(descritor, funcionarios) {
    let melhor = null;
    for (const f of funcionarios) if (f.face) { const d = dist(descritor, f.face); if (!melhor || d < melhor.dist) melhor = { f, dist: d }; }
    return melhor && melhor.dist < 0.5 ? melhor : null;
  }
  async function hashFoto(video) {
    const c = document.createElement('canvas'); c.width = 320; c.height = 240;
    c.getContext('2d').drawImage(video, 0, 0, 320, 240);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8));
    const h = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  return { carregar, abrirCamera, capturar, identificar, hashFoto };
})();
