'use strict';
const test = require('node:test');
const assert = require('node:assert');
process.env.DIXI_DB = ':memory:';
const { abrir } = require('../src/db');
const { registrarMarcacao, verificarCadeia } = require('../src/rep');
const fiscal = require('../src/fiscal');

function base() {
  const db = abrir(':memory:');
  db.prepare("INSERT INTO empresas (cnpj, razao_social) VALUES ('11222333000181','Teste Ltda')").run();
  db.prepare("INSERT INTO funcionarios (empresa_id, nome, cpf) VALUES (1,'Fulano','52998224725')").run();
  return db;
}
const agora = new Date('2026-11-10T12:00:00Z');

test('NSR sequencial e cadeia de hash íntegra', () => {
  const db = base();
  for (let i = 0; i < 3; i++) registrarMarcacao(db, { empresaId: 1, funcionarioId: 1, agora: new Date(agora.getTime() + i * 60000) });
  const ms = db.prepare('SELECT nsr, hash, hash_anterior FROM marcacoes ORDER BY nsr').all();
  assert.deepEqual(ms.map((m) => m.nsr), [1, 2, 3]);
  assert.equal(ms[1].hash_anterior, ms[0].hash);
  assert.deepEqual(verificarCadeia(db, 1), { ok: true, registros: 3 });
});
test('marcações são imutáveis', () => {
  const db = base();
  registrarMarcacao(db, { empresaId: 1, funcionarioId: 1, agora });
  assert.throws(() => db.prepare("UPDATE marcacoes SET data_hora='x'").run(), /imutaveis/);
  assert.throws(() => db.prepare('DELETE FROM marcacoes').run(), /imutaveis/);
});
test('reenvio offline com mesmo idLocal não duplica', () => {
  const db = base();
  const a = registrarMarcacao(db, { empresaId: 1, funcionarioId: 1, agora, idLocal: 'abc', online: false, dataHora: '2026-11-10T08:00:00-03:00' });
  const b = registrarMarcacao(db, { empresaId: 1, funcionarioId: 1, agora, idLocal: 'abc', online: false, dataHora: '2026-11-10T08:00:00-03:00' });
  assert.equal(a.nsr, b.nsr); assert.equal(b.duplicada, true);
  assert.equal(a.data_hora, '2026-11-10T08:00:00-03:00'); assert.equal(a.online, 0);
});
test('AFD: cabeçalho, registros tipo 7 (137 posições) e trailer', () => {
  const db = base();
  registrarMarcacao(db, { empresaId: 1, funcionarioId: 1, agora });
  const linhas = fiscal.gerarAFD(db, 1, '2026-11-01', '2026-11-30', agora).trim().split('\r\n');
  assert.equal(linhas[0].slice(0, 10), '0000000001');
  assert.equal(linhas[1].length, 137); assert.equal(linhas[1][9], '7');
  assert.ok(linhas[2].startsWith('999999999')); assert.ok(linhas[2].endsWith('9'));
});
test('assinatura CAdES confere e detecta alteração', () => {
  const s = fiscal.assinarCAdES('conteudo');
  assert.equal(fiscal.verificarAssinatura('conteudo', s), true);
  assert.equal(fiscal.verificarAssinatura('conteudX', s), false);
});
test('comprovante é um PDF', () => {
  const db = base();
  const m = registrarMarcacao(db, { empresaId: 1, funcionarioId: 1, agora });
  assert.equal(fiscal.comprovantePDF(db, m.id).slice(0, 5).toString(), '%PDF-');
});
