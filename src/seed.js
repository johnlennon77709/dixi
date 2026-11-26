'use strict';
// Cerca virtual: a demo vem sem coordenadas para funcionar de qualquer lugar; cadastre
// latitude/longitude do estabelecimento (aba Dispositivos) para exigir o GPS no local.
// Popula uma empresa de demonstração com escalas, funcionários, dispositivo e um mês de marcações.
const { abrir } = require('./db');
const { hashSenha, semearFeriados } = require('./app');
const { registrarMarcacao } = require('./rep');
const T = require('./tempo');

if (process.env.DIXI_PRODUCAO === '1' && process.env.DIXI_SEED_FORCAR !== '1') {
  console.error('Em produção a empresa de demonstração não é criada. Crie a sua conta pelo site.'); process.exit(1);
}
const db = abrir();
if (db.prepare("SELECT 1 FROM usuarios WHERE email='admin@demo.com'").get()) {
  console.log('Demo já existe. Login: admin@demo.com / demo123'); process.exit(0);
}
const hoje = T.dataBR(new Date());
const ano = Number(hoje.slice(0, 4));
semearFeriados(db, ano); semearFeriados(db, ano + 1);

const emp = Number(db.prepare("INSERT INTO empresas (cnpj, razao_social) VALUES ('11222333000181','Padaria Demo Ltda')").run().lastInsertRowid);
db.prepare('INSERT INTO usuarios (empresa_id, email, senha_hash, nome) VALUES (?,?,?,?)').run(emp, 'admin@demo.com', hashSenha('demo123'), 'Admin Demo');
const est = Number(db.prepare(`INSERT INTO estabelecimentos (empresa_id, nome, endereco, latitude, longitude, raio_metros, uf)
  VALUES (?, 'Loja Centro', 'Rua XV de Novembro, 100 - Curitiba/PR', NULL, NULL, 300, 'PR')`).run(emp).lastInsertRowid);

const esc = (nome, tipo, config) => Number(db.prepare('INSERT INTO escalas (empresa_id, nome, tipo, config) VALUES (?,?,?,?)').run(emp, nome, tipo, JSON.stringify(config)).lastInsertRowid);
const dia = { entrada: '08:00', saida: '17:00', intervalo: 60 };
const fixa = esc('Comercial 08-17 (seg-sex) + sáb 08-12', 'fixa', { dias: { 1: dia, 2: dia, 3: dia, 4: dia, 5: dia, 6: { entrada: '08:00', saida: '12:00', intervalo: 0 } } });
const doze = esc('12x36 noturno 19h-07h', '12x36', { inicio: T.somarDias(hoje, -40), entrada: '19:00', horas: 12, intervalo: 60 });
const flex = esc('Flexível 8h/dia', 'flexivel', { carga: 480, intervalo: 60, dias: [1, 2, 3, 4, 5] });

const func = (nome, cpf, escala, matricula) => Number(db.prepare(`INSERT INTO funcionarios (empresa_id, estabelecimento_id, escala_id, nome, cpf, matricula, pin_hash, admissao)
  VALUES (?,?,?,?,?,?,?,?)`).run(emp, est, escala, nome, cpf, matricula, hashSenha('1234'), T.somarDias(hoje, -31)).lastInsertRowid);
const ana = func('Ana Souza', '52998224725', fixa, '001');
const bruno = func('Bruno Lima', '16899535009', doze, '002');
const carla = func('Carla Mendes', '71428793860', flex, '003');

db.prepare("INSERT INTO dispositivos (empresa_id, estabelecimento_id, nome, tipo, token, numero_coletor) VALUES (?,?, 'Tablet do balcão', 'quiosque', 'demo-quiosque', 1)").run(emp, est);
db.prepare("INSERT INTO dispositivos (empresa_id, estabelecimento_id, nome, tipo, token, numero_coletor) VALUES (?,?, 'Celulares (app)', 'app', 'demo-app', 2)").run(emp, est);
const disp = db.prepare("SELECT * FROM dispositivos WHERE token='demo-quiosque'").get();

// Marcações dos últimos 30 dias (gravadas como offline com a hora original)
const r = (n) => Math.floor(Math.random() * n);
const marcar = (f, data, hora) => registrarMarcacao(db, { empresaId: emp, funcionarioId: f, dispositivoId: disp.id, tipoColetor: 'quiosque',
  agora: new Date(), dataHora: `${data}T${hora}:00-03:00`, online: false, metodo: 'pin', idLocal: `seed-${f}-${data}-${hora}` });
const hh = (min) => T.fmt(min);
const eventos = [];
for (let i = 30; i >= 1; i--) {
  const data = T.somarDias(hoje, -i); const dow = T.diaSemana(data);
  if (dow >= 1 && dow <= 5) {
    // Ana: dentro da tolerância na maior parte dos dias, às vezes faz hora extra
    const extra = i % 7 === 0 ? 75 : 0;
    const alm = 720 + r(4);
    eventos.push([ana, data, hh(480 - 3 + r(6))], [ana, data, hh(alm)], [ana, data, hh(alm + 60 + r(3))], [ana, data, hh(1020 - 2 + r(5) + extra)]);
    // Carla: flexível, às vezes intervalo curto ou esquece a saída
    const ent = 540 + r(30);
    eventos.push([carla, data, hh(ent)], [carla, data, hh(ent + 240)], [carla, data, hh(ent + 240 + (i % 5 === 0 ? 30 : 60))]);
    if (i !== 9) eventos.push([carla, data, hh(ent + 540 + (i % 5 === 0 ? -30 : 0))]);
  } else if (dow === 6) {
    { const e0 = 480 + r(3); eventos.push([ana, data, hh(e0)], [ana, data, hh(e0 + 240 - r(3))]); }
  }
  // Bruno: 12x36 noturno 19h-07h com 1h de intervalo
  if (((T.diasEntre(T.somarDias(hoje, -40), data) % 2) + 2) % 2 === 0) {
    const prox = T.somarDias(data, 1);
    eventos.push([bruno, data, hh(1140 + r(3))], [bruno, prox, hh(60)], [bruno, prox, hh(120)], [bruno, prox, hh(420 + r(10))]);
  }
}
eventos.sort((a, b) => (a[1] + a[2]).localeCompare(b[1] + b[2]));
for (const [f, d, h] of eventos) { if (d < hoje) marcar(f, d, h); }

// Um ajuste pendente para mostrar o fluxo de tratamento
db.prepare(`INSERT INTO ajustes (empresa_id, funcionario_id, tipo, data, hora, motivo, solicitado_por) VALUES (?,?,?,?,?,?,?)`)
  .run(emp, carla, 'inclusao', T.somarDias(hoje, -9), '18:00', 'Esqueceu de registrar a saída', 'admin@demo.com');

console.log(`Demo criada: ${eventos.length} marcações.`);
console.log('Painel RH: admin@demo.com / demo123');
console.log('App de ponto: token do quiosque "demo-quiosque", token do app "demo-app"; PIN de todos: 1234');
