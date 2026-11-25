'use strict';
const { abrir } = require('./db');
const { iniciar } = require('./app');

const porta = Number(process.env.PORT || 3000);
const db = abrir();
iniciar(db, porta).then(() => {
  console.log(`DIXI-MVP rodando em http://localhost:${porta}`);
  console.log(`  Painel do RH ........ http://localhost:${porta}/`);
  console.log(`  App de ponto (REP-P)  http://localhost:${porta}/ponto.html`);
});
