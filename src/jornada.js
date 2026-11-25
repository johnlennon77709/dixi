'use strict';
// Motor de jornada (seção 7.1 item 2 do REA):
// escalas fixas/12x36/flexíveis, tolerância (art. 58 §1º CLT), HE 50%/100%,
// adicional noturno com hora reduzida (art. 73 CLT), intervalo intrajornada (art. 71),
// interjornada (art. 66), DSR (reflexo das HE) e banco de horas.
const T = require('./tempo');

const TOLERANCIA_MARCACAO = 5;   // min por marcação
const TOLERANCIA_DIARIA = 10;    // min por dia
const INTERJORNADA_MIN = 11 * 60;
const HORA_NOTURNA = 52.5;       // 52min30s

function cfg(escala) {
  return typeof escala.config === 'string' ? JSON.parse(escala.config) : escala.config;
}

// Jornada prevista para uma data. Retorna null em dia de folga.
// { entrada, saida (min a partir de 00:00 do dia, pode passar de 1440), intervalo, minutos }
function previstoPara(escala, data) {
  const c = cfg(escala);
  if (escala.tipo === 'fixa') {
    const d = c.dias && c.dias[String(T.diaSemana(data))];
    if (!d) return null;
    const entrada = T.hm(d.entrada); let saida = T.hm(d.saida);
    if (saida <= entrada) saida += 1440;
    const intervalo = d.intervalo || 0;
    return { entrada, saida, intervalo, minutos: saida - entrada - intervalo };
  }
  if (escala.tipo === '12x36') {
    const dif = T.diasEntre(c.inicio, data);
    if (((dif % 2) + 2) % 2 !== 0) return null;
    const entrada = T.hm(c.entrada); const horas = c.horas || 12;
    const intervalo = c.intervalo ?? 60;
    return { entrada, saida: entrada + horas * 60, intervalo, minutos: horas * 60 - intervalo };
  }
  if (escala.tipo === 'flexivel') {
    const dias = c.dias || [1, 2, 3, 4, 5];
    if (!dias.includes(T.diaSemana(data))) return null;
    return { entrada: null, saida: null, intervalo: c.intervalo ?? 60, minutos: c.carga ?? 480 };
  }
  throw new Error('tipo de escala desconhecido: ' + escala.tipo);
}

// Minuto do dia que separa uma jornada da outra. Para jornadas que cruzam a
// meia-noite (ex.: 12x36 noturna 19h-07h), a "virada" fica 6h antes da entrada,
// para que a saída das 07h pertença ao dia em que a jornada começou.
function viradaDoDia(escala) {
  const c = cfg(escala);
  let entrada = null; let cruza = false;
  if (escala.tipo === 'fixa') {
    for (const d of Object.values(c.dias || {})) {
      if (T.hm(d.saida) <= T.hm(d.entrada)) { cruza = true; entrada = T.hm(d.entrada); }
    }
  } else if (escala.tipo === '12x36') {
    entrada = T.hm(c.entrada); cruza = entrada + (c.horas || 12) * 60 > 1440;
  }
  return cruza ? Math.max(0, entrada - 360) : 0;
}

function sobreposicao(a0, a1, b0, b1) { return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0)); }

function minutosNoturnos(pares) {
  let total = 0;
  for (const [i, f] of pares) {
    for (let k = -1; k <= 2; k++) total += sobreposicao(i, f, 1320 + 1440 * k, 1740 + 1440 * k);
  }
  return total;
}

// Calcula um dia. batidas = minutos desde 00:00 da data da jornada (ordenados).
function calcularDia({ previsto, batidas, especial = false, abono = 0 }) {
  const b = [...batidas].sort((x, y) => x - y);
  const inconsistente = b.length % 2 !== 0;
  const pares = [];
  for (let i = 0; i + 1 < b.length; i += 2) pares.push([b[i], b[i + 1]]);
  const trabalhado = pares.reduce((s, [i, f]) => s + (f - i), 0);
  let intervaloFeito = 0;
  for (let i = 1; i < pares.length; i++) intervaloFeito += pares[i][0] - pares[i - 1][1];

  const noturno = minutosNoturnos(pares);
  const noturnoReduzido = Math.round((noturno * 60) / HORA_NOTURNA);

  const intervaloMinimo = trabalhado > 360 ? 60 : trabalhado > 240 ? 15 : 0;
  const intervaloSuprimido = Math.max(0, intervaloMinimo - intervaloFeito);

  const r = {
    trabalhado, previsto: 0, extra50: 0, extra100: 0, falta: 0, abono: 0,
    noturno, noturnoReduzido, intervaloFeito, intervaloSuprimido,
    toleranciaAplicada: false, inconsistente,
  };

  if (especial) { r.extra100 = trabalhado; return r; }
  if (!previsto) { r.extra50 = trabalhado; return r; } // trabalho em folga da escala

  r.previsto = previsto.minutos;
  let dif = trabalhado - previsto.minutos;

  // Art. 58 §1º: variações de até 5 min por marcação, máx. 10 min/dia, não são computadas.
  // Se ultrapassar, conta-se a totalidade (Súmula 366 TST).
  if (b.length >= 2 && Math.abs(dif) <= TOLERANCIA_DIARIA) {
    const okMarcacoes = previsto.entrada == null ||
      (Math.abs(b[0] - previsto.entrada) <= TOLERANCIA_MARCACAO &&
       Math.abs(b[b.length - 1] - previsto.saida) <= TOLERANCIA_MARCACAO);
    if (okMarcacoes) { r.toleranciaAplicada = dif !== 0; dif = 0; }
  }

  if (dif > 0) r.extra50 = dif;
  else if (dif < 0) {
    r.abono = Math.min(abono, -dif);
    r.falta = -dif - r.abono;
  }
  return r;
}

// Calcula um período (normalmente o mês) para um funcionário.
// marcacoes: [{ id, data_hora: ISO -03:00 }] já tratadas (sem as desconsideradas, com inclusões).
// hoje: dias depois de hoje não são calculados e o dia de hoje (em andamento) não gera falta.
function calcularPeriodo({ escala, marcacoes, inicio, fim, feriados = [], abonos = {}, usaBancoHoras = true, saldoAnterior = 0, hoje = null }) {
  if (hoje && fim > hoje) fim = hoje < inicio ? T.somarDias(inicio, -1) : hoje;
  const virada = viradaDoDia(escala);
  const feriadoSet = new Set(feriados);
  const porDia = new Map();
  for (const m of marcacoes) {
    const data = m.data_hora.slice(0, 10);
    const min = T.hm(m.data_hora.slice(11, 16));
    // data da jornada = data de (instante - virada)
    let dJ = data; let rel = min;
    if (min < virada) { dJ = T.somarDias(data, -1); rel = min + 1440; }
    if (!porDia.has(dJ)) porDia.set(dJ, []);
    porDia.get(dJ).push(rel);
  }

  const dias = []; let ultimaSaidaAbs = null;
  const tot = {
    trabalhado: 0, previsto: 0, extra50: 0, extra100: 0, falta: 0, abono: 0, noturno: 0,
    noturnoReduzido: 0, intervaloSuprimido: 0, interjornadaViolada: 0, inconsistencias: 0,
    diasUteis: 0, diasDescanso: 0,
  };

  for (const data of T.intervaloDatas(inicio, fim)) {
    const dow = T.diaSemana(data);
    const previsto = previstoPara(escala, data);
    const feriado = feriadoSet.has(data);
    const especial = feriado || (dow === 0 && !previsto);
    if (dow === 0 || feriado) tot.diasDescanso++; else tot.diasUteis++;

    const batidas = (porDia.get(data) || []).sort((a, b) => a - b);
    const r = calcularDia({ previsto: feriado ? null : previsto, batidas, especial, abono: abonos[data] || 0 });

    // Interjornada (art. 66): 11h entre o fim de uma jornada e o início da próxima.
    const base = T.diasEntre(inicio, data) * 1440;
    let interjornada = 0;
    if (batidas.length) {
      if (ultimaSaidaAbs != null) {
        const desc = base + batidas[0] - ultimaSaidaAbs;
        if (desc < INTERJORNADA_MIN) interjornada = INTERJORNADA_MIN - desc;
      }
      ultimaSaidaAbs = base + batidas[batidas.length - 1];
    }
    r.interjornadaViolada = interjornada;
    if (hoje && data === hoje) { r.falta = 0; r.emAndamento = true; }

    dias.push({
      data, diaSemana: dow, feriado, previstoInfo: previsto,
      batidas: batidas.map(T.fmt), ...r,
    });
    for (const k of ['trabalhado', 'previsto', 'extra50', 'extra100', 'falta', 'abono', 'noturno', 'noturnoReduzido', 'intervaloSuprimido']) tot[k] += r[k];
    tot.interjornadaViolada += interjornada;
    if (r.inconsistente) tot.inconsistencias++;
  }

  // Banco de horas: HE 50% e faltas compensam entre si; HE 100% (domingo/feriado) são pagas.
  const bancoMovimento = usaBancoHoras ? tot.extra50 - tot.falta : 0;
  const hePagas50 = usaBancoHoras ? 0 : tot.extra50;
  const faltasDescontadas = usaBancoHoras ? 0 : tot.falta;
  // DSR reflexo das HE habituais (Lei 605/49, Súmula 172 TST): HE pagas / dias úteis × dias de descanso
  const hePagas = hePagas50 + tot.extra100;
  const dsrReflexo = tot.diasUteis ? Math.round((hePagas / tot.diasUteis) * tot.diasDescanso) : 0;

  return {
    dias,
    totais: {
      ...tot, hePagas50, hePagas100: tot.extra100, faltasDescontadas, dsrReflexo,
      bancoMovimento, bancoSaldoAnterior: saldoAnterior, bancoSaldo: saldoAnterior + bancoMovimento,
    },
  };
}

module.exports = { previstoPara, viradaDoDia, calcularDia, calcularPeriodo, minutosNoturnos };
