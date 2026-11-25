'use strict';
// API HTTP (sem framework) + arquivos estáticos do painel e do app REP-P.
const http = require('node:http');
const https = require('node:https');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const T = require('./tempo');
const { registrarMarcacao, verificarCadeia } = require('./rep');
const fiscal = require('./fiscal');
const folha = require('./exportacao');
const { espelho } = require('./servico');
const horaLegal = require('./horalegal');

const PUBLIC = path.join(__dirname, '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.bin': 'application/octet-stream', '.png': 'image/png' };

// ---------- segurança ----------
function hashSenha(s) {
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + ':' + crypto.scryptSync(String(s), salt, 32).toString('hex');
}
function conferirSenha(s, h) {
  if (!h) return false;
  const [salt, hex] = h.split(':');
  const a = crypto.scryptSync(String(s), salt, 32); const b = Buffer.from(hex, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function segredo() {
  if (process.env.DIXI_SEGREDO) return process.env.DIXI_SEGREDO;
  const f = path.join(__dirname, '..', 'data', 'segredo.txt');
  if (!fs.existsSync(f)) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, crypto.randomBytes(32).toString('hex')); }
  return fs.readFileSync(f, 'utf8').trim();
}
let SEGREDO = null;
const assinar = (dados) => { SEGREDO ??= segredo(); const p = Buffer.from(JSON.stringify(dados)).toString('base64url'); return p + '.' + crypto.createHmac('sha256', SEGREDO).update(p).digest('base64url'); };
function lerToken(tok) {
  if (!tok) return null; SEGREDO ??= segredo();
  const [p, s] = tok.split('.');
  const esperado = crypto.createHmac('sha256', SEGREDO).update(p || '').digest('base64url');
  if (!s || s.length !== esperado.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(esperado))) return null;
  const d = JSON.parse(Buffer.from(p, 'base64url').toString());
  return d.exp && d.exp < Date.now() ? null : d;
}

// ---------- utilidades ----------
const erro = (status, msg) => Object.assign(new Error(msg), { status });
const so = (s) => String(s || '').replace(/\D/g, '');
function validarCPF(c) {
  c = so(c); if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false;
  for (const n of [9, 10]) {
    let s = 0; for (let i = 0; i < n; i++) s += Number(c[i]) * (n + 1 - i);
    if (((s * 10) % 11) % 10 !== Number(c[n])) return false;
  }
  return true;
}
function distanciaM(a, b, c, d) {
  const R = 6371000; const r = (x) => (x * Math.PI) / 180;
  const h = Math.sin(r(c - a) / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(r(d - b) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function periodo(q) {
  const hoje = T.dataBR(horaLegal.agora());
  if (q.get('competencia')) {
    const [a, m] = q.get('competencia').split('-').map(Number);
    return { inicio: `${a}-${T.pad(m)}-01`, fim: `${a}-${T.pad(m)}-${T.ultimoDiaMes(a, m)}`, competencia: q.get('competencia') };
  }
  const inicio = q.get('inicio') || hoje.slice(0, 8) + '01'; const fim = q.get('fim') || hoje;
  return { inicio, fim, competencia: inicio.slice(0, 7) };
}

const FERIADOS_NACIONAIS = ['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25'];
function semearFeriados(db, ano) {
  const nomes = ['Confraternização Universal', 'Tiradentes', 'Dia do Trabalho', 'Independência', 'Nossa Senhora Aparecida', 'Finados', 'Proclamação da República', 'Consciência Negra', 'Natal'];
  const st = db.prepare('INSERT INTO feriados (empresa_id, data, nome) SELECT NULL, ?, ? WHERE NOT EXISTS (SELECT 1 FROM feriados WHERE empresa_id IS NULL AND data=?)');
  FERIADOS_NACIONAIS.forEach((d, i) => st.run(`${ano}-${d}`, nomes[i], `${ano}-${d}`));
}

// ---------- rotas ----------
function criarApp(db) {
  const rotas = [];
  const rota = (metodo, padrao, auth, fn) => rotas.push({ metodo, re: new RegExp('^' + padrao.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), auth, fn });

  // --- cadastro e login do RH ---
  rota('POST', '/api/cadastro', null, ({ body }) => {
    const { cnpj, razao_social, nome, email, senha } = body;
    if (so(cnpj).length !== 14 || !razao_social || !email || !senha || String(senha).length < 6) throw erro(400, 'dados inválidos (CNPJ com 14 dígitos e senha com 6+ caracteres)');
    const e = db.prepare('INSERT INTO empresas (cnpj, razao_social) VALUES (?,?)').run(so(cnpj), razao_social);
    db.prepare('INSERT INTO usuarios (empresa_id, email, senha_hash, nome) VALUES (?,?,?,?)').run(e.lastInsertRowid, String(email).toLowerCase(), hashSenha(senha), nome || email);
    const ano = Number(T.dataBR(new Date()).slice(0, 4)); semearFeriados(db, ano); semearFeriados(db, ano + 1);
    return { token: assinar({ u: email, e: Number(e.lastInsertRowid), exp: Date.now() + 12 * 3600e3 }) };
  });
  rota('POST', '/api/login', null, ({ body, host }) => {
    // Pela internet (túnel), a conta de demonstração com senha pública fica bloqueada.
    if (/trycloudflare\.com$/.test(host || '') && String(body.email || '').toLowerCase() === 'admin@demo.com') {
      throw erro(403, 'Pela internet, a conta de demonstração é bloqueada por segurança. Crie a sua conta em "Criar empresa".');
    }
    const u = db.prepare('SELECT * FROM usuarios WHERE email=?').get(String(body.email || '').toLowerCase());
    if (!u || !conferirSenha(body.senha, u.senha_hash)) throw erro(401, 'e-mail ou senha incorretos');
    return { token: assinar({ u: u.email, e: u.empresa_id, exp: Date.now() + 12 * 3600e3 }), nome: u.nome };
  });

  // --- empresa / cadastros ---
  rota('GET', '/api/empresa', 'rh', ({ emp }) => db.prepare('SELECT * FROM empresas WHERE id=?').get(emp));
  rota('PUT', '/api/empresa', 'rh', ({ emp, body }) => {
    db.prepare('UPDATE empresas SET usa_banco_horas=? WHERE id=?').run(body.usa_banco_horas ? 1 : 0, emp);
    return db.prepare('SELECT * FROM empresas WHERE id=?').get(emp);
  });
  rota('GET', '/api/estabelecimentos', 'rh', ({ emp }) => db.prepare('SELECT * FROM estabelecimentos WHERE empresa_id=?').all(emp));
  rota('POST', '/api/estabelecimentos', 'rh', ({ emp, body }) => {
    if (!body.nome) throw erro(400, 'nome obrigatório');
    const r = db.prepare('INSERT INTO estabelecimentos (empresa_id, nome, cnpj_cei, endereco, latitude, longitude, raio_metros, uf) VALUES (?,?,?,?,?,?,?,?)')
      .run(emp, body.nome, body.cnpj_cei || null, body.endereco || null, body.latitude ?? null, body.longitude ?? null, body.raio_metros || 200, body.uf || 'PR');
    return db.prepare('SELECT * FROM estabelecimentos WHERE id=?').get(r.lastInsertRowid);
  });
  rota('GET', '/api/escalas', 'rh', ({ emp }) => db.prepare('SELECT * FROM escalas WHERE empresa_id=?').all(emp).map((e) => ({ ...e, config: JSON.parse(e.config) })));
  rota('POST', '/api/escalas', 'rh', ({ emp, body }) => {
    if (!['fixa', '12x36', 'flexivel'].includes(body.tipo) || !body.nome || !body.config) throw erro(400, 'escala inválida');
    require('./jornada').previstoPara({ tipo: body.tipo, config: body.config }, '2026-01-05'); // valida a config
    const r = db.prepare('INSERT INTO escalas (empresa_id, nome, tipo, config) VALUES (?,?,?,?)').run(emp, body.nome, body.tipo, JSON.stringify(body.config));
    return { id: Number(r.lastInsertRowid), ...body };
  });
  rota('GET', '/api/funcionarios', 'rh', ({ emp }) => db.prepare(`SELECT id, nome, cpf, pis, matricula, escala_id, estabelecimento_id, admissao, ativo,
    pin_hash IS NOT NULL AS tem_pin, face_descritor IS NOT NULL AS tem_face, consentimento_biometria FROM funcionarios WHERE empresa_id=? ORDER BY nome`).all(emp));
  rota('POST', '/api/funcionarios', 'rh', ({ emp, body }) => {
    if (!body.nome || !validarCPF(body.cpf)) throw erro(400, 'nome e CPF válido são obrigatórios');
    const r = db.prepare(`INSERT INTO funcionarios (empresa_id, estabelecimento_id, escala_id, nome, cpf, pis, matricula, pin_hash, admissao)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(emp, body.estabelecimento_id || null, body.escala_id || null, body.nome, so(body.cpf), body.pis || null,
      body.matricula || null, body.pin ? hashSenha(body.pin) : null, body.admissao || null);
    return { id: Number(r.lastInsertRowid) };
  });
  rota('PUT', '/api/funcionarios/:id', 'rh', ({ emp, params, body }) => {
    const f = db.prepare('SELECT * FROM funcionarios WHERE id=? AND empresa_id=?').get(params.id, emp);
    if (!f) throw erro(404, 'funcionário não encontrado');
    const campos = { escala_id: body.escala_id, estabelecimento_id: body.estabelecimento_id, matricula: body.matricula, ativo: body.ativo, admissao: body.admissao, nome: body.nome };
    if (body.pin) campos.pin_hash = hashSenha(body.pin);
    if (body.face_descritor) {
      if (!body.consentimento) throw erro(400, 'biometria exige o aceite do termo de consentimento (LGPD art. 11)');
      if (!Array.isArray(body.face_descritor) || body.face_descritor.length !== 128) throw erro(400, 'descritor facial inválido');
      campos.face_descritor = JSON.stringify(body.face_descritor); campos.consentimento_biometria = T.isoBR(new Date());
    }
    if (body.remover_biometria) { campos.face_descritor = null; campos.consentimento_biometria = null; }
    for (const [k, v] of Object.entries(campos)) if (v !== undefined) db.prepare(`UPDATE funcionarios SET ${k}=? WHERE id=?`).run(v, f.id);
    return { ok: true };
  });
  rota('GET', '/api/dispositivos', 'rh', ({ emp }) => db.prepare('SELECT * FROM dispositivos WHERE empresa_id=?').all(emp));
  rota('POST', '/api/dispositivos', 'rh', ({ emp, body }) => {
    if (!['app', 'quiosque', 'web'].includes(body.tipo)) throw erro(400, 'tipo: app | quiosque | web');
    const n = db.prepare('SELECT COUNT(*) c FROM dispositivos WHERE empresa_id=?').get(emp).c + 1;
    const token = crypto.randomBytes(24).toString('base64url');
    const r = db.prepare('INSERT INTO dispositivos (empresa_id, estabelecimento_id, nome, tipo, token, numero_coletor) VALUES (?,?,?,?,?,?)')
      .run(emp, body.estabelecimento_id || null, body.nome || `Dispositivo ${n}`, body.tipo, token, n);
    return db.prepare('SELECT * FROM dispositivos WHERE id=?').get(r.lastInsertRowid);
  });
  rota('GET', '/api/feriados', 'rh', ({ emp }) => db.prepare('SELECT * FROM feriados WHERE empresa_id IS NULL OR empresa_id=? ORDER BY data').all(emp));
  rota('POST', '/api/feriados', 'rh', ({ emp, body }) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.data || '') || !body.nome) throw erro(400, 'data (AAAA-MM-DD) e nome obrigatórios');
    db.prepare('INSERT INTO feriados (empresa_id, data, nome) VALUES (?,?,?)').run(emp, body.data, body.nome); return { ok: true };
  });

  // --- marcações, espelho, tratamento ---
  rota('GET', '/api/marcacoes', 'rh', ({ emp, q }) => {
    const { inicio, fim } = periodo(q);
    return db.prepare(`SELECT m.id, m.nsr, m.data_hora, m.data_hora_gravacao, m.online, m.metodo, m.latitude, m.longitude, m.hash, f.nome
      FROM marcacoes m JOIN funcionarios f ON f.id=m.funcionario_id WHERE m.empresa_id=? AND substr(m.data_hora,1,10) BETWEEN ? AND ?
      ${q.get('funcionario') ? 'AND m.funcionario_id=' + Number(q.get('funcionario')) : ''} ORDER BY m.nsr DESC LIMIT 500`).all(emp, inicio, fim);
  });
  rota('GET', '/api/espelho/:id', 'rh', ({ emp, params, q }) => {
    const f = db.prepare('SELECT * FROM funcionarios WHERE id=? AND empresa_id=?').get(params.id, emp);
    if (!f) throw erro(404, 'funcionário não encontrado');
    const { inicio, fim } = periodo(q); return espelho(db, f, inicio, fim);
  });
  rota('GET', '/api/ajustes', 'rh', ({ emp }) => db.prepare(`SELECT a.*, f.nome FROM ajustes a JOIN funcionarios f ON f.id=a.funcionario_id
    WHERE a.empresa_id=? ORDER BY a.status='pendente' DESC, a.id DESC LIMIT 300`).all(emp));
  rota('POST', '/api/ajustes', 'rh', ({ emp, body, user }) => {
    const f = db.prepare('SELECT id FROM funcionarios WHERE id=? AND empresa_id=?').get(body.funcionario_id, emp);
    if (!f || !['inclusao', 'desconsiderar', 'abono'].includes(body.tipo) || !body.motivo || !body.data) throw erro(400, 'ajuste inválido (funcionário, tipo, data e motivo obrigatórios)');
    if (body.tipo === 'inclusao' && !/^\d{2}:\d{2}$/.test(body.hora || '')) throw erro(400, 'hora HH:MM obrigatória');
    if (body.tipo === 'desconsiderar' && !db.prepare('SELECT 1 FROM marcacoes WHERE id=? AND funcionario_id=?').get(body.marcacao_id, f.id)) throw erro(400, 'marcação inválida');
    const r = db.prepare(`INSERT INTO ajustes (empresa_id, funcionario_id, tipo, data, hora, marcacao_id, minutos, motivo, solicitado_por) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(emp, f.id, body.tipo, body.data, body.hora || null, body.marcacao_id || null, body.minutos || null, body.motivo, user);
    return { id: Number(r.lastInsertRowid) };
  });
  rota('POST', '/api/ajustes/:id/decidir', 'rh', ({ emp, params, body, user }) => {
    if (!['aprovado', 'rejeitado'].includes(body.status)) throw erro(400, 'status: aprovado | rejeitado');
    const r = db.prepare(`UPDATE ajustes SET status=?, decidido_por=? WHERE id=? AND empresa_id=? AND status='pendente'`).run(body.status, user, params.id, emp);
    if (!r.changes) throw erro(404, 'ajuste não encontrado ou já decidido');
    return { ok: true };
  });

  // --- fiscal ---
  const arquivo = (nome, tipo, conteudo) => ({ __arquivo: true, nome, tipo, conteudo });
  const calculosEmpresa = (emp, inicio, fim) => Object.fromEntries(db.prepare('SELECT * FROM funcionarios WHERE empresa_id=?').all(emp).map((f) => [f.id, espelho(db, f, inicio, fim)]));
  rota('GET', '/api/fiscal/afd', 'rh', ({ emp, q }) => { const { inicio, fim } = periodo(q); return arquivo(`AFD_${inicio}_${fim}.txt`, 'text/plain; charset=latin1', Buffer.from(fiscal.gerarAFD(db, emp, inicio, fim, horaLegal.agora()), 'latin1')); });
  rota('GET', '/api/fiscal/afd.p7s', 'rh', ({ emp, q }) => { const { inicio, fim } = periodo(q); return arquivo(`AFD_${inicio}_${fim}.txt.p7s`, 'application/pkcs7-signature', fiscal.assinarCAdES(fiscal.gerarAFD(db, emp, inicio, fim, horaLegal.agora()))); });
  rota('GET', '/api/fiscal/aej', 'rh', ({ emp, q }) => { const { inicio, fim } = periodo(q); return arquivo(`AEJ_${inicio}_${fim}.txt`, 'text/plain; charset=utf-8', Buffer.from(fiscal.gerarAEJ(db, emp, inicio, fim, calculosEmpresa(emp, inicio, fim), horaLegal.agora()))); });
  rota('GET', '/api/fiscal/aej.p7s', 'rh', ({ emp, q }) => { const { inicio, fim } = periodo(q); return arquivo(`AEJ_${inicio}_${fim}.txt.p7s`, 'application/pkcs7-signature', fiscal.assinarCAdES(Buffer.from(fiscal.gerarAEJ(db, emp, inicio, fim, calculosEmpresa(emp, inicio, fim), horaLegal.agora())))); });
  rota('GET', '/api/comprovante/:id', 'rh', ({ emp, params }) => {
    const m = db.prepare('SELECT id FROM marcacoes WHERE id=? AND empresa_id=?').get(params.id, emp); if (!m) throw erro(404, 'marcação não encontrada');
    return arquivo(`comprovante_${m.id}.pdf`, 'application/pdf', fiscal.comprovantePDF(db, m.id));
  });
  rota('GET', '/api/auditoria', 'rh', ({ emp }) => ({ cadeia: verificarCadeia(db, emp), horaLegal: horaLegal.status(), certificadoDeTeste: fiscal.carregarCertificado().teste }));

  // --- folha ---
  const espelhosEmpresa = (emp, inicio, fim) => db.prepare('SELECT * FROM funcionarios WHERE empresa_id=? AND ativo=1').all(emp).map((f) => espelho(db, f, inicio, fim));
  rota('GET', '/api/folha/csv', 'rh', ({ emp, q }) => { const p = periodo(q); return arquivo(`folha_${p.competencia}.csv`, 'text/csv; charset=utf-8', Buffer.from('﻿' + folha.csv(espelhosEmpresa(emp, p.inicio, p.fim)))); });
  rota('GET', '/api/folha/txt', 'rh', ({ emp, q }) => { const p = periodo(q); return arquivo(`folha_${p.competencia}.txt`, 'text/plain', Buffer.from(folha.txtFolha(espelhosEmpresa(emp, p.inicio, p.fim), p.competencia))); });
  rota('GET', '/api/folha/s1200', 'rh', ({ emp, q }) => { const p = periodo(q); const e = db.prepare('SELECT * FROM empresas WHERE id=?').get(emp); return arquivo(`S-1200_${p.competencia}.xml`, 'application/xml', Buffer.from(folha.s1200(espelhosEmpresa(emp, p.inicio, p.fim), e, p.competencia))); });

  // --- dispositivo (app REP-P / quiosque) ---
  rota('GET', '/api/dispositivo/sync', 'disp', ({ disp }) => {
    db.prepare('UPDATE dispositivos SET ultimo_contato=? WHERE id=?').run(T.isoBR(horaLegal.agora()), disp.id);
    const est = disp.estabelecimento_id ? db.prepare('SELECT * FROM estabelecimentos WHERE id=?').get(disp.estabelecimento_id) : null;
    const emp = db.prepare('SELECT razao_social, cnpj FROM empresas WHERE id=?').get(disp.empresa_id);
    const funcs = db.prepare(`SELECT id, nome, cpf, face_descritor, pin_hash IS NOT NULL AS tem_pin FROM funcionarios WHERE empresa_id=? AND ativo=1
      ${disp.estabelecimento_id ? 'AND (estabelecimento_id IS NULL OR estabelecimento_id=' + Number(disp.estabelecimento_id) + ')' : ''} ORDER BY nome`).all(disp.empresa_id)
      .map((f) => ({ id: f.id, nome: f.nome, cpfFinal: f.cpf.slice(-4), face: f.face_descritor ? JSON.parse(f.face_descritor) : null, temPin: !!f.tem_pin }));
    return { dispositivo: { id: disp.id, nome: disp.nome, tipo: disp.tipo }, empresa: emp, estabelecimento: est, funcionarios: funcs, horaServidor: horaLegal.agora().toISOString(), horaLegal: horaLegal.status() };
  });
  rota('POST', '/api/dispositivo/marcar', 'disp', ({ disp, body }) => {
    const f = body.cpf
      ? db.prepare('SELECT * FROM funcionarios WHERE empresa_id=? AND cpf=? AND ativo=1').get(disp.empresa_id, so(body.cpf))
      : db.prepare('SELECT * FROM funcionarios WHERE empresa_id=? AND id=? AND ativo=1').get(disp.empresa_id, body.funcionarioId);
    if (!f) throw erro(404, 'funcionário não encontrado');
    const metodo = body.metodo === 'facial' ? 'facial' : 'pin';
    if (metodo === 'pin' && !conferirSenha(body.pin || '', f.pin_hash)) throw erro(401, 'PIN incorreto');
    if (metodo === 'facial' && !(f.face_descritor && typeof body.distanciaFacial === 'number' && body.distanciaFacial < 0.5)) throw erro(401, 'reconhecimento facial não confirmado');
    // cerca virtual
    const est = (f.estabelecimento_id || disp.estabelecimento_id) && db.prepare('SELECT * FROM estabelecimentos WHERE id=?').get(f.estabelecimento_id || disp.estabelecimento_id);
    if (disp.tipo === 'app' && est && est.latitude != null) {
      if (body.latitude == null) throw erro(400, 'localização obrigatória para marcar pelo celular');
      const dist = distanciaM(est.latitude, est.longitude, body.latitude, body.longitude);
      if (dist > est.raio_metros + Math.min(body.precisao || 0, 100)) throw erro(403, `fora da cerca virtual (${Math.round(dist)} m do local)`);
    }
    const m = registrarMarcacao(db, {
      empresaId: disp.empresa_id, funcionarioId: f.id, dispositivoId: disp.id, tipoColetor: disp.tipo,
      agora: horaLegal.agora(), dataHora: body.online === false ? body.dataHora : null, online: body.online !== false,
      latitude: body.latitude, longitude: body.longitude, precisao: body.precisao, metodo,
      fotoHash: typeof body.fotoHash === 'string' ? body.fotoHash.slice(0, 64) : null, idLocal: body.idLocal,
    });
    const link = `/api/dispositivo/comprovante/${m.id}?c=${assinar({ m: m.id })}`;
    return { nsr: m.nsr, dataHora: m.data_hora, nome: f.nome, hash: m.hash, duplicada: !!m.duplicada, comprovante: link };
  });
  rota('GET', '/api/dispositivo/comprovante/:id', null, ({ params, q }) => {
    const t = lerToken(q.get('c')); if (!t || String(t.m) !== params.id) throw erro(403, 'link inválido');
    return arquivo(`comprovante_${params.id}.pdf`, 'application/pdf', fiscal.comprovantePDF(db, Number(params.id)));
  });
  rota('GET', '/api/rede', 'rh', () => ({ urls: urlsCelular() }));
  rota('GET', '/api/qr', 'rh', async ({ q }) => {
    const svg = await require('qrcode').toString(String(q.get('texto') || '').slice(0, 500), { type: 'svg', margin: 1, width: 180 });
    return { __arquivo: true, inline: true, nome: 'qr.svg', tipo: 'image/svg+xml', conteudo: Buffer.from(svg) };
  });
  rota('GET', '/api/hora', null, () => ({ agora: horaLegal.agora().toISOString(), ...horaLegal.status() }));

  // ---------- servidor ----------
  return async function handler(req, res) {
    const url = new URL(req.url, 'http://x');
    try {
      if (!url.pathname.startsWith('/api/')) return estatico(url.pathname, res);
      const r = rotas.find((x) => x.metodo === req.method && x.re.test(url.pathname));
      if (!r) throw erro(404, 'rota não encontrada');
      const ctx = { params: url.pathname.match(r.re).groups || {}, q: url.searchParams, body: {}, host: String(req.headers.host || '').split(':')[0] };
      if (req.method === 'POST' || req.method === 'PUT') ctx.body = await lerCorpo(req);
      if (r.auth === 'rh') {
        const t = lerToken((req.headers.authorization || '').replace('Bearer ', '') || url.searchParams.get('token'));
        if (!t || !t.e) throw erro(401, 'faça login');
        ctx.emp = t.e; ctx.user = t.u;
      } else if (r.auth === 'disp') {
        const d = db.prepare('SELECT * FROM dispositivos WHERE token=?').get(req.headers['x-dispositivo'] || '');
        if (!d) throw erro(401, 'dispositivo não autorizado');
        ctx.disp = d;
      }
      const out = await r.fn(ctx);
      if (out && out.__arquivo) {
        res.writeHead(200, { 'content-type': out.tipo, 'content-disposition': `${out.inline ? 'inline' : 'attachment'}; filename="${out.nome}"` });
        return res.end(out.conteudo);
      }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(out ?? {}));
    } catch (e) {
      const status = e.status || (String(e.message).includes('UNIQUE') ? 409 : 500);
      if (status === 500) console.error(e);
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ erro: status === 409 ? 'registro duplicado' : e.message }));
    }
  };
}

function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    let n = 0; const partes = [];
    req.on('data', (c) => { n += c.length; if (n > 1e6) { reject(erro(413, 'corpo muito grande')); req.destroy(); } else partes.push(c); });
    req.on('end', () => { try { resolve(partes.length ? JSON.parse(Buffer.concat(partes).toString()) : {}); } catch { reject(erro(400, 'JSON inválido')); } });
  });
}

const FACE_API = path.join(__dirname, '..', 'node_modules', '@vladmandic', 'face-api');
function estatico(p, res) {
  if (p === '/') p = '/index.html';
  let base = PUBLIC;
  // modelos de reconhecimento facial servidos localmente (o quiosque funciona sem internet externa)
  if (p.startsWith('/vendor/face-api/')) { base = FACE_API; p = p.slice('/vendor/face-api'.length); }
  const f = path.normalize(path.join(base, p));
  if (!f.startsWith(base) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('não encontrado'); }
  const h = { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-cache' };
  if (p === '/sw.js') h['service-worker-allowed'] = '/';
  res.writeHead(200, h);
  fs.createReadStream(f).pipe(res);
}

// ---------- acesso pelo celular (mesma rede Wi-Fi) ----------
// Câmera e GPS no celular exigem HTTPS, então o servidor também sobe em HTTPS com um
// certificado autoassinado que cobre os IPs da rede local do PC.
const PORTA_HTTPS = Number(process.env.PORT_HTTPS || 3443);
function ipsLocais() {
  const ips = [];
  for (const lista of Object.values(os.networkInterfaces())) for (const i of lista || []) if (i.family === 'IPv4' && !i.internal) ips.push(i.address);
  // redes domésticas (192.168.x / 10.x) primeiro
  return ips.sort((a, b) => (/^(192\.168|10\.)/.test(b) ? 1 : 0) - (/^(192\.168|10\.)/.test(a) ? 1 : 0));
}
const urlsCelular = () => [require('./tunel').endereco(), ...ipsLocais().map((ip) => `https://${ip}:${PORTA_HTTPS}`)].filter(Boolean);
function certificadoHttps() {
  const forge = require('node-forge');
  const dir = path.join(__dirname, '..', 'data', 'certs');
  const ips = ipsLocais(); const marca = ips.join(',');
  const kf = path.join(dir, 'https.key.pem'); const cf = path.join(dir, 'https.cert.pem'); const mf = path.join(dir, 'https.ips');
  if (fs.existsSync(kf) && fs.existsSync(mf) && fs.readFileSync(mf, 'utf8') === marca) return { key: fs.readFileSync(kf), cert: fs.readFileSync(cf) };
  fs.mkdirSync(dir, { recursive: true });
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const keyPem = privateKey.export({ type: 'pkcs1', format: 'pem' });
  const key = forge.pki.privateKeyFromPem(keyPem);
  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.setRsaPublicKey(key.n, key.e);
  cert.serialNumber = crypto.randomBytes(8).toString('hex');
  cert.validity.notBefore = new Date(Date.now() - 86400000);
  cert.validity.notAfter = new Date(Date.now() + 800 * 86400000);
  const nome = [{ name: 'commonName', value: 'Ponto DIXI-MVP (rede local)' }];
  cert.setSubject(nome); cert.setIssuer(nome);
  cert.setExtensions([{ name: 'basicConstraints', cA: false }, { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
    { name: 'extKeyUsage', serverAuth: true },
    { name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }, { type: 7, ip: '127.0.0.1' }, ...ips.map((ip) => ({ type: 7, ip }))] }]);
  cert.sign(key, forge.md.sha256.create());
  const certPem = forge.pki.certificateToPem(cert);
  fs.writeFileSync(kf, keyPem); fs.writeFileSync(cf, certPem); fs.writeFileSync(mf, marca);
  return { key: keyPem, cert: certPem };
}

function iniciar(db, porta) {
  const handler = criarApp(db);
  const srv = http.createServer(handler);
  const sync = async () => {
    const s = await horaLegal.sincronizar();
    for (const e of db.prepare('SELECT id FROM empresas').all()) {
      db.prepare('INSERT INTO eventos_rep (empresa_id, data_hora, tipo, detalhe) VALUES (?,?,?,?)').run(e.id, T.isoBR(horaLegal.agora()), 'sincronizacao_hora', JSON.stringify(s));
    }
  };
  sync(); setInterval(sync, 6 * 3600e3).unref();
  let srvs = null;
  if (process.env.DIXI_SEM_HTTPS !== '1') {
    try { srvs = https.createServer(certificadoHttps(), handler); srvs.on('error', (e) => console.error('HTTPS indisponível:', e.message)); srvs.listen(PORTA_HTTPS, '0.0.0.0'); }
    catch (e) { console.error('HTTPS indisponível:', e.message); }
  }
  return new Promise((r) => srv.listen(porta, '0.0.0.0', () => r(srv)));
}

module.exports = { criarApp, iniciar, urlsCelular, hashSenha, validarCPF, semearFeriados };
