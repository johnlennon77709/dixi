'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { calcularDia, calcularPeriodo, previstoPara } = require('../src/jornada');

const comercial = { tipo: 'fixa', config: { dias: { 1: { entrada: '08:00', saida: '17:00', intervalo: 60 }, 2: { entrada: '08:00', saida: '17:00', intervalo: 60 } } } };
const prev = { entrada: 480, saida: 1020, intervalo: 60, minutos: 480 };
const h = (s) => { const [a, b] = s.split(':').map(Number); return a * 60 + b; };

test('jornada exata não gera extra nem falta', () => {
  const r = calcularDia({ previsto: prev, batidas: ['08:00', '12:00', '13:00', '17:00'].map(h) });
  assert.equal(r.trabalhado, 480); assert.equal(r.extra50, 0); assert.equal(r.falta, 0);
});
test('tolerância art. 58: até 5 min por marcação e 10 min/dia são desconsiderados', () => {
  const r = calcularDia({ previsto: prev, batidas: ['07:56', '12:00', '13:00', '17:04'].map(h) });
  assert.equal(r.extra50, 0); assert.equal(r.toleranciaAplicada, true);
});
test('passou da tolerância: conta tudo (Súmula 366)', () => {
  const r = calcularDia({ previsto: prev, batidas: ['07:50', '12:00', '13:00', '17:00'].map(h) });
  assert.equal(r.extra50, 10);
});
test('atraso vira falta e abono compensa', () => {
  const r = calcularDia({ previsto: prev, batidas: ['09:00', '12:00', '13:00', '17:00'].map(h), abono: 30 });
  assert.equal(r.falta, 30); assert.equal(r.abono, 30);
});
test('intervalo intrajornada menor que 1h em jornada > 6h é apontado', () => {
  const r = calcularDia({ previsto: prev, batidas: ['08:00', '12:00', '12:30', '17:00'].map(h) });
  assert.equal(r.intervaloSuprimido, 30); assert.equal(r.extra50, 30);
});
test('adicional noturno com hora reduzida (22h-05h = 7h reais = 8h noturnas)', () => {
  const r = calcularDia({ previsto: null, batidas: [h('22:00'), h('05:00') + 1440] });
  assert.equal(r.noturno, 420); assert.equal(r.noturnoReduzido, 480);
});
test('feriado/domingo: tudo é HE 100%', () => {
  const r = calcularDia({ previsto: null, batidas: ['08:00', '12:00'].map(h), especial: true });
  assert.equal(r.extra100, 240);
});
test('marcação ímpar é inconsistente', () => {
  assert.equal(calcularDia({ previsto: prev, batidas: [h('08:00')] }).inconsistente, true);
});
test('12x36 alterna dias de trabalho e folga', () => {
  const e = { tipo: '12x36', config: { inicio: '2026-11-02', entrada: '19:00', horas: 12, intervalo: 60 } };
  assert.ok(previstoPara(e, '2026-11-02')); assert.equal(previstoPara(e, '2026-11-03'), null); assert.ok(previstoPara(e, '2026-11-04'));
});
test('12x36 noturno: saída das 07h pertence ao dia em que a jornada começou', () => {
  const e = { tipo: '12x36', config: { inicio: '2026-11-02', entrada: '19:00', horas: 12, intervalo: 60 } };
  const ms = ['2026-11-02T19:00', '2026-11-03T01:00', '2026-11-03T02:00', '2026-11-03T07:00'].map((d) => ({ data_hora: d + ':00-03:00' }));
  const r = calcularPeriodo({ escala: e, marcacoes: ms, inicio: '2026-11-02', fim: '2026-11-03' });
  assert.equal(r.dias[0].trabalhado, 660); assert.equal(r.dias[0].falta, 0); assert.equal(r.dias[1].trabalhado, 0);
  assert.equal(r.dias[0].noturno, 360); // 22-01 e 02-05
});
test('interjornada menor que 11h é apontada', () => {
  const ms = ['2026-11-02T08:00', '2026-11-02T23:00', '2026-11-03T08:00', '2026-11-03T17:00'].map((d) => ({ data_hora: d + ':00-03:00' }));
  const r = calcularPeriodo({ escala: comercial, marcacoes: ms, inicio: '2026-11-02', fim: '2026-11-03' });
  assert.equal(r.dias[1].interjornadaViolada, 120);
});
test('banco de horas: HE 50% e faltas compensam; sem banco, são pagas/descontadas', () => {
  const ms = ['2026-11-02T08:00', '2026-11-02T12:00', '2026-11-02T13:00', '2026-11-02T18:00',
    '2026-11-03T08:00', '2026-11-03T12:00', '2026-11-03T13:00', '2026-11-03T16:30'].map((d) => ({ data_hora: d + ':00-03:00' }));
  const com = calcularPeriodo({ escala: comercial, marcacoes: ms, inicio: '2026-11-02', fim: '2026-11-03', usaBancoHoras: true, saldoAnterior: 15 });
  assert.equal(com.totais.bancoMovimento, 30); assert.equal(com.totais.bancoSaldo, 45); assert.equal(com.totais.hePagas50, 0);
  const sem = calcularPeriodo({ escala: comercial, marcacoes: ms, inicio: '2026-11-02', fim: '2026-11-03', usaBancoHoras: false });
  assert.equal(sem.totais.hePagas50, 60); assert.equal(sem.totais.faltasDescontadas, 30);
});
