'use strict';
// Arquivos fiscais (seção 7.1 item 3 do REA): AFD e AEJ no leiaute da Portaria MTP 671/2021,
// assinatura digital CAdES destacada (.p7s) e comprovante do trabalhador em PDF.
// Leiautes implementados a partir do Anexo V/VI da Portaria 671; valide com o
// validador oficial antes de uso em fiscalização.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const forge = require('node-forge');
const T = require('./tempo');
const { corpoTipo7, isoAfd, COLETOR } = require('./rep');

const PROGRAMA = { nome: 'DIXI-MVP Ponto', versao: '0.1.0', cnpjDesenvolvedor: process.env.DIXI_CNPJ_DESENV || '00000000000000', email: process.env.DIXI_EMAIL_DESENV || 'contato@exemplo.com.br' };
const NUMERO_REP_P = process.env.DIXI_REGISTRO_INPI || '00000000000000000'; // nº de registro do software no INPI (17)

const so = (s) => String(s || '').replace(/\D/g, '');
const txt = (s, n) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').slice(0, n).padEnd(n, ' ');

// CRC-16/CCITT (poli 0x1021, init 0xFFFF) em hexadecimal maiúsculo
function crc16(str) {
  let crc = 0xffff;
  for (const b of Buffer.from(str, 'latin1')) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

// ---------------- AFD ----------------
function gerarAFD(db, empresaId, inicio, fim, agora = new Date()) {
  const emp = db.prepare('SELECT * FROM empresas WHERE id=?').get(empresaId);
  const marc = db.prepare(`SELECT m.*, f.cpf, d.tipo AS tipo_disp FROM marcacoes m
    JOIN funcionarios f ON f.id=m.funcionario_id LEFT JOIN dispositivos d ON d.id=m.dispositivo_id
    WHERE m.empresa_id=? AND substr(m.data_hora,1,10) BETWEEN ? AND ? ORDER BY m.nsr`).all(empresaId, inicio, fim);

  // Registro tipo 1 — cabeçalho
  let cab = '000000000' + '1' + '1' + so(emp.cnpj).padStart(14, '0') + ''.padEnd(14, ' ') +
    txt(emp.razao_social, 150) + NUMERO_REP_P.padStart(17, '0') + inicio + fim +
    isoAfd(T.isoBR(agora)) + '003' + '1' + so(PROGRAMA.cnpjDesenvolvedor).padStart(14, '0') +
    txt(PROGRAMA.nome, 30);
  cab += crc16(cab);

  // Registros tipo 7 — marcações REP-P (campo 8 = hash SHA-256 encadeado)
  const tipo7 = marc.map((m) => corpoTipo7({
    nsr: m.nsr, dataHora: m.data_hora, cpf: m.cpf, dataHoraGravacao: m.data_hora_gravacao,
    coletor: COLETOR[m.tipo_disp] || '02', online: !!m.online,
  }) + m.hash);

  // Registro tipo 9 — trailer: quantidade de registros tipos 2,3,4,5,6,7
  const trailer = '999999999' + [0, 0, 0, 0, 0, tipo7.length].map((n) => String(n).padStart(9, '0')).join('') + '9';

  return [cab, ...tipo7, trailer].join('\r\n') + '\r\n';
}

// ---------------- AEJ ----------------
// Registros separados por "|": 01 cabeçalho, 02 REP, 03 vínculos, 04 horário contratual,
// 05 marcações, 06 matrícula eSocial, 07 ausências/banco de horas, 08 programa, 99 trailer.
function gerarAEJ(db, empresaId, inicio, fim, calculos, agora = new Date()) {
  const emp = db.prepare('SELECT * FROM empresas WHERE id=?').get(empresaId);
  const funcs = db.prepare('SELECT * FROM funcionarios WHERE empresa_id=? ORDER BY id').all(empresaId);
  const escalas = db.prepare('SELECT * FROM escalas WHERE empresa_id=?').all(empresaId);
  const l = []; const cont = {};
  const add = (tipo, ...campos) => { l.push([tipo, ...campos].join('|')); cont[tipo] = (cont[tipo] || 0) + 1; };

  add('01', '1', so(emp.cnpj), '', '', emp.razao_social, inicio, fim, T.isoBR(agora).slice(0, 16).replace('T', ' '), '001');
  add('02', '1', '3', NUMERO_REP_P);
  for (const f of funcs) add('03', f.id, so(f.cpf), f.nome);
  for (const e of escalas) {
    const c = typeof e.config === 'string' ? JSON.parse(e.config) : e.config;
    const d = e.tipo === 'fixa' ? Object.values(c.dias || {})[0] || {} : c;
    add('04', e.id, e.tipo === 'flexivel' ? (c.carga ?? 480) : '', d.entrada || '', d.saida || '', '', '');
  }
  for (const f of funcs) {
    const marc = db.prepare(`SELECT * FROM marcacoes WHERE funcionario_id=? AND substr(data_hora,1,10) BETWEEN ? AND ? ORDER BY data_hora`).all(f.id, inicio, fim);
    const inclusoes = db.prepare(`SELECT * FROM ajustes WHERE funcionario_id=? AND tipo='inclusao' AND status='aprovado' AND data BETWEEN ? AND ?`).all(f.id, inicio, fim);
    const desc = new Set(db.prepare(`SELECT marcacao_id FROM ajustes WHERE funcionario_id=? AND tipo='desconsiderar' AND status='aprovado'`).all(f.id).map((r) => r.marcacao_id));
    const todas = [
      ...marc.map((m) => ({ dh: m.data_hora, fonte: 'O', desc: desc.has(m.id), motivo: '' })),
      ...inclusoes.map((a) => ({ dh: `${a.data}T${a.hora}:00-03:00`, fonte: 'I', desc: false, motivo: a.motivo })),
    ].sort((a, b) => a.dh.localeCompare(b.dh));
    const porDia = {};
    for (const m of todas) {
      const dia = m.dh.slice(0, 10); porDia[dia] = porDia[dia] || 0;
      const tp = m.desc ? 'D' : porDia[dia] % 2 === 0 ? 'E' : 'S';
      const seq = m.desc ? '' : Math.floor(porDia[dia] / 2) + 1;
      if (!m.desc) porDia[dia]++;
      add('05', f.id, m.dh.slice(0, 16).replace('T', ' '), '1', tp, seq, m.fonte, f.escala_id || '', m.motivo);
    }
    if (f.matricula) add('06', f.id, f.matricula);
    const calc = calculos && calculos[f.id];
    if (calc) {
      for (const d of calc.dias) {
        if (d.falta) add('07', f.id, '1', d.data, d.falta, '');
        if (d.abono) add('07', f.id, '2', d.data, d.abono, '');
      }
      if (calc.totais.bancoMovimento) add('07', f.id, '3', fim, Math.abs(calc.totais.bancoMovimento), calc.totais.bancoMovimento > 0 ? '1' : '2');
    }
  }
  add('08', PROGRAMA.nome, PROGRAMA.versao, '1', so(PROGRAMA.cnpjDesenvolvedor), PROGRAMA.nome, PROGRAMA.email);
  const tipos = ['01', '02', '03', '04', '05', '06', '07', '08'];
  l.push(['99', ...tipos.map((t) => cont[t] || 0)].join('|'));
  return l.join('\r\n') + '\r\n';
}

// ---------------- Assinatura CAdES (PKCS#7 destacada) ----------------
// Usa certificado A1 (ICP-Brasil) de DIXI_CERT_PFX/DIXI_CERT_SENHA. Sem ele, gera um
// certificado de TESTE autoassinado (não vale juridicamente) em data/certs.
let certCache = null;
function carregarCertificado() {
  if (certCache) return certCache;
  const pfx = process.env.DIXI_CERT_PFX;
  if (pfx && fs.existsSync(pfx)) {
    const p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(fs.readFileSync(pfx).toString('binary')), process.env.DIXI_CERT_SENHA || '');
    const key = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag][0].key;
    const cert = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag][0].cert;
    return (certCache = { key, cert, teste: false });
  }
  const dir = path.join(__dirname, '..', 'data', 'certs');
  const kf = path.join(dir, 'teste.key.pem'); const cf = path.join(dir, 'teste.cert.pem');
  if (!fs.existsSync(kf)) {
    fs.mkdirSync(dir, { recursive: true });
    const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const key = forge.pki.privateKeyFromPem(privateKey.export({ type: 'pkcs1', format: 'pem' }));
    const cert = forge.pki.createCertificate();
    cert.publicKey = forge.pki.setRsaPublicKey(key.n, key.e);
    cert.serialNumber = '01';
    cert.validity.notBefore = new Date();
    cert.validity.notAfter = new Date(Date.now() + 5 * 365 * 86400000);
    const attrs = [{ name: 'commonName', value: 'DIXI-MVP CERTIFICADO DE TESTE' }, { name: 'countryName', value: 'BR' }];
    cert.setSubject(attrs); cert.setIssuer(attrs);
    cert.sign(key, forge.md.sha256.create());
    fs.writeFileSync(kf, forge.pki.privateKeyToPem(key));
    fs.writeFileSync(cf, forge.pki.certificateToPem(cert));
  }
  return (certCache = { key: forge.pki.privateKeyFromPem(fs.readFileSync(kf, 'utf8')), cert: forge.pki.certificateFromPem(fs.readFileSync(cf, 'utf8')), teste: true });
}

function assinarCAdES(conteudo) {
  const { key, cert } = carregarCertificado();
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(Buffer.isBuffer(conteudo) ? conteudo.toString('binary') : Buffer.from(conteudo, 'latin1').toString('binary'));
  p7.addCertificate(cert);
  p7.addSigner({
    key, certificate: cert, digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date() },
    ],
  });
  p7.sign({ detached: true });
  return Buffer.from(forge.asn1.toDer(p7.toAsn1()).getBytes(), 'binary');
}

function verificarAssinatura(conteudo, p7sDer) {
  const p7 = forge.pkcs7.messageFromAsn1(forge.asn1.fromDer(p7sDer.toString('binary')));
  const signer = p7.rawCapture;
  const attrs = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SET, true, signer.authenticatedAttributes);
  const md = forge.md.sha256.create(); md.update(forge.asn1.toDer(attrs).getBytes());
  const cert = p7.certificates[0];
  const okAssin = cert.publicKey.verify(md.digest().bytes(), signer.signature);
  // messageDigest do conteúdo
  const digest = crypto.createHash('sha256').update(Buffer.isBuffer(conteudo) ? conteudo : Buffer.from(conteudo, 'latin1')).digest('binary');
  const mdAttr = signer.authenticatedAttributes.find((a) => forge.asn1.derToOid(a.value[0].value) === forge.pki.oids.messageDigest);
  const okDigest = mdAttr.value[1].value[0].value === digest;
  return okAssin && okDigest;
}

// ---------------- Comprovante PDF ----------------
function pdfTexto(titulo, linhas) {
  const esc = (s) => txt(s, 200).trimEnd().replace(/[\\()]/g, (c) => '\\' + c);
  let y = 800; const ops = [`BT /F1 14 Tf 50 ${y} Td (${esc(titulo)}) Tj ET`];
  y -= 30;
  for (const ln of linhas) { ops.push(`BT /F1 10 Tf 50 ${y} Td (${esc(ln)}) Tj ET`); y -= 16; }
  const stream = ops.join('\n');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>',
  ];
  let out = '%PDF-1.4\n'; const offs = [];
  objs.forEach((o, i) => { offs.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

function comprovantePDF(db, marcacaoId) {
  const m = db.prepare(`SELECT m.*, f.nome, f.cpf, e.razao_social, e.cnpj, s.nome AS local, s.endereco
    FROM marcacoes m JOIN funcionarios f ON f.id=m.funcionario_id JOIN empresas e ON e.id=m.empresa_id
    LEFT JOIN estabelecimentos s ON s.id=f.estabelecimento_id WHERE m.id=?`).get(marcacaoId);
  if (!m) return null;
  return pdfTexto('Comprovante de Registro de Ponto do Trabalhador', [
    `Empregador: ${m.razao_social}`,
    `CNPJ: ${m.cnpj}`,
    `Local: ${m.local || '-'} ${m.endereco || ''}`,
    `REP-P (registro INPI): ${NUMERO_REP_P}`,
    `Trabalhador: ${m.nome}`,
    `CPF: ${m.cpf}`,
    `Data e hora da marcacao: ${m.data_hora.slice(0, 10).split('-').reverse().join('/')} ${m.data_hora.slice(11, 16)}`,
    `NSR: ${String(m.nsr).padStart(9, '0')}`,
    `Marcacao ${m.online ? 'online' : 'offline'} - gravada em ${m.data_hora_gravacao}`,
    `Codigo hash (SHA-256):`,
    m.hash.slice(0, 32), m.hash.slice(32),
  ]);
}

module.exports = { gerarAFD, gerarAEJ, assinarCAdES, verificarAssinatura, comprovantePDF, pdfTexto, crc16, carregarCertificado, PROGRAMA };
