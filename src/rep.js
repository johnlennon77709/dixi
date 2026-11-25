'use strict';
// REP-P: gravação das marcações (append-only, NSR sequencial, hash SHA-256 encadeado).
const crypto = require('node:crypto');
const T = require('./tempo');

const COLETOR = { app: '01', web: '02', quiosque: '04' }; // 01 app mobile, 02 navegador, 04 dispositivo eletrônico

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const so = (s) => String(s || '').replace(/\D/g, '');

// "2026-11-25T08:00:00-03:00" -> "2026-11-25T08:00:00-0300" (formato do AFD)
const isoAfd = (iso) => iso.slice(0, 19) + iso.slice(19).replace(':', '');

// Campos 1 a 7 do registro tipo 7 do AFD (marcação de ponto em REP-P)
function corpoTipo7({ nsr, dataHora, cpf, dataHoraGravacao, coletor, online }) {
  return String(nsr).padStart(9, '0') + '7' + isoAfd(dataHora) +
    so(cpf).padStart(12, '0') + isoAfd(dataHoraGravacao) + coletor + (online ? '0' : '1');
}

// Registra uma marcação. Idempotente por id_local (reenvio da fila offline não duplica).
function registrarMarcacao(db, m) {
  if (m.idLocal) {
    const ja = db.prepare('SELECT * FROM marcacoes WHERE empresa_id=? AND id_local=?').get(m.empresaId, m.idLocal);
    if (ja) return { ...ja, duplicada: true };
  }
  const func = db.prepare('SELECT * FROM funcionarios WHERE id=? AND empresa_id=? AND ativo=1').get(m.funcionarioId, m.empresaId);
  if (!func) throw Object.assign(new Error('funcionário não encontrado'), { status: 404 });

  const gravacao = T.isoBR(m.agora);
  const dataHora = m.dataHora ? T.isoBR(new Date(m.dataHora)) : gravacao;
  if (new Date(dataHora) - m.agora > 5 * 60000) {
    throw Object.assign(new Error('marcação no futuro rejeitada'), { status: 400 });
  }
  const dataHoraMin = dataHora.slice(0, 17) + '00' + dataHora.slice(19); // AFD registra hh:mm:00
  const online = m.online !== false;

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('INSERT OR IGNORE INTO rep_sequencia (empresa_id) VALUES (?)').run(m.empresaId);
    const seq = db.prepare('SELECT * FROM rep_sequencia WHERE empresa_id=?').get(m.empresaId);
    const nsr = seq.ultimo_nsr + 1;
    const corpo = corpoTipo7({
      nsr, dataHora: dataHoraMin, cpf: func.cpf, dataHoraGravacao: gravacao,
      coletor: COLETOR[m.tipoColetor] || '02', online,
    });
    const hash = sha256(corpo + seq.ultimo_hash);
    const r = db.prepare(`INSERT INTO marcacoes (empresa_id, funcionario_id, dispositivo_id, nsr, data_hora,
      data_hora_gravacao, online, latitude, longitude, precisao, metodo, foto_hash, id_local, hash, hash_anterior)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      m.empresaId, func.id, m.dispositivoId ?? null, nsr, dataHoraMin, gravacao, online ? 1 : 0,
      m.latitude ?? null, m.longitude ?? null, m.precisao ?? null, m.metodo || 'web',
      m.fotoHash ?? null, m.idLocal ?? null, hash, seq.ultimo_hash);
    db.prepare('UPDATE rep_sequencia SET ultimo_nsr=?, ultimo_hash=? WHERE empresa_id=?').run(nsr, hash, m.empresaId);
    db.exec('COMMIT');
    return db.prepare('SELECT * FROM marcacoes WHERE id=?').get(r.lastInsertRowid);
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

// Confere a cadeia de hashes e a sequência de NSR de uma empresa (auditoria).
function verificarCadeia(db, empresaId) {
  const linhas = db.prepare(`SELECT m.*, f.cpf, d.tipo AS tipo_disp FROM marcacoes m
    JOIN funcionarios f ON f.id=m.funcionario_id LEFT JOIN dispositivos d ON d.id=m.dispositivo_id
    WHERE m.empresa_id=? ORDER BY m.nsr`).all(empresaId);
  let anterior = ''; let esperado = 1;
  for (const l of linhas) {
    if (l.nsr !== esperado) return { ok: false, erro: `NSR fora de sequência em ${l.nsr}` };
    if (l.hash_anterior !== anterior) return { ok: false, erro: `hash anterior diverge no NSR ${l.nsr}` };
    const corpo = corpoTipo7({
      nsr: l.nsr, dataHora: l.data_hora, cpf: l.cpf, dataHoraGravacao: l.data_hora_gravacao,
      coletor: COLETOR[l.tipo_disp] || '02', online: !!l.online,
    });
    if (sha256(corpo + anterior) !== l.hash) return { ok: false, erro: `hash inválido no NSR ${l.nsr}` };
    anterior = l.hash; esperado++;
  }
  return { ok: true, registros: linhas.length };
}

module.exports = { registrarMarcacao, verificarCadeia, corpoTipo7, isoAfd, sha256, COLETOR };
