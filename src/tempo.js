'use strict';
// Utilitários de data/hora no fuso de Brasília (UTC-03:00, sem horário de verão desde 2019).
const OFFSET_MIN = -180;
const SUFIXO = '-03:00';

const pad = (n, l = 2) => String(n).padStart(l, '0');

// Date (instante) -> partes no horário de Brasília
function partesBR(d) {
  const t = new Date(d.getTime() + OFFSET_MIN * 60000);
  return {
    ano: t.getUTCFullYear(), mes: t.getUTCMonth() + 1, dia: t.getUTCDate(),
    hora: t.getUTCHours(), min: t.getUTCMinutes(), seg: t.getUTCSeconds(),
  };
}

// ISO 8601 com fuso: 2026-11-25T08:00:00-03:00
function isoBR(d) {
  const p = partesBR(d);
  return `${p.ano}-${pad(p.mes)}-${pad(p.dia)}T${pad(p.hora)}:${pad(p.min)}:${pad(p.seg)}${SUFIXO}`;
}

const dataBR = (d) => isoBR(d).slice(0, 10);
const horaBR = (d) => isoBR(d).slice(11, 16);

// "HH:MM" -> minutos
function hm(s) {
  if (s == null || s === '') return null;
  const [h, m] = String(s).split(':').map(Number);
  return h * 60 + m;
}
// minutos -> "HH:MM" (aceita negativo e > 24h)
function fmt(min) {
  const neg = min < 0; const a = Math.abs(Math.round(min));
  return `${neg ? '-' : ''}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

// AAAA-MM-DD -> dia da semana (0 = domingo)
function diaSemana(data) { return new Date(data + 'T12:00:00Z').getUTCDay(); }
function somarDias(data, n) {
  const d = new Date(data + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function diasEntre(a, b) {
  return Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 86400000);
}
function intervaloDatas(inicio, fim) {
  const out = []; for (let d = inicio; d <= fim; d = somarDias(d, 1)) out.push(d); return out;
}
function ultimoDiaMes(ano, mes) { return new Date(Date.UTC(ano, mes, 0)).getUTCDate(); }

module.exports = {
  OFFSET_MIN, SUFIXO, pad, partesBR, isoBR, dataBR, horaBR, hm, fmt,
  diaSemana, somarDias, diasEntre, intervaloDatas, ultimoDiaMes,
};
