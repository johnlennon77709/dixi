'use strict';
// Liga o banco ao motor de jornada: aplica o tratamento (ajustes aprovados) sem
// alterar as marcações originais e calcula o espelho de ponto.
const { calcularPeriodo } = require('./jornada');
const T = require('./tempo');

const ESCALA_PADRAO = { tipo: 'flexivel', config: { carga: 480, intervalo: 60, dias: [1, 2, 3, 4, 5] } };

function feriadosDe(db, empresaId, inicio, fim) {
  return db.prepare(`SELECT data FROM feriados WHERE (empresa_id IS NULL OR empresa_id=?) AND data BETWEEN ? AND ?`)
    .all(empresaId, inicio, fim).map((r) => r.data);
}

function marcacoesTratadas(db, funcionarioId, inicio, fim) {
  // janela de 1 dia extra para jornadas que cruzam a meia-noite
  const fimMais = T.somarDias(fim, 1);
  const originais = db.prepare(`SELECT id, data_hora, nsr, online, metodo FROM marcacoes
    WHERE funcionario_id=? AND substr(data_hora,1,10) BETWEEN ? AND ? ORDER BY data_hora`).all(funcionarioId, inicio, fimMais);
  const ajustes = db.prepare(`SELECT * FROM ajustes WHERE funcionario_id=? AND status='aprovado' AND data BETWEEN ? AND ?`)
    .all(funcionarioId, inicio, fimMais);
  const desc = new Set(ajustes.filter((a) => a.tipo === 'desconsiderar').map((a) => a.marcacao_id));
  const lista = originais.filter((m) => !desc.has(m.id)).map((m) => ({ ...m, origem: 'original' }));
  for (const a of ajustes.filter((x) => x.tipo === 'inclusao')) {
    lista.push({ id: null, data_hora: `${a.data}T${a.hora}:00-03:00`, origem: 'incluida', motivo: a.motivo });
  }
  const abonos = {};
  for (const a of ajustes.filter((x) => x.tipo === 'abono')) abonos[a.data] = (abonos[a.data] || 0) + (a.minutos || 0);
  return { lista: lista.sort((a, b) => a.data_hora.localeCompare(b.data_hora)), abonos, desconsideradas: desc };
}

function saldoBancoAnterior(db, f, inicio) {
  // Saldo acumulado desde a admissão até o dia anterior ao período (recalculado — fonte única de verdade).
  const desde = f.admissao || db.prepare('SELECT substr(min(data_hora),1,10) d FROM marcacoes WHERE funcionario_id=?').get(f.id).d;
  if (!desde || desde >= inicio) return 0;
  const r = espelho(db, f, desde, T.somarDias(inicio, -1), { semSaldoAnterior: true });
  return r.totais.bancoMovimento;
}

function espelho(db, funcionario, inicio, fim, opts = {}) {
  const f = typeof funcionario === 'object' ? funcionario : db.prepare('SELECT * FROM funcionarios WHERE id=?').get(funcionario);
  const emp = db.prepare('SELECT * FROM empresas WHERE id=?').get(f.empresa_id);
  const escala = f.escala_id ? db.prepare('SELECT * FROM escalas WHERE id=?').get(f.escala_id) : ESCALA_PADRAO;
  const { lista, abonos } = marcacoesTratadas(db, f.id, inicio, fim);
  const saldoAnterior = opts.semSaldoAnterior || !emp.usa_banco_horas ? 0 : saldoBancoAnterior(db, f, inicio);
  const r = calcularPeriodo({
    escala, marcacoes: lista, inicio, fim, feriados: feriadosDe(db, f.empresa_id, inicio, fim),
    abonos, usaBancoHoras: !!emp.usa_banco_horas, saldoAnterior, hoje: opts.hoje || T.dataBR(new Date()),
  });
  return { funcionario: { id: f.id, nome: f.nome, cpf: f.cpf, matricula: f.matricula }, escala: { nome: escala.nome || 'Padrão 8h', tipo: escala.tipo }, inicio, fim, ...r, marcacoes: lista };
}

module.exports = { espelho, marcacoesTratadas, feriadosDe };
